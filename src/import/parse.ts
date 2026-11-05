/**
 * 角色 / 世界书导入解析器（纯函数，无外部依赖）。
 *
 * 支持：
 *  - SillyTavern 角色卡 JSON：V2（spec = chara_card_v2）、V3（按 V2 字段读取）、V1（扁平字段）
 *  - SillyTavern 世界书 JSON（entries 为对象或数组），以及角色卡内置的 character_book
 *  - 组合 JSON：{ characters: [...], lorebooks | worldbooks: [...] }
 *  - 通用 JSON：常见中英文键名（name / 昵称 / 性格 / 背景故事 …）
 *  - TXT / Markdown：按标题或「字段：」行拆段，由用户在预览中确认归属，不做 AI 推测
 *
 * 不支持：PNG 角色卡（图片内嵌数据）、CharX / YAML / 二进制格式。
 */
import {
  emptyCharacterDraft,
  type CharacterDraft,
  type CharacterFieldKey,
  type Extensions,
  type ImportFormat,
  type ImportKind,
  type LoreEntryDraft,
  type LorebookDraft,
  type ParsedFile,
  type ParseOutcome,
  type TextSection,
} from './types'

export const MAX_FILE_BYTES = 5 * 1024 * 1024

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return (v as string[]).join('\n').trim()
  return ''
}

function toKeys(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，、;；\n]/) : []
  return list.map((x) => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '')).filter(Boolean)
}

function omit(o: Obj, keys: Iterable<string>): Obj {
  const skip = new Set(keys)
  const out: Obj = {}
  for (const [k, v] of Object.entries(o)) if (!skip.has(k)) out[k] = v
  return out
}

function joinParts(...parts: string[]): string {
  return parts.filter((p) => p.trim()).join('\n\n')
}

function firstLine(s: string, max: number): string {
  const line = s.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

export function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  return base.replace(/\.[^.]+$/, '').trim() || base
}

export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/* ======================================================================
 * 字段别名
 * ==================================================================== */

const normKey = (k: string) => k.toLowerCase().replace(/[\s_\-·.]/g, '')

const FIELD_ALIASES: Record<CharacterFieldKey, string[]> = {
  name: ['name', 'nickname', 'charname', 'charactername', 'char', '名称', '名字', '姓名', '角色名', '角色名称', '昵称', '角色'],
  bio: ['bio', 'summary', 'intro', 'introduction', 'tagline', '简介', '角色简介', '介绍', '一句话简介', '概述'],
  personality: ['personality', 'persona', 'traits', 'character', '性格', '性格设定', '人设', '人物设定', '角色设定', '性格特点'],
  speakingStyle: ['speakingstyle', 'speechstyle', 'style', 'tone', 'voice', '说话风格', '语气', '口吻', '说话方式', '语言风格', '口癖'],
  backstory: ['backstory', 'background', 'description', 'story', 'history', 'scenario', 'lore', '背景', '背景故事', '经历', '故事', '设定', '场景', '世界观', '描述', '人物背景'],
  relationToUser: ['relationtouser', 'relationship', 'relation', '关系', '与你的关系', '与用户的关系', '与我的关系', '和你的关系'],
  greeting: ['greeting', 'firstmes', 'firstmessage', 'opening', 'openingline', '开场白', '第一句话', '问候', '开场'],
  exampleDialogue: ['exampledialogue', 'mesexample', 'examples', 'examplemessages', 'exampledialogues', 'dialogue', 'samples', '示例对话', '对话示例', '示例', '对话样例', '范例对话'],
}

const ALIAS_INDEX = new Map<string, CharacterFieldKey>()
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [CharacterFieldKey, string[]][]) {
  for (const a of aliases) ALIAS_INDEX.set(normKey(a), field)
}

