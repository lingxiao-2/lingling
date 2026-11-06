import { useEffect, useState } from 'react'
import type { Sticker } from '../db/schema'
import { getStickerImage } from '../db/stickerRepo'
import { isSafeStickerSrc } from '../services/stickers'

/** 读取表情包原图（带内存缓存）；读取完成前先显示缩略图 */
export function useStickerImage(sticker?: Sticker): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    let on = true
    setUrl(undefined)
    if (sticker) void getStickerImage(sticker.id).then((u) => on && setUrl(u))
    return () => {
      on = false
    }
  }, [sticker?.id])
  if (url) return url
  return sticker && isSafeStickerSrc(sticker.thumbUrl) ? sticker.thumbUrl : undefined
}

/** 按原始比例显示表情包（不裁切、不拉伸），GIF 正常播放 */
export function StickerPicture({ sticker, max = 120, className = '' }: { sticker: Sticker; max?: number; className?: string }) {
  const src = useStickerImage(sticker)
  const k = Math.min(1, max / Math.max(sticker.width, sticker.height))
  const w = Math.max(24, Math.round(sticker.width * k))
  const h = Math.max(24, Math.round(sticker.height * k))
  return src ? (
    <img src={src} alt={sticker.name || '表情包'} draggable={false} className={`block ${className}`} style={{ width: w, height: h, objectFit: 'contain' }} />
  ) : (
    <div className={`rounded-[12px] bg-white/30 ${className}`} style={{ width: w, height: h }} />
  )
}
