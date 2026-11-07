/**
 * 第八阶段 PR D：信箱（草稿、寄出、文件夹、搜索、收藏、删除恢复；角色来信与回信的真实请求内容、隔离与失败处理）：npm test
 * 【模拟模型】聊天接口是本地模拟的 OpenAI 兼容服务；检查的是发给模型的真实内容与对结果的处理。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { addMemory } from '../src/db/memoryRepo'
import { inFolder, purgeLetter, restoreLetter, saveDraft, searchLetters, sendDraft, toggleStar, trashLetter } from '../src/db/letterRepo'
import { inviteLetter, parseLetter, replyToLetter } from '../src/mail/generate'

type Body = { messages: { role: string; content: string }[] }
let bodies: Body[] = []
let replyText = '标题：雪落之前\n\n小雪：\n今天我把窗边的灯留到很晚，想着你说过喜欢冬天的夜色。我不太会说漂亮话，只是想告诉你，我记得你说的每一件小事。\n——沈星回'
let fail = false
const fetchImpl = (async (_u: string, init: RequestInit) => {
  bodies.push(JSON.parse(String(init.body)))
  if (fail) return new Response('{"error":{"message":"bad key"}}', { status: 401 })
  return new Response(JSON.stringify({ choices: [{ message: { content: replyText } }] }), { headers: { 'content-type': 'application/json' } })
}) as unknown as typeof fetch

let A = ''
let B = ''
beforeEach(async () => {
  await db.delete()
  await db.open()
  bodies = []
  fail = false
  await setSetting('ai-config', { service: 'custom', mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', proxyUrl: '', proxyToken: '', model: 'letter-model', temperature: 0.7, maxTokens: 300 })
  await setSetting('profile', { nickname: '小雪', signature: '' })
  A = (await createCharacter({ name: '沈星回', bio: '天文台研究员', personality: '冷静内敛，话少', speakingStyle: '克制、简短，很少用感叹号', backstory: '', relationToUser: '暧昧中的朋友' })).id
  B = (await createCharacter({ name: '林小满', bio: '咖啡店店员', personality: '活泼外向', speakingStyle: '轻快，爱用语气词', backstory: '', relationToUser: '好朋友' })).id
})

test('草稿：自动保存与修改；寄出要求正文；文件夹、搜索、收藏、删除与恢复', async () => {
  const id = await saveDraft(null, { characterId: A, subject: '初雪', body: '' })
  await saveDraft(id, { characterId: A, subject: '初雪', body: '今天下雪了' })
  assert.equal((await db.letters.get(id))!.body, '今天下雪了')
  const empty = await saveDraft(null, { characterId: A, subject: 'x', body: '  ' })
  await assert.rejects(sendDraft(empty), /不能为空/)
  const sent = await sendDraft(id)
  assert.deepEqual([sent.status, sent.direction], ['sent', 'from_user'])
  await assert.rejects(saveDraft(id, { characterId: A, body: '改' }), /已经寄出/)
  const all = await db.letters.toArray()
  assert.deepEqual(all.filter((l) => inFolder(l, 'sent')).map((l) => l.id), [id])
  assert.deepEqual(all.filter((l) => inFolder(l, 'drafts')).map((l) => l.id), [empty])
  assert.deepEqual(searchLetters(all, '下雪').map((l) => l.id), [id])
  assert.deepEqual(searchLetters(all, '沈星回', new Map([[A, '沈星回']])).length, 2)
  await toggleStar(id)
  assert.ok(inFolder((await db.letters.get(id))!, 'starred'))
  assert.equal(await purgeLetter(id), false, '不在最近删除中的不能彻底删除')
  await trashLetter(id)
  const t = (await db.letters.get(id))!
  assert.ok(inFolder(t, 'trash') && !inFolder(t, 'sent') && !inFolder(t, 'starred'))
  await restoreLetter(id)
  assert.ok(inFolder((await db.letters.get(id))!, 'sent'))
  await trashLetter(id)
  assert.equal(await purgeLetter(id), true)
  assert.equal(await db.letters.get(id), undefined)
})

test('【模拟模型】邀请写信：请求带上这个角色的人设、语气、关系与已确认记忆；写信要求禁止模板与编造；不带其他角色的内容', async () => {
  await addMemory(A, { kind: 'preference', content: '小雪喜欢冬天的夜色' })
  await addMemory(B, { kind: 'preference', content: '小雪喜欢拿铁' })
  const conv = await getOrCreateSingleConversation(A)
  await sendUserMessage(conv, '今天天文台的星星好看吗')
  const l = await inviteLetter(A, { topic: '初雪那天', paper: 'night', fetchImpl })
  const sys = bodies[0].messages[0].content
  const task = bodies[0].messages[1].content
  assert.equal(bodies[0].messages.length, 2, '只有设定与这次任务，没有把聊天当成要回复的消息')
  assert.match(sys, /以沈星回本人的身份，亲笔给「小雪」写一封信/)
  assert.match(sys, /冷静内敛/)
  assert.match(sys, /克制、简短/)
  assert.match(sys, /小雪喜欢冬天的夜色/)
  assert.match(sys, /不要套用统一的甜宠模板/)
  assert.match(sys, /不要编造没有发生过的约会/)
  assert.match(sys, /今天天文台的星星好看吗/, '最近聊天作为参考')
  assert.doesNotMatch(sys, /<msg>.*每条消息/, '不包含聊天的消息格式要求')
  assert.doesNotMatch(sys + task, /林小满|拿铁|咖啡店/, '不包含其他角色的人设或记忆')
  assert.match(task, /初雪那天/)
  assert.deepEqual([l.subject, l.direction, l.status, l.read, l.paper, l.model, l.characterId], ['雪落之前', 'from_character', 'received', false, 'night', 'letter-model', A])
  assert.match(l.body, /^小雪：/)
})

test('【模拟模型】不同人设的角色，发给模型的写信设定不同（不共用模板）', async () => {
  await inviteLetter(A, { fetchImpl })
  await inviteLetter(B, { fetchImpl })
  const [a, b] = bodies.map((x) => x.messages[0].content)
  assert.match(a, /冷静内敛/)
  assert.match(b, /活泼外向/)
  assert.match(b, /爱用语气词/)
  assert.doesNotMatch(b, /冷静内敛/)
})

test('【模拟模型】回信：带上你寄出的信与你们之间之前的往来；不读取其他角色的信', async () => {
  const otherDraft = await saveDraft(null, { characterId: B, subject: '给小满', body: '咖啡店的秘密' })
  await sendDraft(otherDraft)
  const first = await inviteLetter(A, { fetchImpl })
  const d = await saveDraft(null, { characterId: A, subject: '谢谢你的信', body: '我也记得那天的雪，和你站在路灯下。', replyToId: first.id })
  const mine = await sendDraft(d)
  bodies = []
  const r = await replyToLetter(mine.id, { fetchImpl })
  const task = bodies[0].messages[1].content
  assert.match(task, /我也记得那天的雪/)
  assert.match(task, /雪落之前/, '之前的往来信件')
  assert.doesNotMatch(task, /咖啡店的秘密/, '不包含其他角色的信')
  assert.deepEqual([r.replyToId, r.direction], [mine.id, 'from_character'])
  await assert.rejects(replyToLetter(first.id, { fetchImpl }), /只能回复你已经寄出的信/)
})

test('【模拟模型】失败或内容不合格时不保存任何信件（不用预设内容冒充）', async () => {
  fail = true
  await assert.rejects(inviteLetter(A, { fetchImpl }), /密钥|拒绝/)
  fail = false
  replyText = '好的'
  await assert.rejects(inviteLetter(A, { fetchImpl }), /太短/)
  assert.equal(await db.letters.count(), 0)
})

test('解析：去掉误加的标签；没有标题时用默认标题；长度限制', () => {
  assert.deepEqual(parseLetter('<msg>标题：《星》\n\n亲爱的小雪，今晚的星星很亮，我想起了你，所以写下这封信给你。</msg>', 'x'), { subject: '星', body: '亲爱的小雪，今晚的星星很亮，我想起了你，所以写下这封信给你。' })
  assert.equal(parseLetter('亲爱的小雪，今晚的星星很亮，我想起了你，所以写下这封信给你。', '来自沈星回的信').subject, '来自沈星回的信')
  assert.throws(() => parseLetter('标题：短\n\n嗯', 'x'), /太短/)
})
