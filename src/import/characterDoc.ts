/**
 * 长篇角色人设文档（DOCX / PDF / TXT / Markdown）→ 章节、字段归类、角色名称（纯函数）。
 *
 * 规则（不调用 AI，不猜内容含义，只看标题）：
 *  - 标题：Markdown 风格的「# 标题」（Word 普通正文里手打的也算，# 后可以没有空格）、Word 标题样式、
 *    单独一行的【标题】、「一、标题」、单独一行的 **标题**
 *  - 标题按关键词归入角色字段；子标题无法归类时继承上级标题的归属
 *  - 无法归类的章节标为「其他设定」，原文完整保留，不丢弃
 *  - 「# 核心任务」这类通用章节标题永远不会被当作角色名称
 */
import type { CharacterFieldKey, SectionTarget, TextSection } from './types'

export interface DocSection extends TextSection {
  level: number
}

/** 标题关键词 → 字段。按顺序匹配，越具体的越靠前 */
const RULES: [RegExp, CharacterFieldKey][] = [
  [/^(角色名|角色名称|角色姓名|姓名|名字|名称|称呼)$/, 'name'],
  [/开场白|开场|第一句|问候语|初次见面/, 'greeting'],
  [/语录|台词|示例|范例|例句|样例|对话样本|对话示例|示范/, 'exampleDialogue'],
  [/对话规范|对话风格|对话要求|对话规则|聊天风格|回复风格|说话|语言习惯|语言风格|语言特点|语气|口癖|口头禅|用词|表达方式|说话方式/, 'speakingStyle'],
  [/性格|人格|个性|性情|特质|脾气|价值观/, 'personality'],
  [/共同经历|共同回忆|个人情报|个人信息|个人资料/, 'backstory'],
  [/人物关系|人际关系|关系|羁绊|与你|与用户|和你|对你|对我|和我|与我|昵称|恋人|伴侣/, 'relationToUser'],
  [/共同经历|共同回忆|经历|过往|回忆|往事|背景|故事|生平|身世|成长|个人情报|个人信息|个人资料|基本信息|基础信息|基本资料|档案|资料|外貌|外形|形象|身份|职业|喜好|喜欢|爱好|习惯|日常|作息|设定集|世界观|基础信息|基数信息|基本情况/, 'backstory'],
  [/^(简介|一句话简介|概述|角色简介|人物简介)$/, 'bio'],
]

/** 通用章节标题：可能是一级标题，但绝不是角色名 */
const GENERIC_TITLE =
  /任务|规则|规范|要求|说明|指令|指南|须知|注意|前言|目录|总则|附录|备注|系统|设定|人设|角色卡|角色设定|人物设定|prompt|system|instruction|简介|概述|开场|性格|背景|经历|关系|资料|情报|语录|示例|风格|对话|token/i

