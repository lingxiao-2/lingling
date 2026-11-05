/** 双模式 AI：客户端统一接口与默认服务 Worker 测试：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIError, configProblem, resolveTarget, streamChat } from '../src/services/ai/openai'
import { setServiceUrlForTesting } from '../src/services/ai/serviceConfig'
import type { AIConfig } from '../src/db/schema'

const base: AIConfig = { service: 'lingling', mode: 'direct', baseUrl: '', apiKey: '', proxyUrl: '', proxyToken: '', model: '', temperature: 0.8, maxTokens: 500 }

/* ---------------- 客户端 ---------------- */

test('默认服务未开通：明确提示，不发请求，不生成回复', async () => {
  setServiceUrlForTesting('')
  assert.match(configProblem(base)!, /尚未开通/)
  let called = false
  const f = (async () => {
    called = true
    return new Response('')
  }) as unknown as typeof fetch
  await assert.rejects(streamChat({ config: base, messages: [], fetchImpl: f }), (e: AIError) => e.kind === 'unavailable')
  assert.equal(called, false)
})

test('默认服务：只发送设备 ID，不发送任何密钥、模型或参数', async () => {
  setServiceUrlForTesting('https://svc.example.com/')
  const t = resolveTarget({ ...base, apiKey: 'sk-user', model: 'x' }, 'dev_12345678')
  assert.equal(t.url, 'https://svc.example.com/v1/chat/completions')
  assert.equal(t.headers['X-Lingling-Device'], 'dev_12345678')
  assert.ok(!('Authorization' in t.headers))
  assert.deepEqual(t.params, {})
  let body: Record<string, unknown> = {}
  const f = (async (_u: string, init: RequestInit) => {
    body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: '你好' } }] }), { headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  assert.equal(await streamChat({ config: base, messages: [{ role: 'user', content: 'hi' }], fetchImpl: f, deviceId: 'dev_12345678' }), '你好')
  assert.deepEqual(Object.keys(body).sort(), ['messages', 'stream'])
})

test('默认服务：额度用完 / 服务繁忙 / 网络错误的友好提示', async () => {
  setServiceUrlForTesting('https://svc.example.com')
  const res = (status: number, error: object) => (async () => new Response(JSON.stringify({ error }), { status })) as unknown as typeof fetch
  await assert.rejects(
    streamChat({ config: base, messages: [], fetchImpl: res(429, { code: 'quota_exceeded', message: '今天的 30 条免费消息已经用完了', resetAt: '2026-11-06T16:00:00.000Z' }) }),
    (e: AIError) => e.kind === 'quota' && /30 条/.test(e.message) && e.resetAt === '2026-11-06T16:00:00.000Z',
  )
  await assert.rejects(streamChat({ config: base, messages: [], fetchImpl: res(503, { code: 'service_busy' }) }), (e: AIError) => e.kind === 'unavailable')
  const down = (async () => {
    throw new TypeError('Failed to fetch')
  }) as unknown as typeof fetch
  await assert.rejects(streamChat({ config: base, messages: [], fetchImpl: down }), (e: AIError) => e.kind === 'unavailable' && /自己的 API/.test(e.message))
})

test('自定义 API 不受默认服务影响', () => {
  setServiceUrlForTesting('')
  const custom: AIConfig = { ...base, service: 'custom', baseUrl: 'https://api.x/v1', apiKey: 'sk-u', model: 'm' }
  assert.equal(configProblem(custom), null)
  const t = resolveTarget(custom)
  assert.equal(t.headers.Authorization, 'Bearer sk-u')
  assert.deepEqual(t.params, { model: 'm', temperature: 0.8, max_tokens: 500 })
})

/* ---------------- 默认服务 Worker ---------------- */

type Env = Record<string, unknown>
function kv() {
  const m = new Map<string, string>()
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) }
}

async function loadWorker() {
  return (await import('../server/lingling-service-worker.js')).default as { fetch: (r: Request, env: Env) => Promise<Response> }
}

