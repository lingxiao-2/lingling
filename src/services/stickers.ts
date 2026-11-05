/**
 * 表情包：只来自用户自己选择的本地图片，保存在本机 IndexedDB，不上传、不引用外部网址。
 *
 * 校验：
 *  - 只接受 PNG / JPEG / WebP / GIF，按文件头（魔数）判断真实类型，不信任扩展名和 MIME；SVG 等一律拒绝
 *  - 原文件不超过 5 MB；能被浏览器正常解码；尺寸不超过 4096 px
 *  - 静态图片较大时缩小到 512 px 以内再保存；GIF 保留原文件（保留动画），保存后不超过 1.5 MB
 */
import type { Sticker } from '../db/schema'

export type StickerMime = Sticker['mime']

export const STICKER_LIMITS = {
  /** 选择的原文件上限 */
  inputBytes: 5 * 1024 * 1024,
  /** 保存到本机的上限 */
  storedBytes: 1.5 * 1024 * 1024,
  /** 静态图片保存时的最大边长 */
  maxSide: 512,
  /** 原图最大边长（防止超大图片耗尽内存） */
  maxInputSide: 4096,
  /** 收藏数量上限 */
  maxCount: 300,
}

export class StickerError extends Error {}

/** 根据文件头判断图片类型；不是支持的图片返回 null */
export function sniffImageType(bytes: Uint8Array): StickerMime | null {
  const b = bytes
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp'
  return null
}

/** 文件层面的校验（纯函数，便于测试）：返回真实类型，或抛出带原因的错误 */
export function checkStickerFile(head: Uint8Array, size: number): StickerMime {
  if (size <= 0) throw new StickerError('文件是空的')
  if (size > STICKER_LIMITS.inputBytes) throw new StickerError(`图片太大了（${(size / 1024 / 1024).toFixed(1)} MB），请选择 5 MB 以内的图片`)
  const type = sniffImageType(head)
  if (!type) throw new StickerError('只支持 PNG、JPEG、WebP 和 GIF 图片')
  return type
}

/** dataURL 解码后的大致字节数 */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - pad
}

/** 只允许本机保存的图片 dataURL（防止任何外部网址被当作表情包显示） */
export function isSafeStickerSrc(src: string): boolean {
  return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(src)
}

function readAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new StickerError('图片读取失败'))
    r.readAsDataURL(blob)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new StickerError('图片无法打开，文件可能已损坏'))
    img.src = src
  })
}

export interface PreparedSticker {
  dataUrl: string
  mime: StickerMime
  width: number
  height: number
  bytes: number
}

/** 浏览器端：校验并整理用户选择的图片（不联网） */
export async function prepareSticker(file: File): Promise<PreparedSticker> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const type = checkStickerFile(head, file.size)
  // 以真实类型重新包装，避免文件声明的 MIME 与内容不符
  const original = await readAsDataURL(new Blob([file], { type }))
  const img = await loadImage(original)
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) throw new StickerError('图片无法打开，文件可能已损坏')
  if (w > STICKER_LIMITS.maxInputSide || h > STICKER_LIMITS.maxInputSide) throw new StickerError('图片尺寸太大了，请选择 4096 像素以内的图片')

  const side = STICKER_LIMITS.maxSide
  if (type === 'image/gif' || (Math.max(w, h) <= side && file.size <= 300 * 1024)) {
    const bytes = dataUrlBytes(original)
    if (bytes > STICKER_LIMITS.storedBytes) throw new StickerError('动图太大了，请选择 1.5 MB 以内的 GIF')
    return { dataUrl: original, mime: type, width: w, height: h, bytes }
  }
  // 静态图片：缩小到 512 px 以内。PNG / WebP 可能有透明背景，导出为 PNG；JPEG 导出为 JPEG
  const k = Math.min(1, side / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * k))
  const ch = Math.max(1, Math.round(h * k))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const g = canvas.getContext('2d')
  if (!g) throw new StickerError('图片处理失败')
  g.drawImage(img, 0, 0, cw, ch)
  const outType: StickerMime = type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  const dataUrl = canvas.toDataURL(outType, 0.9)
  const bytes = dataUrlBytes(dataUrl)
  if (bytes > STICKER_LIMITS.storedBytes) throw new StickerError('图片处理后仍然太大，请换一张')
  return { dataUrl, mime: outType, width: cw, height: ch, bytes }
}
