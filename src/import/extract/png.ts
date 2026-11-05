/**
 * PNG 角色卡：SillyTavern 把角色 JSON 以 base64 写在 PNG 文本块里。
 *  - 关键字 "ccv3"：V3 卡（优先）
 *  - 关键字 "chara"：V2 / V1 卡
 * 支持 tEXt、iTXt（可压缩）、zTXt（压缩）三种文本块。图片本身作为角色头像。
 */
import { ImportError, base64ToBytes, inflate, latin1, utf8 } from './bytes'

const MAX_CHUNK = 16 * 1024 * 1024
const MAX_TEXT = 8 * 1024 * 1024

interface TextChunk {
  keyword: string
  text: string
}

async function readTextChunks(b: Uint8Array): Promise<TextChunk[]> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: TextChunk[] = []
  let p = 8
  while (p + 12 <= b.length) {
    const len = dv.getUint32(p)
    const type = latin1(b.subarray(p + 4, p + 8))
    if (len > MAX_CHUNK || p + 12 + len > b.length) throw new ImportError('PNG 文件结构损坏或被截断')
    const data = b.subarray(p + 8, p + 8 + len)
    if (type === 'tEXt') {
      const z = data.indexOf(0)
      if (z > 0) out.push({ keyword: latin1(data.subarray(0, z)), text: latin1(data.subarray(z + 1)) })
    } else if (type === 'zTXt') {
      const z = data.indexOf(0)
      if (z > 0) {
        const raw = await inflate(data.subarray(z + 2), 'deflate', MAX_TEXT)
        out.push({ keyword: latin1(data.subarray(0, z)), text: latin1(raw) })
      }
    } else if (type === 'iTXt') {
      const z = data.indexOf(0)
      if (z > 0) {
        const compressed = data[z + 1] === 1
        let q = z + 3
        const langEnd = data.indexOf(0, q)
        const transEnd = langEnd >= 0 ? data.indexOf(0, langEnd + 1) : -1
        if (transEnd >= 0) {
          q = transEnd + 1
          const body = compressed ? await inflate(data.subarray(q), 'deflate', MAX_TEXT) : data.subarray(q)
          out.push({ keyword: latin1(data.subarray(0, z)), text: utf8(body) })
        }
      }
    } else if (type === 'IEND') break
    p += 12 + len
  }
  return out
}

export interface PngCard {
  json: unknown
  chunk: 'ccv3' | 'chara'
}

export async function readPngCard(b: Uint8Array): Promise<PngCard> {
  const chunks = await readTextChunks(b)
  const pick = chunks.find((c) => c.keyword === 'ccv3') ?? chunks.find((c) => c.keyword === 'chara')
  if (!pick) {
    throw new ImportError('这张 PNG 里没有角色卡数据（未找到 chara / ccv3 文本块）。它可能只是普通图片，或在保存、转发时被压缩丢失了元数据')
  }
  let text: string
  try {
    text = utf8(base64ToBytes(pick.text))
  } catch {
    throw new ImportError('PNG 中的角色数据不是有效的 base64')
  }
  try {
    return { json: JSON.parse(text), chunk: pick.keyword as PngCard['chunk'] }
  } catch {
    throw new ImportError('PNG 中的角色数据无法解析为 JSON')
  }
}
