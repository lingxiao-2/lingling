/**
 * 极简 GIF 解码器（纯函数，不依赖 DOM），只用于给识图模型抽取关键帧。
 * 支持全局 / 局部调色板、透明色、隔行扫描、帧处置方式（不处置 / 恢复背景 / 恢复上一帧）。
 * 有帧数与像素总量上限，异常文件只返回已解出的帧，不会让页面卡死。
 */

export interface GifFrame {
  /** 合成后的整幅画面（RGBA） */
  rgba: Uint8ClampedArray
  /** 显示时长（毫秒） */
  delay: number
}

export interface DecodedGif {
  width: number
  height: number
  frames: GifFrame[]
  /** 文件里的总帧数（可能多于解出的帧数） */
  totalFrames: number
}

const MAX_FRAMES = 200
const MAX_PIXELS = 48_000_000

function lzwDecode(minCodeSize: number, data: Uint8Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount)
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const prefix = new Int16Array(4096)
  const suffix = new Uint8Array(4096)
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1
    suffix[i] = i
  }
  let codeSize = minCodeSize + 1
  let next = eoi + 1
  let prevCode = -1
  let acc = 0
  let bits = 0
  let pos = 0
  let i = 0
  const stack = new Uint8Array(4097)
  const first = (c: number) => {
    while (prefix[c] >= 0) c = prefix[c]
    return suffix[c]
  }
  const emit = (c: number) => {
    let sp = 0
    while (c >= 0 && sp < 4096) {
      stack[sp++] = suffix[c]
      c = prefix[c]
    }
    while (sp > 0 && pos < pixelCount) out[pos++] = stack[--sp]
  }
  while (pos < pixelCount) {
    while (bits < codeSize && i < data.length) {
      acc |= data[i++] << bits
      bits += 8
    }
    if (bits < codeSize) break
    const code = acc & ((1 << codeSize) - 1)
    acc >>>= codeSize
    bits -= codeSize
    if (code === clear) {
      codeSize = minCodeSize + 1
      next = eoi + 1
      prevCode = -1
      continue
    }
    if (code === eoi) break
    if (prevCode < 0) {
      if (code >= clear) break
      emit(code)
      prevCode = code
      continue
    }
    let k: number
    if (code < next) {
      emit(code)
      k = first(code)
    } else if (code === next) {
      k = first(prevCode)
      emit(prevCode)
      if (pos < pixelCount) out[pos++] = k
    } else {
      break // 数据损坏：保留已解出的部分
    }
    if (next < 4096) {
      prefix[next] = prevCode
      suffix[next] = k
      next++
      if (next === 1 << codeSize && codeSize < 12) codeSize++
    }
    prevCode = code
  }
  return out
}

export function decodeGif(b: Uint8Array): DecodedGif {
  if (b.length < 13 || String.fromCharCode(b[0], b[1], b[2]) !== 'GIF') throw new Error('不是 GIF 文件')
  const width = b[6] | (b[7] << 8)
  const height = b[8] | (b[9] << 8)
  if (!width || !height || width * height > 16_777_216) throw new Error('GIF 尺寸异常')
  const packed = b[10]
  let p = 13
  let gct: Uint8Array | null = null
  if (packed & 0x80) {
    const size = 3 * (1 << ((packed & 7) + 1))
    gct = b.subarray(p, p + size)
    p += size
  }
  const canvas = new Uint8ClampedArray(width * height * 4)
  const frames: GifFrame[] = []
  let totalFrames = 0
  let transparent = -1
  let delay = 100
  let disposal = 0
  const readSubBlocks = (): Uint8Array => {
    const parts: Uint8Array[] = []
    let len = 0
    while (p < b.length) {
      const n = b[p++]
      if (n === 0) break
      parts.push(b.subarray(p, p + n))
      len += n
      p += n
    }
    const out = new Uint8Array(len)
    let o = 0
    for (const part of parts) {
      out.set(part, o)
      o += part.length
    }
    return out
  }
  while (p < b.length) {
    const tag = b[p++]
    if (tag === 0x3b) break
    if (tag === 0x21) {
      const label = b[p++]
      if (label === 0xf9 && b[p] === 4) {
        const flags = b[p + 1]
        delay = (b[p + 2] | (b[p + 3] << 8)) * 10 || 100
        transparent = flags & 1 ? b[p + 4] : -1
        disposal = (flags >> 2) & 7
        p += 5
        while (p < b.length && b[p] !== 0) p += b[p] + 1
        p++
      } else {
        readSubBlocks()
      }
      continue
    }
    if (tag !== 0x2c) break
    const left = b[p] | (b[p + 1] << 8)
    const top = b[p + 2] | (b[p + 3] << 8)
    const w = b[p + 4] | (b[p + 5] << 8)
    const h = b[p + 6] | (b[p + 7] << 8)
    const f = b[p + 8]
    p += 9
    let palette = gct
    if (f & 0x80) {
      const size = 3 * (1 << ((f & 7) + 1))
      palette = b.subarray(p, p + size)
      p += size
    }
    const interlaced = !!(f & 0x40)
    const minCode = b[p++]
    const data = readSubBlocks()
    totalFrames++
    if (frames.length >= MAX_FRAMES || (frames.length + 1) * width * height > MAX_PIXELS || !palette || minCode < 2 || minCode > 11) continue
    const before = disposal === 3 ? canvas.slice() : null
    const idx = lzwDecode(minCode, data, w * h)
    const rowOf = (r: number): number => {
      if (!interlaced) return r
      const p1 = Math.ceil(h / 8)
      const p2 = Math.ceil((h - 4) / 8)
      const p3 = Math.ceil((h - 2) / 4)
      if (r < p1) return r * 8
      if (r < p1 + p2) return (r - p1) * 8 + 4
      if (r < p1 + p2 + p3) return (r - p1 - p2) * 4 + 2
      return (r - p1 - p2 - p3) * 2 + 1
    }
    for (let r = 0; r < h; r++) {
      const y = top + rowOf(r)
      if (y >= height) continue
      for (let x = 0; x < w; x++) {
        const xx = left + x
        if (xx >= width) continue
        const ci = idx[r * w + x]
        if (ci === transparent) continue
        const o = (y * width + xx) * 4
        canvas[o] = palette[ci * 3] ?? 0
        canvas[o + 1] = palette[ci * 3 + 1] ?? 0
        canvas[o + 2] = palette[ci * 3 + 2] ?? 0
        canvas[o + 3] = 255
      }
    }
    frames.push({ rgba: canvas.slice(), delay })
    if (disposal === 2) {
      for (let y = top; y < Math.min(height, top + h); y++) canvas.fill(0, (y * width + left) * 4, (y * width + Math.min(width, left + w)) * 4)
    } else if (disposal === 3 && before) {
      canvas.set(before)
    }
    transparent = -1
    delay = 100
    disposal = 0
  }
  return { width, height, frames, totalFrames }
}

/** 按时间均匀抽取最多 n 帧（总是包含第一帧；帧数不足时全部返回） */
export function pickKeyframes(frames: GifFrame[], n = 4): GifFrame[] {
  if (frames.length <= n) return frames
  const total = frames.reduce((s, f) => s + f.delay, 0)
  const out: GifFrame[] = []
  const used = new Set<number>()
  for (let k = 0; k < n; k++) {
    const target = (total * k) / n
    let t = 0
    let i = 0
    for (; i < frames.length - 1 && t + frames[i].delay <= target; i++) t += frames[i].delay
    if (!used.has(i)) {
      used.add(i)
      out.push(frames[i])
    }
  }
  return out
}
