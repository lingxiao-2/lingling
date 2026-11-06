/**
 * 长期记忆集成测试（真实回复引擎 + Dexie + 模拟模型）：npm test
 * 注意：模型是模拟的，只验证记忆的保存、去重、召回、隔离和授权逻辑，不代表真实模型的提取质量。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { createCharacter, deleteConversation, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { addMemory, mergeMemories, removeMemory, setMemoryPrefs, updateMemory } from '../src/db/memoryRepo'
import { getReplyState, runReply, setPaceScaleForTesting } from '../src/services/ai/replyEngine'
import { AUTO_EVERY, maybeAutoExtract } from '../src/services/ai/autoMemory'

type Body = { messages: { role: string; content: string }[] }
let chatCalls: Body[] = []
let extractCalls: Body[] = []
let extractMode: 'ok' | 'sensitive' | 'error' = 'ok'

const json = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } })

globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Body
  if (body.messages[0].content.includes('记忆整理工具')) {
    extractCalls.push(body)
    if (extractMode === 'error') return new Response('{"error":{"message":"server busy"}}', { status: 503 })
    // 从发来的聊天中找第一条用户消息，按要求引用它的编号与原文
    const lines = body.messages[1].content.split('\n')
    const pick = lines.find((l) => l.includes(extractMode === 'sensitive' ? '焦虑' : '火锅'))!
    const [, id, text] = pick.match(/^\[(\S+)\] 小雪：(.*)$/)!
    return json(JSON.stringify({ memories: [{ kind: extractMode === 'sensitive' ? 'user-fact' : 'preference', content: extractMode === 'sensitive' ? '最近在吃抗焦虑的药' : '小雪爱吃火锅', messageId: id, quote: text.slice(0, 8) }] }))
  }
  chatCalls.push(body)
  return json('<msg>嗯</msg>')
}) as unknown as typeof fetch

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
let a = ''
let b = ''
let convA = ''
let convB = ''
const sys = () => chatCalls[chatCalls.length - 1].messages[0].content

beforeEach(async () => {
  await db.delete()
  await db.open()
  chatCalls = []
  extractCalls = []
  extractMode = 'ok'
  setPaceScaleForTesting(0)
  await setSetting('ai-config', { mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-test', proxyUrl: '', proxyToken: '', model: 'mock', temperature: 0.7, maxTokens: 200 })
  await setSetting('profile', { nickname: '小雪', signature: '' })
  a = (await createCharacter({ name: '沈遥', bio: '', personality: '温柔', speakingStyle: '', backstory: '', relationToUser: '你们是恋人' })).id
  b = (await createCharacter({ name: '阿玲', bio: '', personality: '活泼', speakingStyle: '', backstory: '', relationToUser: '' })).id
  convA = await getOrCreateSingleConversation(a)
  convB = await getOrCreateSingleConversation(b)
})

async function say(conv: string, text: string) {
  await sendUserMessage(conv, text)
  await runReply(conv)
  assert.equal(getReplyState(conv).status, 'idle', getReplyState(conv).error)
}
const memsOf = async (id: string) => (await db.memories.where('characterId').equals(id).toArray()).filter((m) => m.content)

test('聊天中说「记住」：保存一次；之后反复说同一件事不会累积，只合并依据', async () => {
  await say(convA, '记住，我对芒果过敏')
  for (let i = 0; i < 8; i++) await say(convA, i % 2 ? '别忘了我对芒果过敏哦' : '你要记住我对芒果过敏！')
  const ms = await memsOf(a)
  assert.equal(ms.length, 1)
  assert.equal(ms[0].content, '我对芒果过敏')
  assert.equal(ms[0].kind, 'preference')
  assert.equal(ms[0].mentions, 9)
  assert.equal(ms[0].sourceMessageIds.length, 9)
  assert.ok(ms[0].worldId)
})

test('关闭「记住」自动保存后不再保存', async () => {
  await setMemoryPrefs(a, { rememberRequests: false })
  await say(convA, '记住我喜欢下雪')
  assert.equal((await memsOf(a)).length, 0)
})

test('新会话：删除聊天记录、重新开始后，仍能召回已确认的记忆', async () => {
  await addMemory(a, { kind: 'promise', content: '说好今年冬天一起去看极光', pinned: true })
  await addMemory(a, { kind: 'preference', content: '我不吃香菜' })
  await say(convA, '今天好冷')
  await deleteConversation(convA)
  convA = await getOrCreateSingleConversation(a)
  await say(convA, '早')
  assert.match(sys(), /说好今年冬天一起去看极光/)
  assert.doesNotMatch(sys(), /香菜/, '无关的记忆不发送')
  await say(convA, '晚上吃什么，我不想要香菜')
  assert.match(sys(), /我不吃香菜/)
})

test('角色隔离：A 的记忆和聊天不会出现在 B 的请求里', async () => {
  await addMemory(a, { kind: 'event', content: '我们一起在海边放了烟花', pinned: true })
  await say(convA, '记住我的猫叫团子')
  await say(convB, '你知道我的猫叫什么吗，还记得海边的烟花吗')
  const s = sys()
  assert.doesNotMatch(s, /烟花|团子/)
  assert.ok(!chatCalls[chatCalls.length - 1].messages.some((m) => m.content.includes('记住我的猫叫团子')), 'B 看不到 A 的聊天')
})

test('删除记忆后立即不再注入；合并后只注入合并结果', async () => {
  const m = await addMemory(a, { kind: 'user-fact', content: '我在杭州上班', pinned: true })
  await say(convA, '在吗')
  assert.match(sys(), /我在杭州上班/)
  await removeMemory(m)
  await say(convA, '在吗')
  assert.doesNotMatch(sys(), /杭州/)
  const x = await addMemory(a, { kind: 'preference', content: '我喜欢猫', pinned: true })
  const y = await addMemory(a, { kind: 'preference', content: '我最喜欢橘猫了', pinned: true })
  await mergeMemories(x.id, y.id)
  await say(convA, '在吗')
  assert.match(sys(), /我喜欢猫；我最喜欢橘猫了/)
  assert.equal((await memsOf(a)).length, 1)
})

test('角色换到别的世界后：原世界线的记忆不再发送，可以手动改为当前世界', async () => {
  const m = await addMemory(a, { kind: 'event', content: '我们在钟楼下第一次见面', pinned: true })
  const w = await db.worlds.add({ id: 'w-other', name: '另一个世界', createdAt: 0, updatedAt: 0 } as never)
  await db.characters.update(a, { worldId: String(w) })
  await say(convA, '在吗')
  assert.doesNotMatch(sys(), /钟楼/)
  await updateMemory(m.id, { worldId: 'w-other' })
  await say(convA, '在吗')
  assert.match(sys(), /钟楼/)
})

test('自动提取默认关闭：聊很多也不会额外请求', async () => {
  for (let i = 0; i < AUTO_EVERY + 3; i++) await say(convA, `第${i}句，我爱吃火锅`)
  await wait(30)
  assert.equal(extractCalls.length, 0)
})

test('同意开启自动提取后：每 20 条用户消息提取一次，结果只进入待确认，确认前不注入', async () => {
  await setMemoryPrefs(a, { autoExtract: true, autoConsentAt: Date.now() - 1 })
  for (let i = 0; i < AUTO_EVERY - 1; i++) await say(convA, `今天第${i}件小事`)
  await wait(30)
  assert.equal(extractCalls.length, 0)
  await say(convA, '我爱吃火锅，尤其是牛油锅')
  for (let i = 0; i < 50 && extractCalls.length === 0; i++) await wait(10)
  for (let i = 0; i < 50 && !(await memsOf(a)).length; i++) await wait(10)
  assert.equal(extractCalls.length, 1)
  // 只发送用户授权范围内的聊天，不含其他角色
  assert.doesNotMatch(extractCalls[0].messages[1].content, /阿玲/)
  const ms = await memsOf(a)
  assert.deepEqual(ms.map((m) => [m.status, m.content, m.origin]), [['pending', '小雪爱吃火锅', 'suggested']])
  await say(convA, '晚上吃火锅吗')
  assert.doesNotMatch(sys(), /小雪爱吃火锅/, '待确认的不注入')
  await updateMemory(ms[0].id, { status: 'active' })
  await say(convA, '晚上吃火锅吗')
  assert.match(sys(), /小雪爱吃火锅/)
  // 没有新增 20 条，不会再次提取
  await wait(30)
  assert.equal(extractCalls.length, 1)
  assert.match((await db.characters.get(a))!.memoryPrefs!.lastNote!, /新增待确认 1 条/)
})

test('自动提取到的敏感内容默认不保存；失败时不会每次回复都重试', async () => {
  await setMemoryPrefs(a, { autoExtract: true, autoConsentAt: Date.now() - 1 })
  extractMode = 'sensitive'
  for (let i = 0; i < AUTO_EVERY; i++) await sendUserMessage(convA, i === 3 ? '我最近很焦虑，在吃药' : `小事${i}`)
  const r = await maybeAutoExtract(a, convA)
  assert.equal(r.ran, true)
  assert.equal(r.droppedSensitive, 1)
  assert.equal((await memsOf(a)).length, 0)

  extractMode = 'error'
  for (let i = 0; i < AUTO_EVERY; i++) await sendUserMessage(convA, `又一件小事${i}`)
  const e = await maybeAutoExtract(a, convA)
  assert.match(e.note ?? '', /自动提取失败/)
  const again = await maybeAutoExtract(a, convA)
  assert.equal(again.ran, false)
  assert.equal(extractCalls.length, 2)
})
