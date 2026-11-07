/**
 * 第七阶段 PR D：AI 通过工具调用真实 iPhone 操作（权限、确认、点按打开、真实状态、防重复、次数限制）：npm test
 * 【模拟模型】聊天模型是本地模拟的 OpenAI 兼容服务；快捷指令的回跳也是模拟的。**不是真机测试，也不是真实 DeepSeek。**
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { normalizeAIConfig } from '../src/services/ai/service'
import { toolRegistry } from '../src/tools/registry'
import { executeToolCall, type Executed } from '../src/tools/executor'
import { authorizeTool, toolsForCharacter } from '../src/tools/runtime'
import { revokeAll, setMode } from '../src/tools/permissions'
import { pendingConfirmations, resolveConfirmation, type ConfirmRequest } from '../src/tools/confirm'
import { IOS_TOOL_DEFS, setRunWaitForTesting } from '../src/tools/iosTools'
import { registerShortcut } from '../src/ios/shortcuts'
import { applyCallback, launchRun, setOpenerForTesting } from '../src/ios/runs'
import { addDays } from '../src/life/calendar'
import { localDate } from '../src/life/diary'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { getReplyState, runReply, setPaceScaleForTesting, stopReply } from '../src/services/ai/replyEngine'
import type { ToolCall } from '../src/services/ai/provider'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size } }
;(globalThis as { location?: unknown }).location = { origin: 'https://lingxiao-2.github.io', pathname: '/lingling/' }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const config = normalizeAIConfig({ service: 'custom', mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', model: 'm' } as never)
const tomorrow = addDays(localDate(), 1)
const call = (name: string, args: unknown): ToolCall => ({ id: `c_${Math.random()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const code = (e: Executed) => (e.result.ok ? 'ok' : e.result.code)
const data = (e: Executed) => (e.result as { data: Record<string, unknown> }).data
let opened: string[] = []
const run = (name: string, args: unknown, characterId = 'A', signal = new AbortController().signal) =>
  executeToolCall(call(name, args), { registry: toolRegistry, ctx: { characterId, characterName: '沈星回', conversationId: 'cv', signal }, authorize: authorizeTool, allowed: new Set(IOS_TOOL_DEFS.map((d) => d.name)) })

/** 模拟聊天中的确认卡片：确认时在「点按」里同步打开（与 ToolConfirmCard 相同） */
async function tap(ok: boolean): Promise<ConfirmRequest> {
  for (let i = 0; i < 200 && !pendingConfirmations().length; i++) await wait(5)
  const [req] = pendingConfirmations()
  assert.ok(req, '应该出现确认卡片')
  if (ok && req.launch) void launchRun({ id: req.launch.runId, url: req.launch.url, status: 'awaiting_confirmation' })
  resolveConfirmation(req.id, ok)
  return req
}
const runOf = async (req: ConfirmRequest) => (await db.shortcutRuns.get(req.launch!.runId))!

beforeEach(async () => {
  await db.delete()
  await db.open()
  opened = []
  mem.clear()
  setOpenerForTesting((u) => opened.push(u))
  setRunWaitForTesting(300)
  await registerShortcut({ name: '聆聆提醒事项', purpose: 'reminder' })
  await registerShortcut({ name: '聆聆日历', purpose: 'calendar' })
})

test('默认关闭：iPhone 工具不提供给模型；直接调用也不执行、不生成任何运行', async () => {
  assert.deepEqual((await toolsForCharacter('A', config)).filter((t) => t.name.startsWith('ios.')), [])
  assert.equal(code(await run('ios.create_reminder', { title: '买东西', date: tomorrow, time: '15:00' })), 'not_granted')
  assert.equal(await db.shortcutRuns.count(), 0)
  assert.equal(pendingConfirmations().length, 0)
  await setMode('A', 'ios_reminder', 'always')
  assert.deepEqual((await toolsForCharacter('A', config)).filter((t) => t.name.startsWith('ios.')).map((t) => t.name), ['ios.create_reminder'])
  assert.deepEqual((await toolsForCharacter('B', config)).filter((t) => t.name.startsWith('ios.')), [], '其他角色不受影响')
})

test('创建提醒：即使「始终允许」也必须确认；卡片显示执行计划；点确认时同步打开快捷指令；成功回跳才 verified', async () => {
  await setMode('A', 'ios_reminder', 'always')
  const p = run('ios.create_reminder', { title: '去买东西', date: tomorrow, time: '15:00' })
  const req = await tap(true)
  assert.equal(req.title, '沈星回想在 iPhone 上创建提醒事项')
  assert.equal(req.confirmText, '确认并打开')
  assert.ok(req.lines.some((l) => /提醒时间：.*15:00/.test(l)))
  assert.equal(opened.length, 1, '点确认的同时打开')
  assert.equal(new URL(opened[0].replace('shortcuts://', 'https://')).searchParams.get('name'), '聆聆提醒事项')
  const r = await runOf(req)
  await wait(50)
  await applyCallback({ status: 'ok', runId: r.id, nonce: r.nonce, result: 'ok' })
  const e = await p
  assert.equal(code(e), 'ok')
  assert.deepEqual([data(e).status, data(e).verified], ['confirmed', true])
  assert.equal((await runOf(req)).conversationId, 'cv')
})

