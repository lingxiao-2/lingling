/**
 * AI 工具调用 PR A：注册表、严格参数校验、OpenAI 兼容协议解析、执行器、调用循环与限制、执行记录、回复引擎集成：npm test
 *
 * 【模拟模型】本文件中所有「模型」都是本地模拟的 OpenAI 兼容流式服务（返回预先写好的 tool_calls），
 * 不是真实的 DeepSeek。真实 DeepSeek 的 Tool Calling 兼容性需要另行验收（见 docs/ai-tools.md）。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { DB_SCHEMA_VERSION } from '../src/db/schema'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { assembleToolCalls, chatTurn, fromWireName, parseSSE, wireName } from '../src/services/ai/openai'
import { normalizeAIConfig } from '../src/services/ai/service'
import { getReplyState, runReply, setPaceScaleForTesting, stopReply } from '../src/services/ai/replyEngine'
import { schemaProblem, validate, type ObjectSchema } from '../src/tools/schema'
import { ToolRegistry, toModelTools, toolRegistry, type ToolDefinition, type ToolResult } from '../src/tools/registry'
import { denyPersonalData, executeToolCall, type Authorizer } from '../src/tools/executor'
import { runToolLoop, TOOL_RULES } from '../src/tools/loop'
import { clearToolLogs, listToolLogs, scrub } from '../src/tools/audit'
import type { ChatTurn, ToolCall } from '../src/services/ai/provider'
import type { TurnResult } from '../src/services/ai/openai'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const call = (name: string, args: unknown, id = `c_${name}`): ToolCall => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } })
const ctx = (signal = new AbortController().signal) => ({ characterId: 'ch1', characterName: '阿玲', conversationId: 'cv1', signal })

const P: ObjectSchema = {
  type: 'object',
  properties: {
    date: { type: 'string', maxLength: 10, format: 'date' },
    q: { type: 'string', maxLength: 20 },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
    kind: { type: 'string', maxLength: 10, enum: ['a', 'b'] },
    tags: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 5 } },
  },
  required: ['date'],
}

const echo = (over: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name: 'test.echo',
  label: '回声测试',
  description: '测试用：原样返回参数',
  parameters: { type: 'object', properties: { text: { type: 'string', maxLength: 50 } } },
  permission: null,
  confirm: false,
  execute: async (a) => ({ ok: true, data: { echo: a.text ?? '' }, summary: '返回 1 条' }),
  ...over,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('数据库 v9 只新增 toolLogs 表', async () => {
  assert.equal(DB_SCHEMA_VERSION, 9)
  assert.equal(db.verno, 9)
  assert.ok(db.tables.some((t) => t.name === 'toolLogs'))
})

test('参数严格校验：多余参数、缺少必填、类型、长度、枚举、非法日期一律拒绝；通过时只保留声明的字段', () => {
  assert.deepEqual(validate(P, { date: '2026-11-07', limit: 3 }), { ok: true, value: { date: '2026-11-07', limit: 3 } })
  assert.match((validate(P, { date: '2026-11-07', sql: 'drop table' }) as { error: string }).error, /不认识的参数：sql/)
  assert.match((validate(P, {}) as { error: string }).error, /缺少参数：date/)
  assert.match((validate(P, { date: '2026-02-30' }) as { error: string }).error, /不是有效日期/)
  assert.match((validate(P, { date: '2026-11-07', limit: 2.5 }) as { error: string }).error, /整数/)
  assert.match((validate(P, { date: '2026-11-07', limit: 99 }) as { error: string }).error, /不能大于/)
  assert.match((validate(P, { date: '2026-11-07', q: 'x'.repeat(21) }) as { error: string }).error, /太长/)
  assert.match((validate(P, { date: '2026-11-07', kind: 'c' }) as { error: string }).error, /只能是/)
  assert.match((validate(P, { date: '2026-11-07', tags: ['a', 'b', 'c'] }) as { error: string }).error, /最多 2 项/)
  assert.match((validate(P, { date: 20261107 }) as { error: string }).error, /应该是文字/)
  assert.equal(validate(P, ['x']).ok, false)
  // 定义本身：文字必须限制长度、列表必须限制数量
  assert.match(schemaProblem({ type: 'object', properties: { a: { type: 'string' } as never } })!, /maxLength/)
  assert.match(schemaProblem({ type: 'object', properties: { a: { type: 'array', items: { type: 'boolean' } } as never } })!, /maxItems/)
})

test('注册表：名称唯一且合法；缺说明、参数定义不合法、需要确认却没有预览、未知权限都拒绝注册；发给模型的定义带 additionalProperties: false', () => {
  const r = new ToolRegistry().register(echo())
  assert.throws(() => r.register(echo()), /重复/)
  assert.throws(() => r.register(echo({ name: 'Bad Name' })), /不合法/)
  assert.throws(() => r.register(echo({ name: 'test.a', description: ' ' })), /缺少说明/)
  assert.throws(() => r.register(echo({ name: 'test.b', confirm: true })), /必须提供预览/)
  assert.throws(() => r.register(echo({ name: 'test.c', permission: 'root' as never })), /权限不存在/)
  assert.throws(() => r.register(echo({ name: 'test.d', parameters: { type: 'object', properties: { x: { type: 'string' } as never } } })), /maxLength/)
  const [spec] = toModelTools(r.list())
  assert.equal(spec.function.name, 'test__echo')
  assert.equal(fromWireName(spec.function.name), 'test.echo')
  assert.equal(wireName('calendar.list_events'), 'calendar__list_events')
  assert.equal((spec.function.parameters as { additionalProperties: boolean }).additionalProperties, false)
  // 真实应用的注册表：本 PR 没有注册任何涉及个人数据的工具
  assert.ok(toolRegistry.list().every((d) => d.permission === null))
})

test('协议：流式 tool_calls 按 index 拼接（参数分多段到达）；普通 JSON 响应同样解析；缺 id 的补上', () => {
  const chunks = [
    { choices: [{ delta: { content: '', tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'calendar__list', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"from":"2026-' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '11-07"}' } }, { index: 1, function: { name: 'notes__list', arguments: '{}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]
  const r = parseSSE(chunks.map((c) => `data: ${JSON.stringify(c)}\n`).join('') + 'data: [DONE]\n')
  assert.equal(r.finish, 'tool_calls')
  assert.equal(r.done, true)
  assert.deepEqual(assembleToolCalls(r.toolDeltas), [
    { id: 'call_a', type: 'function', function: { name: 'calendar__list', arguments: '{"from":"2026-11-07"}' } },
    { id: 'call_1', type: 'function', function: { name: 'notes__list', arguments: '{}' } },
  ])
})

test('【模拟模型】chatTurn：提供工具时发送 tools 与 tool_choice；不提供时请求体里没有 tools；工具名称还原为内部名称', async () => {
  const bodies: Record<string, unknown>[] = []
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'test__echo', arguments: '{"text":"hi"}' } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  const config = normalizeAIConfig({ service: 'custom', mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-test', model: 'm' } as never)
  const r = await chatTurn({ config, messages: [{ role: 'user', content: 'hi' }], fetchImpl, tools: toModelTools([echo()]) })
  assert.deepEqual(r.toolCalls, [{ id: 'x', type: 'function', function: { name: 'test.echo', arguments: '{"text":"hi"}' } }])
  assert.equal(bodies[0].tool_choice, 'auto')
  assert.equal((bodies[0].tools as unknown[]).length, 1)
  await assert.rejects(chatTurn({ config, messages: [{ role: 'user', content: 'hi' }], fetchImpl }), /空内容/, '不提供工具时忽略模型的 tool_calls')
  assert.equal('tools' in bodies[1], false)
})

test('执行器：未知工具、未提供给模型的工具、非 JSON 参数、多余参数都拒绝且不执行；执行出错与超时如实返回', async () => {
  let ran = 0
  const reg = new ToolRegistry()
    .register(echo({ execute: async () => (ran++, { ok: true, data: 1, summary: '' }) }))
    .register(echo({ name: 'test.boom', execute: async () => { throw new Error('数据库写入失败') } }))
    .register(echo({ name: 'test.slow', timeoutMs: 30, execute: () => new Promise<ToolResult>(() => {}) }))
    .register(echo({ name: 'test.big', execute: async () => ({ ok: true, data: 'x'.repeat(7000), summary: '' }) }))
  const env = { registry: reg, ctx: ctx(), authorize: denyPersonalData, allowed: new Set(['test.echo', 'test.boom', 'test.slow', 'test.big']) }
  const code = async (c: ToolCall, e = env) => {
    const r = (await executeToolCall(c, e)).result
    return r.ok ? 'ok' : `${r.code}:${r.error}`
  }
  assert.match(await code(call('fs.read', {})), /^unknown_tool/)
  assert.match(await code(call('test.echo', {}), { ...env, allowed: new Set() }), /^unknown_tool/)
  assert.match(await code(call('test.echo', '{not json')), /^bad_arguments/)
  assert.match(await code(call('test.echo', '[1]')), /^bad_arguments/)
  assert.match(await code(call('test.echo', { text: 'a', code: 'alert(1)' })), /^bad_arguments:不认识的参数：code/)
  assert.equal(ran, 0, '以上都没有执行')
  assert.equal(await code(call('test.echo', '')), 'ok', '空参数当作 {}')
  assert.equal(ran, 1)
  assert.equal(await code(call('test.boom', {})), 'execution_failed:执行失败：数据库写入失败')
  assert.match(await code(call('test.slow', {})), /^timeout/)
  assert.match(await code(call('test.big', {})), /^result_too_large/)
})

test('执行器：没有权限层时，涉及个人数据或需要确认的工具一律不执行（例如日记）', async () => {
  let ran = false
  const diary = echo({ name: 'diary.search', permission: 'diary_read', execute: async () => ((ran = true), { ok: true, data: '日记正文', summary: '' }) })
  const write = echo({ name: 'notes.create_draft', permission: null, confirm: true, preview: async () => ({ title: 't', lines: [] }), execute: async () => ((ran = true), { ok: true, data: 1, summary: '' }) })
  const reg = new ToolRegistry().register(diary).register(write)
  const env = { registry: reg, ctx: ctx(), authorize: denyPersonalData, allowed: new Set(['diary.search', 'notes.create_draft']) }
  const a = await executeToolCall(call('diary.search', {}), env)
  const b = await executeToolCall(call('notes.create_draft', {}), env)
  assert.equal(ran, false)
  assert.deepEqual([a.result.ok || a.result.code, b.result.ok || b.result.code], ['not_granted', 'not_granted'])
  assert.doesNotMatch(a.content, /日记正文/)
})

test('执行记录：记录时间、角色、工具、确认状态、结果与错误；不记录结果正文；看起来像密钥的内容会隐藏；可以清空', async () => {
  const reg = new ToolRegistry().register(echo({ execute: async () => ({ ok: true, data: { secretText: '今天我很难过' }, summary: '返回 1 条' }) }))
  const env = { registry: reg, ctx: ctx(), authorize: denyPersonalData, allowed: new Set(['test.echo']) }
  await executeToolCall(call('test.echo', {}), env)
  await executeToolCall(call('nope.x', {}), env)
  const logs = await listToolLogs()
  assert.equal(logs.length, 2)
  const ok = logs.find((l) => l.tool === 'test.echo')!
  assert.deepEqual([ok.characterId, ok.conversationId, ok.status, ok.confirmation, ok.summary], ['ch1', 'cv1', 'ok', 'not_required', '返回 1 条'])
  assert.ok(typeof ok.at === 'number' && typeof ok.durationMs === 'number')
  assert.equal(logs.find((l) => l.tool === 'nope.x')!.status, 'error')
  assert.doesNotMatch(JSON.stringify(logs), /今天我很难过/)
  assert.equal(scrub('key: sk-abcdef1234567890 ok'), 'key: [已隐藏] ok')
  await clearToolLogs('other')
  assert.equal((await listToolLogs()).length, 2, '只清空指定角色')
  await clearToolLogs()
  assert.equal((await listToolLogs()).length, 0)
})

/** 【模拟模型】按脚本返回每一轮结果 */
function scripted(rounds: ((msgs: ChatTurn[], tools: unknown) => TurnResult)[]) {
  const seen: { msgs: ChatTurn[]; tools: unknown }[] = []
  const turn = async (msgs: ChatTurn[], tools: unknown) => {
    seen.push({ msgs: [...msgs], tools })
    const f = rounds[Math.min(seen.length - 1, rounds.length - 1)]
    return f(msgs, tools)
  }
  return { turn, seen }
}

