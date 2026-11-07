/**
 * 第八阶段 PR F：塔罗（完整牌组、真实随机抽牌、正逆位、牌阵、AI 解读、保存到日记）：npm test
 * 【模拟模型】解读请求由本地模拟服务回应。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { createCharacter } from '../src/db/repo'
import { DECK, draw, secureRandom, SPREADS, cardById } from '../src/tarot/deck'
import { cardsText, DISCLAIMER, interpret, newReading, saveReadingToDiary } from '../src/tarot/readings'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await setSetting('ai-config', { service: 'custom', mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', proxyUrl: '', proxyToken: '', model: 'tarot-model', temperature: 0.7, maxTokens: 300 })
})

test('完整标准牌组：78 张，22 张大阿卡纳，每个花色 14 张；每张都有正逆位牌意', () => {
  assert.equal(DECK.length, 78)
  assert.equal(new Set(DECK.map((c) => c.id)).size, 78)
  assert.equal(DECK.filter((c) => c.suit === 'major').length, 22)
  for (const s of ['wands', 'cups', 'swords', 'pentacles']) assert.equal(DECK.filter((c) => c.suit === s).length, 14)
  assert.ok(DECK.every((c) => c.name && c.en && c.upright.length > 3 && c.reversed.length > 3 && c.upright !== c.reversed))
  assert.equal(cardById('major-0')!.name, '愚者')
  assert.equal(cardById('cups-14')!.name, '圣杯国王')
})

test('抽牌：按牌阵数量与位置；同一次不会重复；随机数决定结果（不是固定牌）', () => {
  const one = draw('single')
  assert.equal(one.length, 1)
  assert.equal(one[0].position, '指引')
  const three = draw('three')
  assert.deepEqual(three.map((d) => d.position), ['过去', '现在', '未来'])
  assert.equal(new Set(three.map((d) => d.cardId)).size, 3)
  // 相同的随机序列得到相同结果；不同序列得到不同结果
  const seq = (seed: number) => { let x = seed; return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) }
  assert.deepEqual(draw('three', seq(1)), draw('three', seq(1)))
  assert.notDeepEqual(draw('three', seq(1)), draw('three', seq(2)))
  // 真实随机：大量抽取后每张牌都出现过，正逆位都有，分布大致均匀
  const counts = new Map<string, number>()
  let reversed = 0
  const N = 7800
  for (let i = 0; i < N; i++) {
    const [d] = draw('single', secureRandom)
    counts.set(d.cardId, (counts.get(d.cardId) ?? 0) + 1)
    if (d.reversed) reversed++
  }
  assert.equal(counts.size, 78, '78 张牌都被抽到过')
  assert.ok([...counts.values()].every((n) => n > 40 && n < 180), '没有明显偏向某张牌')
  assert.ok(reversed > N * 0.4 && reversed < N * 0.6, `正逆位约各一半（逆位 ${reversed}）`)
  assert.equal(Object.keys(SPREADS).length, 2)
})

test('【模拟模型】解读：请求包含真实抽到的牌、问题与娱乐声明；结果保存；失败或太短不保存', async () => {
  const c = await createCharacter({ name: '沈星回', bio: '', personality: '冷静内敛', speakingStyle: '', backstory: '', relationToUser: '' })
  const r = await newReading('three', '我该不该换工作', 'night', () => 0.3)
  let body: { messages: { content: string }[] } | null = null
  let reply = '过去的星币六说明你一直在付出……这些只是让你停下来想一想，真正的决定还是要看你自己和身边可靠的人。'
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  await interpret(r.id, c.id, fetchImpl)
  const sys = body!.messages[0].content
  const task = body!.messages[1].content
  assert.match(sys, /不要预测确定的未来，不要给出医疗、财务、法律/)
  assert.match(sys, /冷静内敛/)
  assert.match(task, /我该不该换工作/)
  for (const d of r.cards) assert.ok(task.includes(cardById(d.cardId)!.name), '每张牌都在请求里')
  assert.equal(task.includes(cardsText(r)), true)
  const saved = (await db.tarotReadings.get(r.id))!
  assert.deepEqual([saved.interpreterId, saved.model], [c.id, 'tarot-model'])
  reply = '嗯'
  const r2 = await newReading('single', '', 'ice')
  await assert.rejects(interpret(r2.id, c.id, fetchImpl), /太短/)
  assert.equal((await db.tarotReadings.get(r2.id))!.interpretation, undefined)
})

test('保存到日记：你同意后新建一篇不允许 AI 读取的日记，带「塔罗」标签；重复保存不会重复创建', async () => {
  const r = await newReading('single', '今天的指引', 'silver', () => 0.9)
  const id = await saveReadingToDiary(r.id)
  const d = (await db.diaries.get(id))!
  assert.equal(d.aiReadable, false)
  assert.deepEqual(d.tags, ['塔罗'])
  assert.match(d.title, /今天的指引/)
  assert.ok(d.body.includes(cardById(r.cards[0].cardId)!.name))
  assert.ok(d.body.includes(DISCLAIMER))
  assert.equal(await saveReadingToDiary(r.id), id)
  assert.equal(await db.diaries.count(), 1)
})
