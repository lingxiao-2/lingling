import Dexie, { type Table } from 'dexie'

/** 当前数据结构版本。修改表结构时递增，并在 db.ts 中补充 version(n).upgrade() 迁移。 */
export const DB_SCHEMA_VERSION = 10

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
  /** 联系人中的分组（为空或分组已删除时属于「未分组」），见 lib/characterGroups.ts */
  groupId?: string
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
  /** 与用户的已有关系（自动识别或用户确认）；没有时按人设实时识别，见 services/ai/relationship.ts */
  relationship?: Relationship
  /** 导入时无法映射的原始字段，原样保留（V2 起） */
  extensions?: Record<string, unknown>
  /** 导入来源（V2 起） */
  importSource?: ImportSource
  /** 资料整理结果（AI 或规则，用户确认后保存；原文不变），见 services/ai/organize.ts */
  organized?: OrganizedProfile
  /** 上一次保存整理结果之前的版本（用于一键撤销；prev 为 null 表示之前没有整理过） */
  organizedUndo?: { prev: OrganizedProfile | null; savedAt: number }
  /** 长期记忆设置，见 services/ai/autoMemory.ts */
  memoryPrefs?: MemoryPrefs
  createdAt: number
  updatedAt: number
}

export type RelationshipStatus = 'lover' | 'married' | 'friend' | 'ambiguous' | 'stranger' | 'custom' | 'unknown'

export interface Relationship {
  status: RelationshipStatus
  /** status = custom 时的名称，例如「师徒」「契约关系」 */
  customLabel?: string
  /** 自定义关系的补充说明（用户填写） */
  customNote?: string
  /** 原文依据（摘句，不改写） */
  evidence: { quote: string; source: string }[]
  nicknames: { forUser: string[]; forChar: string[] }
  /** 原文中的共同经历（摘句） */
  sharedHistory: string[]
  /** 原文中的相处习惯（摘句） */
  habits: string[]
  /** auto：自动识别；user：用户确认或修改过（不会再被自动覆盖） */
  source: 'auto' | 'user'
  updatedAt: number
}

export interface ImportSource {
  fileName: string
  format: string
  importedAt: number
}

export type OrganizeCategory = 'identity' | 'personality' | 'speech' | 'habits' | 'background' | 'relation' | 'shared' | 'others' | 'special' | 'examples'

export interface OrganizedItem {
  cat: OrganizeCategory
  /** 简短要点 */
  point: string
  /** 支撑这条要点的原文片段（已核对确实出现在原文中） */
  quote: string
}