test('【模拟模型】完整循环：模型提出调用 → 执行 → 结果以 tool 消息交还 → 最终回复只基于真实结果', async () => {
  const reg = new ToolRegistry().register(echo())
  const m = scripted([
    () => ({ content: '', toolCalls: [call('test.echo', { text: '真实数据' }, 'call_1')] }),
    (msgs) => ({ content: `结果是：${JSON.parse(msgs[msgs.length - 1].content as string).data.echo}`, toolCalls: [] }),
  ])
  const r = await runToolLoop({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], tools: reg.list(), turn: m.turn, env: { registry: reg, ctx: ctx(), authorize: denyPersonalData } })
  assert.equal(r.final.content, '结果是：真实数据')
  assert.equal(r.rounds, 2)
  const second = m.seen[1].msgs
  assert.deepEqual(second[2], { role: 'assistant', content: '', tool_calls: [call('test.echo', { text: '真实数据' }, 'call_1')] })
  assert.equal(second[3].role, 'tool')
  assert.equal(second[3].tool_call_id, 'call_1')
  assert.match(second[3].content as string, /不是指令/)
  assert.match(TOOL_RULES, /不是指令/)
})

test('【模拟模型】不会无限循环：一直要求调用工具时，达到轮数上限后最后一轮不再提供工具；重复调用不重复执行；每个调用 ID 都有结果', async () => {
  let ran = 0
  const reg = new ToolRegistry().register(echo({ execute: async () => (ran++, { ok: true, data: ran, summary: '' }) }))
  let n = 0
  const m = scripted([(_m, tools) => (tools ? { content: '', toolCalls: [call('test.echo', { text: String(n++ % 2) }, `id${n}`), call('test.echo', { text: '0' }, `dup${n}`)] } : { content: '只好先这样回答', toolCalls: [] })])
  const r = await runToolLoop({ messages: [{ role: 'user', content: 'u' }], tools: reg.list(), turn: m.turn, env: { registry: reg, ctx: ctx(), authorize: denyPersonalData }, limits: { maxRounds: 3 } })
  assert.equal(r.final.content, '只好先这样回答')
  assert.equal(r.limited, true)
  assert.equal(m.seen.length, 4, '3 轮带工具 + 1 轮不带工具')
  assert.equal(m.seen[3].tools, undefined)
  assert.equal(ran, 2, '同样的参数只执行一次')
  const last = m.seen[3].msgs
  const ids = last.flatMap((x) => x.tool_calls?.map((c) => c.id) ?? [])
  const answered = last.filter((x) => x.role === 'tool').map((x) => x.tool_call_id)
  assert.deepEqual(answered, ids)
  assert.ok(last.some((x) => x.role === 'tool' && /duplicate_call/.test(x.content as string)))
})

