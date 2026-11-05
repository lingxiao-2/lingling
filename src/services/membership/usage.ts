import type { Message } from '../../db/schema'

/** 本机用量统计（只统计本设备上的聊天记录，不上传） */
export interface LocalUsage {
  /** 今天收到的 AI 回复条数 */
  repliesToday: number
  /** 近 30 天收到的 AI 回复条数 */
  replies30d: number
  /** 近 30 天自己发出的消息条数 */
  sent30d: number
  /** 近 30 天 AI 回复的总字数 */
  replyChars30d: number
}

const DAY = 24 * 60 * 60 * 1000

export function computeUsage(messages: Pick<Message, 'senderType' | 'createdAt' | 'content' | 'deleted' | 'superseded'>[], now = Date.now()): LocalUsage {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  const since = now - 30 * DAY
  const u: LocalUsage = { repliesToday: 0, replies30d: 0, sent30d: 0, replyChars30d: 0 }
  for (const m of messages) {
    if (m.createdAt < since || m.createdAt > now) continue
    // 被重新生成替换的旧版本也真实消耗过模型调用，所以照样计入；软删除的消息同理
    if (m.senderType === 'character') {
      u.replies30d++
      u.replyChars30d += m.content.length
      if (m.createdAt >= today) u.repliesToday++
    } else if (m.senderType === 'user') {
      u.sent30d++
    }
  }
  return u
}
