/** AI 上下文构建、回复拆分与流式解析测试：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildContext, splitReply, triggeredEntries } from '../src/services/ai/context'
import { AIError, parseSSE, streamChat, testConnection } from '../src/services/ai/openai'
import type { AIConfig, Character, Lorebook, Message } from '../src/db/schema'

const char: Character = {
  id: 'c1', name: '阿玲', bio: '雪城的图书管理员', personality: '温柔，叫{{user}}的时候带着笑', speakingStyle: '轻声细语',
  backstory: '在雪城长大', relationToUser: '青梅竹马', worldId: 'w1', permissions: { useStickers: true, postMoments: true },
  exampleDialogue: '{{char}}: 要一起去看雪吗？', greeting: '今天窗外下雪了。', createdAt: 0, updatedAt: 0,
}
const book: Lorebook = {
  id: 'b1', name: '雪城', description: '', extensions: {}, createdAt: 0, updatedAt: 0,
  entries: [
    { id: 'e1', name: '钟楼', keys: ['钟楼'], secondaryKeys: [], content: '午夜敲十三下', enabled: true, constant: false, extensions: {} },
    { id: 'e2', name: '冰湖', keys: ['冰湖', 'Lake'], secondaryKeys: [], content: '冬天可以滑冰', enabled: true, constant: false, extensions: {} },
    { id: 'e3', name: '气候', keys: [], secondaryKeys: [], content: '一年十个月下雪', enabled: true, constant: true, extensions: {} },
    { id: 'e4', name: '停用', keys: ['钟楼'], secondaryKeys: [], content: '不应出现', enabled: false, constant: false, extensions: {} },
  ],
}
let t = 0
const msg = (senderType: 'user' | 'character', content: string, extra: Partial<Message> = {}): Message => ({
  id: `m${++t}`, conversationId: 'v1', senderType, senderId: senderType === 'user' ? 'user' : 'c1', kind: 'text',
  content, status: 'sent', createdAt: t, updatedAt: t, ...extra,
})

test('系统提示包含人设、世界、触发的世界书与示例（宏替换）', () => {
  const history = [msg('user', '今晚钟楼会响吗？')]
  const ctx = buildContext({ character: char, userName: '小雪', world: { id: 'w1', name: '雪城', description: '北方高原', tagline: '永冬之城', createdAt: 0 }, lorebooks: [book], history })
  const sys = ctx.messages[0].content
  assert.equal(ctx.messages[0].role, 'system')
  assert.match(sys, /你是「阿玲」/)
  assert.match(sys, /叫小雪的时候带着笑/)
  assert.match(sys, /【所在世界：雪城】\n永冬之城\n北方高原/)
  assert.match(sys, /钟楼：午夜敲十三下/)
  assert.match(sys, /气候：一年十个月下雪/)
  assert.doesNotMatch(sys, /冬天可以滑冰/)
  assert.doesNotMatch(sys, /不应出现/)
  assert.match(sys, /不是你们真实发生过的对话/)
  assert.match(sys, /阿玲: 要一起去看雪吗/)
  assert.deepEqual(ctx.usedEntries, ['气候', '钟楼'])
  // 开场白不会被当作聊天历史
  assert.deepEqual(ctx.messages.slice(1), [{ role: 'user', content: '今晚钟楼会响吗？' }])
})

test('关键词不区分大小写；只扫描最近若干条消息', () => {
  assert.deepEqual(triggeredEntries([book], 'the LAKE is frozen', 1000).map((e) => e.name), ['气候', '冰湖'])
  const history = [msg('user', '冰湖'), ...Array.from({ length: 6 }, (_, i) => msg('user', `闲聊${i}`))]
  const ctx = buildContext({ character: char, userName: '我', lorebooks: [book], history })
  assert.ok(!ctx.usedEntries.includes('冰湖'))
})

test('历史：排除已删除与被替换的版本，合并相邻同一方消息，按字数截断', () => {
  const history = [
    msg('user', '早'),
    msg('character', '旧版本回复', { superseded: true }),
    msg('character', '早呀'),
    msg('character', '今天也下雪了'),
    msg('user', '已删除的话', { deleted: true }),
    msg('user', '要出去走走吗'),
  ]
  const ctx = buildContext({ character: char, userName: '我', lorebooks: [], history })
  assert.deepEqual(ctx.messages.slice(1), [
    { role: 'user', content: '早' },
    { role: 'assistant', content: '早呀\n\n今天也下雪了' },
    { role: 'user', content: '要出去走走吗' },
  ])
  const long = Array.from({ length: 50 }, (_, i) => msg(i % 2 ? 'character' : 'user', '雪'.repeat(300)))
  const cut = buildContext({ character: char, userName: '我', lorebooks: [], history: long, budget: { historyChars: 1000 } })
  assert.equal(cut.historyCount, 3)
})

test('回复拆分：空行分隔、最多 4 条、去掉名字前缀', () => {
  assert.deepEqual(splitReply('阿玲：早呀\n\n今天下雪了\n\n\n要一起去吗？', '阿玲'), ['早呀', '今天下雪了', '要一起去吗？'])
  assert.deepEqual(splitReply('一\n\n二\n\n三\n\n四\n\n五', '阿玲'), ['一', '二', '三', '四\n五'])
  assert.deepEqual(splitReply('单行 😊 emoji', '阿玲'), ['单行 😊 emoji'])
})

test('SSE 解析：增量、注释行、[DONE]、半行缓冲', () => {
  const r = parseSSE(': ping\ndata: {"choices":[{"delta":{"content":"你"}}]}\ndata:{"choices":[{"delta":{"content":"好"}}]}\ndata: {"choi')
  assert.deepEqual(r.deltas, ['你', '好'])
  assert.equal(r.rest, 'data: {"choi')
  assert.equal(parseSSE('data: [DONE]\n').done, true)
  assert.throws(() => parseSSE('data: {"error":{"message":"bad"}}\n'), AIError)
})

const cfg: AIConfig = { mode: 'direct', baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test', proxyUrl: '', proxyToken: '', model: 'm', temperature: 0.8, maxTokens: 100 }

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

test('streamChat：直连模式请求格式与流式拼接', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init }
    return sseResponse(['data: {"choices":[{"delta":{"content":"早"}}]}\n', 'data: {"choices":[{"delta":{"content":"呀"}}]}\n\ndata: [DONE]\n'])
  }) as unknown as typeof fetch
  const progress: string[] = []
  const out = await streamChat({ config: cfg, messages: [{ role: 'user', content: 'hi' }], fetchImpl: fake, onDelta: (s) => progress.push(s) })
  assert.equal(out, '早呀')
  assert.deepEqual(progress, ['早', '早呀'])
  assert.equal(seen!.url, 'https://api.example.com/v1/chat/completions')
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer sk-test')
  const body = JSON.parse(String(seen!.init.body))
  assert.equal(body.stream, true)
  assert.equal(body.model, 'm')
})

test('streamChat：代理模式不发送服务商密钥', async () => {
  let headers: Record<string, string> = {}
  let url = ''
  const fake = (async (u: string, init: RequestInit) => {
    url = u
    headers = init.headers as Record<string, string>
    return new Response(JSON.stringify({ choices: [{ message: { content: '好' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  const out = await streamChat({ config: { ...cfg, mode: 'proxy', apiKey: 'sk-should-not-leak', proxyUrl: 'https://p.example.com/', proxyToken: 'tok' }, messages: [], fetchImpl: fake })
  assert.equal(out, '好')
  assert.equal(url, 'https://p.example.com/v1/chat/completions')
  assert.equal(headers['X-Lingling-Token'], 'tok')
  assert.ok(!JSON.stringify(headers).includes('sk-should-not-leak'))
})

test('错误分类：401 / 404 / 429 / 网络（CORS）/ 空内容 / 未配置', async () => {
  const status = (s: number) => (async () => new Response('{"error":{"message":"x"}}', { status: s })) as unknown as typeof fetch
  await assert.rejects(streamChat({ config: cfg, messages: [], fetchImpl: status(401) }), (e: AIError) => e.kind === 'auth')
  await assert.rejects(streamChat({ config: cfg, messages: [], fetchImpl: status(404) }), (e: AIError) => e.kind === 'model')
  await assert.rejects(streamChat({ config: cfg, messages: [], fetchImpl: status(429) }), (e: AIError) => e.kind === 'rate')
  const fail = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
  await assert.rejects(streamChat({ config: cfg, messages: [], fetchImpl: fail }), (e: AIError) => e.kind === 'network' && /CORS/.test(e.message))
  await assert.rejects(streamChat({ config: cfg, messages: [], fetchImpl: (async () => sseResponse(['data: [DONE]\n'])) as unknown as typeof fetch }), (e: AIError) => e.kind === 'empty')
  await assert.rejects(streamChat({ config: { ...cfg, apiKey: '' }, messages: [] }), (e: AIError) => e.kind === 'config')
  const r = await testConnection(cfg, status(401))
  assert.equal(r.ok, false)
})

test('streamChat：停止生成会中止请求', async () => {
  const ctrl = new AbortController()
  const fake = (async (_u: string, init: RequestInit) => {
    return new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
  }) as unknown as typeof fetch
  const p = streamChat({ config: cfg, messages: [], fetchImpl: fake, signal: ctrl.signal })
  ctrl.abort()
  await assert.rejects(p, (e: AIError) => e.kind === 'aborted')
})

/* ---------------- 安全代理（Cloudflare Worker 模板） ---------------- */