test('【模拟模型】每轮与每次回复的调用次数上限、工具结果总字数上限', async () => {
  const reg = new ToolRegistry().register(echo({ execute: async (a) => ({ ok: true, data: 'y'.repeat(900) + String(a.text), summary: '' }) }))
  let round = 0
  const m = scripted([
    (_m, tools) => (tools ? (round++, { content: '', toolCalls: Array.from({ length: 6 }, (_, i) => call('test.echo', { text: `${round}-${i}` }, `k${round}${i}`)) }) : { content: '完', toolCalls: [] }),
  ])
  const r = await runToolLoop({ messages: [], tools: reg.list(), turn: m.turn, env: { registry: reg, ctx: ctx(), authorize: denyPersonalData }, limits: { maxCallsPerRound: 2, maxCalls: 3, maxToolChars: 2800 } })
  assert.equal(r.executed.length, 3)
  const tools = m.seen[m.seen.length - 1].msgs.filter((x) => x.role === 'tool').map((x) => x.content as string)
  assert.ok(tools.some((c) => /limit_reached/.test(c)))
  assert.ok(tools.some((c) => /result_too_large/.test(c)))
  // 超出预算之后每个调用只回固定的一句短结果
  const firstOver = tools.findIndex((c) => /result_too_large/.test(c))
  assert.ok(tools.slice(0, firstOver).reduce((n, c) => n + c.length, 0) <= 2800)
  assert.ok(tools.slice(firstOver).every((c) => c.length <= 200))
})

