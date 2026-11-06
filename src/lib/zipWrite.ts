/**
 * 极简 ZIP 写入（只用「存储」方式，不压缩：照片本身已经是 JPEG/PNG，再压缩几乎没有收益，
 * 也避免在 iPhone 上额外占用内存）。输出 Blob，由浏览器管理大块数据，不拼接成一个巨大的字符串。
 * 文件名按 UTF-8 编码（设置通用标志位 11）。不支持 ZIP64：单个文件和总大小都不超过 4 GB。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipInput {
  name: string
  data: Uint8Array | Blob
}

const MAX = 0xffffffff

async function bytesOf(d: Uint8Array | Blob): Promise<Uint8Array> {
  return d instanceof Uint8Array ? d : new Uint8Array(await d.arrayBuffer())
}

/** 生成 ZIP（逐个文件读取并计算 CRC，读完即释放引用） */
export async function writeZip(files: ZipInput[]): Promise<Blob> {
  if (files.length > 0xffff) throw new Error('文件太多（超过 65535 个）')
  const enc = new TextEncoder()
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = await bytesOf(f.data)
    if (data.length >= MAX || offset >= MAX) throw new Error('备份太大，超过 4 GB')
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // 需要的版本
    lv.setUint16(6, 0x0800, true) // UTF-8 文件名
    lv.setUint16(8, 0, true) // 存储
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cd.set(name, 46)
    central.push(cd)
    parts.push(local, f.data instanceof Blob ? f.data : data)
    offset += local.length + data.length
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end], { type: 'application/zip' })
}
