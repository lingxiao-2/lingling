/**
 * AI 工具调用 PR C：逐个角色的权限（默认关闭、每次询问、始终允许、禁止）、执行前确认、撤销立即生效、持久化：npm test
 * 【模拟模型 / 模拟工具】本文件使用测试专用的工具定义（不读取真实的日记等数据），聊天模型为本地模拟。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { LinglingDB } from '../src/db/schema'
import { normalizeAIConfig } from '../src/services/ai/service'
import { ToolRegistry, toolRegistry, type ToolDefinition } from '../src/tools/registry'
import { executeToolCall } from '../src/tools/executor'
import { authorizeTool, toolsForCharacter } from '../src/tools/runtime'
import { getMode, getPermissions, PERMISSIONS_KEY, revokeAll, setMode } from '../src/tools/permissions'
import { pendingConfirmations, resolveConfirmation } from '../src/tools/confirm'
import { listToolLogs } from '../src/tools/audit'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { getReplyState, runReply, setPaceScaleForTesting, stopReply } from '../src/services/ai/replyEngine'
import type { ToolCall } from '../src/services/ai/provider'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const config = normalizeAIConfig({ service: 'custom', mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', model: 'm' } as never)
const call = (name: string, args: unknown = {}): ToolCall => ({ id: `c_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })

let runs: string[] = []
const readTool: ToolDefinition = {
  name: 'mock.read_diary',
  label: '查看你的日记',
  description: '测试用读取工具',
  parameters: { type: 'object', properties: { date: { type: 'string', maxLength: 10, format: 'date' } } },
  permission: 'diary_read',
  confirm: false,
  describe: (a) => [`${a.date ?? '最近'} 的日记`],
  execute: async () => (runs.push('read'), { ok: true, data: { count: 1 }, summary: '1 篇' }),
}
const writeTool: ToolDefinition = {
  name: 'mock.create_event',
  label: '创建日程',
  description: '测试用写入工具',
  parameters: { type: 'object', properties: { title: { type: 'string', maxLength: 20 } }, required: ['title'] },
  permission: 'calendar_write',
  confirm: true,
  preview: async (a) => ({ title: '阿玲想创建一个日程', lines: [`标题：${a.title}`] }),
  execute: async () => (runs.push('write'), { ok: true, data: { id: 'e1' }, summary: '已创建 e1' }),
}
const reg = new ToolRegistry().register(readTool).register(writeTool)
const env = (characterId: string, signal = new AbortController().signal) => ({ registry: reg, ctx: { characterId, characterName: '阿玲', conversationId: 'cv', signal }, authorize: authorizeTool, allowed: new Set([readTool.name, writeTool.name]) })

/** 等待确认卡片出现，然后点允许 / 拒绝 */
async function answer(ok: boolean) {
  for (let i = 0; i < 100 && !pendingConfirmations().length; i++) await wait(5)
  const [req] = pendingConfirmations()
  assert.ok(req, '应该出现确认卡片')
  resolveConfirmation(req.id, ok)
  return req
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  runs = []
})

test('默认全部关闭：没有授权时不提供工具给模型，也不执行（日记不能被读取）', async () => {
  const perms = await getPermissions('a')
  assert.ok(Object.values(perms).every((m) => m === 'off'))
  assert.deepEqual(await toolsForCharacter('a', config, reg), [])
  const r = await executeToolCall(call(readTool.name), env('a'))
  assert.equal(r.result.ok, false)
  assert.equal((r.result as { code: string }).code, 'not_granted')
  assert.deepEqual(runs, [])
})

test('每个角色的权限互相独立', async () => {
  await setMode('a', 'diary_read', 'always')
  assert.deepEqual((await toolsForCharacter('a', config, reg)).map((t) => t.name), [readTool.name])
  assert.deepEqual(await toolsForCharacter('b', config, reg), [])
  assert.equal((await executeToolCall(call(readTool.name), env('b'))).result.ok, false)
  assert.equal((await executeToolCall(call(readTool.name), env('a'))).result.ok, true)
  assert.deepEqual(runs, ['read'])
})

test('始终允许：读取不再询问；禁止：不提供也不执行', async () => {
  await setMode('a', 'diary_read', 'always')
  assert.equal((await executeToolCall(call(readTool.name), env('a'))).result.ok, true)
  assert.equal(pendingConfirmations().length, 0)
  await setMode('a', 'diary_read', 'deny')
  assert.deepEqual(await toolsForCharacter('a', config, reg), [])
  const r = await executeToolCall(call(readTool.name), env('a'))
  assert.equal((r.result as { code: string }).code, 'denied')
  assert.equal(runs.length, 1)
})

test('每次询问：显示「角色想做什么」与范围；允许本次才执行，拒绝不执行', async () => {
  await setMode('a', 'diary_read', 'ask')
  const p1 = executeToolCall(call(readTool.name, { date: '2026-11-07' }), env('a'))
  const req = await answer(true)
  assert.equal(req.title, '阿玲想查看你的日记')
  assert.deepEqual(req.lines, ['2026-11-07 的日记'])
  assert.equal(req.confirmText, '允许本次')
  assert.equal((await p1).result.ok, true)
  const p2 = executeToolCall(call(readTool.name, { date: '2026-11-08' }), env('a'))
  await answer(false)
  const r2 = await p2
  assert.equal((r2.result as { code: string }).code, 'user_rejected')
  assert.deepEqual(runs, ['read'])
  const logs = await listToolLogs()
  assert.deepEqual(logs.map((l) => l.confirmation).sort(), ['once', 'user_rejected'])
})