test('拒绝：不打开、运行被取消；没有回跳：只返回「已发起」并要求模型不能说已创建；出错回跳返回失败', async () => {
  await setMode('A', 'ios_reminder', 'ask')
  const p1 = run('ios.create_reminder', { title: '拒绝我', date: tomorrow, time: '10:00' })
  const r1 = await tap(false)
  assert.equal(code(await p1), 'user_rejected')
  assert.equal(opened.length, 0)
  assert.equal((await runOf(r1)).status, 'cancelled')

  const p2 = run('ios.create_reminder', { title: '没有回跳', date: tomorrow, time: '10:00' })
  await tap(true)
  const e2 = await p2
  assert.deepEqual([code(e2), data(e2).status, data(e2).verified], ['ok', 'launched', false])
  assert.match(String(data(e2).message), /不要说已经创建/)

  const p3 = run('ios.create_reminder', { title: '出错', date: tomorrow, time: '11:00' })
  const r3 = await tap(true)
  const rr = await runOf(r3)
  await applyCallback({ status: 'error', runId: rr.id, nonce: rr.nonce, error: '没有权限' })
  const e3 = await p3
  assert.equal(code(e3), 'execution_failed')
  assert.match((e3.result as { error: string }).error, /没有权限/)
})

test('防止重复：同样的提醒 10 分钟内第二次直接拒绝，不出现卡片；未登记快捷指令时如实说明', async () => {
  await setMode('A', 'ios_reminder', 'always')
  await setMode('A', 'ios_calendar', 'always')
  const p = run('ios.create_reminder', { title: '买牛奶', date: tomorrow, time: '09:00' })
  await tap(true)
  await p
  const again = await run('ios.create_reminder', { title: '买牛奶', date: tomorrow, time: '09:00' })
  assert.equal(code(again), 'invalid')
  assert.match((again.result as { error: string }).error, /10 分钟内已经发起过/)
  assert.equal(pendingConfirmations().length, 0)
  assert.equal(opened.length, 1)
  await db.settings.delete('ios-shortcuts')
  const none = await run('ios.create_calendar_event', { title: '面试', date: tomorrow, startTime: '10:00' })
  assert.match((none.result as { error: string }).error, /还没有登记/)
})

test('参数注入与白名单：多余参数拒绝；非法日期拒绝；不能运行未允许 AI 的快捷指令；不能打开任意链接', async () => {
  for (const p of ['ios_reminder', 'ios_shortcut', 'ios_open_app'] as const) await setMode('A', p, 'always')
  assert.equal(code(await run('ios.create_reminder', { title: 'x', date: tomorrow, url: 'shortcuts://run-shortcut?name=删除全部' })), 'bad_arguments')
  assert.equal(code(await run('ios.create_reminder', { title: 'x', date: '2026-13-01' })), 'bad_arguments')
  await registerShortcut({ name: '清空相册', purpose: 'custom', allowAI: false })
  const no = await run('ios.run_shortcut', { name: '清空相册' })
  assert.match((no.result as { error: string }).error, /没有允许 AI 使用/)
  assert.equal(code(await run('ios.run_shortcut', { name: '任意名字' })), 'not_found')
  assert.equal(code(await run('ios.open_app', { app: 'wechat' })), 'bad_arguments')
  assert.equal(code(await run('ios.open_app', { app: 'safari', url: 'javascript:alert(1)' })), 'invalid')
  assert.equal(opened.length, 0)
  await registerShortcut({ name: '记录喝水', purpose: 'custom', description: '记一杯水', allowAI: true })
  assert.deepEqual(data(await run('ios.list_shortcuts', {})).shortcuts, [{ name: '记录喝水', description: '记一杯水' }])
  const p = run('ios.run_shortcut', { name: '记录喝水', text: '300ml' })
  await tap(true)
  await p
  assert.equal(new URL(opened[0].replace('shortcuts://', 'https://')).searchParams.get('text'), '300ml')
})

test('打开应用：确认后打开，立即返回「已发起」（网页无法确认应用是否打开）', async () => {
  await setMode('A', 'ios_open_app', 'always')
  const p = run('ios.open_app', { app: 'calendar' })
  await tap(true)
  const e = await p
  assert.deepEqual([opened[0], data(e).status, data(e).verified], ['calshow://', 'launched', false])
})

test('撤销权限时，等待中的 iPhone 操作卡片立即消失，运行被取消，不会打开', async () => {
  await setMode('A', 'ios_reminder', 'always')
  const p = run('ios.create_reminder', { title: '撤销我', date: tomorrow, time: '10:00' })
  for (let i = 0; i < 200 && !pendingConfirmations().length; i++) await wait(5)
  const runId = pendingConfirmations()[0].launch!.runId
  await revokeAll('A')
  await p
  assert.equal(pendingConfirmations().length, 0)
  assert.equal((await db.shortcutRuns.get(runId))!.status, 'cancelled')
  assert.equal(opened.length, 0)
})

