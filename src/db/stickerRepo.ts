/**
 * 表情包的本地存取（IndexedDB）。列表只含缩略图，原图按需读取。
 * 删除表情包不会删除聊天记录：引用它的消息会显示「表情包已删除」。识别结果按内容哈希保留，重新导入同一张图不会再次产生识别费用。
 */
import { db } from './db'
import type { Message, Sticker } from './schema'
import { uid } from '../lib/util'
import { isSafeStickerSrc, sha256Hex, STICKER_LIMITS, StickerError, type PreparedSticker } from '../services/stickers'

export async function listStickers(): Promise<Sticker[]> {
  return db.stickers.toArray()
}

export async function existingStickerHashes(): Promise<Set<string>> {
  return new Set((await db.stickers.toArray()).map((s) => s.hash).filter((h): h is string => !!h))
}

const imageCache = new Map<string, string>()

export async function getStickerImage(id: string): Promise<string | undefined> {
  const hit = imageCache.get(id)
  if (hit) return hit
  const row = await db.stickerImages.get(id)
  if (!row || !isSafeStickerSrc(row.dataUrl)) return undefined
  if (imageCache.size > 80) imageCache.delete(imageCache.keys().next().value as string)
  imageCache.set(id, row.dataUrl)
  return row.dataUrl
}

/** 旧版本导入的表情包没有哈希：需要时根据原图补算并保存 */
export async function ensureStickerHash(s: Sticker): Promise<string | undefined> {
  if (s.hash) return s.hash
  const url = await getStickerImage(s.id)
  if (!url) return undefined
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const hash = await sha256Hex(bytes)
  await db.stickers.update(s.id, { hash })
  return hash
}

export async function addSticker(p: PreparedSticker, name = '', packId = 'mine'): Promise<Sticker> {
  if (!isSafeStickerSrc(p.dataUrl) || !isSafeStickerSrc(p.thumbUrl)) throw new StickerError('图片格式不正确')
  if ((await db.stickers.count()) >= STICKER_LIMITS.maxCount) throw new StickerError(`最多收藏 ${STICKER_LIMITS.maxCount} 个表情包，请先删除一些`)
  const now = Date.now()
  const s: Sticker = {
    id: uid('stk'),
    packId,
    name: name.trim().slice(0, 40),
    thumbUrl: p.thumbUrl,
    hash: p.hash,
    mime: p.mime,
    width: p.width,
    height: p.height,
    bytes: p.bytes,
    favorite: false,
    aiUsable: true,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', [db.stickers, db.stickerImages], async () => {
    await db.stickerImages.put({ id: s.id, dataUrl: p.dataUrl })
    await db.stickers.add(s)
  })
  return s
}

export async function updateSticker(id: string, patch: Partial<Pick<Sticker, 'name' | 'favorite' | 'aiUsable'>>) {
  const p = { ...patch }
  if (p.name !== undefined) p.name = p.name.trim().slice(0, 40)
  await db.stickers.update(id, { ...p, updatedAt: Date.now() })
}

export async function deleteSticker(id: string) {
  await db.transaction('rw', [db.stickers, db.stickerImages], async () => {
    await db.stickers.delete(id)
    await db.stickerImages.delete(id)
  })
  imageCache.delete(id)
}

async function markUsed(id: string) {
  const s = await db.stickers.get(id)
  if (s) await db.stickers.update(id, { lastUsedAt: Date.now(), useCount: (s.useCount ?? 0) + 1 })
}

/** 用户发送表情包：作为一条独立消息保存，不影响输入框里的草稿 */
export async function sendUserSticker(conversationId: string, sticker: Sticker): Promise<Message> {
  const now = Date.now()
  const msg: Message = {
    id: uid('msg'),
    conversationId,
    senderType: 'user',
    senderId: 'user',
    kind: 'sticker',
    stickerId: sticker.id,
    content: `[表情包]${sticker.name ? ` ${sticker.name}` : ''}`,
    status: 'sent',
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', [db.messages, db.conversations], async () => {
    await db.messages.add(msg)
    await db.conversations.update(conversationId, { lastMessagePreview: '[表情包]', lastMessageAt: now })
  })
  await markUsed(sticker.id)
  return msg
}

export { markUsed as markStickerUsed }