test('【模拟模型】停止生成：工具执行中停止立即结束，剩下的调用不再执行，也不再请求模型', async () => {
  const ctrl = new AbortController()
  const done: string[] = []
  const reg = new ToolRegistry()
    .register(echo({ name: 'test.wait', execute: () => new Promise<ToolResult>((res) => setTimeout(() => res({ ok: true, data: 1, summary: '' }), 200)) }))
    .register(echo({ execute: async () => (done.push('echo'), { ok: true, data: 1, summary: '' }) }))
  const m = scripted([() => ({ content: '', toolCalls: [call('test.wait', {}), call('test.echo', {})] }), () => ({ content: '不该到这里', toolCalls: [] })])
  setTimeout(() => ctrl.abort(), 30)
  await assert.rejects(runToolLoop({ messages: [], tools: reg.list(), turn: m.turn, env: { registry: reg, ctx: ctx(ctrl.signal), authorize: denyPersonalData } }), /已停止生成/)
  assert.deepEqual(done, [])
  assert.equal(m.seen.length, 1)
})

test('【模拟模型】授权函数抛出异常时按未授权处理，不执行', async () => {
  let ran = false
  const reg = new ToolRegistry().register(echo({ execute: async () => ((ran = true), { ok: true, data: 1, summary: '' }) }))
  const bad: Authorizer = async () => { throw new Error('权限数据损坏') }
  const r = await executeToolCall(call('test.echo', {}), { registry: reg, ctx: ctx(), authorize: bad, allowed: new Set(['test.echo']) })
  assert.equal(ran, false)
  assert.equal(r.result.ok, false)
})

