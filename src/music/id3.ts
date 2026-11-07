/**
 * 读取 MP3 的 ID3v2 标签（标题、歌手、专辑、封面），只在本机解析，不联网。
 * 只支持常见的 v2.3 / v2.4 文本帧与 APIC 封面；读不到时返回空，由文件名代替。
 */
export interface Tags {
  title?: string
  artist?: string
  album?: string
  cover?: { mime: string; data: Uint8Array }
}

const syncsafe = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0

function decodeText(b: Uint8Array): string {
  if (!b.length) return ''
  const enc = b[0]
  const body = b.subarray(1)
  let s: string
  try {
    if (enc === 0) s = new TextDecoder('latin1').decode(body)
    else if (enc === 1) s = new TextDecoder('utf-16').decode(body)
    else if (enc === 2) s = new TextDecoder('utf-16be').decode(body)
    else s = new TextDecoder('utf-8').decode(body)
  } catch {
    s = ''
  }
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000+$/g, '').split('\u0000')[0].trim()
}

function decodeApic(b: Uint8Array): Tags['cover'] | undefined {
  const enc = b[0]
  let i = 1
  while (i < b.length && b[i] !== 0) i++
  const mime = new TextDecoder('latin1').decode(b.subarray(1, i)) || 'image/jpeg'
  i += 2 // 结束符 + 图片类型
  // 描述：UTF-16 以 0x00 0x00 结束，其他以 0x00 结束
  if (enc === 1 || enc === 2) {
    while (i + 1 < b.length && !(b[i] === 0 && b[i + 1] === 0)) i += 2
    i += 2
  } else {
    while (i < b.length && b[i] !== 0) i++
    i += 1
  }
  if (i >= b.length) return undefined
  return { mime: mime.includes('/') ? mime : `image/${mime.toLowerCase() === 'png' ? 'png' : 'jpeg'}`, data: b.slice(i) }
}

export function readId3(buf: Uint8Array): Tags {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return {}
  const ver = buf[3]
  if (ver < 3 || ver > 4) return {}
  const size = syncsafe(buf, 6)
  const end = Math.min(10 + size, buf.length)
  let o = 10
  if (buf[5] & 0x40) o += ver === 4 ? syncsafe(buf, 10) : u32(buf, 10) + 4 // 扩展头
  const tags: Tags = {}
  while (o + 10 <= end) {
    const id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const len = ver === 4 ? syncsafe(buf, o + 4) : u32(buf, o + 4)
    const data = buf.subarray(o + 10, Math.min(o + 10 + len, end))
    if (id === 'TIT2') tags.title = decodeText(data)
    else if (id === 'TPE1') tags.artist = decodeText(data)
    else if (id === 'TALB') tags.album = decodeText(data)
    else if (id === 'APIC' && !tags.cover) tags.cover = decodeApic(data)
    o += 10 + len
  }
  return tags
}

/** 文件名 → 标题（去掉扩展名与常见的「歌手 - 标题」） */
export function titleFromFile(name: string): { title: string; artist?: string } {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').trim()
  const m = base.match(/^(.+?)\s+-\s+(.+)$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base || '未命名' }
}
