/**
 * 聊天上下文所需数据的读取（回复引擎与「查看发送给 AI 的设定」共用，保证预览与实际请求一致）。
 */
import { db, DEFAULT_PROFILE } from '../../db/db'
import { DEFAULT_WORLD_ID } from '../../db/schema'
import type { Character, Lorebook, Memory, Message, Sticker, UserProfile, World } from '../../db/schema'
import { analysesFor } from '../vision/stickerVision'
import { buildContext, type BuiltContext } from './context'

export interface ContextSources {
  profile: UserProfile
  world?: World
  books: Lorebook[]
  stickers: Sticker[]
}

export async function loadContextSources(character: Character): Promise<ContextSources> {
  const profile = { ...DEFAULT_PROFILE, ...(((await db.settings.get('profile'))?.value as UserProfile | undefined) ?? {}) }
  const world = character.worldId !== DEFAULT_WORLD_ID ? await db.worlds.get(character.worldId) : undefined
  const charBookIds = (await db.characterLorebooks.where('characterId').equals(character.id).toArray()).map((l) => l.lorebookId)
  const worldBookIds = world ? (await db.worldLorebooks.where('worldId').equals(world.id).toArray()).map((l) => l.lorebookId) : []
  const books = (await db.lorebooks.bulkGet([...new Set([...charBookIds, ...worldBookIds])])).filter((b): b is Lorebook => !!b)
  const stickers: Sticker[] = await db.stickers.toArray()
  return { profile, world, books, stickers }
}

export async function loadMemories(characterId: string): Promise<Memory[]> {
  return db.memories.where('characterId').equals(characterId).toArray()
}

/** 预览：用与回复引擎相同的数据和 buildContext，按这个角色单聊的当前记录构建上下文（只读，不写入任何数据） */
export async function previewContext(character: Character): Promise<BuiltContext> {
  const src = await loadContextSources(character)
  const conv = (await db.conversations.toArray()).find((v) => v.type === 'single' && v.characterIds.length === 1 && v.characterIds[0] === character.id)
  const history: Message[] = conv ? await db.messages.where('conversationId').equals(conv.id).sortBy('createdAt') : []
  return buildContext({
    character,
    userName: src.profile.nickname,
    world: src.world,
    lorebooks: src.books,
    history,
    stickers: src.stickers,
    analyses: await analysesFor(src.stickers),
    memories: await loadMemories(character.id),
  })
}
