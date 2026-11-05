/**
 * OpenAI 兼容 Chat Completions 客户端（流式）。
 *  - 个人测试模式：POST {baseUrl}/chat/completions，Authorization: Bearer <apiKey>
 *  - 安全代理模式：POST {proxyUrl}/v1/chat/completions，X-Lingling-Token: <proxyToken>，密钥由代理注入
 * 不在代码中写死任何地址或密钥；所有配置来自用户设置。
 */
import type { AIConfig } from '../../db/schema'
import type { ChatTurn } from './provider'

export class AIError extends Error {
  constructor(
    message: string,
    public kind: 'config' | 'auth' | 'model' | 'rate' | 'quota' | 'network' | 'server' | 'aborted' | 'empty' | 'other',
  ) {
    super(message)
  }
}

export function configProblem(c: AIConfig): string | null {
  if (c.mode === 'proxy') {
    if (!c.proxyUrl.trim()) return '请先在「我的 → API 设置」中填写代理地址'
    if (!/^https:\/\//i.test(c.proxyUrl.trim())) return '代理地址需要以 https:// 开头'
  } else {
    if (!c.baseUrl.trim()) return '请先在「我的 → API 设置」中填写 API Base URL'
    if (!c.apiKey.trim()) return '请先在「我的 → API 设置」中填写 API Key'
    if (!/^https?:\/\//i.test(c.baseUrl.trim())) return 'API Base URL 需要以 https:// 开头'
  }
  if (!c.model.trim()) return '请先填写模型名称'
  return null
}

function endpoint(c: AIConfig): { url: string; headers: Record<string, string> } {
  if (c.mode === 'proxy') {
    return {
      url: `${c.proxyUrl.trim().replace(/\/+$/, '')}/v1/chat/completions`,
      headers: { 'Content-Type': 'application/json', 'X-Lingling-Token': c.proxyToken.trim() },
    }
  }
  return {
    url: `${c.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey.trim()}` },
  }
}

async function errorFromResponse(res: Response): Promise<AIError> {
  let detail = ''
  try {
    const body = await res.text()
    try {
      const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
      detail = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? ''
    } catch {
      detail = body.slice(0, 160)
    }
  } catch {
    /* ignore */
  }
  const tail = detail ? `（${detail.slice(0, 160)}）` : ''
  if (res.status === 401 || res.status === 403) return new AIError(`密钥或代理口令无效，服务拒绝访问${tail}`, 'auth')
  if (res.status === 404) return new AIError(`接口地址或模型名称不存在，请检查 Base URL 与模型名${tail}`, 'model')
  if (res.status === 402) return new AIError(`账户余额或额度不足${tail}`, 'quota')
  if (res.status === 429) return new AIError(`请求太频繁或额度已用完，请稍后再试${tail}`, 'rate')
  if (res.status >= 500) return new AIError(`服务暂时不可用（${res.status}）${tail}`, 'server')
  return new AIError(`请求失败（${res.status}）${tail}`, 'other')
}

function networkError(e: unknown, c: AIConfig): AIError {
  if ((e as { name?: string })?.name === 'AbortError') return new AIError('已停止生成', 'aborted')
  return new AIError(
    c.mode === 'proxy'
      ? '无法连接到代理。请检查代理地址、网络，以及代理是否允许当前网站的来源（CORS）'
      : '无法连接到 AI 服务。可能是网络问题，或该服务商不允许浏览器直接请求（CORS）。这种情况需要改用安全代理模式',
    'network',
  )
}

/**
 * 解析 SSE 文本块，返回其中的增量文字与是否结束。
 * 兼容 `data: {...}`、`data:{...}`、注释行、`[DONE]`。
 */
export function parseSSE(buffer: string): { deltas: string[]; rest: string; done: boolean } {
  const deltas: string[] = []
  let done = false
  const lines = buffer.split(/\r?\n/)
  const rest = lines.pop() ?? ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '[DONE]') {
      done = true
      continue
    }
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[]; error?: { message?: string } }
      if (j.error) throw new AIError(j.error.message ?? '服务返回错误', 'server')
      const piece = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content
      if (piece) deltas.push(piece)
    } catch (e) {
      if (e instanceof AIError) throw e
      /* 不完整或非 JSON 的行忽略 */
    }
  }
  return { deltas, rest, done }
}

export interface StreamOptions {
  config: AIConfig
  messages: ChatTurn[]
  signal?: AbortSignal
  onDelta?: (full: string) => void
  fetchImpl?: typeof fetch
}

/** 流式生成一次回复，返回完整文本。服务不支持流式时自动按普通响应处理。 */
export async function streamChat({ config, messages, signal, onDelta, fetchImpl = fetch }: StreamOptions): Promise<string> {
  const problem = configProblem(config)
  if (problem) throw new AIError(problem, 'config')
  const { url, headers } = endpoint(config)
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: true,
      }),
    })
  } catch (e) {
    throw networkError(e, config)
  }
  if (!res.ok) throw await errorFromResponse(res)

  const type = res.headers.get('content-type') ?? ''
  let full = ''
  try {
    if (!res.body || !type.includes('text/event-stream')) {
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      full = j.choices?.[0]?.message?.content ?? ''
      onDelta?.(full)
    } else {
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const r = parseSSE(buf)
        buf = r.rest
        if (r.deltas.length) {
          full += r.deltas.join('')
          onDelta?.(full)
        }
        if (r.done) break
      }
      if (buf.trim()) {
        const r = parseSSE(`${buf}\n`)
        full += r.deltas.join('')
      }
    }
  } catch (e) {
    if (e instanceof AIError) throw e
    if ((e as { name?: string })?.name === 'AbortError') {
      // 已经生成的部分保留给调用方决定是否使用
      const err = new AIError('已停止生成', 'aborted')
      ;(err as AIError & { partial?: string }).partial = full
      throw err
    }
    throw networkError(e, config)
  }
  if (!full.trim()) throw new AIError('模型返回了空内容，请重试或更换模型', 'empty')
  return full
}

/** 连接测试：发一条极短的请求，验证地址、密钥 / 口令、模型与 CORS */
export async function testConnection(config: AIConfig, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const text = await streamChat({
      config: { ...config, maxTokens: 8, temperature: 0 },
      messages: [{ role: 'user', content: '请只回复：好' }],
      signal: ctrl.signal,
      fetchImpl,
    })
    return { ok: true, message: `连接成功，模型回复：「${text.trim().slice(0, 20)}」` }
  } catch (e) {
    if (e instanceof AIError && e.kind === 'aborted') return { ok: false, message: '连接超时（20 秒）' }
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}