const ORIGIN = 'https://lingxiao-2.github.io'
const req = (path: string, init: { method?: string; device?: string; origin?: string; ip?: string; body?: unknown } = {}) =>
  new Request(`https://svc.example.com${path}`, {
    method: init.method ?? 'POST',
    headers: {
      Origin: init.origin ?? ORIGIN,
      'X-Lingling-Device': init.device ?? 'dev_aaaaaaaa',
      'CF-Connecting-IP': init.ip ?? '1.2.3.4',
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? (init.method === 'GET' ? undefined : JSON.stringify({ messages: [{ role: 'user', content: '你好' }], stream: true })) : JSON.stringify(init.body),
  })

function withUpstream<T>(status: number, fn: (calls: { url: string; init: RequestInit }[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return status === 200
      ? new Response('data: {"choices":[{"delta":{"content":"嗯"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
      : new Response('{"error":{"message":"upstream account detail"}}', { status })
  }) as unknown as typeof fetch
  return fn(calls).finally(() => {
    globalThis.fetch = real
  })
}

const envOf = (extra: Env = {}) => ({
  UPSTREAM_BASE_URL: 'https://up.example.com/v1',
  UPSTREAM_API_KEY: 'sk-official',
  UPSTREAM_MODEL: 'deepseek-chat',
  ALLOWED_ORIGINS: ORIGIN,
  FREE_DAILY_MESSAGES: '2',
  IP_DAILY_LIMIT: '5',
  GLOBAL_DAILY_LIMIT: '100',
  QUOTA: kv(),
  ...extra,
})

test('Worker：来源与设备校验', async () => {
  const w = await loadWorker()
  const env = envOf()
  assert.equal((await w.fetch(req('/v1/chat/completions', { origin: 'https://evil.example.com' }), env)).status, 403)
  assert.equal((await w.fetch(req('/v1/chat/completions', { device: 'x' }), env)).status, 400)
  const pre = await w.fetch(new Request('https://svc.example.com/v1/chat/completions', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env)
  assert.equal(pre.status, 204)
})

test('Worker：固定模型与上限、注入官方密钥、不回传密钥；设备额度用完后返回 quota_exceeded', async () => {
  const w = await loadWorker()
  const env = envOf()
  await withUpstream(200, async (calls) => {
    const r1 = await w.fetch(req('/v1/chat/completions', { body: { model: 'gpt-expensive', max_tokens: 99999, temperature: 9, messages: [{ role: 'user', content: '你好' }] } }), env)
    assert.equal(r1.status, 200)
    assert.match(await r1.text(), /嗯/)
    assert.equal(r1.headers.get('X-Lingling-Remaining'), '1')
    const sent = JSON.parse(String(calls[0].init.body))
    assert.equal(sent.model, 'deepseek-chat')
    assert.equal(sent.max_tokens, 600)
    assert.equal(sent.temperature, 1.3)
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer sk-official')
    assert.ok(![...r1.headers.values()].some((v) => v.includes('sk-official')))
    assert.equal((await w.fetch(req('/v1/chat/completions'), env)).status, 200)
    const r3 = await w.fetch(req('/v1/chat/completions'), env)
    assert.equal(r3.status, 429)
    const j = (await r3.json()) as { error: { code: string; resetAt: string } }
    assert.equal(j.error.code, 'quota_exceeded')
    assert.ok(j.error.resetAt)
    assert.equal(calls.length, 2)
  })
  // 额度查询
  const q = (await (await w.fetch(req('/v1/quota', { method: 'GET' }), env)).json()) as { limit: number; used: number; remaining: number }
  assert.deepEqual([q.limit, q.used, q.remaining], [2, 2, 0])
  // 另一台设备不受影响
  await withUpstream(200, async () => assert.equal((await w.fetch(req('/v1/chat/completions', { device: 'dev_bbbbbbbb' }), env)).status, 200))
})

test('Worker：上游失败不扣额度，且不透传上游错误详情', async () => {
  const w = await loadWorker()
  const env = envOf()
  await withUpstream(500, async () => {
    const r = await w.fetch(req('/v1/chat/completions'), env)
    assert.equal(r.status, 503)
    assert.doesNotMatch(await r.text(), /account detail/)
  })
  const q = (await (await w.fetch(req('/v1/quota', { method: 'GET' }), env)).json()) as { used: number }
  assert.equal(q.used, 0)
})

test('Worker：IP 上限、全站上限、输入长度、维护开关、缺少配置', async () => {
  const w = await loadWorker()
  await withUpstream(200, async () => {
    const env = envOf({ FREE_DAILY_MESSAGES: '100', IP_DAILY_LIMIT: '2' })
    await w.fetch(req('/v1/chat/completions', { device: 'dev_11111111' }), env)
    await w.fetch(req('/v1/chat/completions', { device: 'dev_22222222' }), env)
    const r = await w.fetch(req('/v1/chat/completions', { device: 'dev_33333333' }), env)
    assert.equal(r.status, 429)
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'rate_limited')

    const g = envOf({ GLOBAL_DAILY_LIMIT: '1' })
    await w.fetch(req('/v1/chat/completions', { ip: '9.9.9.1' }), g)
    const r2 = await w.fetch(req('/v1/chat/completions', { device: 'dev_44444444', ip: '9.9.9.2' }), g)
    assert.equal(r2.status, 503)
    assert.equal(((await r2.json()) as { error: { code: string } }).error.code, 'service_busy')

    const long = await w.fetch(req('/v1/chat/completions', { body: { messages: [{ role: 'user', content: '雪'.repeat(30000) }] } }), envOf())
    assert.equal(long.status, 413)
    const bad = await w.fetch(req('/v1/chat/completions', { body: { messages: [{ role: 'tool', content: 'x' }] } }), envOf())
    assert.equal(bad.status, 400)
    assert.equal((await w.fetch(req('/v1/chat/completions'), envOf({ SERVICE_ENABLED: 'false' }))).status, 503)
    assert.equal((await w.fetch(req('/v1/chat/completions'), envOf({ UPSTREAM_API_KEY: '' }))).status, 503)
  })
})
