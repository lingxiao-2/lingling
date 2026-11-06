/**
 * AI 工具调用 PR D：记忆工具（只看自己的记忆、提议只进入待确认、必须有用户原话、不编造共同经历）与聊天提示：npm test
 * 【模拟模型】回复引擎中的「模型」是本地模拟的 OpenAI 兼容服务。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { addMemory } from '../src/db/memoryRepo'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { normalizeAIConfig } from '../src/services/ai/service'
import { getReplyState, runReply, setPaceScaleForTesting } from '../src/services/ai/replyEngine'
import { toolRegistry } from '../src/tools/registry'
import { executeToolCall, type Executed } from '../src/tools/executor'
import { authorizeTool, toolsForCharacter } from '../src/tools/runtime'
import { setMode } from '../src/tools/permissions'
import { MEMORY_TOOL_DEFS } from '../src/tools/memoryTools'
import { proposeFromRequests } from '../src/services/ai/memory'
import type { Message } from '../src/db/schema'
import type { ToolCall } from '../src/services/ai/provider'

const config = normalizeAIConfig({ service: 'custom', mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', model: 'm' } as never)
const call = (name: string, args: unknown = {}): ToolCall => ({ id: `c_${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const code = (e: Executed) => (e.result.ok ? 'ok' : e.result.code)
const data = (e: Executed) => (e.result as { data: Record<string, unknown> }).data

let A = ''
let B = ''
let convA = ''
const run = (name: string, args: unknown, characterId = A, conversationId = convA) =>
  executeToolCall(call(name, args), { registry: toolRegistry, ctx: { characterId, characterName: '沈星回', conversationId, signal: new AbortController().signal }, authorize: authorizeTool, allowed: new Set(MEMORY_TOOL_DEFS.map((d) => d.name)) })

beforeEach(async () => {
  await db.delete()
  await db.open()
  const a = await createCharacter({ name: '沈星回', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  const b = await createCharacter({ name: '阿玲', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  A = a.id
  B = b.id
  convA = await getOrCreateSingleConversation(A)
  await addMemory(A, { kind: 'preference', content: '用户喜欢喝桂花乌龙' })
  await addMemory(B, { kind: 'preference', content: '用户怕冷，冬天总穿很多' })
})

test('记忆工具默认不可用；授权后只看到自己的、已确认的记忆（不跨角色）', async () => {
  assert.equal(code(await run('memory.list', {})), 'not_granted')
  await setMode(A, 'memory_propose', 'always')
  assert.deepEqual((await toolsForCharacter(A, config)).map((t) => t.name).sort(), ['memory.list', 'memory.propose', 'memory.search'])
  const list = data(await run('memory.list', {})).memories as { content: string }[]
  assert.deepEqual(list.map((m) => m.content), ['用户喜欢喝桂花乌龙'])
  assert.deepEqual(data(await run('memory.search', { query: '怕冷' })).memories, [], '看不到其他角色的记忆')
  assert.equal(code(await run('memory.list', {}, B)), 'not_granted', '另一个角色没有授权')
})

test('提议记忆只进入「待确认」，必须有用户本次对话中的原话；编造的经历被拒绝', async () => {
  await setMode(A, 'memory_propose', 'always')
  await sendUserMessage(convA, '我下个月要去考雅思了，有点紧张')
  const ok = await run('memory.propose', { kind: 'user-fact', content: '用户下个月考雅思', quote: '下个月要去考雅思' })
  assert.equal(code(ok), 'ok')
  assert.equal(data(ok).status, 'pending')
  const rows = (await db.memories.where('characterId').equals(A).toArray()).filter((m) => m.content === '用户下个月考雅思')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].origin, 'suggested')
  // 同一件事再提议一次：不新增，如实说明已经在待确认里（不是「保存失败」）
  const again = await run('memory.propose', { kind: 'user-fact', content: '用户下个月考雅思', quote: '下个月要去考雅思' })
  assert.equal(data(again).status, 'already_pending')
  assert.equal((await db.memories.toArray()).filter((m) => m.content === '用户下个月考雅思').length, 1)
  // 编造：用户没说过
  const fake = await run('memory.propose', { kind: 'event', content: '我们一起去看了海', quote: '我们一起去看了海' })
  assert.equal(code(fake), 'invalid')
  assert.equal((await db.memories.toArray()).filter((m) => m.content === '我们一起去看了海').length, 0)
  // 角色自己的话不算
  await db.messages.add({ id: 'cm', conversationId: convA, senderType: 'character', senderId: A, kind: 'text', content: '上次我们去了游乐园', status: 'sent', createdAt: Date.now(), updatedAt: Date.now() } as never)
  assert.equal(code(await run('memory.propose', { kind: 'event', content: '一起去了游乐园', quote: '我们去了游乐园' })), 'invalid')
  // 其他会话里的话不算
  const convB = await getOrCreateSingleConversation(B)
  await sendUserMessage(convB, '我的生日是三月五号')
  assert.equal(code(await run('memory.propose', { kind: 'user-fact', content: '生日三月五号', quote: '我的生日是三月五号' })), 'invalid')
})

test('提议记忆：密码类内容拒绝；与已有记忆重复只合并依据；参数不合法拒绝', async () => {
  await setMode(A, 'memory_propose', 'always')
  await sendUserMessage(convA, '我的银行卡密码是 123456')
  assert.equal(code(await run('memory.propose', { kind: 'user-fact', content: '银行卡密码 123456', quote: '银行卡密码是 123456' })), 'invalid')
  await sendUserMessage(convA, '我真的很喜欢喝桂花乌龙')
  const dup = await run('memory.propose', { kind: 'preference', content: '用户喜欢喝桂花乌龙', quote: '很喜欢喝桂花乌龙' })
  assert.equal(data(dup).status, 'already_remembered')
  assert.equal((await db.memories.where('characterId').equals(A).toArray()).length, 1)
  assert.equal(code(await run('memory.propose', { kind: 'secret', content: 'x', quote: 'xx' })), 'bad_arguments')
})

test('【模拟模型】聊天：使用工具后提示「刚才使用了」；记忆提议后回复不声称已经记住', async () => {
  setPaceScaleForTesting(0)
  await setSetting('ai-config', { ...config })
  await setMode(A, 'memory_propose', 'always')
  let n = 0
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body))
    n++
    const enc = new TextEncoder()
    const obj = n === 1
      ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'p1', type: 'function', function: { name: 'memory__propose', arguments: JSON.stringify({ kind: 'preference', content: '用户不吃香菜', quote: '我不吃香菜' }) } }] }, finish_reason: 'tool_calls' }] }
      : { choices: [{ delta: { content: /pending/.test(JSON.parse(b.messages.at(-1).content).data?.status ?? '') ? '<msg>我先把这件事放进待确认里，你看一下</msg>' : '<msg>??</msg>' } }] }
    return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\ndata: [DONE]\n\n`)); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  await sendUserMessage(convA, '对了，我不吃香菜')
  await runReply(convA)
  const s = getReplyState(convA)
  assert.equal(s.status, 'idle')
  assert.equal(s.toolNote, '沈星回 刚才使用了：提议一条新的记忆')
  const said = (await db.messages.where('conversationId').equals(convA).toArray()).filter((m) => m.senderType === 'character').map((m) => m.content)
  assert.deepEqual(said, ['我先把这件事放进待确认里，你看一下'])
  const mem = (await db.memories.where('characterId').equals(A).toArray()).filter((m) => /香菜/.test(m.content))
  assert.ok(mem.length >= 1 && mem.every((m) => m.status === 'pending'), '只进入待确认')
})

test('「帮我记个便签 / 记到日历里」是使用应用，不会被当成「请记住」变成长期记忆；普通的「帮我记一下」照旧', () => {
  const msg = (id: string, content: string) => ({ id, conversationId: 'c', senderType: 'user', senderId: 'user', kind: 'text', content, status: 'sent', createdAt: 1, updatedAt: 1 }) as Message
  const out = proposeFromRequests([msg('1', '帮我记个便签：买牛奶'), msg('2', '记一下日程，周五下午开会'), msg('3', '把这个记到日历里'), msg('4', '帮我记一下，我对芒果过敏'), msg('5', '记住，我生日是三月五号')], [])
  assert.deepEqual(out.map((p) => p.sourceMessageIds[0]), ['4', '5'])
})