/** 把一个标签（JSON 键、标题、「性格：」前缀）匹配到角色字段 */
export function matchFieldLabel(label: string): CharacterFieldKey | null {
  const k = normKey(label.replace(/[【】\[\]：:#*]/g, ''))
  return k ? ALIAS_INDEX.get(k) ?? null : null
}

/* ======================================================================
 * 世界书
 * ==================================================================== */

const ENTRY_MAPPED = ['keys', 'key', 'secondary_keys', 'keysecondary', 'name', 'content', 'enabled', 'disable', 'constant']

function parseEntry(e: Obj, index: number): LoreEntryDraft {
  const keys = toKeys(e.keys ?? e.key)
  const nameRaw = str(e.name)
  const comment = str(e.comment)
  const name = nameRaw || comment || keys[0] || `条目 ${index + 1}`
  const usedComment = !nameRaw && !!comment
  return {
    name,
    keys,
    secondaryKeys: toKeys(e.secondary_keys ?? e.keysecondary),
    content: typeof e.content === 'string' ? e.content.trim() : str(e.content),
    enabled: e.enabled !== undefined ? e.enabled !== false : e.disable !== true,
    constant: e.constant === true,
    extensions: omit(e, usedComment ? [...ENTRY_MAPPED, 'comment'] : ENTRY_MAPPED),
  }
}

function hasEntries(o: Obj): boolean {
  return Array.isArray(o.entries) || isObj(o.entries)
}

/** 解析 SillyTavern 世界书 / character_book。entries 可为数组或 { "0": {...} } 对象 */
export function parseLorebookObject(o: Obj, fallbackName: string, warnings: string[]): LorebookDraft {
  const raw = Array.isArray(o.entries) ? o.entries : isObj(o.entries) ? Object.values(o.entries) : []
  const entries: LoreEntryDraft[] = []
  let skipped = 0
  raw.forEach((e, i) => {
    if (isObj(e)) entries.push(parseEntry(e, i))
    else skipped++
  })
  const name = str(o.name) || fallbackName
  if (skipped) warnings.push(`世界书「${name}」有 ${skipped} 个条目格式无法识别，已跳过`)
  if (entries.length === 0) warnings.push(`世界书「${name}」没有任何条目`)
  const noContent = entries.filter((e) => !e.content).length
  if (noContent) warnings.push(`世界书「${name}」有 ${noContent} 个条目没有正文`)
  const noKeys = entries.filter((e) => e.keys.length === 0 && !e.constant).length
  if (noKeys) warnings.push(`世界书「${name}」有 ${noKeys} 个条目没有关键词，可在预览中补充`)
  return {
    name,
    description: str(o.description),
    entries,
    extensions: omit(o, ['entries', 'name', 'description']),
  }
}

/* ======================================================================
 * 角色
 * ==================================================================== */

interface CharResult {
  draft: CharacterDraft
  format: ImportFormat
  book?: LorebookDraft
}

const ST_MAPPED = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'character_book']

/** SillyTavern 角色卡（V1 扁平字段，或 V2/V3 的 data 对象） */
function parseStCard(fields: Obj, extra: Obj, format: ImportFormat, warnings: string[]): CharResult {
  const draft = emptyCharacterDraft()
  draft.name = str(fields.name)
  draft.personality = str(fields.personality)
  const scenario = str(fields.scenario)
  draft.backstory = joinParts(str(fields.description), scenario ? `【场景】\n${scenario}` : '')
  draft.greeting = str(fields.first_mes)
  draft.exampleDialogue = str(fields.mes_example)
  const notes = str(fields.creator_notes)
  if (notes) draft.bio = firstLine(notes, 80)

  // 其余字段（system_prompt、alternate_greetings、tags、creator、extensions 等）原样保留
  const rest = { ...extra, ...omit(fields, ST_MAPPED) }
  if (Object.keys(rest).length) draft.extensions.sillytavern = rest

  let book: LorebookDraft | undefined
  if (isObj(fields.character_book) && hasEntries(fields.character_book)) {
    book = parseLorebookObject(fields.character_book, `${draft.name || '角色'}的世界书`, warnings)
  }
  return { draft, format, book }
}

/** 通用 JSON 角色：按别名映射字段，未识别的键放进 extensions.unmapped */
function parseGenericCharacter(o: Obj, warnings: string[]): CharResult {
  const draft = emptyCharacterDraft()
  const unmapped: Obj = {}
  const collected: Partial<Record<CharacterFieldKey, string[]>> = {}
  let book: LorebookDraft | undefined
  for (const [k, v] of Object.entries(o)) {
    if (LINK_KEYS.includes(k)) continue
    if ((k === 'character_book' || k === 'lorebook' || k === 'worldbook') && isObj(v) && hasEntries(v)) {
      book = parseLorebookObject(v, `${str(o.name) || '角色'}的世界书`, warnings)
      continue
    }
    const field = matchFieldLabel(k)
    const text = str(v)
    if (field && text) (collected[field] ??= []).push(text)
    else unmapped[k] = v
  }
  for (const [field, parts] of Object.entries(collected) as [CharacterFieldKey, string[]][]) {
    draft[field] = field === 'name' ? parts[0] : joinParts(...parts)
  }
  if (Object.keys(unmapped).length) draft.extensions.unmapped = unmapped
  return { draft, format: 'generic-json', book }
}

function looksLikeStV1(o: Obj): boolean {
  return 'first_mes' in o || 'mes_example' in o || ('description' in o && 'personality' in o && 'scenario' in o)
}

function looksLikeCharacter(o: Obj): boolean {
  return Object.keys(o).some((k) => matchFieldLabel(k) === 'name')
}

function parseCharacterObject(o: Obj, warnings: string[]): CharResult | null {
  const spec = typeof o.spec === 'string' ? o.spec : ''
  if (spec.startsWith('chara_card_v') && isObj(o.data)) {
    if (spec !== 'chara_card_v2') warnings.push(`检测到 ${spec}，已按 V2 字段导入，其余字段已保留`)
    return parseStCard(o.data, omit(o, ['data']), 'st-card-v2', warnings)
  }
  if (isObj(o.data) && looksLikeStV1(o.data)) return parseStCard(o.data, omit(o, ['data']), 'st-card-v2', warnings)
  if (looksLikeStV1(o)) return parseStCard(o, {}, 'st-card-v1', warnings)
  // 带 entries 的对象是世界书（世界书也常有 name 字段），不能当成角色
  if (hasEntries(o)) return null
  if (looksLikeCharacter(o)) return parseGenericCharacter(o, warnings)
  return null
}

/* ======================================================================
 * JSON 入口
 * ==================================================================== */

const LINK_KEYS = ['lorebooks', 'worldbooks', 'linkedLorebooks', 'characters', 'characterNames', 'linkedCharacters']

function refList(o: Obj, keys: string[]): unknown[] {
  for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
  return []
}

class Collector {
  characters: CharacterDraft[] = []
  lorebooks: LorebookDraft[] = []
  links: { character: number; lorebook: number }[] = []
  formats = new Set<ImportFormat>()

  addCharacter(r: CharResult): number {
    const ci = this.characters.push(r.draft) - 1
    this.formats.add(r.format)
    if (r.book) {
      const bi = this.lorebooks.push(r.book) - 1
      this.links.push({ character: ci, lorebook: bi })
    }
    return ci
  }

  addLink(character: number, lorebook: number) {
    if (!this.links.some((l) => l.character === character && l.lorebook === lorebook)) {
      this.links.push({ character, lorebook })
    }
  }
}

/** 组合文件：在同一文件内按「下标或名称」解析引用，保存时再换成稳定 ID */
function parseCombo(root: Obj, warnings: string[], c: Collector) {
  const charsRaw = Array.isArray(root.characters) ? root.characters : []
  const booksRaw = refList(root, ['lorebooks', 'worldbooks', 'world_books', 'worlds'])

  const charIdx: number[] = []
  const charRefs: unknown[][] = []
  charsRaw.forEach((raw, i) => {
    if (!isObj(raw)) return warnings.push(`组合文件第 ${i + 1} 个角色格式无法识别，已跳过`)
    const r = parseCharacterObject(raw, warnings)
    if (!r) return warnings.push(`组合文件第 ${i + 1} 个角色缺少名称等字段，已跳过`)
    charIdx[i] = c.addCharacter(r)
    charRefs[i] = refList(isObj(raw.data) ? { ...raw.data, ...raw } : raw, ['lorebooks', 'worldbooks', 'linkedLorebooks'])
  })

  const bookIdx: number[] = []
  const bookRefs: unknown[][] = []
  booksRaw.forEach((raw, i) => {
    if (!isObj(raw) || !hasEntries(raw)) return warnings.push(`组合文件第 ${i + 1} 个世界书缺少 entries，已跳过`)
    const refs = refList(raw, ['characters', 'characterNames', 'linkedCharacters'])
    const book = parseLorebookObject(omit(raw, ['characters', 'characterNames', 'linkedCharacters']), `世界书 ${i + 1}`, warnings)
    bookIdx[i] = c.lorebooks.push(book) - 1
    bookRefs[i] = refs
  })

  const resolve = (ref: unknown, rawIdx: number[], names: string[]): number | undefined => {
    if (typeof ref === 'number') return rawIdx[ref]
    if (typeof ref === 'string') {
      const n = normalizeName(ref)
      const hit = names.findIndex((x) => normalizeName(x) === n)
      return hit >= 0 ? hit : undefined
    }
    return undefined
  }
  const charNames = () => c.characters.map((x) => x.name)
  const bookNames = () => c.lorebooks.map((x) => x.name)

  charRefs.forEach((refs, i) => {
    for (const ref of refs ?? []) {
      const bi = resolve(ref, bookIdx, bookNames())
      if (bi === undefined) warnings.push(`角色「${c.characters[charIdx[i]].name}」引用的世界书「${String(ref)}」未在文件中找到`)
      else c.addLink(charIdx[i], bi)
    }
  })
  bookRefs.forEach((refs, i) => {
    for (const ref of refs ?? []) {
      const ci = resolve(ref, charIdx, charNames())
      if (ci === undefined) warnings.push(`世界书「${c.lorebooks[bookIdx[i]].name}」引用的角色「${String(ref)}」未在文件中找到`)
      else c.addLink(ci, bookIdx[i])
    }
  })
  c.formats.add('combo-json')
}

function parseJsonRoot(root: unknown, fileName: string, warnings: string[]): Collector | string {
  const c = new Collector()
  const handleObj = (o: Obj, label: string): boolean => {
    const r = parseCharacterObject(o, warnings)
    if (r) {
      c.addCharacter(r)
      return true
    }
    if (hasEntries(o)) {
      c.lorebooks.push(parseLorebookObject(o, fileStem(fileName), warnings))
      c.formats.add(isObj(o.extensions) || 'scan_depth' in o ? 'st-character-book' : 'st-worldinfo')
      return true
    }
    warnings.push(`${label}无法识别：未找到角色名称或世界书条目`)
    return false
  }

  if (Array.isArray(root)) {
    if (root.length === 0) return 'JSON 数组为空'
    root.forEach((item, i) => {
      if (isObj(item)) handleObj(item, `第 ${i + 1} 项`)
      else warnings.push(`第 ${i + 1} 项不是对象，已跳过`)
    })
  } else if (isObj(root)) {
    if (Array.isArray(root.characters) || refList(root, ['lorebooks', 'worldbooks', 'world_books', 'worlds']).length) {
      parseCombo(root, warnings, c)
    } else {
      // 兼容 { "character": {...} } 包装
      const inner = isObj(root.character) && Object.keys(root).length === 1 ? root.character : root
      if (!handleObj(inner, '')) {
        warnings.pop()
        return '无法识别的 JSON 结构：既不是 SillyTavern 角色卡 / 世界书，也没有找到角色名称（name / 名称 / 昵称）或世界书条目（entries）'
      }
    }
  } else {
    return 'JSON 顶层必须是对象或数组'
  }

  if (c.characters.length === 0 && c.lorebooks.length === 0) return '文件中没有可导入的角色或世界书'
  return c
}

/* ======================================================================
 * TXT / Markdown
 * ==================================================================== */

interface RawSection extends TextSection {
  level: number
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const LABEL_LINE = /^\s*[【\[]?([^\s:：【】\[\]]{1,16})[】\]]?\s*[:：]\s*(.*)$/
const BRACKET_LINE = /^\s*[【\[]([^】\]]{1,16})[】\]]\s*$/

function splitSections(text: string, markdown: boolean, labelLines: boolean): RawSection[] {
  const out: RawSection[] = []
  let cur: RawSection | null = null
  const start = (label: string, level: number, first = '') => {
    cur = { label, level, text: first, target: 'ignore' }
    out.push(cur)
  }
  for (const line of text.split(/\r?\n/)) {
    const h = markdown ? HEADING.exec(line) : null
    if (h) {
      start(h[2].replace(/[*_`]/g, '').trim(), h[1].length)
      continue
    }
    if (labelLines) {
      const b = BRACKET_LINE.exec(line)
      if (b && matchFieldLabel(b[1])) {
        start(b[1], 0)
        continue
      }
      const m = LABEL_LINE.exec(line)
      if (m && matchFieldLabel(m[1])) {
        start(m[1], 0, m[2])
        continue
      }
    }
    if (!cur) start('', 0)
    const c = cur as unknown as RawSection
    c.text = c.text ? `${c.text}\n${line}` : line
  }
  return out
    .map((s) => ({ ...s, text: s.text.replace(/^\s*\n|\s+$/g, '').trim() }))
    .filter((s) => s.text || matchFieldLabel(s.label) === 'name')
}

/** 由段落生成角色草稿。用户在预览中修改段落归属后再次调用 */
export function draftFromSections(sections: TextSection[], fallbackName: string): CharacterDraft {
  const draft = emptyCharacterDraft()
  const parts: Partial<Record<CharacterFieldKey, string[]>> = {}
  for (const s of sections) {
    if (s.target === 'ignore' || !s.text.trim()) continue
    if (s.target === 'name') {
      if (!draft.name) draft.name = firstLine(s.text, 40)
      continue
    }
    // 标签与归属不一致时（例如未识别的标题归到背景故事），保留标题，避免丢失上下文
    const keepLabel = s.label && matchFieldLabel(s.label) !== s.target
    ;(parts[s.target] ??= []).push(keepLabel ? `【${s.label}】\n${s.text.trim()}` : s.text.trim())
  }
  for (const [field, list] of Object.entries(parts) as [CharacterFieldKey, string[]][]) {
    draft[field] = joinParts(...list)
  }
  if (!draft.name) draft.name = fallbackName
  return draft
}

function parseTextCharacter(fileName: string, text: string, markdown: boolean, warnings: string[]): ParsedFile {
  const raw = splitSections(text, markdown, true)
  let nameFromTitle = ''
  const hasNameSection = raw.some((s) => matchFieldLabel(s.label) === 'name')
  const sections: TextSection[] = []
  raw.forEach((s, i) => {
    const field = matchFieldLabel(s.label)
    if (i === 0 && markdown && s.level === 1 && !field && !hasNameSection) {
      // 文件第一个一级标题（且不是字段名）视为角色名称
      nameFromTitle = s.label
      sections.push({ label: '角色名称', text: s.label, target: 'name' })
      if (s.text) sections.push({ label: '', text: s.text, target: 'backstory' })
      return
    }
    if (field === 'name') {
      sections.push({ label: s.label, text: s.text, target: 'name' })
      return
    }
    sections.push({ label: s.label, text: s.text, target: field ?? 'backstory' })
  })
  const stem = fileStem(fileName)
  const draft = draftFromSections(sections, stem)
  if (nameFromTitle) warnings.push(`已将标题「${nameFromTitle}」作为角色名称，请确认`)
  else if (!sections.some((s) => s.target === 'name')) warnings.push(`未找到角色名称，已暂用文件名「${stem}」，请确认或修改`)
  if (sections.some((s) => s.target === 'backstory' && !matchFieldLabel(s.label))) {
    warnings.push('部分段落无法确定归属，已暂放入「背景故事」，可在预览中调整')
  }
  return {
    fileName,
    format: markdown ? 'markdown' : 'text',
    characters: [draft],
    lorebooks: [],
    links: [],
    warnings,
    sections,
  }
}

function parseTextLorebook(fileName: string, text: string, markdown: boolean, warnings: string[]): ParsedFile {
  const raw = splitSections(text, markdown, false)
  let name = fileStem(fileName)
  let description = ''
  let body = raw
  const h1 = raw.filter((s) => s.level === 1)
  if (markdown && h1.length === 1 && raw[0] === h1[0] && raw.length > 1) {
    name = h1[0].label
    description = h1[0].text
    body = raw.slice(1)
  } else if (raw.length > 1 && raw[0].label === '') {
    description = raw[0].text
    body = raw.slice(1)
  }
  const entries: LoreEntryDraft[] = body.map((s, i) => ({
    name: s.label || `条目 ${i + 1}`,
    keys: s.label ? [s.label] : [],
    secondaryKeys: [],
    content: s.text,
    enabled: true,
    constant: false,
    extensions: {},
  }))
  if (entries.length === 0) warnings.push('文件中没有可作为条目的内容')
  if (!markdown || !raw.some((s) => s.level > 0)) {
    warnings.push('纯文本没有标题，已整体作为一个条目导入；如需拆分，请改用 Markdown 标题（## 条目名）')
  }
  const noKeys = entries.filter((e) => e.keys.length === 0).length
  if (noKeys) warnings.push(`${noKeys} 个条目没有关键词，可在预览中补充`)
  return {
    fileName,
    format: markdown ? 'markdown' : 'text',
    characters: [],
    lorebooks: [{ name, description, entries, extensions: {} }],
    links: [],
    warnings,
  }
}

/* ======================================================================
 * 总入口
 * ==================================================================== */

export function parseImportFile(fileName: string, rawText: string, kind: ImportKind): ParseOutcome {
  const fail = (error: string): ParseOutcome => ({ ok: false, fileName, error })
  const ext = (fileName.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()
  if (['png', 'webp', 'jpg', 'jpeg'].includes(ext)) {
    return fail('暂不支持图片格式的角色卡（PNG 内嵌数据）。请在 SillyTavern 中导出为 JSON 后再导入')
  }
  if (['charx', 'yaml', 'yml', 'zip', 'docx', 'pdf'].includes(ext)) {
    return fail(`暂不支持 .${ext} 文件，请使用 JSON、TXT 或 Markdown`)
  }

  const text = rawText.replace(/^﻿/, '')
  if (!text.trim()) return fail('文件为空')
  if (text.includes('\u0000')) return fail('文件看起来不是文本文件，请确认格式')

  const isJson = ext === 'json' || (!['txt', 'md', 'markdown'].includes(ext) && /^\s*[[{]/.test(text))
  const warnings: string[] = []

  if (isJson) {
    let root: unknown
    try {
      root = JSON.parse(text)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return fail(`JSON 格式错误，无法解析（${msg}）`)
    }
    const r = parseJsonRoot(root, fileName, warnings)
    if (typeof r === 'string') return fail(r)
    r.characters.forEach((ch, i) => {
      if (!ch.name) {
        ch.name = r.characters.length === 1 ? fileStem(fileName) : ''
        warnings.push(
          ch.name ? `角色缺少名称，已暂用文件名「${ch.name}」，请确认` : `第 ${i + 1} 个角色缺少名称，请在预览中填写`,
        )
      }
      const filled = [ch.bio, ch.personality, ch.speakingStyle, ch.backstory, ch.relationToUser, ch.greeting, ch.exampleDialogue]
      if (!filled.some(Boolean)) warnings.push(`角色「${ch.name || i + 1}」没有任何设定内容`)
    })
    const formats = [...r.formats]
    const format: ImportFormat = r.formats.has('combo-json') || formats.length > 1 ? 'combo-json' : formats[0] ?? 'generic-json'
    return { ok: true, file: { fileName, format, characters: r.characters, lorebooks: r.lorebooks, links: r.links, warnings } }
  }

  if (!['txt', 'md', 'markdown', ''].includes(ext)) {
    return fail(`暂不支持 .${ext} 文件，请使用 JSON、TXT 或 Markdown`)
  }
  const markdown = ext === 'md' || ext === 'markdown'
  const file =
    kind === 'lorebook'
      ? parseTextLorebook(fileName, text, markdown, warnings)
      : parseTextCharacter(fileName, text, markdown, warnings)
  return { ok: true, file }
}

/** 导出给 UI：Extensions 是否非空 */
export function hasExtensions(e: Extensions | undefined): boolean {
  return !!e && Object.keys(e).length > 0
}
