/**
 * 角色与用户的「已有关系」：从人设原文中识别（规则，不调用 AI），保存原文依据，并生成发给模型的关系说明。
 *
 *  - 只认原文明确写出的关系；识别不到时为 unknown，不猜
 *  - 依据、昵称、共同经历、相处习惯都是原文摘句，不改写、不补充
 *  - 用户可以在角色资料页查看和修改；用户修改过的（source = 'user'）不会再被自动识别覆盖
 */
import type { Character, Relationship, RelationshipStatus } from '../../db/schema'

export const RELATION_LABEL: Record<RelationshipStatus, string> = {
  lover: '恋人',
  married: '已婚 / 伴侣',
  friend: '朋友',
  ambiguous: '暧昧',
  stranger: '陌生人',
  custom: '自定义',
  unknown: '未识别',
}

/** 角色与用户的称呼：「你」「用户」「{{user}}」「我」（以用户口吻写的设定） */
const USER_REF = /(你|用户|\{\{user\}\}|<user>|玩家|主角|对方)/i

type Rule = { status: RelationshipStatus; re: RegExp; weight: number }

/** 越具体的越靠前；同一句里命中多个时取权重高的 */
const RULES: Rule[] = [
  { status: 'married', re: /(已婚|结婚|婚后|新婚|成婚|夫妻|夫妇|丈夫|妻子|老公|老婆|爱人|伴侣|先生和太太|另一半|婚姻)/, weight: 3 },
  { status: 'lover', re: /(恋人|情侣|男朋友|女朋友|男友|女友|在一起|交往中|正在交往|已经交往|热恋|恋爱关系|恋爱中|确定关系)/, weight: 3 },
  { status: 'ambiguous', re: /(暧昧|互有好感|没有挑明|还没表白|尚未表白|未表白|友达以上|恋人未满|喜欢但)/, weight: 4 },
  { status: 'friend', re: /(朋友|好友|挚友|闺蜜|兄弟|发小|青梅竹马|竹马|搭档|同学|室友|同事)/, weight: 2 },
  { status: 'stranger', re: /(陌生人|素不相识|初次见面|第一次见面|刚刚认识|刚认识|互不认识|不认识)/, weight: 2 },
]

/** 否定或未来：「还没在一起」「不是恋人」「想成为女朋友」「前男友」 */
const NEGATED = /(不是|并非|还没|还未|尚未|没有|未曾|不再|想要?成为|希望成为|想和你|假装|伪装|前任|前男友|前女友|前妻|前夫|离婚|分手)/

function sentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
}

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s)

export interface RelationSource {
  label: string
  text: string
}

/** 收集用于识别的原文：关系字段优先，其后背景、其他设定、导入全文 */
export function relationSources(c: Pick<Character, 'relationToUser' | 'backstory' | 'bio' | 'personality' | 'profileExtras' | 'sourceDoc'>): RelationSource[] {
  const out: RelationSource[] = []
  if (c.relationToUser?.trim()) out.push({ label: '与你的关系', text: c.relationToUser })
  if (c.bio?.trim()) out.push({ label: '角色简介', text: c.bio })
  if (c.backstory?.trim()) out.push({ label: '背景故事', text: c.backstory })
  for (const e of c.profileExtras ?? []) if (e.text.trim()) out.push({ label: e.label, text: e.text })
  if (c.personality?.trim()) out.push({ label: '性格', text: c.personality })
  // 全文里通常包含上面这些字段；只在字段都没有关系信息时才会用到
  if (c.sourceDoc?.text?.trim()) out.push({ label: '导入原文', text: c.sourceDoc.text })
  return out
}

