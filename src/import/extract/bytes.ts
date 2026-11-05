/** 二进制小工具：文件类型嗅探、文本解码、base64。浏览器与 Node（测试）通用，不依赖 Node API。 */

export type Sniffed = 'png' | 'zip' | 'pdf' | 'ole' | 'rtf' | 'jpeg' | 'gif' | 'webp' | 'text' | 'binary'

export function sniff(b: Uint8Array): Sniffed {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (at(0, 0x50, 0x4b, 0x03, 0x04) || at(0, 0x50, 0x4b, 0x05, 0x06)) return 'zip'
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'pdf'
  if (at(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'ole' // 旧版 .doc / .xls
  if (at(0, 0x7b, 0x5c, 0x72, 0x74, 0x66)) return 'rtf'
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  // 前 4KB 中出现 NUL（且不是 UTF-16 BOM）视为二进制
  const n = Math.min(b.length, 4096)
  const utf16 = at(0, 0xff, 0xfe) || at(0, 0xfe, 0xff)
  if (!utf16) for (let i = 0; i < n; i++) if (b[i] === 0) return 'binary'
  return 'text'
}

export const ENCODINGS = [
  { id: 'utf-8', label: 'UTF-8' },
  { id: 'gb18030', label: 'GB18030（GBK / GB2312）' },
  { id: 'big5', label: 'Big5（繁体）' },
  { id: 'utf-16le', label: 'UTF-16' },
] as const
export type EncodingId = (typeof ENCODINGS)[number]['id']

/**
 * 解码文本。未指定编码时：BOM → UTF-8（严格）→ GB18030。
 * 返回实际使用的编码，以及是否疑似乱码（含替换字符），供用户切换编码重试。
 */
export function decodeText(b: Uint8Array, encoding?: EncodingId): { text: string; encoding: EncodingId; suspicious: boolean } {
  const strip = (s: string) => s.replace(/^﻿/, '')
  const finish = (text: string, enc: EncodingId) => ({
    text: strip(text),
    encoding: enc,
    suspicious: /�/.test(text),
  })
  if (encoding) return finish(new TextDecoder(encoding).decode(b), encoding)
  if (b[0] === 0xff && b[1] === 0xfe) return finish(new TextDecoder('utf-16le').decode(b), 'utf-16le')
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return finish(new TextDecoder('utf-8').decode(b), 'utf-8')
  try {
    return finish(new TextDecoder('utf-8', { fatal: true }).decode(b), 'utf-8')
  } catch {
    return finish(new TextDecoder('gb18030').decode(b), 'gb18030')
  }
}

export function utf8(b: Uint8Array): string {
  return new TextDecoder('utf-8').decode(b)
}

export function latin1(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}

/** base64（可能含换行）→ 字节 */
export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToDataUrl(b: Uint8Array, mime: string): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < b.length; i += CH) bin += String.fromCharCode(...b.subarray(i, i + CH))
  return `data:${mime};base64,${btoa(bin)}`
}

/** 用浏览器内置的 DecompressionStream 解压；maxOut 防止解压炸弹（超出即中止） */
export async function inflate(data: Uint8Array, format: 'deflate' | 'deflate-raw', maxOut: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ImportError('当前浏览器不支持解压（需要 iOS 16.4 及以上）')
  const ds = new DecompressionStream(format)
  const writer = ds.writable.getWriter()
  void writer.write(data as unknown as BufferSource).catch(() => undefined)
  void writer.close().catch(() => undefined)
  const reader = ds.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxOut) {
      await reader.cancel().catch(() => undefined)
      throw new ImportError('解压后的内容超出安全上限，已停止（可能是压缩炸弹）')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** 可以直接展示给用户的导入错误 */
export class ImportError extends Error {}
