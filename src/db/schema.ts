import Dexie, { type Table } from 'dexie'

/** 当前数据结构版本。修改表结构时递增，并在 db.ts 中补充 version(n).upgrade() 迁移。 */
export const DB_SCHEMA_VERSION = 1

export const DEFAULT_WORLD_ID = 'world-default'

/* ---------- 角色 ---------- */
export interface CharacterPermissions {
  /** 是否允许该角色使用表情包（V0.2 起生效） */
  useStickers: boolean
  /** 是否允许该角色发布朋友圈（V0.2 起生效） */
  postMoments: boolean
}

export interface Character {
  id: string
  name: string
  /** 头像，压缩后的 dataURL；为空时显示首字母 */
  avatar?: string
  bio: string
  personality: string
  speakingStyle: string
  backstory: string
  relationToUser: string
  worldId: string
  /** 指定模型配置；为空则使用默认模型 */
  modelProfileId?: string
  permissions: CharacterPermissions
  createdAt: number
  updatedAt: number
}

/* ---------- 会话与消息 ---------- */
export interface Conversation {
  id: string
  type: 'single' | 'group'
  /** 单聊为 1 个角色；群聊按加入顺序排列 */
  characterIds: string[]
  /** 群聊名称（单聊不使用） */
  title?: string
  pinned: boolean
  unread: number
  draft: string
  lastMessagePreview: string
  lastMessageAt: number
  createdAt: number
}

export type MessageStatus = 'sending' | 'sent' | 'failed'

export interface Message {
  id: string
  conversationId: string
  senderType: 'user' | 'character' | 'system'
  /** 角色消息为 characterId；用户消息为 'user' */
  senderId: string
  kind: 'text'
  content: string
  status: MessageStatus
  /** 引用回复（V0.1 后续轮次实现 UI） */
  replyToId?: string
  starred?: boolean
  /** 软删除：保留记录，使依赖该消息的记忆可被标记为失效 */
  deleted?: boolean
  /** 当前生效的回复版本（重新生成功能使用） */
  activeVersionId?: string
  createdAt: number
  updatedAt: number
}

/** AI 回复的历史版本；只有 activeVersionId 对应的版本进入模型上下文 */
export interface MessageVersion {
  id: string
  messageId: string
  content: string
  createdAt: number
}

/* ---------- 记忆（只建结构，V0.2 完善） ---------- */
export type MemoryKind =
  | 'persona' // 角色固定设定
  | 'user-fact' // 用户明确提供的信息
  | 'long-term' // 已确认的长期记忆
  | 'world' // 世界观资料
  | 'event' // 剧情事件

export interface Memory {
  id: string
  characterId: string
  kind: MemoryKind
  content: string
  /** 来源消息，编辑/删除来源后可据此标记失效 */
  sourceMessageIds: string[]
  status: 'active' | 'invalidated'
  createdAt: number
}

/* ---------- 朋友圈 / 表情（只建结构，V0.2 完善） ---------- */
export interface Moment {
  id: string
  authorType: 'user' | 'character'
  authorId: string
  content: string
  imageRefs: string[]
  visibility: 'all' | 'private'
  createdAt: number
}

export interface Sticker {
  id: string
  packId: string
  name: string
  blobRef: string
  favorite: boolean
  createdAt: number
}

export interface World {
  id: string
  name: string
  description: string
  createdAt: number
}

/* ---------- 设置（键值） ---------- */
export interface SettingRow {
  key: string
  value: unknown
}

export interface UserProfile {
  nickname: string
  avatar?: string
  signature: string
}

/** AI 服务配置；API Key 只保存在当前设备的 IndexedDB 中，不进入代码或仓库 */
export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
}

export class LinglingDB extends Dexie {
  characters!: Table<Character, string>
  conversations!: Table<Conversation, string>
  messages!: Table<Message, string>
  messageVersions!: Table<MessageVersion, string>
  memories!: Table<Memory, string>
  moments!: Table<Moment, string>
  stickers!: Table<Sticker, string>
  worlds!: Table<World, string>
  settings!: Table<SettingRow, string>

  constructor() {
    super('lingling-ai')
    this.version(1).stores({
      characters: 'id, name, updatedAt',
      conversations: 'id, type, pinned, lastMessageAt',
      messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
      messageVersions: 'id, messageId',
      memories: 'id, characterId, status, createdAt',
      moments: 'id, authorId, createdAt',
      stickers: 'id, packId',
      worlds: 'id',
      settings: 'key',
    })
  }
}