export function classifyHeading(label: string): CharacterFieldKey | null {
  const k = label.replace(/[【】\[\]（）()《》「」“”"'：:#*\s·.、0-9一二三四五六七八九十]/g, '').toLowerCase()
  if (!k) return null
  for (const [re, field] of RULES) if (re.test(k)) return field
  return null
}

const MD_HEADING = /^\s{0,3}(#{1,6})\s*([^#\s].*?)\s*#*\s*$/
const BRACKET = /^\s*【([^】]{1,24})】\s*$/
const ORDINAL = /^\s*[一二三四五六七八九十]{1,3}\s*[、.．]\s*([^。！？!?]{1,24})$/
const BOLD = /^\s*\*\*([^*]{1,24})\*\*\s*$/
const LABEL_LINE = /^\s*[【[]?([^\s:：【】[\]]{1,12})[】\]]?\s*[:：]\s*(.*)$/

/** 识别一行是否是标题；返回级别与标题文字 */
export function headingOf(line: string): { level: number; label: string } | null {
  const md = MD_HEADING.exec(line)
  // 「#」后紧跟文字时，要求整行较短，避免把 #话题标签 当标题
  if (md && (line.trimStart().charAt(md[1].length) === ' ' || md[2].length <= 24)) {
    return { level: md[1].length, label: md[2].replace(/[*_`]/g, '').trim() }
  }
  const b = BRACKET.exec(line) ?? BOLD.exec(line)
  if (b) return { level: 2, label: b[1].trim() }
  const o = ORDINAL.exec(line)
  if (o) return { level: 2, label: o[1].trim() }
  return null
}

/** 按标题拆分章节；每段保留完整原文 */
export function splitDocSections(text: string): DocSection[] {
  const out: DocSection[] = []
  let cur: DocSection | null = null
  const start = (label: string, level: number, first = '') => {
    cur = { label, level, text: first, target: 'extra' }
    out.push(cur)
  }
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = headingOf(line)
    if (h) {
      start(h.label, h.level)
      continue
    }
    // 「性格：……」这种字段行（只认识别得出的字段名，避免把正文里的冒号句子拆开）
    const m = LABEL_LINE.exec(line)
    if (m && classifyHeading(m[1]) && m[1].length <= 8) {
      start(m[1], 7, m[2])
      continue
    }
    if (!cur) start('', 0)
    const c = cur as unknown as DocSection
    c.text = c.text ? `${c.text}\n${line}` : line
  }
  // 只有子标题、没有正文的标题也先保留：子标题要靠它继承归属（assignTargets 之后再去掉空段）
  return out.map((s) => ({ ...s, text: s.text.replace(/^\s*\n|\s+$/g, '').trim() }))
}

/** 为章节分配字段：自己能归类就归类；否则继承上级标题；仍无法归类则为「其他设定」 */
export function assignTargets(sections: DocSection[]): DocSection[] {
  const stack: { level: number; target: SectionTarget }[] = []
  return sections.map((s) => {
    const own = classifyHeading(s.label)
    while (stack.length && stack[stack.length - 1].level >= s.level) stack.pop()
    const inherited = stack.length ? stack[stack.length - 1].target : null
    // 没有标题的开头部分通常是整体介绍，归入背景故事；有标题但无法归类的，作为「其他设定」保留
    const target: SectionTarget = own ?? (inherited && inherited !== 'name' ? inherited : s.label ? 'extra' : 'backstory')
    if (s.level > 0 && s.level < 7) stack.push({ level: s.level, target: own ?? target })
    return { ...s, target, auto: !!own || !!inherited }
  }).filter((s) => s.text || s.target === 'name')
}

export interface NameGuess {
  name: string
  confident: boolean
  candidates: string[]
  /** 识别依据，用于预览说明 */
  source: string
}

const NAME_CHARS = '[\\u4e00-\\u9fa5A-Za-z·・]{2,10}'

function countIn(text: string, name: string): number {
  if (!name) return 0
  let n = 0
  for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + name.length)) n++
  return n
}

/** 文件名去掉「prompt / 人设 / 设定 / 角色卡 / 版本号」等后缀，例如「沈星回prompt」→「沈星回」 */
export function nameFromFileStem(stem: string): string {
  return stem
    .replace(/[（(【[].*?[】\])）]/g, '')
    .replace(/(prompt|prompts|persona|character|card|人设|设定集|设定|角色卡|角色设定|人物设定|角色|档案|资料|最终版|终版|修改版|副本|copy|v\d+(\.\d+)*|\d{4,})/gi, '')
    .replace(/[\s_\-—.·、,，]+/g, '')
    .trim()
}

/**
 * 识别角色名称。依据（按可信度）：
 *  1. 明确的字段行或标题：「角色名：沈星回」「## 姓名」下的第一行
 *  2. 「你是 / 你将扮演 / 扮演」后面的名字，且在文中多次出现
 *  3. 文件名（去掉 prompt / 人设 等后缀）且在文中多次出现
 *  4. 不是通用章节名的一级标题
 * 只有 1，或 2、3 互相印证时才算有把握；否则请用户确认。
 */
export function guessCharacterName(text: string, fileStem: string, sections: DocSection[]): NameGuess {
  const candidates: string[] = []
  const add = (n: string) => {
    const v = n.trim().replace(/^[「“"《]|[」”"》]$/g, '')
    if (v && v.length <= 12 && !GENERIC_TITLE.test(v) && !candidates.includes(v)) candidates.push(v)
  }

  // 1. 明确字段
  const labelLine = new RegExp(`^\\s*[【[]?(?:角色名称|角色名|角色姓名|姓名|名字|名称)[】\\]]?\\s*[:：]\\s*[「“"]?(${NAME_CHARS})`, 'm').exec(text)
  if (labelLine) return { name: labelLine[1], confident: true, candidates: [labelLine[1]], source: '文件中的「姓名 / 角色名」' }
  const nameSection = sections.find((s) => classifyHeading(s.label) === 'name' && s.text.trim())
  if (nameSection) {
    const n = nameSection.text.split('\n')[0].trim().replace(/^[「“"]|[」”"]$/g, '').slice(0, 20)
    return { name: n, confident: true, candidates: [n], source: '文件中的「姓名 / 角色名」' }
  }

  // 2. 「你是 X」「扮演 X」
  const roleRe = new RegExp(`(?:你(?:将|要|需要|必须)?(?:扮演|饰演|成为|化身为?|是)|扮演|饰演)\\s*[「“"《]?(${NAME_CHARS})`, 'g')
  const roleHits = new Map<string, number>()
  for (const m of text.matchAll(roleRe)) {
    // 名字后面常跟「，一个……」「的」等，截到第一个虚词前
    const n = m[1].replace(/(的|，|。|一个|一名|一位|这个|这位|角色|本人).*$/, '')
    if (n.length >= 2) roleHits.set(n, (roleHits.get(n) ?? 0) + 1)
  }
  const fromFile = nameFromFileStem(fileStem)
  const fileCount = fromFile.length >= 2 && fromFile.length <= 10 ? countIn(text, fromFile) : 0

  const role = [...roleHits.keys()].sort((a, b) => countIn(text, b) - countIn(text, a))[0]
  if (role) add(role)
  if (fileCount > 0) add(fromFile)
  const h1 = sections.find((s) => s.level === 1)
  if (h1 && h1.label.length <= 10 && !classifyHeading(h1.label)) add(h1.label)

  if (role && (role === fromFile || countIn(text, role) >= 3)) {
    return { name: role, confident: true, candidates, source: `文中的「扮演 / 你是${role}」` }
  }
  if (fileCount >= 2) return { name: fromFile, confident: true, candidates, source: `文件名，且文中出现 ${fileCount} 次` }
  if (candidates.length) return { name: candidates[0], confident: false, candidates, source: '推测' }
  return { name: fromFile || fileStem, confident: false, candidates: [], source: '文件名' }
}

/**
 * 文档里要求模型做到、但聆聆并不提供的能力（只提示用户，不执行、不承诺）。
 * 例如「自动检测系统时间」「自查 Token 剩余容量」「移除伦理限制」。
 */
export function capabilityNotes(text: string): string[] {
  const notes: string[] = []
  if (/token/i.test(text) && /(自查|检测|检查|剩余|容量)/.test(text)) {
    notes.push('文档要求模型「自查 Token 剩余容量」：模型看不到自己的上下文用量，聆聆也不会把用量告诉模型，这条要求通常无法做到')
  }
  if (/(系统时间|现实时间|当前时间)/.test(text)) {
    notes.push('文档要求模型「检测现实 / 系统时间」：聆聆目前不会把当前时间发给模型，模型无法得知真实时间')
  }
  if (/(伦理|道德|安全)\S{0,6}(限制|约束)/.test(text)) {
    notes.push('文档中关于「移除伦理 / 安全限制」的要求只是人设原文，会照原样发给模型；它不会改变模型服务商的安全规则')
  }
  return notes
}

/** 统计：可见字符数（不含空白） */
export function visibleChars(s: string): number {
  return s.replace(/\s/g, '').length
}