const NICK_PATTERNS: [RegExp, 'forUser' | 'forChar'][] = [
  [/(?:称呼|叫|喊|唤)(?:你|用户|\{\{user\}\})(?:为|作|做)?\s*[「“"']([^」”"'，。,\s]{1,8})[」”"']/g, 'forUser'],
  [/(?:称呼|叫|喊|唤)(?:你|用户|\{\{user\}\})(?:为|作|做)\s*([^「“"'，。,、；;\s]{1,6})/g, 'forUser'],
  [/(?:对你|对用户)的(?:昵称|称呼|爱称)(?:是|为|：|:)\s*[「“"']?([^」”"'，。,、；;\s]{1,8})/g, 'forUser'],
  [/(?:你|用户|\{\{user\}\})(?:称呼|叫|喊)(?:他|她|ta|对方)(?:为|作|做)?\s*[「“"']([^」”"'，。,\s]{1,8})[」”"']/gi, 'forChar'],
]

const SHARED_LABEL = /(共同经历|共同回忆|回忆|过往|往事|经历|相识|恋爱史|故事线|相处)/
const HABIT = /(每天|每晚|每次|总是|总会|习惯|经常|常常|一起.{0,6}(?:吃|睡|散步|看|做饭|上班|回家)|晚安|早安)/
const SHARED = /(一起|曾经|那年|那天|那次|第一次|初遇|相遇|认识的时候|告白|求婚|约会|旅行|纪念日)/

/** 从原文中识别关系；只返回原文摘句，不改写 */
export function detectRelationship(sources: RelationSource[], now = Date.now()): Relationship {
  const score = new Map<RelationshipStatus, number>()
  const evidence: Relationship['evidence'] = []
  const seen = new Set<string>()
  const nickU = new Set<string>()
  const nickC = new Set<string>()
  const shared: string[] = []
  const habits: string[] = []

  for (const src of sources) {
    const isRelField = src.label === '与你的关系' || /关系|羁绊|恋|伴侣/.test(src.label)
    // 导入全文只在前面的字段里找不到依据时参与（避免重复计数）
    if (src.label === '导入原文' && evidence.length) break
    for (const s of sentences(src.text)) {
      for (const [re, who] of NICK_PATTERNS) {
        for (const m of s.matchAll(re)) {
          const n = m[1].replace(/[的地得]$/, '')
          if (n && n.length <= 8 && !/^(你|我|他|她|用户)$/.test(n)) (who === 'forUser' ? nickU : nickC).add(n)
        }
      }
      if (seen.has(s)) continue
      // 关系字段里的句子即使不出现「你」也算（字段本身就是「与你的关系」）
      const aboutUser = isRelField || USER_REF.test(s)
      if (aboutUser) {
        let best: Rule | null = null
        for (const r of RULES) {
          const m = r.re.exec(s)
          if (!m) continue
          const before = s.slice(Math.max(0, m.index - 6), m.index)
          if (NEGATED.test(before) || /^前/.test(s.slice(m.index - 1, m.index))) continue
          if (!best || r.weight > best.weight) best = r
        }
        if (best) {
          const w = best.weight * (isRelField ? 2 : 1)
          score.set(best.status, (score.get(best.status) ?? 0) + w)
          if (evidence.length < 6) evidence.push({ quote: clip(s), source: src.label })
          seen.add(s)
        }
      }
      if (aboutUser && shared.length < 8 && (SHARED_LABEL.test(src.label) || SHARED.test(s)) && !seen.has(`s:${s}`)) {
        seen.add(`s:${s}`)
        if (USER_REF.test(s) || SHARED_LABEL.test(src.label)) shared.push(clip(s, 160))
      }
      if (aboutUser && habits.length < 6 && HABIT.test(s) && USER_REF.test(s) && !seen.has(`h:${s}`)) {
        seen.add(`h:${s}`)
        habits.push(clip(s, 120))
      }
    }
  }

  let status: RelationshipStatus = 'unknown'
  let top = 0
  for (const [k, v] of score) if (v > top) [status, top] = [k, v]
  // 「已婚」与「恋人」同时出现时，已婚更具体
  if (status === 'lover' && (score.get('married') ?? 0) >= top * 0.6) status = 'married'

  return {
    status,
    evidence: status === 'unknown' ? [] : evidence,
    nicknames: { forUser: [...nickU].slice(0, 4), forChar: [...nickC].slice(0, 4) },
    sharedHistory: shared.filter((s) => !habits.includes(s)),
    habits,
    source: 'auto',
    updatedAt: now,
  }
}

/** 当前有效的关系：用户确认/修改过的优先；否则按现有资料自动识别（不写入数据库） */
export function effectiveRelationship(c: Pick<Character, 'relationship' | 'relationToUser' | 'backstory' | 'bio' | 'personality' | 'profileExtras' | 'sourceDoc'>): Relationship {
  if (c.relationship) return c.relationship
  return detectRelationship(relationSources(c))
}

/** 已确立、需要从第一句话就延续的关系 */
export function isEstablished(s: RelationshipStatus) {
  return s === 'lover' || s === 'married' || s === 'friend' || s === 'ambiguous'
}

const GUIDE: Partial<Record<RelationshipStatus, string>> = {
  lover: '你们已经是恋人。从第一句话起就以恋人的身份自然相处：不要重新自我介绍、不要像初次认识那样客套，也不要再表白或询问对方是否愿意交往。',
  married: '你们已经结婚 / 是共同生活的伴侣。从第一句话起就以伴侣的身份自然相处：有共同的日常和默契，不要像初次认识那样客套，不要重新追求或求婚。',
  friend: '你们已经是朋友。从第一句话起就以老朋友的熟悉感相处，不要重新自我介绍；除非设定写明，不要主动发展成恋爱。',
  ambiguous: '你们之间是暧昧、彼此有好感但没有挑明的关系。保持这种分寸和张力：不要直接确定恋爱关系，也不要表现得像陌生人。',
  stranger: '你们是刚认识的陌生人。保持礼貌和分寸，关系要在真实的聊天中慢慢发展，不要突然亲昵。',
}

export interface RelationshipSectionOptions {
  /** 已经发送过的人设文字：原文依据、共同经历、相处习惯如果已经原样出现在里面，就不再重复发送 */
  alreadySent?: string
  /** 用户在已有聊天之后修改过关系：提醒模型以新关系为准 */
  changedAfterChat?: boolean
}

const normQuote = (s: string) => s.replace(/…$/, '').replace(/\s+/g, '')

/** 原文摘句是否已经在发送的人设里（避免同一句话发两遍） */
export function alreadyIncluded(quote: string, sent: string): boolean {
  const q = normQuote(quote)
  return q.length >= 6 && sent.includes(q)
}

/** 关系说明中被省略的、已在人设里出现过的摘句数（供预览显示） */
export function duplicatedQuotes(rel: Relationship, alreadySent: string): number {
  const sent = alreadySent.replace(/\s+/g, '')
  return [...rel.evidence.slice(0, 3).map((e) => e.quote), ...rel.sharedHistory.slice(0, 6), ...rel.habits.slice(0, 4)].filter((q) => alreadyIncluded(q, sent)).length
}

/** 发给模型的关系说明（system 中，每次都发送，保证长期一致） */
export function relationshipSection(rel: Relationship, user: string, opts: RelationshipSectionOptions = {}): string {
  if (rel.status === 'unknown') return ''
  const sent = (opts.alreadySent ?? '').replace(/\s+/g, '')
  const fresh = (q: string) => !alreadyIncluded(q, sent)
  const lines: string[] = []
  const label = rel.status === 'custom' ? rel.customLabel?.trim() || '自定义关系' : RELATION_LABEL[rel.status]
  lines.push(`关系：${label}${rel.source === 'user' ? `（${user}确认）` : '（来自人设原文）'}`)
  if (opts.changedAfterChat && rel.source === 'user') {
    lines.push(`这个关系是${user}最近确认或修改的，从现在起以它为准；之前聊天里与它不一致的说法、称呼和相处方式不再适用，也不用特意解释这个变化。`)
  }
  const g = GUIDE[rel.status]
  if (g) lines.push(g.replace(/对方/g, user))
  if (rel.status === 'custom' && rel.customNote?.trim()) lines.push(rel.customNote.trim().slice(0, 300))
  if (rel.status !== 'stranger') {
    lines.push(
      `亲密的表达方式由你自己的性格决定：内敛的人就含蓄克制，外向的人就自然外放，嘴硬的人就用嘴硬的方式在意。不要套用统一的甜宠话术，不要每句都表达爱意，不要动不动叫「宝宝」之类的称呼（除非下面的昵称或人设里就是这样叫）。`,
    )
  }
  if (rel.status === 'lover' || rel.status === 'married') {
    lines.push('真正的亲密来自熟悉和默契：可以自然地调侃、撒娇、闹小脾气、偶尔吃醋，接住对方的玩笑，记得对方的习惯；不要机械表白，不要强行制造浪漫，程度跟着你的性格和对方当下的回应走。')
  }
  if (rel.nicknames.forUser.length) lines.push(`你对${user}的称呼：${rel.nicknames.forUser.join('、')}（自然地用，不必每句都叫）`)
  if (rel.nicknames.forChar.length) lines.push(`${user}对你的称呼：${rel.nicknames.forChar.join('、')}`)
  const evidence = rel.evidence.slice(0, 3).filter((e) => fresh(e.quote))
  if (evidence.length) lines.push(`人设原文依据：\n${evidence.map((e) => `  · 「${e.quote}」`).join('\n')}`)
  const shared = rel.sharedHistory.slice(0, 6)
  const sharedFresh = shared.filter(fresh)
  if (sharedFresh.length) {
    lines.push(`已有的共同经历（只可提及这些、上面人设里写到的和聊天中真实发生过的事，不要编造新的过往细节）：\n${sharedFresh.map((s) => `  · ${s}`).join('\n')}`)
  } else if (shared.length) {
    lines.push('你们已有的共同经历写在上面的人设里：只可提及那些和聊天中真实发生过的事，不要编造新的过往细节。')
  } else if (rel.status !== 'stranger') {
    lines.push('人设里没有写具体的共同经历：可以表现出熟悉和默契，但不要编造具体发生过的事件、日期或地点；需要时可以自然地问。')
  }
  const habits = rel.habits.slice(0, 4).filter(fresh)
  if (habits.length) lines.push(`相处习惯：\n${habits.map((s) => `  · ${s}`).join('\n')}`)
  return `【你和${user}的关系】（始终有效，聊多久都不要忘记或改变，除非${user}在聊天中明确改变了它）\n${lines.map((l) => (l.startsWith('关系：') ? l : `· ${l}`)).join('\n')}`
}
