import { db, ensureDefaults } from './db'
import { DEFAULT_WORLD_ID } from './schema'
import type { Character, Conversation, Message } from './schema'
import { uid } from '../lib/util'

export type CharacterInput = Pick<
  Character,
  'name' | 'avatar' | 'bio' | 'personality' | 'speakingStyle' | 'backstory' | 'relationToUser'
>

/* ---------- 角色 ---------- */
export async function createCharacter(input: CharacterInput): Promise<Character> {
  await ensureDefaults()
  const now = Date.now()
  const c: Character = {
    id: uid('char'),
    ...input,
    worldId: DEFAULT_WORLD_ID,
    permissions: { useStickers: true, postMoments: true },
    createdAt: now,
    updatedAt: now,
  }
  await db.characters.add(c)
  return c
}

export async function updateCharacter(id: string, input: CharacterInput): Promise<void> {
  await db.characters.update(id, { ...input, updatedAt: Date.now() })
}

/** 删除角色及其单聊会话与消息。调用方必须先让用户确认。 */
export async function deleteCharacter(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.characters, db.conversations, db.messages, db.messageVersions, db.memories],
    async () => {
      const convs = await db.conversations
        .filter((c) => c.type === 'single' && c.characterIds[0] === id)
        .toArray()
      for (const conv of convs) await deleteConversationInner(conv.id)
      await db.memories.where('characterId').equals(id).delete()
      await db.characters.delete(id)
    },
  )
}

/* ---------- 会话 ---------- */
export async function getOrCreateSingleConversation(characterId: string): Promise<string> {
  const existing = await db.conversations
    .filter((c) => c.type === 'single' && c.characterIds[0] === characterId)
    .first()
  if (existing) return existing.id
  const now = Date.now()
  const conv: Conversation = {
    id: uid('conv'),
    type: 'single',
    characterIds: [characterId],
    pinned: false,
    unread: 0,
    draft: '',
    lastMessagePreview: '',
    lastMessageAt: now,
    createdAt: now,
  }
  await db.conversations.add(conv)
  return conv.id
}

async function deleteConversationInner(id: string): Promise<void> {
  const ids = (await db.messages.where('conversationId').equals(id).primaryKeys()) as string[]
  await db.messageVersions.where('messageId').anyOf(ids).delete()
  await db.messages.where('conversationId').equals(id).delete()
  await db.conversations.delete(id)
}

export async function deleteConversation(id: string): Promise<void> {
  await db.transaction('rw', [db.conversations, db.messages, db.messageVersions], () =>
    deleteConversationInner(id),
  )
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  await db.conversations.update(id, { pinned })
}

export async function saveDraft(id: string, draft: string): Promise<void> {
  await db.conversations.update(id, { draft })
}

export async function markRead(id: string): Promise<void> {
  const c = await db.conversations.get(id)
  if (c && c.unread !== 0) await db.conversations.update(id, { unread: 0 })
}

/* ---------- 消息 ---------- */
function previewOf(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}

/** 保存用户发送的文字消息，同时更新会话摘要并清空草稿（同一事务） */
export async function sendUserMessage(conversationId: string, text: string): Promise<Message> {
  const content = text.trim()
  const now = Date.now()
  const msg: Message = {
    id: uid('msg'),
    conversationId,
    senderType: 'user',
    senderId: 'user',
    kind: 'text',
    content,
    status: 'sent',
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', [db.messages, db.conversations], async () => {
    await db.messages.add(msg)
    await db.conversations.update(conversationId, {
      draft: '',
      lastMessagePreview: previewOf(content),
      lastMessageAt: now,
    })
  })
  return msg
}

export async function softDeleteMessage(message: Message): Promise<void> {
  await db.transaction('rw', [db.messages, db.conversations], async () => {
    await db.messages.update(message.id, { deleted: true, updatedAt: Date.now() })
    const last = (
      await db.messages.where('conversationId').equals(message.conversationId).sortBy('createdAt')
    )
      .filter((m) => !m.deleted)
      .pop()
    await db.conversations.update(message.conversationId, {
      lastMessagePreview: last ? previewOf(last.content) : '',
    })
  })
}