test('写入即使「始终允许」也必须逐次确认，确认卡片显示草稿预览；取消则不执行', async () => {
  await setMode('a', 'calendar_write', 'always')
  const p = executeToolCall(call(writeTool.name, { title: '看雪' }), env('a'))
  const req = await answer(false)
  assert.equal(req.kind, 'write')
  assert.deepEqual(req.lines, ['标题：看雪'])
  assert.equal((await p).result.ok, false)
  assert.deepEqual(runs, [])
  const p2 = executeToolCall(call(writeTool.name, { title: '看雪' }), env('a'))
  await answer(true)
  assert.equal((await p2).result.ok, true)
  assert.deepEqual(runs, ['write'])
})

test('撤销立即生效：已经提供给模型的工具，在执行时重新检查；等待确认期间被撤销也不执行', async () => {
  await setMode('a', 'diary_read', 'always')
  const offered = await toolsForCharacter('a', config, reg)
  assert.equal(offered.length, 1)
  await setMode('a', 'diary_read', 'off')
  assert.equal((await executeToolCall(call(readTool.name), env('a'))).result.ok, false, '撤销后即使模型已拿到工具也不执行')
  await setMode('a', 'calendar_write', 'ask')
  const p = executeToolCall(call(writeTool.name, { title: 'x' }), env('a'))
  for (let i = 0; i < 100 && !pendingConfirmations().length; i++) await wait(5)
  await revokeAll('a')
  await answer(true)
  const r = await p
  assert.equal(r.result.ok, false)
  assert.match((r.result as { error: string }).error, /撤销/)
  assert.deepEqual(runs, [])
})

test('停止生成：等待确认中的请求按拒绝处理，卡片消失，不执行', async () => {
  await setMode('a', 'calendar_write', 'ask')
  const ctrl = new AbortController()
  const p = executeToolCall(call(writeTool.name, { title: 'x' }), env('a', ctrl.signal))
  for (let i = 0; i < 100 && !pendingConfirmations().length; i++) await wait(5)
  ctrl.abort()
  const r = await p
  assert.equal(r.result.ok, false)
  assert.equal(pendingConfirmations().length, 0)
  assert.deepEqual(runs, [])
})

test('权限刷新后仍在（持久化在数据库）；损坏的数据当作关闭；不合法的设置被拒绝', async () => {
  await setMode('a', 'notes_read', 'ask')
  db.close()
  const again = new LinglingDB()
  await again.open()
  assert.deepEqual((await again.settings.get(PERMISSIONS_KEY))?.value, { version: 1, characters: { a: { notes_read: 'ask' } } })
  again.close()
  await db.open()
  assert.equal(await getMode('a', 'notes_read'), 'ask')
  await setSetting(PERMISSIONS_KEY, { characters: { a: { notes_read: 'root', diary_read: true } } })
  assert.equal(await getMode('a', 'notes_read'), 'off')
  assert.equal(await getMode('a', 'diary_read'), 'off')
  await assert.rejects(setMode('a', 'notes_read', 'yes' as never), /不合法/)
  await assert.rejects(setMode('a', 'shell' as never, 'always'), /不合法/)
})

test('AI 不能修改权限：没有任何已注册工具会写权限设置', async () => {
  for (const d of toolRegistry.list()) assert.doesNotMatch(d.name, /permission|权限|setting/i)
})

/* ---------- 回复引擎：聊天中的确认卡片（模拟模型） ---------- */
test('【模拟模型】聊天中：模型要读取 → 出现「允许本次 / 拒绝」→ 拒绝后模型收到拒绝结果并如实回复', async () => {
  toolRegistry.register(readTool)
  try {
    setPaceScaleForTesting(0)
    const bodies: { messages: { role: string; content: string }[]; tools?: unknown[] }[] = []
    const replies = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'k1', type: 'function', function: { name: 'mock__read_diary', arguments: '{"date":"2026-11-07"}' } }] }, finish_reason: 'tool_calls' }] },
      null,
    ]
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body))
      bodies.push(b)
      const enc = new TextEncoder()
      const obj = bodies.length === 1 ? replies[0] : { choices: [{ delta: { content: /user_rejected/.test(b.messages.at(-1).content) ? '<msg>好，那我不看</msg>' : '<msg>???</msg>' } }] }
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\ndata: [DONE]\n\n`)); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
    }) as unknown as typeof fetch
    await setSetting('ai-config', { ...config })
    const c = await createCharacter({ name: '沈星回', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
    const convId = await getOrCreateSingleConversation(c.id)
    await sendUserMessage(convId, '看看我昨天的日记')
    // 没有授权：不提供工具
    await setMode(c.id, 'diary_read', 'ask')
    const p = runReply(convId)
    const req = await answer(false)
    assert.equal(req.conversationId, convId)
    assert.equal(req.title, '沈星回想查看你的日记')
    await p
    assert.equal(getReplyState(convId).status, 'idle')
    const said = (await db.messages.where('conversationId').equals(convId).toArray()).filter((m) => m.senderType === 'character').map((m) => m.content)
    assert.deepEqual(said, ['好，那我不看'])
    assert.deepEqual(runs, [])
    // 停止生成时卡片消失
    bodies.length = 0
    await sendUserMessage(convId, '再看一次')
    const p2 = runReply(convId)
    for (let i = 0; i < 100 && !pendingConfirmations(convId).length; i++) await wait(5)
    stopReply(convId)
    await p2
    assert.equal(pendingConfirmations().length, 0)
    assert.equal(bodies.length, 1)
    assert.deepEqual(runs, [])
  } finally {
    toolRegistry.unregister(readTool.name)
  }
})
