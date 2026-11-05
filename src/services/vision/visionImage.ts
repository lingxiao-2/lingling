/**
 * 浏览器端：把表情包整理成发给识图模型的图片（不联网）。
 *  - 静态图：缩小到 512 px 以内，铺白底（透明区域不会变黑）导出 JPEG
 *  - 动图：解码后按时间均匀抽取最多 4 帧，拼成一张 2×2 的图（每格 ≤ 256 px），控制图片数量与 Token
 *  - 动图解码失败时退回第一帧，并在结果中标明「只看了第一帧」
 */
import { decodeGif, pickKeyframes } from './gif'
import type { VisionImage } from './vision'

function dataUrlToBytes(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片无法打开'))
    img.src = src
  })
}

function whiteCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  return { c, g }
}

export async function renderVisionImage(dataUrl: string): Promise<VisionImage> {
  if (dataUrl.startsWith('data:image/gif')) {
    try {
      const gif = decodeGif(dataUrlToBytes(dataUrl))
      const frames = pickKeyframes(gif.frames, 4)
      if (frames.length > 1) {
        const cell = Math.min(256, Math.max(gif.width, gif.height))
        const k = cell / Math.max(gif.width, gif.height)
        const cw = Math.round(gif.width * k)
        const ch = Math.round(gif.height * k)
        const cols = 2
        const rows = Math.ceil(frames.length / cols)
        const { c, g } = whiteCanvas(cw * cols + 6 * (cols - 1), ch * rows + 6 * (rows - 1))
        const tmp = document.createElement('canvas')
        tmp.width = gif.width
        tmp.height = gif.height
        const tg = tmp.getContext('2d')!
        frames.forEach((f, i) => {
          tg.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), gif.width, gif.height), 0, 0)
          g.drawImage(tmp, (i % cols) * (cw + 6), Math.floor(i / cols) * (ch + 6), cw, ch)
        })
        return { dataUrl: c.toDataURL('image/jpeg', 0.82), coverage: 'keyframes', frames: frames.length }
      }
    } catch {
      // 解码失败：退回浏览器自带的第一帧
      const img = await loadImage(dataUrl)
      const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
      const { c, g } = whiteCanvas(img.naturalWidth * k, img.naturalHeight * k)
      g.drawImage(img, 0, 0, c.width, c.height)
      return { dataUrl: c.toDataURL('image/jpeg', 0.85), coverage: 'first-frame', frames: 1 }
    }
  }
  const img = await loadImage(dataUrl)
  const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
  const { c, g } = whiteCanvas(img.naturalWidth * k, img.naturalHeight * k)
  g.drawImage(img, 0, 0, c.width, c.height)
  return { dataUrl: c.toDataURL('image/jpeg', 0.85), coverage: 'static', frames: 1 }
}