export interface OrganizedProfile {
  method: 'ai' | 'rule'
  /** AI 整理时使用的模型 */
  model?: string
  createdAt: number
  sourceChars: number
  /** 超出整理上限、没有整理的原文字数（原文仍完整保留） */
  skippedChars: number
  items: OrganizedItem[]
  /** 原文中前后矛盾的设定（保留双方原文） */
  conflicts: { topic: string; quotes: string[] }[]
  /** 因无法在原文中核对而丢弃的条数 */
  dropped: number
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

/* ---------- 长期记忆（每个角色独立；只保存用户确认过的内容） ---------- */
export type MemoryKind =
  | 'persona' // 角色固定设定（保留：旧结构）
  | 'user-fact' // 用户明确希望角色记住的事 / 用户提供的信息
  | 'long-term' // 已确认的长期记忆（保留：旧结构）
  | 'world' // 世界观资料（保留：旧结构）
  | 'event' // 重要共同经历（真实发生在聊天中，或用户写下的）
  | 'recent' // 最近聊天事件（较短期，优先级低）
  | 'preference' // 用户的长期偏好（喜欢 / 讨厌 / 习惯）
  | 'promise' // 两人之间的重要约定

export interface Memory {
  id: string
  characterId: string
  kind: MemoryKind
  content: string
  /** 来源消息，编辑/删除来源后可据此标记失效 */
  sourceMessageIds: string[]
  /** pending：从聊天中提议、等待用户确认；active：已确认；invalidated：来源被删除等原因失效 */
  status: 'active' | 'invalidated' | 'pending'
  createdAt: number
  /** 以下为 V1 新增，均可选（旧数据没有也能正常使用） */
  updatedAt?: number
  /** 固定：每次聊天都带上 */
  pinned?: boolean
  /** 1 普通 · 2 重要 · 3 非常重要 */
  priority?: 1 | 2 | 3
  /** 健康、财务等敏感内容：只在话题相关时发送，不会固定常驻 */
  sensitive?: boolean
  /** 来源：用户手写 / 用户在聊天中要求记住 / 从聊天中提议后用户确认 */
  origin?: 'manual' | 'user-request' | 'suggested'
  /** 来源消息原文摘录（用户可核对） */
  quote?: string
  lastUsedAt?: number
  /** 保存时角色所在的世界（世界线）。角色换到别的世界后，这条记忆不再发送，避免设定混在一起；旧数据没有该字段，视为通用 */
  worldId?: string
  /** 同一件事在聊天中被再次提到的次数（自动去重时只合并依据，不改写内容） */
  mentions?: number
}

/** 每个角色的记忆设置（均可选；旧角色没有时按默认值） */
export interface MemoryPrefs {
  /** 聊天中说「记住……」时自动保存（默认开启：这是用户明确的要求） */
  rememberRequests?: boolean
  /** 定期让 AI 从聊天中提取记忆候选（默认关闭；开启即表示用户同意把最近聊天发送给自己配置的 AI 服务） */
  autoExtract?: boolean
  /** 同意开启自动提取的时间 */
  autoConsentAt?: number
  /** 允许把健康、财务等敏感内容作为候选保存（默认关闭：自动提取到的敏感内容直接丢弃，不写入） */
  allowSensitive?: boolean
  /** 上一次自动提取覆盖到的消息时间 */
  lastExtractedAt?: number
  /** 上一次自动提取的结果说明（失败原因等），只用于显示 */
  lastNote?: string
}

/* ---------- 朋友圈 / 表情（只建结构，V0.2 完善） ---------- */
/** 动态的互动者：用户自己，或某个角色 */
export interface MomentActor {
  type: 'user' | 'character'
  /** 用户为 'user'，角色为角色 ID */
  id: string
}

export interface MomentLike extends MomentActor {
  at: number
}

export interface MomentComment {
  id: string
  author: MomentActor
  content: string
  /** 回复某人（对方的显示名由界面根据 actor 计算） */
  replyTo?: MomentActor
  createdAt: number
  /** 软删除：不显示、不发送给模型，可以撤销 */
  deleted?: boolean
}

/**
 * 动态（朋友圈）。v1 起就有这张表；V1 第三阶段新增的字段均为可选，不需要数据库迁移。
 */
export interface Moment {
  id: string
  authorType: 'user' | 'character'
  authorId: string
  content: string
  /** 配图：本机压缩后的图片 dataURL（最多 9 张），不上传到任何服务器 */
  imageRefs: string[]
  /**
   * 可见范围：all 所有角色可见 · private 仅自己可见 · some 只有 visibleTo 中的角色可见。
   * 只影响角色能否看到和互动；动态始终只保存在本机。
   */
  visibility: 'all' | 'private' | 'some'
  /** visibility = some 时可见的角色 ID */
  visibleTo?: string[]
  likes?: MomentLike[]
  comments?: MomentComment[]
  /** 软删除：从动态列表中隐藏，可以撤销；不会真正删除数据 */
  deleted?: boolean
  updatedAt?: number
  createdAt: number
}

/**
 * 表情包：用户自己从相册、文件或 ZIP 合集添加，保存在本机 IndexedDB，不上传到任何服务器。
 * 列表只存缩略图；原图（保留 GIF 动画、透明背景、原始比例）单独存在 stickerImages 表，
 * 图片识别结果按内容哈希单独存在 stickerAnalyses 表。
 */
export interface Sticker {
  id: string
  /** 合集：'mine'（相册 / 文件导入）或 ZIP 合集名 */
  packId: string
  /** 可选的含义；不填也能收藏和发送。AI 主要依靠图片识别结果理解它 */
  name: string
  /** 网格用的缩略图（静态，约 160px） */
  thumbUrl: string
  /** 原图内容的 SHA-256（去重、识别结果缓存） */
  hash?: string
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  width: number
  height: number
  bytes: number
  /** 收藏：排在最前 */
  favorite: boolean
  /** 是否允许 AI 角色使用 */
  aiUsable: boolean
  lastUsedAt?: number
  useCount?: number
  createdAt: number
  updatedAt: number
}

/** 表情包原图（与列表分开存，避免打开面板时把所有原图读进内存） */
export interface StickerImage {
  id: string
  dataUrl: string
}

/** 表情包识别结果（按图片内容哈希缓存，同一张图只识别一次） */
export interface StickerAnalysis {
  hash: string
  status: 'done' | 'failed'
  /** 内容摘要：人物 / 动物、动作、表情 */
  summary: string
  /** 图上的文字（原样） */
  text: string
  /** 情绪 / 语气，例如「无语、翻白眼、阴阳怪气」 */
  emotion: string
  /** 适合的聊天场景 */
  scenes: string[]
  /** 模型自评的可信程度 0–1 */
  confidence: number
  /** 理解范围：静态图；动图按关键帧理解；只看了第一帧 */
  coverage: 'static' | 'keyframes' | 'first-frame'
  frames: number
  model: string
  analyzedAt: number
  error?: string
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

/* ---------- 生活应用：相册（v5） ---------- */
export interface Album {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/**
 * 照片的信息（不含原图）。缩略图是小尺寸 JPEG dataURL，直接放在这里，列表滚动时不用读原图。
 * 原图单独存在 photoBlobs 表（Blob），只在查看大图时读取。照片只保存在本机，不会自动上传。
 */
export interface Photo {
  id: string
  /** 所在相册；为空表示只在「全部照片」中 */
  albumId?: string
  /** 名称（默认是导入时的文件名，可修改） */
  name: string
  note: string
  /** 保存的显示图尺寸 */
  width: number
  height: number
  /** 保存的显示图格式与大小 */
  mime: string
  bytes: number
  /** 导入时原文件的大小与类型（用于说明） */
  originalBytes: number
  originalType: string
  /** 缩略图 dataURL（最长边约 360px） */
  thumb: string
  /** 导入（上传到本机）的时间 */
  createdAt: number
  updatedAt: number
  /** 移到「最近删除」的时间；为空表示正常 */
  deletedAt?: number
}

export interface PhotoBlob {
  id: string
  blob: Blob
}

/* ---------- 生活应用：日记（v6） ---------- */
export type DiaryMood = 'calm' | 'happy' | 'tender' | 'excited' | 'missing' | 'tired' | 'sad' | 'anxious'

export interface Diary {
  id: string
  /** 日记属于哪一天（本地日期 YYYY-MM-DD），可以与写作时间不同 */
  date: string
  title: string
  body: string
  mood?: DiaryMood
  tags: string[]
  /** 关联的照片（稳定 ID；照片被删除后显示为「照片已删除」） */
  photoIds: string[]
  /** 是否允许以后的 AI 功能读取这篇日记。默认 false：日记只有自己可见 */
  aiReadable: boolean
  createdAt: number
  updatedAt: number
  /** 移到「最近删除」的时间 */
  deletedAt?: number
}

/* ---------- 生活应用：便签（v7） ---------- */
export type NoteColor = 'pearl' | 'ice' | 'mist' | 'lilac' | 'blush' | 'mint'

export interface NoteItem {
  id: string
  text: string
  done: boolean
}

export interface Note {
  id: string
  title: string
  /** text：普通文字；checklist：清单 */
  kind: 'text' | 'checklist'
  text: string
  items: NoteItem[]
  color: NoteColor
  pinned: boolean
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

/* ---------- 生活应用：日历（v8） ---------- */
export type EventKind = 'event' | 'anniversary' | 'birthday'
export type EventRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export type AnniversaryType = 'met' | 'together' | 'birthday' | 'other'

/**
 * 聆聆内的日程（只保存在本机，不是 iPhone 系统日历里的事件）。
 * 重复事件只保存一条，显示时按规则计算每一次，不复制多条。
 */
export interface CalEvent {
  id: string
  title: string
  kind: EventKind
  allDay: boolean
  /** 开始日期（本地 YYYY-MM-DD） */
  date: string
  /** 非全天事件的开始、结束时间（HH:mm） */
  startTime?: string
  endTime?: string
  location: string
  note: string
  repeat: EventRepeat
  /** 纪念日 / 生日关联的角色（稳定 ID；角色被删除后显示为「已删除的角色」） */
  characterId?: string
  anniversaryType?: AnniversaryType
  /** 关联的日记 */
  diaryIds: string[]
  /** local：在聆聆里创建。以后通过 iOS 快捷指令写入系统日历时会有别的来源标记，两者不会混在一起 */
  source: 'local'
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

/* ---------- AI 工具调用：执行记录（第六阶段，v9 新增表；不进入备份） ---------- */
export interface ToolLog {
  id: string
  at: number
  characterId: string
  conversationId?: string
  /** 工具名，例如 calendar.list_events */
  tool: string
  /** 授权方式：无需授权 / 本角色始终允许 / 用户允许本次 / 用户拒绝 / 权限禁止 / 未授权 */
  confirmation: 'not_required' | 'always' | 'once' | 'user_rejected' | 'denied' | 'not_granted'
  status: 'ok' | 'error' | 'rejected'
  /** 简短的结果说明（只有条数、ID 等，不含日记 / 照片 / 便签正文） */
  summary: string
  error?: string
  durationMs: number
}

/* ---------- 真实 iPhone：快捷指令执行记录（第七阶段，v10 新增表；不进入备份） ---------- */
export type ShortcutRunStatus =
  /** 等待你确认（还没有打开快捷指令） */
  | 'awaiting_confirmation'
  /** 已发起：已经请求打开快捷指令，还不知道结果 */
  | 'launched'
  /** 已确认完成：快捷指令通过回跳链接报告运行成功 */
  | 'confirmed'
  /** 无法验证：没有收到回跳（例如从主屏幕 App 打开时回跳到了 Safari） */
  | 'unverifiable'
  /** 执行失败：快捷指令报告出错 */
  | 'failed'
  /** 已取消：你在聆聆或快捷指令中取消 */
  | 'cancelled'
  /** 你在 iPhone 上确认看到了结果（不是系统回报） */
  | 'user_reported'

export interface ShortcutRun {
  id: string
  /** 回跳校验码：只有带着正确校验码的回跳才会改变状态 */
  nonce: string
  kind: 'test' | 'reminder' | 'calendar' | 'open_app' | 'custom'
  shortcutName?: string
  /** 给你看的标题与内容（例如提醒事项的标题与时间） */
  title: string
  lines: string[]
  /** 发给快捷指令的文本（只保存在本机） */
  input?: string
  url: string
  status: ShortcutRunStatus
  source: 'settings' | 'chat'
  characterId?: string
  conversationId?: string
  /** 同样内容的操作在短时间内只执行一次 */
  dedupeKey: string
  result?: string
  error?: string
  createdAt: number
  updatedAt: number
  launchedAt?: number
  finishedAt?: number
}

export class LinglingDB extends Dexie {
  characters!: Table<Character, string>
  conversations!: Table<Conversation, string>
  messages!: Table<Message, string>
  messageVersions!: Table<MessageVersion, string>
  memories!: Table<Memory, string>
  moments!: Table<Moment, string>
  stickers!: Table<Sticker, string>
  stickerImages!: Table<StickerImage, string>
  stickerAnalyses!: Table<StickerAnalysis, string>
  worlds!: Table<World, string>
  settings!: Table<SettingRow, string>
  lorebooks!: Table<Lorebook, string>
  characterLorebooks!: Table<CharacterLorebookLink, string>
  worldLorebooks!: Table<WorldLorebookLink, string>
  albums!: Table<Album, string>
  photos!: Table<Photo, string>
  photoBlobs!: Table<PhotoBlob, string>
  diaries!: Table<Diary, string>
  notes!: Table<Note, string>
  events!: Table<CalEvent, string>
  toolLogs!: Table<ToolLog, string>
  shortcutRuns!: Table<ShortcutRun, string>

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
    // v4：表情包原图与列表分开存放，新增识别结果缓存表。
    // 迁移：旧表情包的 dataUrl 原样移到 stickerImages，列表里用它作缩略图；不删除任何表情包或聊天记录。
    this.version(4)
      .stores({
        stickers: 'id, packId, hash, createdAt',
        stickerImages: 'id',
        stickerAnalyses: 'hash',
      })
      .upgrade(async (tx) => {
        const stickers = tx.table('stickers')
        const images = tx.table('stickerImages')
        for (const s of await stickers.toArray()) {
          const legacy = (s as { dataUrl?: string }).dataUrl
          if (!legacy) continue
          await images.put({ id: s.id, dataUrl: legacy })
          const { dataUrl: _drop, ...rest } = s as Sticker & { dataUrl?: string }
          void _drop
          await stickers.put({ ...rest, thumbUrl: (s as Sticker).thumbUrl || legacy, aiUsable: rest.aiUsable ?? true })
        }
      })
    // v5：生活应用「相册」。只新增三张表，不修改、不删除已有的表和数据，因此不需要 upgrade()。
    this.version(5).stores({
      albums: 'id, name, createdAt',
      photos: 'id, albumId, createdAt, deletedAt',
      photoBlobs: 'id',
    })
    // v6：生活应用「日记」。只新增一张表，不修改已有数据。
    this.version(6).stores({
      diaries: 'id, date, updatedAt, deletedAt',
    })
    // v7：生活应用「便签」。只新增一张表；旧的桌面便签（settings 中的 desktop-note）在第一次打开时复制成一张便签，原记录保留。
    this.version(7).stores({
      notes: 'id, pinned, updatedAt, deletedAt',
    })
    // v8：生活应用「日历」。只新增一张表，不修改已有数据。
    this.version(8).stores({
      events: 'id, date, kind, deletedAt',
    })
    // v9：只新增 AI 工具执行记录表，不改动任何已有的表和数据
    this.version(9).stores({
      toolLogs: 'id, at, characterId, tool',
    })
    // v10：只新增快捷指令执行记录表，不改动任何已有的表和数据
    this.version(10).stores({
      shortcutRuns: 'id, createdAt, status, conversationId, dedupeKey',
    })
  }
}