/* ---------- 回复引擎集成（模拟 OpenAI 兼容流式服务） ---------- */

type Body = { messages: ChatTurn[]; tools?: { function: { name: string } }[] }
let bodies: Body[] = []
let script: ((b: Body) => unknown[])[] = []
const sse = (objs: unknown[]) => {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({ start(c) { for (const o of objs) c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
}
globalThis.fetch = (async (_u: string, init: RequestInit) => {
  const b = JSON.parse(String(init.body)) as Body
  bodies.push(b)
  return sse(script[Math.min(bodies.length - 1, script.length - 1)](b))
}) as unknown as typeof fetch
const text = (t: string) => [{ choices: [{ delta: { content: t } }] }]
const toolCallChunk = (name: string, args: string, id = 'call_1') => [{ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }] }, finish_reason: 'tool_calls' }] }]

async function settle(convId: string) {
  for (let i = 0; i < 200; i++) {
    const s = getReplyState(convId).status
    if (s === 'idle' || s === 'error') return
    await wait(15)
  }
  throw new Error('回复未完成')
}

async function setupChat(service: 'custom' | 'lingling' = 'custom') {
  setPaceScaleForTesting(0)
  bodies = []
  await setSetting('ai-config', { service, mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', proxyUrl: '', proxyToken: '', model: 'test-model', temperature: 0.7, maxTokens: 200 })
  const c = await createCharacter({ name: '沈星回', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  const convId = await getOrCreateSingleConversation(c.id)
  await sendUserMessage(convId, '帮我测一下')
  return { convId, charId: c.id }
}
const said = async (convId: string) => (await db.messages.where('conversationId').equals(convId).sortBy('createdAt')).filter((m) => m.senderType === 'character').map((m) => m.content)

test('【模拟模型】回复引擎：没有可用工具时请求体与以前一样（没有 tools 参数）', async () => {
  const { convId } = await setupChat()
  script = [() => text('<msg>好的</msg>')]
  await runReply(convId)
  assert.equal(bodies.length, 1)
  assert.equal('tools' in bodies[0], false)
  assert.deepEqual(await said(convId), ['好的'])
})

test('【模拟模型】回复引擎：完整工具循环，结果交还模型后生成最终回复并保存；工具结果不写入聊天记录', async () => {
  toolRegistry.register(echo())
  try {
    const { convId } = await setupChat()
    script = [() => toolCallChunk('test__echo', '{"text":"雪"}'), (b) => text(`<msg>工具说：${JSON.parse(b.messages[b.messages.length - 1].content as string).data.echo}</msg>`)]
    await runReply(convId)
    assert.equal(getReplyState(convId).status, 'idle')
    assert.equal(bodies.length, 2)
    assert.deepEqual(bodies[0].tools!.map((t) => t.function.name), ['test__echo'])
    assert.equal(bodies[0].messages[1].role, 'system')
    assert.match(bodies[0].messages[1].content as string, /只能根据工具真实返回的结果回答/)
    assert.equal(bodies[1].messages.at(-1)!.role, 'tool')
    assert.equal(bodies[1].messages.at(-2)!.tool_calls![0].function.name, 'test.echo')
    assert.deepEqual(await said(convId), ['工具说：雪'])
    const msgs = await db.messages.toArray()
    assert.ok(!msgs.some((m) => /"tool"/.test(m.content)))
    assert.equal((await listToolLogs())[0].tool, 'test.echo')
  } finally {
    toolRegistry.unregister('test.echo')
  }
})

test('【模拟模型】回复引擎：聆聆默认服务暂不提供工具', async () => {
  toolRegistry.register(echo())
  try {
    const { convId } = await setupChat('lingling')
    const { toolsForCharacter } = await import('../src/tools/runtime')
    assert.deepEqual(await toolsForCharacter('x', normalizeAIConfig({ service: 'lingling' } as never)), [])
    void convId
  } finally {
    toolRegistry.unregister('test.echo')
  }
})

test('【模拟模型】回复引擎：工具执行中停止生成，不再请求模型，状态回到空闲', async () => {
  toolRegistry.register(echo({ execute: () => new Promise<ToolResult>((res) => setTimeout(() => res({ ok: true, data: 1, summary: '' }), 300)) }))
  try {
    const { convId } = await setupChat()
    script = [() => toolCallChunk('test__echo', '{}'), () => text('<msg>不该出现</msg>')]
    const p = runReply(convId)
    for (let i = 0; i < 50 && getReplyState(convId).phase !== 'tool'; i++) await wait(5)
    assert.equal(getReplyState(convId).phase, 'tool')
    assert.equal(getReplyState(convId).toolLabel, '回声测试')
    stopReply(convId)
    await p
    await settle(convId)
    assert.equal(getReplyState(convId).status, 'idle')
    assert.equal(bodies.length, 1)
    assert.deepEqual(await said(convId), [])
  } finally {
    toolRegistry.unregister('test.echo')
  }
})

test('【模拟模型】回复引擎：模型调用不存在的工具时如实交还错误，最终回复照常生成', async () => {
  toolRegistry.register(echo())
  try {
    const { convId } = await setupChat()
    script = [() => toolCallChunk('system__exec', '{"cmd":"rm"}'), (b) => text(`<msg>${/unknown_tool/.test(b.messages.at(-1)!.content as string) ? '我没有这个能力' : '??'}</msg>`)]
    await runReply(convId)
    assert.deepEqual(await said(convId), ['我没有这个能力'])
  } finally {
    toolRegistry.unregister('test.echo')
  }
})
