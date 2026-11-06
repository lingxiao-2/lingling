/**
 * 消息页搜索（纯函数）：联系人 / 角色、已有会话、聊天记录关键词。
 * 只在本机数据中查找，不上传任何内容。
 */
import type { Character, Conversation, Message } from '../db/schema'

export interface MessageHit {
  message: Message
  conversation: Conversation
  /** 以关键词为中心截取的片段 */
  snippet: string
}

export interface SearchResult {
  characters: Character[]
  conversations: Conversation[]
  messages: MessageHit[]
}

export const MESSAGE_HIT_LIMIT = 50

const norm = (s: string) => s.toLowerCase()

export function snippetAround(text: string, kw: string, radius = 14): string {
  const t = text.replace(/\s+/g, ' ')
  const i = norm(t).indexOf(norm(kw))
  if (i < 0) return t.slice(0, radius * 2)
  const start = Math.max(0, i - radius)
  const end = Math.min(t.length, i + kw.length + radius)
  return `${start > 0 ? '…' : ''}${t.slice(start, end)}${end < t.length ? '…' : ''}`
}

export function searchAll(q: string, characters: Character[], conversations: Conversation[], messages: Message[]): SearchResult {
  const kw = norm(q.trim())
  if (!kw) return { characters: [], conversations: [], messages: [] }
  const charName = new Map(characters.map((c) => [c.id, c.name]))
  const convName = (c: Conversation) => (c.type === 'group' ? c.title ?? '' : charName.get(c.characterIds[0]) ?? '')
  const convById = new Map(conversations.map((c) => [c.id, c]))

  const chars = characters.filter((c) => norm(c.name).includes(kw) || norm(c.bio).includes(kw))
  const convs = conversations
    .filter((c) => norm(convName(c)).includes(kw))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  const hits: MessageHit[] = []
  for (const m of [...messages].sort((a, b) => b.createdAt - a.createdAt)) {
    if (m.deleted || m.superseded || m.kind !== 'text') continue
    const conv = convById.get(m.conversationId)
    if (!conv || !norm(m.content).includes(kw)) continue
    hits.push({ message: m, conversation: conv, snippet: snippetAround(m.content, q.trim()) })
    if (hits.length >= MESSAGE_HIT_LIMIT) break
  }
  return { characters: chars, conversations: convs, messages: hits }
}
