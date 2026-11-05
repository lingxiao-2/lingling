/**
 * 极简、只读的 ZIP 读取器（用于 CharX、ZIP、DOCX）。
 * 只解析中央目录，按需解压单个条目。安全限制：
 *  - 拒绝 ZIP64、加密条目、除 存储/Deflate 以外的压缩方式
 *  - 条目数量、单个与总解压大小、压缩比都有上限（防压缩炸弹）
 *  - 绝对路径、含 ".." 的路径直接忽略（不会写入任何文件系统，仅作为名称参考）
 */
import { ImportError, inflate, utf8 } from './bytes'

export interface ZipLimits {
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
  maxRatio: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxEntryBytes: 40 * 1024 * 1024,
  maxTotalBytes: 120 * 1024 * 1024,
  maxRatio: 200,
}

export interface ZipEntry {
  name: string
  size: number
  compressedSize: number
  read(): Promise<Uint8Array>
}

export function isUnsafePath(name: string): boolean {
  const n = name.replace(/\\/g, '/')
  return n.startsWith('/') || /^[a-z]:/i.test(n) || n.split('/').some((seg) => seg === '..')
}

export function readZip(b: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  // 从尾部寻找「中央目录结束」记录（最长注释 65535 字节）
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ImportError('ZIP 文件结构损坏，找不到目录')
  const count = dv.getUint16(eocd + 10, true)
  const cdSize = dv.getUint32(eocd + 12, true)
  const cdOff = dv.getUint32(eocd + 16, true)
  if (count === 0xffff || cdOff === 0xffffffff) throw new ImportError('暂不支持 ZIP64 格式的超大压缩包')
  if (count > limits.maxEntries) throw new ImportError(`压缩包内文件过多（${count} 个），超出安全上限`)
  if (cdOff + cdSize > b.length) throw new ImportError('ZIP 文件被截断或已损坏')

  const entries: ZipEntry[] = []
  let total = 0
  let p = cdOff
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new ImportError('ZIP 目录损坏')
    const flags = dv.getUint16(p + 8, true)
    const method = dv.getUint16(p + 10, true)
    const csize = dv.getUint32(p + 20, true)
    const usize = dv.getUint32(p + 24, true)
    const nlen = dv.getUint16(p + 28, true)
    const xlen = dv.getUint16(p + 30, true)
    const clen = dv.getUint16(p + 32, true)
    const lho = dv.getUint32(p + 42, true)
    const name = utf8(b.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen

    if (name.endsWith('/')) continue
    if (flags & 0x1) throw new ImportError(`压缩包内的「${name}」已加密，无法读取`)
    if (method !== 0 && method !== 8) throw new ImportError(`压缩包使用了不支持的压缩方式（${method}）`)
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ImportError('暂不支持 ZIP64 格式的超大压缩包')
    if (isUnsafePath(name)) continue // 路径穿越：忽略
    if (usize > limits.maxEntryBytes) throw new ImportError(`压缩包内的「${name}」过大，超出安全上限`)
    if (csize > 0 && usize / csize > limits.maxRatio) throw new ImportError('压缩包的压缩比异常，疑似压缩炸弹，已拒绝')
    total += usize
    if (total > limits.maxTotalBytes) throw new ImportError('压缩包解压后的总大小超出安全上限')

    entries.push({
      name,
      size: usize,
      compressedSize: csize,
      read: async () => {
        if (dv.getUint32(lho, true) !== 0x04034b50) throw new ImportError(`压缩包内的「${name}」已损坏`)
        const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true)
        const data = b.subarray(start, start + csize)
        if (method === 0) return data
        const out = await inflate(data, 'deflate-raw', Math.max(usize, 1))
        if (out.length !== usize) throw new ImportError(`压缩包内的「${name}」大小与目录记录不符，已拒绝`)
        return out
      },
    })
  }
  return entries
}
