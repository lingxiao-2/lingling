/**
 * 相册：照片处理与规则。
 *  - 浏览器能解码的图片才会导入：JPEG、PNG、WebP、GIF；HEIC/HEIF 只在浏览器本身支持时导入（iPhone Safari 一般支持，
 *    从 iPhone 相册选择时系统通常也会自动转成 JPEG）。解码失败的明确报告，不会假装导入成功
 *  - 保存一张显示图（最长边 2048px，JPEG；带透明的小 PNG 保持 PNG）和一张缩略图（最长边 360px）
 *  - 只保存在本机 IndexedDB，不自动上传
 */
import type { Photo } from '../db/schema'

export const PHOTO_LIMITS = {
  /** 单张原文件上限 */
  fileBytes: 40 * 1024 * 1024,
  /** 一次最多导入 */
  batch: 60,
  /** 显示图最长边 */
  displaySide: 2048,
  /** 缩略图最长边 */
  thumbSide: 360,
  /** 名称、备注长度 */
  name: 80,
  note: 500,
}

export class PhotoError extends Error {}

const OK_TYPES = /^image\/(jpeg|jpg|png|webp|gif|heic|heif|avif)$/i
const OK_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i

/** 先按类型和扩展名粗筛（iPhone「文件」有时不给类型，只能看扩展名） */
export function precheck(file: { name: string; type: string; size: number }): string | null {
  if (!OK_TYPES.test(file.type) && !OK_EXT.test(file.name)) return '不是支持的图片格式（支持 JPEG、PNG、HEIC、WebP、GIF）'
  if (file.size > PHOTO_LIMITS.fileBytes) return `文件太大（${(file.size / 1048576).toFixed(1)} MB，单张上限 40 MB）`
  if (file.size === 0) return '文件是空的'
  return null
}

export function isHeic(file: { name: string; type: string }): boolean {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
}

/** 缩放到最长边不超过 max（不放大） */
export function fitSize(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

/** 去掉扩展名作为默认名称 */
export function defaultName(fileName: string): string {
  return (fileName.replace(/\.[a-z0-9]+$/i, '').trim() || '照片').slice(0, PHOTO_LIMITS.name)
}

/** 搜索名称与备注（不区分大小写，多个关键词需全部命中） */
export function searchPhotos(list: Photo[], q: string): Photo[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return list
  return list.filter((p) => {
    const hay = `${p.name}\n${p.note}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(2)} GB`
}

/** 存储提醒：已用超过可用空间的 80%，或照片总量超过 500 MB */
export function storageWarning(usage: number | null, quota: number | null, photoBytes: number): string | null {
  if (usage != null && quota && usage / quota > 0.8) return `本机给聆聆的空间已用 ${Math.round((usage / quota) * 100)}%，继续导入可能失败。建议先导出备份或删除不需要的照片。`
  if (photoBytes > 500 * 1048576) return `照片已占用 ${formatBytes(photoBytes)}。iPhone 在空间紧张时可能清理网站数据，建议定期导出备份。`
  return null
}

export interface PreparedPhoto {
  name: string
  blob: Blob
  mime: string
  width: number
  height: number
  thumb: string
  originalBytes: number
  originalType: string
}

/* ---------- 以下只在浏览器中运行 ---------- */

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch {
      /* 回退到 <img>：Safari 的部分版本 createImageBitmap 不支持 HEIC，但 <img> 可以 */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new PhotoError('无法解码')
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoError('图片编码失败'))), type, quality))
}

function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const step = Math.max(1, Math.floor(Math.max(w, h) / 64))
  const data = ctx.getImageData(0, 0, w, h).data
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (data[(y * w + x) * 4 + 3] < 250) return true
  return false
}

/** 解码并生成显示图与缩略图；失败时抛出 PhotoError（中文原因） */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bad = precheck(file)
  if (bad) throw new PhotoError(bad)
  let img
  try {
    img = await decode(file)
  } catch {
    throw new PhotoError(
      isHeic(file)
        ? '这个浏览器无法解码 HEIC 照片。请用 iPhone 的 Safari 打开聆聆，或在 设置 → 相机 → 格式 中选择「兼容性最佳」后重新导入'
        : '图片无法解码，可能已损坏或格式不受支持',
    )
  }
  try {
    const d = fitSize(img.width, img.height, PHOTO_LIMITS.displaySide)
    const canvas = document.createElement('canvas')
    canvas.width = d.width
    canvas.height = d.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError('无法处理图片')
    ctx.drawImage(img.source, 0, 0, d.width, d.height)
    const keepPng = /png/i.test(file.type) && file.size < 3 * 1048576 && hasAlpha(ctx, d.width, d.height)
    let blob: Blob
    if (keepPng) blob = await toBlob(canvas, 'image/png', 1)
    else {
      // 透明区域填白，再存 JPEG
      const flat = document.createElement('canvas')
      flat.width = d.width
      flat.height = d.height
      const f = flat.getContext('2d')!
      f.fillStyle = '#fff'
      f.fillRect(0, 0, d.width, d.height)
      f.drawImage(canvas, 0, 0)
      blob = await toBlob(flat, 'image/jpeg', 0.88)
    }
    const t = fitSize(img.width, img.height, PHOTO_LIMITS.thumbSide)
    const tc = document.createElement('canvas')
    tc.width = t.width
    tc.height = t.height
    const tctx = tc.getContext('2d')!
    tctx.fillStyle = '#fff'
    tctx.fillRect(0, 0, t.width, t.height)
    tctx.drawImage(img.source, 0, 0, t.width, t.height)
    return {
      name: defaultName(file.name),
      blob,
      mime: blob.type || (keepPng ? 'image/png' : 'image/jpeg'),
      width: d.width,
      height: d.height,
      thumb: tc.toDataURL('image/jpeg', 0.8),
      originalBytes: file.size,
      originalType: file.type || (file.name.split('.').pop() ?? ''),
    }
  } finally {
    img.close()
  }
}
