/**
 * 第八阶段 PR E：礼物（清单、送礼与回应、请 TA 送礼、纪念日关联、角色隔离、失败处理）：npm test
 * 【模拟模型】检查发给模型的真实内容与对结果的处理。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { createCharacter } from '../src/db/repo'
import { addMemory } from '../src/db/memoryRepo'
import { saveEvent } from '../src/db/eventRepo'
import { GIFTS, CATEGORIES, giftById } from '../src/gifts/catalog'
import { anniversariesOf, askCharacterGift, deleteGiftRecord, parseChoice, requestReply, restoreGiftRecord, sendGift, toggleGiftStar } from '../src/gifts/gifts'

type Body = { messages: { role: string; content: string }[] }
let bodies: Body[] = []
let answer = '……谢谢。我会把它放在书桌上。'
let status = 200
const fetchImpl = (async (_u: string, init: RequestInit) => {
  bodies.push(JSON.parse(String(init.body)))
  if (status !== 200) return new Response('{"error":{"message":"server down"}}', { status })
  return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { headers: { 'content-type': 'application/json' } })
}) as unknown as typeof fetch

let A = ''
let B = ''
beforeEach(async () => {
  await db.delete()
  await db.open()
  bodies = []
  status = 200
  answer = '……谢谢。我会把它放在书桌上。'
  await setSetting('ai-config', { service: 'custom', mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', proxyUrl: '', proxyToken: '', model: 'gift-model', temperature: 0.7, maxTokens: 300 })
  await setSetting('profile', { nickname: '小雪', signature: '' })
  A = (await createCharacter({ name: '沈星回', bio: '', personality: '冷静内敛', speakingStyle: '克制', backstory: '', relationToUser: '朋友' })).id
  B = (await createCharacter({ name: '林小满', bio: '', personality: '活泼外向', speakingStyle: '轻快', backstory: '', relationToUser: '好朋友' })).id
})

test('清单：每份礼物 id 唯一、有类别与图标；6 个类别都有礼物', () => {
  assert.equal(new Set(GIFTS.map((g) => g.id)).size, GIFTS.length)
  for (const c of CATEGORIES) assert.ok(GIFTS.some((g) => g.category === c.id), c.name)
  assert.ok(GIFTS.length >= 24)
})

test('【模拟模型】送礼物：保存记录并真实请求回应；请求包含人设、礼物、留言、纪念日与相关记忆；不含其他角色', async () => {
  await addMemory(A, { kind: 'preference', content: '小雪喜欢看星星' })
  await addMemory(B, { kind: 'preference', content: '小雪爱喝拿铁' })
  const ev = await saveEvent(null, { title: '初次认识', kind: 'anniversary', allDay: true, date: '2026-01-05', location: '', note: '', repeat: 'yearly', diaryIds: [], characterId: A, anniversaryType: 'met' })
  const r = await sendGift({ characterId: A, giftId: 'telescope', message: '一起看星星吧', eventId: ev, fetchImpl })
  assert.deepEqual([r.replyStatus, r.reply, r.model, r.direction], ['done', '……谢谢。我会把它放在书桌上。', 'gift-model', 'to_character'])
  const sys = bodies[0].messages[0].content
  const task = bodies[0].messages[1].content
  assert.match(sys, /冷静内敛/)
  assert.match(sys, /虚拟礼物，不涉及真实的钱和物品/)
  assert.match(sys, /小雪喜欢看星星/)
  assert.match(task, /星空望远镜/)
  assert.match(task, /一起看星星吧/)
  assert.match(task, /初次认识/)
  assert.doesNotMatch(sys + task, /林小满|拿铁/)
  // 纪念日只能是这个角色的
  const evB = await saveEvent(null, { title: 'B 的生日', kind: 'birthday', allDay: true, date: '2026-03-01', location: '', note: '', repeat: 'yearly', diaryIds: [], characterId: B })
  await assert.rejects(sendGift({ characterId: A, giftId: 'rose', eventId: evB, fetchImpl }), /不属于这个角色/)
  assert.deepEqual((await anniversariesOf(A)).map((e) => e.id), [ev])
})

test('【模拟模型】回应失败：记录保留、状态为失败、可以重试；不用预设文字冒充', async () => {
  status = 500
  const r = await sendGift({ characterId: A, giftId: 'cocoa', fetchImpl })
  assert.equal(r.replyStatus, 'failed')
  assert.equal(r.reply, undefined)
  assert.match(r.replyError!, /500|server/)
  status = 200
  await requestReply(r.id, fetchImpl)
  assert.equal((await db.giftRecords.get(r.id))!.replyStatus, 'done')
  await assert.rejects(sendGift({ characterId: A, giftId: 'diamond-ring', fetchImpl }), /没有这个礼物/)
})

test('【模拟模型】请 TA 送礼：只能选清单里的礼物，必须有留言；格式不对或礼物不存在时不保存', async () => {
  answer = '我想了想，{"giftId":"feather","message":"适合你写信用。别弄丢了。"}'
  const r = await askCharacterGift(A, fetchImpl)
  assert.deepEqual([r.direction, r.giftId, r.message, r.characterId], ['from_character', 'feather', '适合你写信用。别弄丢了。', A])
  assert.match(bodies[0].messages[1].content, /feather：羽毛笔/)
  answer = '{"giftId":"diamond","message":"送你钻石"}'
  await assert.rejects(askCharacterGift(A, fetchImpl), /清单里没有/)
  answer = '我送你一支玫瑰'
  await assert.rejects(askCharacterGift(A, fetchImpl), /没有按要求/)
  assert.equal(await db.giftRecords.count(), 1)
  assert.equal(parseChoice('{"giftId":"rose","message":"「给你」"}').message, '给你')
  assert.equal(giftById('rose')!.name, '一支白玫瑰')
})

test('收藏、删除与恢复', async () => {
  const r = await sendGift({ characterId: A, giftId: 'rose', fetchImpl })
  await toggleGiftStar(r.id)
  assert.equal((await db.giftRecords.get(r.id))!.starred, true)
  await deleteGiftRecord(r.id)
  assert.ok((await db.giftRecords.get(r.id))!.deletedAt)
  await restoreGiftRecord(r.id)
  assert.equal((await db.giftRecords.get(r.id))!.deletedAt, undefined)
})
