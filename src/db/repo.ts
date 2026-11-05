import { db, ensureDefaults } from './db'
import { DEFAULT_WORLD_ID } from './schema'
import type {
  Character,
  CharacterLorebookLink,
  Conversation,
  ImportSource,
  LoreEntry,
  Lorebook,
  Message,
  World,
} from './schema'
import type { CharacterDraft, LorebookDraft, WorldDraft } from '../import/types'
import { uid } from '../lib/util'

export type CharacterInput = Pick<
  Character,
  'name' | 'avatar' | 'bio' | 'personality' | 'speakingStyle' | 'backstory' | 'relationToUser'
> &
  Partial<Pick<Character, 'greeting' | 'exampleDialogue' | 'worldId'>>

/* ---------- 角色 ---------- */
export async function createCharacter(input: CharacterInput): Promise<Character> {
  await ensureDefaults()
  const now = Date.now()
  const c: Character = {
    id: uid('char'),
    ...input,
    worldId: input.worldId || DEFAULT_WORLD_ID,
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
    [db.characters, db.conversations, db.messages, db.messageVersions, db.memories, db.characterLorebooks],
    async () => {
      const convs = await db.conversations
        .filter((c) => c.type === 'single' && c.characterIds[0] === id)
        .toArray()
      for (const conv of convs) await deleteConversationInner(conv.id)
      await db.memories.where('characterId').equals(id).delete()
      // 只解除与世界书的关联，世界书本身保留
      await db.characterLorebooks.where('characterId').equals(id).delete()
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

/* ---------- 世界书与关联 ---------- */

/** 建立角色与世界书的关联；已存在则忽略 */
export async function linkLorebook(characterId: string, lorebookId: string): Promise<void> {
  const exists = await db.characterLorebooks.where({ characterId, lorebookId }).first()
  if (exists) return
  const link: CharacterLorebookLink = { id: uid('link'), characterId, lorebookId, createdAt: Date.now() }
  await db.characterLorebooks.add(link)
}

/** 解除关联，不删除世界书，也不影响角色 */
export async function unlinkLorebook(characterId: string, lorebookId: string): Promise<void> {
  await db.characterLorebooks.where({ characterId, lorebookId }).delete()
}

/** 删除世界书本身（同时解除它的所有关联）。调用方必须先让用户确认。 */
export async function deleteLorebook(id: string): Promise<void> {
  await db.transaction('rw', [db.lorebooks, db.characterLorebooks, db.worldLorebooks], async () => {
    await db.characterLorebooks.where('lorebookId').equals(id).delete()
    await db.worldLorebooks.where('lorebookId').equals(id).delete()
    await db.lorebooks.delete(id)
  })
}

export interface LorebookInput {
  name: string
  description: string
  entries: Omit<LoreEntry, 'id'>[] | LoreEntry[]
}

function withEntryIds(entries: LorebookInput['entries']): LoreEntry[] {
  return entries.map((e) => ({ ...e, id: 'id' in e && e.id ? e.id : uid('entry') }))
}

/** 手动新建世界书 */
export async function createLorebook(input: LorebookInput): Promise<Lorebook> {
  const now = Date.now()
  const book: Lorebook = {
    id: uid('book'),
    name: input.name.trim() || '未命名世界书',
    description: input.description.trim(),
    entries: withEntryIds(input.entries),
    extensions: {},
    createdAt: now,
    updatedAt: now,
  }
  await db.lorebooks.add(book)
  return book
}

/** 编辑世界书；条目的 extensions（导入时保留的原始字段）随条目一起保留 */
export async function updateLorebook(id: string, input: LorebookInput): Promise<void> {
  await db.lorebooks.update(id, {
    name: input.name.trim() || '未命名世界书',
    description: input.description.trim(),
    entries: withEntryIds(input.entries),
    updatedAt: Date.now(),
  })
}

/* ---------- 世界 ---------- */

export interface WorldInput {
  name: string
  tagline: string
  description: string
  cover?: string
}

export async function createWorld(input: WorldInput): Promise<World> {
  const now = Date.now()
  const w: World = {
    id: uid('world'),
    name: input.name.trim(),
    tagline: input.tagline.trim(),
    description: input.description.trim(),
    cover: input.cover,
    createdAt: now,
    updatedAt: now,
  }
  await db.worlds.add(w)
  return w
}

export async function updateWorld(id: string, input: WorldInput): Promise<void> {
  await db.worlds.update(id, {
    name: input.name.trim(),
    tagline: input.tagline.trim(),
    description: input.description.trim(),
    cover: input.cover,
    updatedAt: Date.now(),
  })
}

/**
 * 删除世界本身。居民角色移回「未归入世界」，关联的世界书只解除关联，都不会被删除。
 * 调用方必须先让用户确认。
 */
export async function deleteWorld(id: string): Promise<void> {
  if (id === DEFAULT_WORLD_ID) return
  await db.transaction('rw', [db.worlds, db.characters, db.worldLorebooks], async () => {
    await db.characters.where('worldId').equals(id).modify({ worldId: DEFAULT_WORLD_ID })
    await db.worldLorebooks.where('worldId').equals(id).delete()
    await db.worlds.delete(id)
  })
}

/** 设置角色所属世界（一个角色只属于一个世界）；传 DEFAULT_WORLD_ID 表示移出 */
export async function setCharacterWorld(characterId: string, worldId: string): Promise<void> {
  await db.characters.update(characterId, { worldId, updatedAt: Date.now() })
}

export async function linkWorldLorebook(worldId: string, lorebookId: string): Promise<void> {
  const exists = await db.worldLorebooks.where({ worldId, lorebookId }).first()
  if (exists) return
  await db.worldLorebooks.add({ id: uid('wlink'), worldId, lorebookId, createdAt: Date.now() })
}

export async function unlinkWorldLorebook(worldId: string, lorebookId: string): Promise<void> {
  await db.worldLorebooks.where({ worldId, lorebookId }).delete()
}

/**
 * 预留给后续 AI 上下文注入：读取角色关联的世界书。
 * 当前版本没有任何地方调用它，世界书尚不会影响聊天。
 */
export async function getCharacterLorebooks(characterId: string): Promise<Lorebook[]> {
  const links = await db.characterLorebooks.where('characterId').equals(characterId).toArray()
  const books = await db.lorebooks.bulkGet(links.map((l) => l.lorebookId))
  return books.filter((b): b is Lorebook => !!b)
}

/* ---------- 导入 ---------- */

export interface ImportCharacterPlan {
  /** 预览中的临时键，用于关联 */
  key: string
  draft: CharacterDraft
  source: Omit<ImportSource, 'importedAt'>
}

export interface ImportLorebookPlan {
  key: string
  draft: LorebookDraft
  source: Omit<ImportSource, 'importedAt'>
  /** 关联到本次导入的新角色（临时键） */
  linkNewCharacters: string[]
  /** 关联到已有联系人（稳定 ID） */
  linkExistingCharacters: string[]
}

export interface ImportWorldPlan {
  draft: WorldDraft
  source?: Omit<ImportSource, 'importedAt'>
}

export interface ImportSummary {
  characters: number
  lorebooks: number
  links: number
  /** 世界模式下新建的世界 ID */
  worldId?: string
}

/** 在一个事务里保存导入结果：要么全部成功，要么全部不写入 */
export async function saveImport(
  characters: ImportCharacterPlan[],
  lorebooks: ImportLorebookPlan[],
  world?: ImportWorldPlan,
  /** 导入到已有世界：角色归入该世界，世界书与该世界关联 */
  targetWorldId?: string,
): Promise<ImportSummary> {
  await ensureDefaults()
  const now = Date.now()
  const idByKey = new Map<string, string>()
  let linkCount = 0
  let worldId = world ? uid('world') : undefined

  await db.transaction('rw', [db.characters, db.lorebooks, db.characterLorebooks, db.worlds, db.worldLorebooks], async () => {
    if (!world && targetWorldId && targetWorldId !== DEFAULT_WORLD_ID && (await db.worlds.get(targetWorldId))) {
      worldId = targetWorldId
    }
    if (world && worldId) {
      const d = world.draft
      await db.worlds.add({
        id: worldId,
        name: d.name.trim() || '未命名世界',
        tagline: d.tagline.trim(),
        description: d.description.trim(),
        extensions: d.extensions,
        importSource: world.source ? { ...world.source, importedAt: now } : undefined,
        createdAt: now,
        updatedAt: now,
      })
    }

    for (const plan of characters) {
      const d = plan.draft
      const c: Character = {
        id: uid('char'),
        name: d.name.trim(),
        bio: d.bio.trim(),
        personality: d.personality.trim(),
        speakingStyle: d.speakingStyle.trim(),
        backstory: d.backstory.trim(),
        relationToUser: d.relationToUser.trim(),
        greeting: d.greeting.trim(),
        exampleDialogue: d.exampleDialogue.trim(),
        extensions: d.extensions,
        importSource: { ...plan.source, importedAt: now },
        worldId: worldId ?? DEFAULT_WORLD_ID,
        permissions: { useStickers: true, postMoments: true },
        createdAt: now,
        updatedAt: now,
      }
      await db.characters.add(c)
      idByKey.set(plan.key, c.id)
    }

    for (const plan of lorebooks) {
      const d = plan.draft
      const book: Lorebook = {
        id: uid('book'),
        name: d.name.trim() || '未命名世界书',
        description: d.description.trim(),
        entries: d.entries.map((e) => ({ ...e, id: uid('entry') })),
        extensions: d.extensions,
        importSource: { ...plan.source, importedAt: now },
        createdAt: now,
        updatedAt: now,
      }
      await db.lorebooks.add(book)
      if (worldId) {
        await db.worldLorebooks.add({ id: uid('wlink'), worldId, lorebookId: book.id, createdAt: now })
      }

      const targets = new Set<string>(plan.linkExistingCharacters)
      for (const key of plan.linkNewCharacters) {
        const id = idByKey.get(key)
        if (id) targets.add(id)
      }
      for (const characterId of targets) {
        // 已有联系人可能在预览期间被删除，跳过不存在的角色
        if (!(await db.characters.get(characterId))) continue
        await db.characterLorebooks.add({ id: uid('link'), characterId, lorebookId: book.id, createdAt: now })
        linkCount++
      }
    }
  })

  return { characters: characters.length, lorebooks: lorebooks.length, links: linkCount, worldId: world ? worldId : undefined }
}
