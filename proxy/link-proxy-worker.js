/**
 * 聆聆「表情包链接导入」图片代理（Cloudflare Workers，可选，自己部署）
 *
 * 为什么需要：很多图床（例如 i.imgant.com、微博、B 站图床）允许浏览器「显示」图片，
 * 但不返回 Access-Control-Allow-Origin，网页里的脚本因此不能读取图片内容（CORS）。
 * 这个 Worker 在服务端下载「公开的」图片或 ZIP，再把内容返回给聆聆。
 *
 *   浏览器 → GET https://<你的 worker>/fetch?url=<编码后的链接>   头：X-Lingling-Token
 *   Worker → GET <链接>（不带 Cookie、不带登录信息、不伪造 Referer）
 *
 * 安全限制：
 *  - 只接受 ALLOWED_ORIGINS 中的网站来源 + 正确的访问口令（ACCESS_TOKEN，Secret）
 *  - 只访问 https、443 端口、公网地址；用 DNS over HTTPS 解析后拒绝内网 / 本机 / 保留地址
 *  - 手动跟随跳转，最多 3 次，每一跳都重新校验
 *  - 只放行 PNG / JPEG / WebP / GIF / ZIP（按文件头判断），可选放行 HTML 网页（用于提取图片）
 *  - 大小上限：图片 10 MB、ZIP 60 MB、网页 3 MB；边下边数，超出立即中止；总超时 15 秒
 *  - 不解压 ZIP（解压在浏览器里进行，沿用数量 / 大小 / 压缩比限制，防解压炸弹）
 *  - 源站返回 401 / 403 / 404 / 429 等原样告知，不重试、不绕过
 *  - 不缓存、不记录完整链接
 *
 * 需要配置的变量（Settings → Variables and Secrets）：
 *   ACCESS_TOKEN     访问口令（类型选 Secret），在聆聆「表情包与识图 → 链接导入代理」中填写
 *   ALLOWED_ORIGINS  允许的网站来源，逗号分隔，例：https://lingxiao-2.github.io
 */

export const LIMITS = {
  image: 10 * 1024 * 1024,
  zip: 60 * 1024 * 1024,
  html: 3 * 1024 * 1024,
  redirects: 3,
  timeoutMs: 15_000,
}

/** IPv4 是否属于不允许访问的地址段 */
export function isBlockedIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return true
  const [a, b] = [Number(m[1]), Number(m[2])]
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // 链路本地 / 云元数据
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0.0/24、192.0.2.0/24
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224 // 组播、保留、广播
  )
}

/** IPv6 是否属于不允许访问的地址段（只要不是 2000::/3 公网单播就拒绝） */
export function isBlockedIPv6(ip) {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h.includes(':')) return true
  const first = h.startsWith('::') ? 0 : parseInt(h.split(':')[0] || '0', 16)
  if (Number.isNaN(first)) return true
  if ((first & 0xe000) !== 0x2000) return true // 非全球单播（含 ::1、::ffff:、fc00::/7、fe80::/10、ff00::/8）
  if (/^2001:0*db8:/.test(h) || /^2001:0*:/.test(h) || /^2002:/.test(h)) return true // 文档、Teredo、6to4
  return false
}

const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|:/

/** 校验链接本身；返回 URL 或错误代码 */
export function checkTarget(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return { error: 'invalid' }
  }
  if (u.protocol !== 'https:') return { error: u.protocol === 'http:' ? 'not_https' : 'invalid' }
  if (u.username || u.password) return { error: 'invalid' }
  if (u.port && u.port !== '443') return { error: 'blocked' }
  const host = u.hostname.toLowerCase()
  if (!host.includes('.') || /\.(localhost|local|internal|lan|home|arpa)$/.test(host) || host === 'localhost') return { error: 'blocked' }
  if (IP_LITERAL.test(host.replace(/^\[|\]$/g, ''))) {
    const ip = host.replace(/^\[|\]$/g, '')
    if (ip.includes(':') ? isBlockedIPv6(ip) : isBlockedIPv4(ip)) return { error: 'blocked' }
  }
  return { url: u }
}

/** 用 DNS over HTTPS 解析域名，任何一个解析结果是内网地址就拒绝（防 DNS 重绑定到内网） */
export async function resolveIsPublic(host, fetchImpl = fetch) {
  if (IP_LITERAL.test(host.replace(/^\[|\]$/g, ''))) return true // 字面量 IP 已在 checkTarget 中校验
  const ips = []
  for (const type of ['A', 'AAAA']) {
    const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: 'application/dns-json' },
    })
    if (!r.ok) return false
    const j = await r.json()
    for (const a of j.Answer ?? []) {
      if (a.type === 1) ips.push({ v: 4, ip: a.data })
      if (a.type === 28) ips.push({ v: 6, ip: a.data })
    }
  }
  if (!ips.length) return false
  return ips.every((x) => (x.v === 4 ? !isBlockedIPv4(x.ip) : !isBlockedIPv6(x.ip)))
}

/** 按文件头判断类型 */
export function sniff(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'application/zip'
  const head = new TextDecoder().decode(b.subarray(0, 1024)).toLowerCase()
  if (/<!doctype html|<html|<head|<body/.test(head)) return 'text/html'
  return null
}

const capFor = (type) => (type === 'application/zip' ? LIMITS.zip : type === 'text/html' ? LIMITS.html : LIMITS.image)

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