test('代理：校验来源与口令，转发时注入服务商密钥且不回传', async () => {
  const worker = (await import('../proxy/cloudflare-worker.js')).default as { fetch: (r: Request, env: Record<string, string>) => Promise<Response> }
  const env = { UPSTREAM_BASE_URL: 'https://up.example.com/v1/', UPSTREAM_API_KEY: 'sk-secret', ACCESS_TOKEN: 'tok', ALLOWED_ORIGINS: 'https://lingxiao-2.github.io', ALLOWED_MODELS: 'm1', MAX_TOKENS: '100' }
  const realFetch = globalThis.fetch
  let upstream: { url: string; auth: string; body: Record<string, unknown> } | null = null
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    upstream = { url, auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) }
    return new Response('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n', { headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  try {
    const req = (origin: string, token: string, body: object) =>
      new Request('https://proxy.example.com/v1/chat/completions', {
        method: 'POST',
        headers: { Origin: origin, 'X-Lingling-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const good = { model: 'm1', messages: [{ role: 'user', content: 'hi' }], max_tokens: 9999, stream: true, extra: 'drop' }
    assert.equal((await worker.fetch(req('https://evil.example.com', 'tok', good), env)).status, 403)
    assert.equal((await worker.fetch(req('https://lingxiao-2.github.io', 'wrong', good), env)).status, 401)
    assert.equal((await worker.fetch(req('https://lingxiao-2.github.io', 'tok', { ...good, model: 'other' }), env)).status, 403)
    const res = await worker.fetch(req('https://lingxiao-2.github.io', 'tok', good), env)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://lingxiao-2.github.io')
    assert.match(await res.text(), /好/)
    assert.equal(upstream!.url, 'https://up.example.com/v1/chat/completions')
    assert.equal(upstream!.auth, 'Bearer sk-secret')
    assert.equal(upstream!.body.max_tokens, 100)
    assert.ok(!('extra' in upstream!.body))
    const pre = await worker.fetch(new Request('https://proxy.example.com/v1/chat/completions', { method: 'OPTIONS', headers: { Origin: 'https://lingxiao-2.github.io' } }), env)
    assert.equal(pre.status, 204)
  } finally {
    globalThis.fetch = realFetch
  }
})
