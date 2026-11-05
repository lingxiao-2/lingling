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
  emptyWorldDraft,
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
  type WorldDraft,
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
 * 世界设定
 * ==================================================================== */

type WorldField = 'name' | 'tagline' | 'description'

const WORLD_ALIASES: Record<WorldField, string[]> = {
  name: ['name', 'title', 'worldname', '世界名', '世界名称', '名称', '名字', '标题'],
  tagline: ['tagline', 'subtitle', 'slogan', 'summary', 'intro', '一句话', '一句话简介', '简介', '副标题', '概述'],
  description: ['description', 'setting', 'worldview', 'lore', 'overview', 'background', 'content', '世界观', '设定', '世界设定', '描述', '背景', '正文'],
}
const WORLD_INDEX = new Map<string, WorldField>()
for (const [f, list] of Object.entries(WORLD_ALIASES) as [WorldField, string[]][]) {
  for (const a of list) WORLD_INDEX.set(normKey(a), f)
}

export function parseWorldObject(o: Obj): WorldDraft {
  const w = emptyWorldDraft()
  const parts: Partial<Record<WorldField, string[]>> = {}
  const unmapped: Obj = {}
  for (const [k, v] of Object.entries(o)) {
    const f = WORLD_INDEX.get(normKey(k))
    const text = str(v)
    if (f && text) (parts[f] ??= []).push(text)
    else unmapped[k] = v
  }
  w.name = parts.name?.[0] ?? ''
  w.tagline = parts.tagline ? firstLine(parts.tagline.join(' '), 60) : ''
  w.description = joinParts(...(parts.description ?? []))
  if (Object.keys(unmapped).length) w.extensions.unmapped = unmapped
  return w
}

const WORLD_KEYS = ['world', 'worldSetting', 'world_setting', 'setting', '世界', '世界设定']

function findWorld(root: Obj): Obj | null {
  for (const k of WORLD_KEYS) if (isObj(root[k])) return root[k] as Obj
  return null
}

