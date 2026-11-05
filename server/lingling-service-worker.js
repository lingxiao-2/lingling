/**
 * 聆聆默认 AI 服务（Cloudflare Workers）
 *
 * 让没有 API Key 的用户也能直接聊天：官方模型密钥只保存在本 Worker 的加密变量中，
 * 前端只发送匿名设备 ID；模型、参数上限与免费额度全部由服务端决定。
 *
 *   POST /v1/chat/completions   OpenAI 兼容（流式），请求头 X-Lingling-Device
 *   GET  /v1/quota              查询该设备今日剩余额度
 *
 * 必需配置（Settings → Variables and Secrets / Bindings）：
 *   UPSTREAM_BASE_URL     例：https://api.deepseek.com/v1
 *   UPSTREAM_API_KEY      官方模型密钥（Secret）
 *   UPSTREAM_MODEL        例：deepseek-chat
 *   ALLOWED_ORIGINS       例：https://lingxiao-2.github.io
 *   QUOTA                 KV 命名空间绑定（用于额度计数）
 * 可选配置（括号内为默认值）：
 *   FREE_DAILY_MESSAGES   每个设备每天的免费回复次数（30）
 *   IP_DAILY_LIMIT        每个 IP 每天的上限，防止刷设备 ID（150）
 *   GLOBAL_DAILY_LIMIT    全站每天的上限，控制总预算（3000）
 *   MAX_TOKENS            单次回复上限（600）
 *   MAX_INPUT_CHARS       单次请求的上下文总字数上限（24000）
 *   TEMPERATURE_MAX       temperature 上限（1.3）
 *   TZ_OFFSET_MINUTES     额度按哪个时区的零点重置（480 = 北京时间）
 *   SERVICE_ENABLED       设为 "false" 可临时关闭服务（维护）
 *
 * 隐私：本 Worker 不记录聊天内容、密钥或请求头；不要在这里添加 console.log(request/body)。
 * 说明：KV 计数是「最终一致」的，额度在高并发时可能有少量误差；需要严格计数时可改用 Durable Objects。
 */

const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d)
const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

function dayKey(env, now = Date.now()) {
  const offset = num(env.TZ_OFFSET_MINUTES, 480) * 60_000
  const local = new Date(now + offset)
  const day = local.toISOString().slice(0, 10)
  // 下一个本地零点（UTC 时间戳）
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - offset
  return { day, resetAt: new Date(next).toISOString(), ttl: Math.max(60, Math.ceil((next - now) / 1000) + 3600) }
}

async function readCount(kv, key) {
  return num(await kv.get(key), 0)
}

function cors(env, origin) {
  const ok = list(env.ALLOWED_ORIGINS).includes(origin)
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Lingling-Device, X-Lingling-Client',
      'Access-Control-Expose-Headers': 'X-Lingling-Remaining, X-Lingling-Reset',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  }
}

