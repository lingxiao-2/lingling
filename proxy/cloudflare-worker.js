/**
 * 聆聆 AI 安全代理（Cloudflare Workers）
 *
 * 作用：服务商 API Key 只保存在这里（Worker 的加密变量），前端只持有「访问口令」。
 *   浏览器 → POST https://<你的 worker>/v1/chat/completions  （头：X-Lingling-Token）
 *   Worker → POST <UPSTREAM_BASE_URL>/chat/completions        （头：Authorization: Bearer <UPSTREAM_API_KEY>）
 *
 * 需要配置的变量（Settings → Variables and Secrets）：
 *   UPSTREAM_BASE_URL  例：https://api.deepseek.com/v1
 *   UPSTREAM_API_KEY   服务商密钥（类型选 Secret）
 *   ACCESS_TOKEN       自己设定的访问口令（类型选 Secret），在聆聆「API 设置 → 安全代理」中填写
 *   ALLOWED_ORIGINS    允许的网站来源，逗号分隔，例：https://lingxiao-2.github.io
 *   ALLOWED_MODELS     可选，允许的模型，逗号分隔；留空表示不限制
 *   MAX_TOKENS         可选，单次回复的 max_tokens 上限，默认 2048
 */
const json = (status, message, headers) =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  })

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const allowedOrigin = list(env.ALLOWED_ORIGINS).includes(origin)
    const cors = {
      'Access-Control-Allow-Origin': allowedOrigin ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Lingling-Token',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: allowedOrigin ? 204 : 403, headers: cors })
    if (!allowedOrigin) return json(403, '来源网站不在允许列表中（ALLOWED_ORIGINS）', cors)

    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') return json(404, '只支持 POST /v1/chat/completions', cors)
    if (!env.ACCESS_TOKEN || request.headers.get('X-Lingling-Token') !== env.ACCESS_TOKEN) return json(401, '访问口令无效', cors)
    if (!env.UPSTREAM_BASE_URL || !env.UPSTREAM_API_KEY) return json(500, '代理尚未配置 UPSTREAM_BASE_URL / UPSTREAM_API_KEY', cors)

    let body
    try {
      body = await request.json()
    } catch {
      return json(400, '请求体不是有效的 JSON', cors)
    }
    const models = list(env.ALLOWED_MODELS)
    if (models.length && !models.includes(body.model)) return json(403, `模型 ${body.model} 不在允许列表中`, cors)
    const cap = Number(env.MAX_TOKENS) || 2048
    const clean = {
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: Math.min(Number(body.max_tokens) || cap, cap),
      stream: body.stream === true,
    }

    const upstream = await fetch(`${String(env.UPSTREAM_BASE_URL).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.UPSTREAM_API_KEY}` },
      body: JSON.stringify(clean),
    })
    // 原样转发（含流式），只附加 CORS；不转发上游的其它响应头
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  },
}