/* ---------- 回复引擎（模拟模型） ---------- */
type Body = { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] }
function mockModel(steps: ((b: Body) => unknown)[]) {
  const bodies: Body[] = []
  globalThis.fetch = (async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)) as Body
    bodies.push(b)
    const obj = steps[Math.min(bodies.length - 1, steps.length - 1)](b)
    const enc = new TextEncoder()
    return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\ndata: [DONE]\n\n`)); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  return bodies
}
const toolCall = (name: string, args: unknown, id = 'k1') => () => ({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] })
const replyFromResult = (b: Body) => {
  const r = JSON.parse(b.messages.at(-1)!.content)
  const text = !r.ok ? `没有成功：${r.error}` : r.data.verified ? '提醒已经建好了' : '已经帮你发起了，请在 iPhone 上看一下'
  return { choices: [{ delta: { content: `<msg>${text}</msg>` } }] }
}
async function chat() {
  setPaceScaleForTesting(0)
  await setSetting('ai-config', { ...config })
  const c = await createCharacter({ name: '沈星回', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  const convId = await getOrCreateSingleConversation(c.id)
  return { c, convId }
}
const said = async (convId: string) => (await db.messages.where('conversationId').equals(convId).toArray()).filter((m) => m.senderType === 'character').map((m) => m.content)

test('【模拟模型】聊天：「帮我创建一个提醒」→ 确认并打开 → 快捷指令回跳成功 → 回复基于真实结果；系统提示带有当前日期', async () => {
  const { c, convId } = await chat()
  await setMode(c.id, 'ios_reminder', 'ask')
  const bodies = mockModel([toolCall('ios__create_reminder', { title: '去买东西', date: tomorrow, time: '15:00' }), replyFromResult])
  await sendUserMessage(convId, '帮我创建一个提醒，明天下午三点去买东西')
  const p = runReply(convId)
  const req = await tap(true)
  assert.equal(req.conversationId, convId)
  const r = await runOf(req)
  await wait(30)
  await applyCallback({ status: 'ok', runId: r.id, nonce: r.nonce, result: 'ok' })
  await p
  assert.equal(getReplyState(convId).status, 'idle')
  assert.match(bodies[0].messages[1].content, /现在是 \d{4}-\d{2}-\d{2}（星期.）/)
  assert.match(bodies[0].messages[1].content, /status 为 confirmed 时才能说已经完成/)
  assert.deepEqual(await said(convId), ['提醒已经建好了'])
  const log = (await db.toolLogs.toArray()).find((l) => l.tool === 'ios.create_reminder')!
  assert.deepEqual([log.confirmation, log.status], ['once', 'ok'])
  assert.match(log.summary, /已确认完成/)
})

test('【模拟模型】聊天：没有回跳时，回复只说「已发起」；一次回复只能执行一个 iPhone 操作', async () => {
  const { c, convId } = await chat()
  await setMode(c.id, 'ios_reminder', 'always')
  const two = () => ({ choices: [{ delta: { tool_calls: [
    { index: 0, id: 'a', type: 'function', function: { name: 'ios__create_reminder', arguments: JSON.stringify({ title: '一', date: tomorrow, time: '10:00' }) } },
    { index: 1, id: 'b', type: 'function', function: { name: 'ios__create_reminder', arguments: JSON.stringify({ title: '二', date: tomorrow, time: '11:00' }) } },
  ] }, finish_reason: 'tool_calls' }] })
  const bodies = mockModel([two, replyFromResult])
  await sendUserMessage(convId, '帮我建两个提醒')
  const p = runReply(convId)
  await tap(true)
  await p
  const toolMsgs = bodies[1].messages.filter((m) => m.role === 'tool').map((m) => m.content)
  assert.ok(/limit_reached/.test(toolMsgs[1]), '第二个被拦下')
  assert.equal(opened.length, 1)
  assert.equal((await db.shortcutRuns.toArray()).length, 1)
})

test('【模拟模型】聊天：卡片等待确认时停止生成 → 卡片消失、运行取消、什么都不打开', async () => {
  const { c, convId } = await chat()
  await setMode(c.id, 'ios_calendar', 'always')
  mockModel([toolCall('ios__create_calendar_event', { title: '面试', date: tomorrow, startTime: '10:00' }), replyFromResult])
  await sendUserMessage(convId, '把明天的面试加到日历')
  const p = runReply(convId)
  for (let i = 0; i < 200 && !pendingConfirmations().length; i++) await wait(5)
  const runId = pendingConfirmations()[0].launch!.runId
  stopReply(convId)
  await p
  assert.equal(pendingConfirmations().length, 0)
  assert.equal((await db.shortcutRuns.get(runId))!.status, 'cancelled')
  assert.equal(opened.length, 0)
  assert.equal(await db.events.count(), 0, '聆聆日历也没有被写入')
})
