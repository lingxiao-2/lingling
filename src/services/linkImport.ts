/**
 * 通过链接导入表情包（浏览器直接请求，不经过任何第三方代理）。
 *
 *  A. 图片直链：下载 → 校验文件头 → 预览 → 加入收藏
 *  B. ZIP 直链：下载 → 校验 → 解压（沿用 ZIP 的数量 / 大小 / 压缩比限制）→ 预览整套 → 选择导入
 *  C. 普通网页：尽力识别页面主要内容中的图片和 ZIP 链接，过滤头像、图标、广告等，用户选择后导入
 *  D. 无法访问：跨域限制、需要登录、无权限、不存在、超时、过大——都给出具体原因，不假装成功
 *
 * 浏览器只能读取「允许跨域读取」（CORS）的资源；很多网站不允许，这时会如实提示。
 * 不会使用公共 CORS 代理（会泄露链接），也不会绕过登录、付费墙或平台限制。
 */
import { sniffImageType } from './stickers'

export class LinkError extends Error {
  constructor(
    message: string,
    public kind: 'invalid' | 'blocked' | 'cors' | 'auth' | 'notfound' | 'ratelimit' | 'http' | 'timeout' | 'toolarge' | 'unsupported' | 'empty',
  ) {
    super(message)
  }
}

export const LINK_LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  zipBytes: 60 * 1024 * 1024,
  pageBytes: 3 * 1024 * 1024,
  timeoutMs: 20_000,
  /** 网页中最多识别多少个候选 */
  maxCandidates: 120,
}

/** 是否为内网、本机、链路本地或云元数据等不应访问的地址 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal') return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe80/.test(h) || /^::ffff:/.test(h)
  return /^\d+$/.test(h) // 十进制整数形式的 IP
}

/** 校验用户输入的链接；返回规范化后的 URL */
export function checkLink(input: string): URL {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    throw new LinkError('这不是一个有效的链接，请粘贴以 http:// 或 https:// 开头的完整地址', 'invalid')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new LinkError('只支持 http / https 链接', 'invalid')
  if (u.username || u.password) throw new LinkError('链接中不能包含用户名或密码', 'invalid')
  if (isPrivateHost(u.hostname)) throw new LinkError('不能访问本机或内网地址', 'blocked')
  return u
}

export type FetchedKind = 'image' | 'zip' | 'html'

export interface Fetched {
  kind: FetchedKind
  bytes: Uint8Array
  /** 跟随跳转后的实际地址 */
  finalUrl: string
  contentType: string
}

