/**
 * 表情包批量导入：相册 / 文件多选、ZIP 合集。
 *  - 一张一张处理，单张失败不影响其他图片；按内容哈希去重（与已有收藏、本批次内都去重）
 *  - ZIP：只取图片文件，忽略 macOS 附带的 __MACOSX / ._ 文件；数量、单个大小、总大小、压缩比都有上限
 *  - 不需要填写名称或含义
 * 处理图片（解码、缩略图）依赖浏览器，通过 deps.prepare 注入，便于测试。
 */
import { readZip, isUnsafePath, type ZipLimits } from '../import/extract/zip'
import { ImportError } from '../import/extract/bytes'
import { STICKER_LIMITS, StickerError, sniffImageType, type PreparedSticker } from './stickers'

export const STICKER_ZIP_LIMITS: ZipLimits = {
  maxEntries: 600,
  maxEntryBytes: STICKER_LIMITS.inputBytes,
  maxTotalBytes: 200 * 1024 * 1024,
  maxRatio: 60,
}

export interface StickerInput {
  name: string
  bytes: Uint8Array
}

export interface StickerImportResult {
  added: number
  duplicates: number
  failed: { name: string; reason: string }[]
  /** 因存储空间不足而中止 */
  stoppedForQuota: boolean
}

export interface StickerImportDeps {
  prepare: (bytes: Uint8Array) => Promise<PreparedSticker>
  /** 已有收藏的哈希 */
  existingHashes: Set<string>
  save: (p: PreparedSticker, packId: string) => Promise<void>
  onProgress?: (done: number, total: number) => void
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i

function isQuotaError(e: unknown): boolean {
  const n = (e as { name?: string; inner?: { name?: string } })?.name ?? ''
  const inner = (e as { inner?: { name?: string } })?.inner?.name ?? ''
  return /QuotaExceeded/i.test(n) || /QuotaExceeded/i.test(inner)
}

/** 展开输入：普通图片原样保留；ZIP 解出其中的图片（合集名 = ZIP 文件名） */
export async function expandInputs(inputs: StickerInput[]): Promise<{ items: (StickerInput & { packId: string })[]; failed: { name: string; reason: string }[] }> {
  const items: (StickerInput & { packId: string })[] = []
  const failed: { name: string; reason: string }[] = []
  for (const input of inputs) {
    const isZip = input.bytes.length >= 4 && input.bytes[0] === 0x50 && input.bytes[1] === 0x4b && input.bytes[2] === 0x03 && input.bytes[3] === 0x04
    if (!isZip) {
      items.push({ ...input, packId: 'mine' })
      continue
    }
    const pack = input.name.replace(/\.zip$/i, '').trim() || '表情合集'
    try {
      const entries = readZip(input.bytes, STICKER_ZIP_LIMITS).filter((e) => {
        const base = e.name.split('/').pop() ?? ''
        return !e.name.endsWith('/') && !isUnsafePath(e.name) && !e.name.startsWith('__MACOSX/') && !base.startsWith('._') && !base.startsWith('.')
      })
      const images = entries.filter((e) => IMAGE_EXT.test(e.name))
      const skipped = entries.length - images.length
      if (!images.length) failed.push({ name: input.name, reason: '压缩包里没有 PNG / JPEG / WebP / GIF 图片' })
      else if (skipped) failed.push({ name: input.name, reason: `压缩包里有 ${skipped} 个非图片文件，已跳过` })
      for (const e of images) {
        try {
          items.push({ name: `${input.name} › ${e.name.split('/').pop()}`, bytes: await e.read(), packId: pack })
        } catch (err) {
          failed.push({ name: `${input.name} › ${e.name}`, reason: err instanceof Error ? err.message : '解压失败' })
        }
      }
    } catch (err) {
      failed.push({ name: input.name, reason: err instanceof ImportError ? err.message : '压缩包无法读取，可能已损坏' })
    }
  }
  return { items, failed }
}

export async function importStickers(inputs: StickerInput[], deps: StickerImportDeps): Promise<StickerImportResult> {
  const { items, failed } = await expandInputs(inputs)
  const result: StickerImportResult = { added: 0, duplicates: 0, failed, stoppedForQuota: false }
  const seen = new Set(deps.existingHashes)
  let done = 0
  deps.onProgress?.(0, items.length)
  for (const item of items) {
    try {
      if (!sniffImageType(item.bytes.subarray(0, 16))) throw new StickerError('不是支持的图片格式（PNG / JPEG / WebP / GIF）')
      const p = await deps.prepare(item.bytes)
      if (seen.has(p.hash)) {
        result.duplicates++
      } else {
        await deps.save(p, item.packId)
        seen.add(p.hash)
        result.added++
      }
    } catch (e) {
      if (isQuotaError(e)) {
        result.stoppedForQuota = true
        result.failed.push({ name: item.name, reason: '设备存储空间不足，已停止导入' })
        break
      }
      result.failed.push({ name: item.name, reason: e instanceof Error ? e.message : '处理失败' })
    }
    done++
    deps.onProgress?.(done, items.length)
    // 让出主线程，避免几十张图片连续处理时页面卡住
    await new Promise((r) => setTimeout(r, 0))
  }
  return result
}

/** 估算剩余存储空间（Safari 可能不提供，返回 null） */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    if (!e || !e.quota) return null
    return { usage: e.usage ?? 0, quota: e.quota }
  } catch {
    return null
  }
}
