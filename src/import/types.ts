/**
 * 导入解析层的数据类型。
 * 这一层只做「文件 → 草稿」的纯函数转换，不访问 IndexedDB、不依赖 React，
 * 便于单独测试。真正写入数据库在 db/repo.ts 的 saveImport()。
 */

export type Extensions = Record<string, unknown>

/** 角色草稿：导入预览阶段可编辑，确认后才保存 */
export interface CharacterDraft {
  name: string
  bio: string
  personality: string
  speakingStyle: string
  backstory: string
  relationToUser: string
  /** 开场白：只作为角色设定保存，不写入聊天记录 */
  greeting: string
  /** 示例对话：只作为角色设定保存，不写入聊天记录 */
  exampleDialogue: string
  /** 无法映射到上述字段的原始数据，原样保留 */
  extensions: Extensions
  /** 文档中无法归入上述字段的章节：原文完整保留（作为扩展资料，按需进入 AI 上下文） */
  extras?: ProfileExtra[]
}

export interface ProfileExtra {
  label: string
  text: string
}

export interface LoreEntryDraft {
  name: string
  keys: string[]
  secondaryKeys: string[]
  content: string
  enabled: boolean
  constant: boolean
  extensions: Extensions
}

/** 世界设定草稿 */
export interface WorldDraft {
  name: string
  tagline: string
  description: string
  extensions: Extensions
}

export interface LorebookDraft {
  name: string
  description: string
  entries: LoreEntryDraft[]
  extensions: Extensions
}

/** 角色字段键（TXT / Markdown 段落归属用） */
export type CharacterFieldKey =
  | 'name'
  | 'bio'
  | 'personality'
  | 'speakingStyle'
  | 'backstory'
  | 'relationToUser'
  | 'greeting'
  | 'exampleDialogue'

/** extra：其他设定（无法归类，原文完整保留）；ignore：用户明确选择不保存 */
export type SectionTarget = CharacterFieldKey | 'extra' | 'ignore'

/** TXT / Markdown 文件拆出的段落，用户在预览里决定它属于哪个字段 */
export interface TextSection {
  label: string
  text: string
  target: SectionTarget
  /** 归属是按标题自动识别的（用于预览中的提示） */
  auto?: boolean
}

export type ImportFormat =
  | 'st-card-v2'
  | 'st-card-v1'
  | 'st-worldinfo'
  | 'st-character-book'
  | 'combo-json'
  | 'generic-json'
  | 'world-json'
  | 'text'
  | 'markdown'

export interface ParsedFile {
  fileName: string
  format: ImportFormat
  characters: CharacterDraft[]
  lorebooks: LorebookDraft[]
  /** 同一文件内角色与世界书的关联（下标），保存时转换为稳定 ID */
  links: { character: number; lorebook: number }[]
  warnings: string[]
  /** 仅 TXT / Markdown 角色：可重新分配的段落；characters[0] 由它生成 */
  sections?: TextSection[]
  /** 仅文本类角色文档：角色名称候选与是否有把握（没把握时请用户确认） */
  nameCheck?: { confident: boolean; candidates: string[]; source: string }
  /** 仅「世界」导入模式：文件中的世界设定 */
  world?: WorldDraft
  /** 文件来源（PNG 角色卡、CharX、ZIP 内文件、DOCX、PDF、YAML…），用于预览中的说明 */
  container?: Container
  /** PNG 角色卡图片本身 / CharX 内的图标，作为角色头像（只用于 characters[0]） */
  avatar?: { bytes: Uint8Array; mime: string }
  /** 文本类文档：提取出的文字（可按其它方式重新解析）和供用户核对的原文 */
  doc?: {
    text: string
    markdown: boolean
    rawText: string
    encoding?: string
    pages?: number
    /** 提取出的段落数（DOCX） */
    paragraphs?: number
  }
}

export type Container = 'png' | 'charx' | 'zip' | 'yaml' | 'docx' | 'pdf' | 'txt' | 'md' | 'json'

export const CONTAINER_LABELS: Record<Container, string> = {
  png: 'PNG 角色卡',
  charx: 'CharX 角色卡',
  zip: 'ZIP 压缩包',
  yaml: 'YAML',
  docx: 'Word 文档',
  pdf: 'PDF 文档',
  txt: '纯文本',
  md: 'Markdown',
  json: 'JSON',
}

export type ParseOutcome =
  | { ok: true; file: ParsedFile }
  | { ok: false; fileName: string; error: string }

/** 导入模式：决定 TXT / Markdown 被当作角色、世界书还是世界设定 */
export type ImportKind = 'character' | 'lorebook' | 'world'

export const FIELD_LABELS: Record<CharacterFieldKey, string> = {
  name: '角色名称',
  bio: '角色简介',
  personality: '性格设定',
  speakingStyle: '说话风格',
  backstory: '背景故事',
  relationToUser: '与你的关系',
  greeting: '开场白',
  exampleDialogue: '示例对话',
}

export const FORMAT_LABELS: Record<ImportFormat, string> = {
  'st-card-v2': 'SillyTavern 角色卡 V2',
  'st-card-v1': 'SillyTavern 角色卡 V1',
  'st-worldinfo': 'SillyTavern 世界书',
  'st-character-book': 'SillyTavern 角色内置世界书',
  'combo-json': '组合 JSON（世界 / 角色 / 世界书）',
  'generic-json': '通用 JSON',
  'world-json': '世界设定 JSON',
  text: '纯文本 TXT',
  markdown: 'Markdown',
}

export function emptyCharacterDraft(): CharacterDraft {
  return {
    name: '',
    bio: '',
    personality: '',
    speakingStyle: '',
    backstory: '',
    relationToUser: '',
    greeting: '',
    exampleDialogue: '',
    extensions: {},
    extras: [],
  }
}

export function emptyWorldDraft(): WorldDraft {
  return { name: '', tagline: '', description: '', extensions: {} }
}