const json = (status, body, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
const fail = (status, code, message, headers, extra = {}) => json(status, { error: { code, message, ...extra } }, headers)

const DEVICE = /^[A-Za-z0-9_-]{8,80}$/

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const c = cors(env, origin)
    if (request.method === 'OPTIONS') return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers })
    if (!c.ok) return fail(403, 'origin_not_allowed', '来源网站未被允许', c.headers)

    const url = new URL(request.url)
    const device = request.headers.get('X-Lingling-Device') || ''
    if (!DEVICE.test(device)) return fail(400, 'bad_device', '缺少有效的设备标识', c.headers)
    if (!env.QUOTA) return fail(503, 'maintenance', '聆聆默认服务尚未完成配置', c.headers)

    const { day, resetAt, ttl } = dayKey(env)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    const keys = { device: `d:${day}:${device}`, ip: `i:${day}:${ip}`, global: `g:${day}` }
    const limits = {
      device: num(env.FREE_DAILY_MESSAGES, 30),
      ip: num(env.IP_DAILY_LIMIT, 150),
      global: num(env.GLOBAL_DAILY_LIMIT, 3000),
    }

    if (request.method === 'GET' && url.pathname === '/v1/quota') {
      const used = await readCount(env.QUOTA, keys.device)
      return json(200, { limit: limits.device, used, remaining: Math.max(0, limits.device - used), resetAt }, c.headers)
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') return fail(404, 'not_found', '不支持的请求', c.headers)
    if (String(env.SERVICE_ENABLED).toLowerCase() === 'false') {
      return fail(503, 'maintenance', '聆聆默认服务正在维护，请稍后再试，或改用自己的 API', c.headers)
    }
    if (!env.UPSTREAM_BASE_URL || !env.UPSTREAM_API_KEY || !env.UPSTREAM_MODEL) {
      return fail(503, 'maintenance', '聆聆默认服务尚未完成配置', c.headers)
    }

    // —— 请求校验：只接受 messages（与可选 temperature），其余参数由服务端决定 ——
    let body
    try {
      body = await request.json()
    } catch {
      return fail(400, 'bad_request', '请求格式错误', c.headers)
    }
    const msgs = Array.isArray(body?.messages) ? body.messages : null
    if (!msgs || msgs.length === 0 || msgs.length > 80) return fail(400, 'bad_request', '消息格式错误', c.headers)
    let chars = 0
    for (const m of msgs) {
      if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
        return fail(400, 'bad_request', '消息格式错误', c.headers)
      }
      chars += m.content.length
    }
    if (chars > num(env.MAX_INPUT_CHARS, 24000)) return fail(413, 'too_long', '这段对话太长了，请删除部分内容后再试', c.headers)

    // —— 额度：设备 / IP / 全站，任一用完即拒绝 ——
    const [usedDevice, usedIp, usedGlobal] = await Promise.all([
      readCount(env.QUOTA, keys.device),
      readCount(env.QUOTA, keys.ip),
      readCount(env.QUOTA, keys.global),
    ])
    if (usedDevice >= limits.device) {
      return fail(429, 'quota_exceeded', `今天的 ${limits.device} 条免费消息已经用完了，明天会自动恢复；也可以改用自己的 API 继续聊天`, c.headers, { resetAt })
    }
    if (usedIp >= limits.ip) return fail(429, 'rate_limited', '今天来自当前网络的请求太多了，请明天再试或改用自己的 API', c.headers, { resetAt })
    if (usedGlobal >= limits.global) return fail(503, 'service_busy', '今天聆聆默认服务的总额度已用完，请明天再试或改用自己的 API', c.headers, { resetAt })

    const bump = (delta) =>
      Promise.all([
        env.QUOTA.put(keys.device, String(Math.max(0, usedDevice + delta)), { expirationTtl: ttl }),
        env.QUOTA.put(keys.ip, String(Math.max(0, usedIp + delta)), { expirationTtl: ttl }),
        env.QUOTA.put(keys.global, String(Math.max(0, usedGlobal + delta)), { expirationTtl: ttl }),
      ])
    await bump(1)

    const t = Number(body.temperature)
    let upstream
    try {
      upstream = await fetch(`${String(env.UPSTREAM_BASE_URL).replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.UPSTREAM_API_KEY}` },
        body: JSON.stringify({
          model: env.UPSTREAM_MODEL,
          messages: msgs.map((m) => ({ role: m.role, content: m.content })),
          temperature: Number.isFinite(t) ? Math.min(Math.max(t, 0), num(env.TEMPERATURE_MAX, 1.3)) : 0.8,
          max_tokens: num(env.MAX_TOKENS, 600),
          stream: true,
        }),
      })
    } catch {
      await bump(0) // 恢复为原计数
      return fail(503, 'service_busy', '聆聆默认服务暂时连不上模型，请稍后再试', c.headers)
    }
    if (!upstream.ok) {
      // 上游失败不扣用户额度；不把上游的错误详情（可能含账户信息）透传给前端
      await bump(0)
      return fail(503, 'service_busy', '聆聆默认服务暂时不可用，请稍后再试，或改用自己的 API', c.headers)
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...c.headers,
        'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Lingling-Remaining': String(Math.max(0, limits.device - usedDevice - 1)),
        'X-Lingling-Reset': resetAt,
      },
    })
  },
}