/** 只有世界才会有、角色不会有的判断：没有任何角色专属字段 */
const CHARACTER_ONLY: CharacterFieldKey[] = ['personality', 'speakingStyle', 'relationToUser', 'greeting', 'exampleDialogue']
function hasCharacterOnlyFields(o: Obj): boolean {
  return Object.keys(o).some((k) => {
    const f = matchFieldLabel(k)
    return f !== null && CHARACTER_ONLY.includes(f)
  })
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
  world?: WorldDraft

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
  const booksRaw = refList(root, ['lorebooks', 'worldbooks', 'world_books'])

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

function parseJsonRoot(root: unknown, fileName: string, warnings: string[], kind: ImportKind): Collector | string {
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
    const worldObj = findWorld(root)
    if (worldObj) {
      c.world = parseWorldObject(worldObj)
      c.formats.add('world-json')
    }
    if (Array.isArray(root.characters) || refList(root, ['lorebooks', 'worldbooks', 'world_books']).length) {
      parseCombo(root, warnings, c)
    } else if (worldObj) {
      // 只有世界设定，没有角色和世界书
    } else if (
      kind === 'world' &&
      !(typeof root.spec === 'string') &&
      !hasEntries(root) &&
      !looksLikeStV1(root) &&
      !hasCharacterOnlyFields(root)
    ) {
      // 世界导入模式下，一个只有名称和描述的对象视为世界设定
      c.world = parseWorldObject(root)
      c.formats.add('world-json')
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

  if (c.characters.length === 0 && c.lorebooks.length === 0 && !c.world) return '文件中没有可导入的角色、世界书或世界设定'
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

function parseTextLorebook(
  fileName: string,
  text: string,
  markdown: boolean,
  warnings: string[],
  split: 'sections' | 'whole' = 'sections',
): ParsedFile {
  const raw = splitSections(text, markdown, false)
  const hasHeadings = markdown && raw.some((s) => s.level > 0)
  if (split === 'whole' || !hasHeadings) {
    // 整篇作为一个条目：正文原样保留（含标题），不编造关键词
    const h1 = markdown ? /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(text) : null
    const name = h1?.[1]?.trim() || fileStem(fileName)
    if (!hasHeadings && split !== 'whole') {
      warnings.push(markdown ? '文档中没有标题，已整体作为一个条目导入' : '纯文本没有标题，已整体作为一个条目导入；如需拆分，请改用 Markdown 标题（## 条目名）')
    }
    warnings.push('条目没有关键词：请在预览中手动补充，或设为常驻条目')
    return {
      fileName,
      format: markdown ? 'markdown' : 'text',
      characters: [],
      lorebooks: [
        {
          name,
          description: '',
          entries: [{ name, keys: [], secondaryKeys: [], content: text.trim(), enabled: true, constant: false, extensions: {} }],
          extensions: {},
        },
      ],
      links: [],
      warnings,
    }
  }
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
  // 关键词不从标题自动生成：文件没有提供的关键词，由用户补充或设为常驻
  const entries: LoreEntryDraft[] = body.map((s, i) => ({
    name: s.label || `条目 ${i + 1}`,
    keys: [],
    secondaryKeys: [],
    content: s.text,
    enabled: true,
    constant: false,
    extensions: {},
  }))
  if (entries.length === 0) warnings.push('文件中没有可作为条目的内容')
  const noKeys = entries.filter((e) => e.keys.length === 0).length
  if (noKeys) warnings.push(`${noKeys} 个条目没有关键词：请在预览中手动补充，或设为常驻条目`)
  return {
    fileName,
    format: markdown ? 'markdown' : 'text',
    characters: [],
    lorebooks: [{ name, description, entries, extensions: {} }],
    links: [],
    warnings,
  }
}

/** 世界设定 TXT / Markdown：一级标题（或「名称：」行）作为世界名，其余全文作为设定，保留原有排版 */
function parseTextWorld(fileName: string, text: string, markdown: boolean, warnings: string[]): ParsedFile {
  const lines = text.split(/\r?\n/)
  const world = emptyWorldDraft()
  const firstIdx = lines.findIndex((l) => l.trim())
  const first = firstIdx >= 0 ? lines[firstIdx] : ''
  const h1 = markdown ? /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(first) : null
  const nameLine = /^\s*(世界名称|世界名|名称|名字)\s*[:：]\s*(.+)$/.exec(first)
  let body = lines
  if (h1 || nameLine) {
    world.name = (h1 ? h1[1] : nameLine![2]).replace(/[*_`]/g, '').trim()
    body = lines.slice(firstIdx + 1)
  } else {
    world.name = fileStem(fileName)
    warnings.push(`未找到世界名称，已暂用文件名「${world.name}」，请确认或修改`)
  }
  // 紧跟标题的「简介：」行作为一句话简介
  const nextIdx = body.findIndex((l) => l.trim())
  const tag = nextIdx >= 0 ? /^\s*(简介|一句话简介|副标题|一句话)\s*[:：]\s*(.+)$/.exec(body[nextIdx]) : null
  if (tag) {
    world.tagline = firstLine(tag[2], 60)
    body = body.slice(nextIdx + 1)
  }
  world.description = body.join('\n').trim()
  if (!world.description) warnings.push('世界设定正文为空')
  return { fileName, format: markdown ? 'markdown' : 'text', characters: [], lorebooks: [], links: [], warnings, world }
}

/* ======================================================================
 * 总入口
 * ==================================================================== */

/** 结构化数据（JSON / YAML / PNG 卡 / CharX 解析出的对象）→ 角色、世界书、世界 */
export function parseStructured(fileName: string, root: unknown, kind: ImportKind): ParseOutcome {
  const fail = (error: string): ParseOutcome => ({ ok: false, fileName, error })
  const warnings: string[] = []
  const r = parseJsonRoot(root, fileName, warnings, kind)
  if (typeof r === 'string') return fail(r)
  let world = r.world
  if (world && kind !== 'world') {
    warnings.push('文件中包含世界设定，当前不是世界导入，世界设定不会保存。如需导入，请到「世界」中选择从本地文件导入')
    world = undefined
    if (r.characters.length === 0 && r.lorebooks.length === 0) {
      return fail('这个文件只包含世界设定，请到「世界」中选择从本地文件导入')
    }
  }
  if (world && !world.name) {
    world.name = fileStem(fileName)
    warnings.push(`世界缺少名称，已暂用文件名「${world.name}」，请确认`)
  }
  r.characters.forEach((ch, i) => {
    if (!ch.name) {
      ch.name = r.characters.length === 1 ? fileStem(fileName) : ''
      warnings.push(ch.name ? `角色缺少名称，已暂用文件名「${ch.name}」，请确认` : `第 ${i + 1} 个角色缺少名称，请在预览中填写`)
    }
    const filled = [ch.bio, ch.personality, ch.speakingStyle, ch.backstory, ch.relationToUser, ch.greeting, ch.exampleDialogue]
    if (!filled.some(Boolean)) warnings.push(`角色「${ch.name || i + 1}」没有任何设定内容`)
  })
  const formats = [...r.formats]
  const format: ImportFormat = r.formats.has('combo-json') || formats.length > 1 ? 'combo-json' : formats[0] ?? 'generic-json'
  return {
    ok: true,
    file: { fileName, format, characters: r.characters, lorebooks: r.lorebooks, links: r.links, warnings, world },
  }
}

export interface TextDocOptions {
  markdown: boolean
  /** 世界书：按章节拆分（默认）或整篇一个条目 */
  split?: 'sections' | 'whole'
}

/** 文本文档（TXT / Markdown / DOCX / PDF 提取后的文字）→ 角色、世界书或世界设定 */
export function parseTextDocument(fileName: string, rawText: string, kind: ImportKind, opts: TextDocOptions): ParseOutcome {
  const text = rawText.replace(/^\uFEFF/, '')
  if (!text.trim()) return { ok: false, fileName, error: '文件中没有可提取的文字' }
  const warnings: string[] = []
  const file =
    kind === 'lorebook'
      ? parseTextLorebook(fileName, text, opts.markdown, warnings, opts.split)
      : kind === 'world'
        ? parseTextWorld(fileName, text, opts.markdown, warnings)
        : parseTextCharacter(fileName, text, opts.markdown, warnings)
  return { ok: true, file }
}

/**
 * 文本内容的快捷入口（JSON / TXT / Markdown，按扩展名判断）。
 * 二进制格式（PNG、CharX、ZIP、DOCX、PDF）请使用 pipeline.ts 的 importFile()。
 */
export function parseImportFile(fileName: string, rawText: string, kind: ImportKind): ParseOutcome {
  const fail = (error: string): ParseOutcome => ({ ok: false, fileName, error })
  const ext = (fileName.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()
  const text = rawText.replace(/^\uFEFF/, '')
  if (!text.trim()) return fail('文件为空')
  if (text.includes('\u0000')) return fail('文件看起来不是文本文件，请确认格式')
  const isJson = ext === 'json' || (!['txt', 'md', 'markdown'].includes(ext) && /^\s*[[{]/.test(text))
  if (isJson) {
    let root: unknown
    try {
      root = JSON.parse(text)
    } catch (e) {
      return fail(`JSON 格式错误，无法解析（${e instanceof Error ? e.message : String(e)}）`)
    }
    return parseStructured(fileName, root, kind)
  }
  if (!['txt', 'md', 'markdown', ''].includes(ext)) return fail(`.${ext} 不是文本格式，请通过文件导入流程读取`)
  return parseTextDocument(fileName, text, kind, { markdown: ext === 'md' || ext === 'markdown' })
}

/** 导出给 UI：Extensions 是否非空 */
export function hasExtensions(e: Extensions | undefined): boolean {
  return !!e && Object.keys(e).length > 0
}