function isZip(b: Uint8Array) {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

/** 下载并判断类型。限制大小（边下边数，超出立即停止）、超时；校验跳转后的地址 */
export async function fetchLink(url: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<Fetched> {
  checkLink(url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), LINK_LIMITS.timeoutMs)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    let res: Response
    try {
      // credentials: omit——不带上任何登录状态；referrerPolicy: no-referrer——不暴露来源
      res = await fetchImpl(url, { mode: 'cors', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', signal: ctrl.signal })
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') throw new LinkError(signal?.aborted ? '已取消' : '网站响应太慢（超过 20 秒），请稍后再试', 'timeout')
      throw new LinkError('这个网站不允许其他网站直接读取它的文件（跨域限制），或者网络无法连接。可以先把图片保存到相册或「文件」，再从那里导入', 'cors')
    }
    const finalUrl = res.url || url
    try {
      checkLink(finalUrl)
    } catch {
      throw new LinkError('链接跳转到了不允许访问的地址', 'blocked')
    }
    if (res.status === 401 || res.status === 403) throw new LinkError('这个链接需要登录或没有访问权限，聆聆不会绕过登录或权限限制', 'auth')
    if (res.status === 404 || res.status === 410) throw new LinkError('链接指向的文件不存在或已被删除', 'notfound')
    if (res.status === 429) throw new LinkError('网站暂时限制了访问频率，请稍后再试', 'ratelimit')
    if (!res.ok) throw new LinkError(`网站返回错误（HTTP ${res.status}）`, 'http')
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    const declared = Number(res.headers.get('content-length') ?? 0)
    const max = /zip|octet-stream/.test(contentType) ? LINK_LIMITS.zipBytes : /html/.test(contentType) ? LINK_LIMITS.pageBytes : LINK_LIMITS.zipBytes
    if (declared > max) throw new LinkError(`文件太大（${(declared / 1024 / 1024).toFixed(1)} MB）`, 'toolarge')

    const chunks: Uint8Array[] = []
    let size = 0
    if (res.body) {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > max) {
          await reader.cancel()
          throw new LinkError(`文件太大（超过 ${(max / 1024 / 1024).toFixed(0)} MB）`, 'toolarge')
        }
        chunks.push(value)
      }
    } else {
      const b = new Uint8Array(await res.arrayBuffer())
      if (b.length > max) throw new LinkError('文件太大', 'toolarge')
      chunks.push(b)
      size = b.length
    }
    const bytes = new Uint8Array(size)
    let o = 0
    for (const c of chunks) {
      bytes.set(c, o)
      o += c.length
    }
    if (!bytes.length) throw new LinkError('链接返回的内容是空的', 'empty')
    if (sniffImageType(bytes.subarray(0, 16))) {
      if (bytes.length > LINK_LIMITS.imageBytes) throw new LinkError('图片太大了（超过 5 MB）', 'toolarge')
      return { kind: 'image', bytes, finalUrl, contentType }
    }
    if (isZip(bytes)) return { kind: 'zip', bytes, finalUrl, contentType }
    const head = new TextDecoder().decode(bytes.subarray(0, 2048)).toLowerCase()
    if (/html/.test(contentType) || head.includes('<html') || head.includes('<!doctype html')) return { kind: 'html', bytes, finalUrl, contentType }
    throw new LinkError('链接的内容不是支持的图片（PNG / JPEG / WebP / GIF）、ZIP 或网页', 'unsupported')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export interface PageCandidate {
  url: string
  kind: 'image' | 'zip'
  /** 页面上写明的尺寸（可能没有） */
  width?: number
  height?: number
  alt: string
}

const NOISE = /(avatar|logo|icon|favicon|sprite|banner|\bads?\b|advert|qrcode|qr_code|emoji\/|badge|button|tracking|pixel|spacer|placeholder|loading|blank\.)/i
const IMAGE_URL = /\.(png|jpe?g|webp|gif)(\?|#|$)/i

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : undefined
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

/**
 * 从网页 HTML 中找出可能是表情包的图片与 ZIP 链接（纯函数，尽力而为）。
 *  - 优先只看 <main> / <article> / 内容区域；没有时看整个 <body>
 *  - 读取 src、data-src、data-original、srcset（取最大的）、指向图片或 ZIP 的 <a href>
 *  - 过滤：头像、图标、logo、广告、二维码、1×1 跟踪像素、宽或高小于 48 的小图、data:/svg
 */
export function extractCandidates(html: string, baseUrl: string): PageCandidate[] {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  const region =
    /<main\b[\s\S]*?<\/main>/i.exec(noComments)?.[0] ??
    /<article\b[\s\S]*?<\/article>/i.exec(noComments)?.[0] ??
    /<body\b[\s\S]*<\/body>/i.exec(noComments)?.[0] ??
    noComments
  // 去掉页头、页脚、导航、侧栏
  const content = region.replace(/<(header|footer|nav|aside)\b[\s\S]*?<\/\1>/gi, '')
  const out = new Map<string, PageCandidate>()
  const add = (raw: string | undefined, kind: 'image' | 'zip', tag: string) => {
    if (!raw || out.size >= LINK_LIMITS.maxCandidates) return
    const v = decodeEntities(raw)
    if (/^(data|blob|javascript):/i.test(v) || /\.svg(\?|#|$)/i.test(v)) return
    let abs: URL
    try {
      abs = new URL(v, baseUrl)
    } catch {
      return
    }
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') return
    if (isPrivateHost(abs.hostname)) return
    const cls = `${attr(tag, 'class') ?? ''} ${attr(tag, 'id') ?? ''} ${attr(tag, 'alt') ?? ''}`
    if (NOISE.test(abs.pathname) || NOISE.test(cls)) return
    const w = Number(attr(tag, 'width') ?? 0) || undefined
    const h = Number(attr(tag, 'height') ?? 0) || undefined
    if ((w && w < 48) || (h && h < 48)) return
    const key = abs.href
    if (!out.has(key)) out.set(key, { url: key, kind, width: w, height: h, alt: (attr(tag, 'alt') ?? '').slice(0, 40) })
  }
  for (const m of content.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    const srcset = attr(tag, 'srcset') ?? attr(tag, 'data-srcset')
    let best: string | undefined
    if (srcset) {
      const items = srcset.split(',').map((s) => s.trim().split(/\s+/))
      best = items.sort((a, b) => parseFloat(b[1] ?? '1') - parseFloat(a[1] ?? '1'))[0]?.[0]
    }
    add(attr(tag, 'data-original') ?? attr(tag, 'data-src') ?? best ?? attr(tag, 'src'), 'image', tag)
  }
  for (const m of content.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], 'href')
    if (!href) continue
    if (/\.zip(\?|#|$)/i.test(href)) add(href, 'zip', m[0])
    else if (IMAGE_URL.test(href)) add(href, 'image', m[0])
  }
  return [...out.values()]
}