const MESSAGES = {
  invalid: '链接格式不正确',
  not_https: '代理只访问 https 链接',
  blocked: '不能访问内网、本机或保留地址',
  dns: '域名无法解析，或解析到了不允许访问的地址',
  too_many_redirects: '跳转次数过多',
  upstream_auth: '源站要求登录或拒绝访问（防盗链 / 权限限制），代理不会绕过',
  upstream_notfound: '源站文件不存在或已失效',
  upstream_ratelimit: '源站限制了访问频率',
  upstream_http: '源站返回错误',
  upstream_network: '代理无法连接源站',
  timeout: '源站响应超时',
  too_large: '文件超过大小上限',
  unsupported: '内容不是 PNG / JPEG / WebP / GIF / ZIP',
  empty: '源站返回了空内容',
  forbidden: '访问口令不正确，或请求来源不在允许列表中',
}

function errorResponse(code, cors, status = 502, extra = {}) {
  return new Response(JSON.stringify({ error: { code, message: MESSAGES[code] ?? code, ...extra } }), {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * 主流程（导出以便测试；fetchImpl 可替换）
 * @param {Request} request
 * @param {{ ACCESS_TOKEN?: string, ALLOWED_ORIGINS?: string }} env
 */
export async function handle(request, env, fetchImpl = fetch) {
  const origin = request.headers.get('origin') ?? ''
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const originOk = allowed.includes(origin)
  const cors = originOk
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'x-lingling-token',
        'access-control-expose-headers': 'x-final-url, x-content-kind',
        'access-control-max-age': '600',
        vary: 'Origin',
      }
    : { vary: 'Origin' }

  if (request.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors })
  const reqUrl = new URL(request.url)
  if (request.method !== 'GET' || reqUrl.pathname !== '/fetch') return errorResponse('invalid', cors, 404)
  if (!originOk || !env.ACCESS_TOKEN || !timingSafeEqual(request.headers.get('x-lingling-token') ?? '', env.ACCESS_TOKEN)) {
    return errorResponse('forbidden', cors, 403)
  }
  const allowHtml = reqUrl.searchParams.get('html') === '1'
  let current = reqUrl.searchParams.get('url') ?? ''
  const deadline = AbortSignal.timeout(LIMITS.timeoutMs)

  try {
    for (let hop = 0; ; hop++) {
      const t = checkTarget(current)
      if (t.error) return errorResponse(t.error, cors, 400)
      if (!(await resolveIsPublic(t.url.hostname, fetchImpl))) return errorResponse('dns', cors, 400)

      let res
      try {
        res = await fetchImpl(t.url.href, {
          method: 'GET',
          redirect: 'manual',
          signal: deadline,
          // 不带 Cookie / Authorization / Referer；只声明要图片或文件
          headers: { accept: 'image/avif,image/webp,image/png,image/*,application/zip,text/html;q=0.5,*/*;q=0.1', 'user-agent': 'LinglingStickerImport/1.0' },
        })
      } catch (e) {
        return errorResponse(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'upstream_network', cors, 504)
      }

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop >= LIMITS.redirects) return errorResponse('too_many_redirects', cors, 400)
        current = new URL(res.headers.get('location'), t.url).href
        continue
      }
      if (res.status === 401 || res.status === 403) return errorResponse('upstream_auth', cors, 502, { status: res.status })
      if (res.status === 404 || res.status === 410) return errorResponse('upstream_notfound', cors, 502, { status: res.status })
      if (res.status === 429) return errorResponse('upstream_ratelimit', cors, 502, { status: 429 })
      if (!res.ok || !res.body) return errorResponse('upstream_http', cors, 502, { status: res.status })

      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > LIMITS.zip) return errorResponse('too_large', cors, 413)

      // 先读到足够判断类型的字节，再决定上限
      const reader = res.body.getReader()
      const chunks = []
      let size = 0
      let type = null
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        size += value.length
        if (!type && size >= 16) {
          const head = new Uint8Array(Math.min(size, 1024))
          let o = 0
          for (const c of chunks) {
            const take = Math.min(c.length, head.length - o)
            head.set(c.subarray(0, take), o)
            o += take
            if (o >= head.length) break
          }
          type = sniff(head)
          if (!type || (type === 'text/html' && !allowHtml)) {
            await reader.cancel()
            return errorResponse('unsupported', cors, 415)
          }
          if (declared > capFor(type)) {
            await reader.cancel()
            return errorResponse('too_large', cors, 413)
          }
        }
        if (size > capFor(type ?? 'application/zip')) {
          await reader.cancel()
          return errorResponse('too_large', cors, 413)
        }
      }
      if (!size) return errorResponse('empty', cors, 502)
      const body = new Uint8Array(size)
      let o = 0
      for (const c of chunks) {
        body.set(c, o)
        o += c.length
      }
      type = type ?? sniff(body)
      if (!type || (type === 'text/html' && !allowHtml)) return errorResponse('unsupported', cors, 415)
      return new Response(body, {
        status: 200,
        headers: {
          ...cors,
          'content-type': type,
          'x-final-url': t.url.href,
          'x-content-kind': type.startsWith('image/') ? 'image' : type === 'application/zip' ? 'zip' : 'html',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        },
      })
    }
  } catch (e) {
    return errorResponse(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'upstream_network', cors, 504)
  }
}

export default {
  fetch: (request, env) => handle(request, env),
}
