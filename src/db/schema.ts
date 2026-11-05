import Dexie, { type Table } from 'dexie'

/** 当前数据结构版本。修改表结构时递增，并在 db.ts 中补充 version(n).upgrade() 迁移。 */
export const DB_SCHEMA_VERSION = 3

export const DEFAULT_WORLD_ID = 'world-default'

/* ---------- 角色 ---------- */
export interface CharacterPermissions {
  /** 是否允许该角色使用表情包（V0.2 起生效） */
  useStickers: boolean
  /** 是否允许该角色发布朋友圈（V0.2 起生效） */
  postMoments: boolean
}

/** 角色的聊天表达偏好（V0.3 起，全部可选）。只影响「怎么说」，不覆盖角色卡的人设 */
export interface ChatStyle {
  /** 话量：少 / 适中 / 多 */
  verbosity?: 'low' | 'medium' | 'high'
  /** 表达风格；为空表示完全按人设 */
  tone?: '' | 'concise' | 'lively' | 'gentle' | 'cool' | 'playful'
  /** 表情包使用频率 */
  stickers?: 'never' | 'sometimes' | 'often'
  /** 语言特点（用户自由填写），例如口头禅、标点习惯 */
  quirks?: string
  /** 关系亲密程度；auto 表示结合角色设定与实际聊天积累 */
  closeness?: 'auto' | 'distant' | 'friendly' | 'close'
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
  /** 开场白（V2 起）。只是角色设定，不写入聊天记录 */
  greeting?: string
  /** 示例对话（V2 起）。只是角色设定，不写入聊天记录，也不进入记忆 */
  exampleDialogue?: string
  /**
   * 长篇人设文档中无法归入固定字段的章节（原文完整保留）。
   * 不会每次都整段发给模型：按与当前聊天的相关程度挑选，见 services/ai/profile.ts
   */
  profileExtras?: { label: string; text: string }[]
  /** 从文档导入时提取出的全文（供核对和以后重新整理；不直接发送给模型） */
  sourceDoc?: { fileName: string; text: string; chars: number; paragraphs?: number }
  /** 聊天表达偏好（可选） */
  chatStyle?: ChatStyle
  /** 导入时无法映射的原始字段，原样保留（V2 起） */
  extensions?: Record<string, unknown>
  /** 导入来源（V2 起） */
  importSource?: ImportSource
  createdAt: number
  updatedAt: number
}

export interface ImportSource {
  fileName: string
  format: string
  importedAt: number
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
  /** text：文字；sticker：表情包（stickerId 指向本机表情包，content 保存「[表情包] 含义」作为预览与兼容文本） */
  kind: 'text' | 'sticker'
  content: string
  stickerId?: string
  status: MessageStatus
  /** 引用回复（V0.1 后续轮次实现 UI） */
  replyToId?: string
  starred?: boolean
  /** 软删除：保留记录，使依赖该消息的记忆可被标记为失效 */
  deleted?: boolean
  /** 当前生效的回复版本（重新生成功能使用） */
  activeVersionId?: string
  /** AI 回复：同一次回复拆成的多条消息共享同一个分组 */
  replyGroupId?: string
  /** AI 回复：同一位置的多个版本（重新生成）共享同一个家族 ID */
  versionFamily?: string
  /** 被重新生成替换的旧版本：保留但隐藏，不进入模型上下文 */
  superseded?: boolean
  /** 生成该回复的模型名称 */
  model?: string
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

/**
 * 表情包：用户自己从相册或文件添加，保存在本机 IndexedDB，不上传到任何服务器。
 * 图片以 dataURL 保存（PNG / JPEG / WebP / GIF，已校验文件头并限制大小）。
 */
export interface Sticker {
  id: string
  /** 目前只有用户自己的收藏：'mine' */
  packId: string
  /** 含义 / 描述，例如「开心转圈」。为空时 AI 不会使用它（AI 需要靠描述判断何时合适） */
  name: string
  dataUrl: string
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  width: number
  height: number
  bytes: number
  /** 常用：排在最前 */
  favorite: boolean
  /** 是否允许 AI 角色使用（需要同时填写含义） */
  aiUsable: boolean
  createdAt: number
  updatedAt: number
}

/**
 * 世界：独立实体。角色通过 Character.worldId 归属于一个世界（DEFAULT_WORLD_ID 视为「未归入世界」），
 * 世界书通过 worldLorebooks 与世界多对多关联。三者分开存放，互不混淆。
 */
export interface World {
  id: string
  name: string
  description: string
  /** 一句话简介（V3 起） */
  tagline?: string
  /** 封面图，压缩后的 dataURL（V3 起） */
  cover?: string
  extensions?: Record<string, unknown>
  importSource?: ImportSource
  createdAt: number
  updatedAt?: number
}

/** 世界 ↔ 世界书 多对多关联，只用稳定 ID */
export interface WorldLorebookLink {
  id: string
  worldId: string
  lorebookId: string
  createdAt: number
}

/* ---------- 世界书（V2 起） ---------- */
export interface LoreEntry {
  id: string
  name: string
  keys: string[]
  secondaryKeys: string[]
  content: string
  enabled: boolean
  constant: boolean
  extensions: Record<string, unknown>
}

/** 世界书与角色人设、聊天记忆分开存放 */
export interface Lorebook {
  id: string
  name: string
  description: string
  entries: LoreEntry[]
  extensions: Record<string, unknown>
  importSource?: ImportSource
  createdAt: number
  updatedAt: number
}

/** 角色 ↔ 世界书 多对多关联，只用稳定 ID，不依赖名称 */
export interface CharacterLorebookLink {
  id: string
  characterId: string
  lorebookId: string
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
  /**
   * lingling：聆聆默认服务（无需 API Key，由聆聆服务端调用默认模型，有免费额度）
   * custom：使用自己的 API（下面的 mode / baseUrl / apiKey / proxy… 只在此模式下使用）
   */
  service: 'lingling' | 'custom'
  /**
   * 自己的 API 的连接方式 —— direct：个人测试模式，浏览器直接请求服务商，密钥保存在本设备（会随请求发出）
   * proxy：安全代理模式，请求发给你自己部署的代理，密钥只保存在代理服务器上
   */
  mode: 'direct' | 'proxy'
  baseUrl: string
  apiKey: string
  /** 代理地址，例如 https://lingling-proxy.xxx.workers.dev */
  proxyUrl: string
  /** 代理访问口令（不是服务商密钥；用于防止他人滥用你的代理） */
  proxyToken: string
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
  lorebooks!: Table<Lorebook, string>
  characterLorebooks!: Table<CharacterLorebookLink, string>
  worldLorebooks!: Table<WorldLorebookLink, string>

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
    // v2：新增世界书与关联表。旧表结构不变，角色的新增字段均为可选，
    // 因此不需要 upgrade() 改写旧数据，已有联系人和聊天记录原样保留。
    this.version(2).stores({
      lorebooks: 'id, name, updatedAt',
      characterLorebooks: 'id, characterId, lorebookId, &[characterId+lorebookId]',
    })
    // v3：新增世界 ↔ 世界书关联表；为角色的 worldId 建索引以便按世界查询居民。
    // 世界的新字段均为可选，已有数据无需改写。
    this.version(3).stores({
      characters: 'id, name, updatedAt, worldId',
      worldLorebooks: 'id, worldId, lorebookId, &[worldId+lorebookId]',
    })
  }
}
