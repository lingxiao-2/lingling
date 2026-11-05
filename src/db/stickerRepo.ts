/**
 * 表情包的本地存取。只存在本机 IndexedDB；删除表情包不会删除聊天记录，
 * 聊天里引用了已删除表情包的消息会显示为「表情包已删除」。
 */
import { db } from './db'
import type { Message, Sticker } from './schema'
import { uid } from '../lib/util'
import { isSafeStickerSrc, STICKER_LIMITS, StickerError, type PreparedSticker } from '../services/stickers'

export async function listStickers(): Promise<Sticker[]> {
  const all = await db.stickers.toArray()
  return all.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.createdAt - a.createdAt)
}

export async function addSticker(p: PreparedSticker, name = ''): Promise<Sticker> {
  if (!isSafeStickerSrc(p.dataUrl)) throw new StickerError('图片格式不正确')
  if ((await db.stickers.count()) >= STICKER_LIMITS.maxCount) throw new StickerError(`最多收藏 ${STICKER_LIMITS.maxCount} 个表情包，请先删除一些`)
  const now = Date.now()
  const s: Sticker = {
    id: uid('stk'),
    packId: 'mine',
    name: name.trim().slice(0, 20),
    dataUrl: p.dataUrl,
    mime: p.mime,
    width: p.width,
    height: p.height,
    bytes: p.bytes,
    favorite: false,
    aiUsable: true,
    createdAt: now,
    updatedAt: now,
  }
  await db.stickers.add(s)
  return s
}

export async function updateSticker(id: string, patch: Partial<Pick<Sticker, 'name' | 'favorite' | 'aiUsable'>>) {
  const p = { ...patch }
  if (p.name !== undefined) p.name = p.name.trim().slice(0, 20)
  await db.stickers.update(id, { ...p, updatedAt: Date.now() })
}

export async function deleteSticker(id: string) {
  await db.stickers.delete(id)
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
  return msg
}
