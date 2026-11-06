/**
 * 长期记忆（纯函数）。
 *
 *  分层：角色永久人设、世界设定、与用户的固定关系 → 由人设 / 世界 / 关系模块负责（不在这里重复保存）
 *        共同经历（event）、用户长期偏好（preference）、重要约定（promise）、
 *        用户希望角色记住的事（user-fact）、近期聊天事件（recent）→ 本模块
 *        临时上下文 → 最近的聊天记录本身，不保存
 *  原则：
 *   - 只保存用户确认过的内容；提议的记忆只来自「用户自己说的话」或「真实发生在聊天中的事」，
 *     并且必须能在用户的原话中找到依据 —— AI 自己编造的情节不会成为记忆
 *   - 每个角色的记忆独立（characterId），不会串到其他角色
 *   - 身份证号、银行卡号等不保存；健康、财务等敏感内容标记为敏感，只在话题相关时才发送
 *   - 发送时：固定 / 重要的优先，其余按与当前话题的相关程度挑选，限制总字数，避免每次发送全部
 */
import type { Memory, MemoryKind, Message, RelationshipStatus } from '../../db/schema'
import { features, STOP } from './profile'

export const MEMORY_BUDGET = {
  /** 每次发送的记忆总字数上限 */
  chars: 900,
  /** 固定 / 非常重要的记忆最多占用的字数 */
  pinnedChars: 500,
  itemChars: 200,
}

export const KIND_LABEL: Partial<Record<MemoryKind, string>> = {
  'user-fact': '要记住的事',
  preference: '长期偏好',
  promise: '重要约定',
  event: '共同经历',
  recent: '近期的事',
  'long-term': '长期记忆',
  persona: '设定',
  world: '世界',
}

/** 绝不保存的内容：证件号、银行卡号、密码等 */
const FORBIDDEN = [
  /\b\d{17}[\dXx]\b/, // 身份证
  /\b(?:\d[ -]?){15,18}\d\b/, // 银行卡
  /(密码|验证码|口令|password|passcode)\s*(是|为|:|：)/i,
  /sk-[A-Za-z0-9]{16,}/, // API Key
]
const SENSITIVE = /(病|症|药|医院|诊断|抑郁|焦虑|怀孕|手术|治疗|心理咨询|工资|收入|存款|负债|欠款|贷款|信用|宗教|信仰|政治|性取向|住址|家庭住址|电话|手机号)/

export function memoryCheck(text: string): { ok: boolean; sensitive: boolean; reason?: string } {
  if (FORBIDDEN.some((re) => re.test(text))) return { ok: false, sensitive: true, reason: '含有证件号、银行卡号、密码或密钥，聆聆不会把这类信息保存为记忆' }
  return { ok: true, sensitive: SENSITIVE.test(text) }
}

/** 否定 / 相反的说法：「喜欢猫」和「不喜欢猫」字面很像，但意思相反，不能当成重复 */
const NEGATIVE = /(不喜欢|不爱|讨厌|不吃|不能吃|不喝|不想|不要|不会|不再|没有|戒了|过敏|受不了|害怕)/
const normalize = (t: string) => t.replace(/[\s\p{P}\p{S}]+/gu, '').replace(/[哦呀啦呢吧嘛哈啊]+$/u, '')

/** 两段文字的相似程度（0～1，按相邻两字特征）；一句是否定、一句不是时最多 0.5 */
export function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (na && na === nb) return 1
  const fa = features(a)
  const fb = features(b)
  if (!fa.size || !fb.size) return a.trim() === b.trim() ? 1 : 0
  let inter = 0
  for (const x of fa) if (fb.has(x)) inter++
  const score = inter / Math.min(fa.size, fb.size)
  return NEGATIVE.test(a) !== NEGATIVE.test(b) ? Math.min(score, 0.5) : score
}

/** 疑似相关（可以由用户决定是否合并）的记忆对：相似但还不算重复 */
export function relatedPairs(mems: Memory[], low = 0.5, high = 0.75): [Memory, Memory][] {
  const list = mems.filter((m) => m.status === 'active' && m.content.trim())
  const out: [Memory, Memory][] = []
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const s = similarity(list[i].content, list[j].content)
      if (s >= low && s < high && NEGATIVE.test(list[i].content) === NEGATIVE.test(list[j].content)) out.push([list[i], list[j]])
    }
  return out.slice(0, 10)
}

/** 合并两条记忆的内容：一条包含另一条时保留较完整的；否则两句都保留（不改写原意） */
export function mergedContent(a: string, b: string): string {
  const x = a.trim()
  const y = b.trim()
  if (normalize(x).includes(normalize(y))) return x
  if (normalize(y).includes(normalize(x))) return y
  return `${x}；${y}`.slice(0, 300)
}

/** 按内容判断记忆类别（只用于默认分类，用户可以修改） */
export function guessKind(content: string): MemoryKind {
  if (/(约定|约好|说好|说定|答应|保证|拉钩|下次一起|以后一起|等.{1,8}一起)/.test(content)) return 'promise'
  if (/((我们|咱们|我和你|你和我).{0,10}(一起|去了|看了|吃了|见了|第一次)|那天我们|上次我们)/.test(content)) return 'event'
  if (/(喜欢|讨厌|爱吃|爱喝|不吃|不喝|不爱|最爱|偏好|习惯|过敏|受不了|口味|害怕|怕冷|怕热)/.test(content)) return 'preference'
  return 'user-fact'
}

/** 找出与新内容重复的已有记忆（同一角色内） */
export function findDuplicate(content: string, existing: Memory[], threshold = 0.75): Memory | undefined {
  return existing.filter((m) => m.status !== 'invalidated').find((m) => similarity(content, m.content) >= threshold)
}

/** 「记住 / 别忘了 / 记得」：用户明确要求角色记住的话 */
const REMEMBER = /(记住|记好|别忘了|不要忘了|不要忘记|千万记得|你要记得|帮我记|记一下)/
/** 「帮我记个便签 / 记到日历里」是让角色使用便签、日历，不是要求记住（不当作长期记忆） */
export const APP_RECORD = /(记|写|加|存)(一)?(个|张|条|下|到|在|进)?(我的)?(便签|日程|日历|备忘录?|待办|清单)|(便签|日程|日历|备忘录?|待办|清单)(里|上|中)/

export interface MemoryProposal {
  kind: MemoryKind
  content: string
  sourceMessageIds: string[]
  quote: string
  origin: 'user-request' | 'suggested'
  sensitive: boolean
  /** 与已有记忆重复：不新增，只把这条消息作为依据合并进那条记忆（内容不变） */
  mergeInto?: string
}

/** 从用户的消息中找出「请记住……」，原样作为提议（不改写、不推断） */
export function proposeFromRequests(history: Message[], existing: Memory[]): MemoryProposal[] {
  const out: MemoryProposal[] = []
  const handled = new Set(existing.flatMap((m) => m.sourceMessageIds))
  for (const m of history) {
    if (m.senderType !== 'user' || m.deleted || m.kind !== 'text' || handled.has(m.id)) continue
    const t = m.content.trim()
    if (!REMEMBER.test(t) || t.length < 4 || APP_RECORD.test(t)) continue
    const content = t.replace(/^(你)?(要|得|一定要)?(记住|记好|记一下|帮我记(一下)?)[，,：:\s]*/, '').slice(0, MEMORY_BUDGET.itemChars) || t
    const check = memoryCheck(content)
    if (!check.ok) continue
    const dup = findDuplicate(content, existing)
    const same = out.find((p) => similarity(p.content, content) >= 0.75)
    if (dup || same) {
      // 重复说了同一件事：只合并依据，不新增
      const target = dup?.id ?? same?.mergeInto
      if (target) out.push({ kind: dup?.kind ?? 'user-fact', content: dup?.content ?? content, sourceMessageIds: [m.id], quote: t.slice(0, 120), origin: 'user-request', sensitive: check.sensitive, mergeInto: target })
      else same!.sourceMessageIds.push(m.id)
      continue
    }
    out.push({ kind: guessKind(content), content, sourceMessageIds: [m.id], quote: t.slice(0, 120), origin: 'user-request', sensitive: check.sensitive })
  }
  return out
}

/** 让模型从最近聊天中提取记忆候选的提示词（只摘录用户说过的话） */
export function extractPrompt(charName: string, userName: string, msgs: Message[]): { role: 'system' | 'user'; content: string }[] {
  const lines = msgs
    .filter((m) => !m.deleted && !m.superseded && m.kind === 'text' && m.content.trim() && m.senderType !== 'system')
    .map((m) => `[${m.id}] ${m.senderType === 'user' ? userName : charName}：${m.content.trim().slice(0, 300)}`)
  return [
    {
      role: 'system',
      content:
        `你是记忆整理工具。从下面的聊天记录中，找出值得「${charName}」长期记住的关于「${userName}」的事实、偏好、计划，以及两人在聊天中真实约定或经历的事。\n` +
        `规则：\n1. 只能依据「${userName}」本人说的话；「${charName}」说的内容可能是编的，不能作为依据。\n` +
        `2. 每条写成一句简短的陈述（不超过 60 字），并给出依据消息的编号，以及从那条消息中逐字摘录的原文（quote）。\n` +
        '3. 不要记录寒暄、情绪化的一时之语，不要推测，不要记录证件号、银行卡号、密码。\n' +
        '4. kind 只能是：user-fact（关于对方的事实）、preference（对方长期的喜好、厌恶、习惯）、promise（两人之间明确的约定）、event（两人在聊天中真实经历的事）。角色单方面描述的经历、剧情、设定都不算。\n' +
        '5. 没有值得记住的就返回空数组。只输出 JSON：{"memories":[{"kind":"user-fact","content":"…","messageId":"…","quote":"…"}]}',
    },
    { role: 'user', content: lines.join('\n') },
  ]
}

/** 校验模型给出的候选：必须引用用户本人的消息，且摘录能在原文中找到 */
export function validateExtracted(raw: unknown, msgs: Message[], existing: Memory[]): { proposals: MemoryProposal[]; dropped: number; merged: number } {
  const byId = new Map(msgs.map((m) => [m.id, m]))
  const list = (raw as { memories?: unknown[] })?.memories
  const proposals: MemoryProposal[] = []
  let dropped = 0
  let merged = 0
  const norm = (s: string) => s.replace(/\s+/g, '')
  const KINDS: MemoryKind[] = ['event', 'user-fact', 'preference', 'promise']
  for (const it of Array.isArray(list) ? list.slice(0, 20) : []) {
    const x = it as { kind?: string; content?: string; messageId?: string; quote?: string }
    const src = x?.messageId ? byId.get(x.messageId) : undefined
    const kind = KINDS.find((k) => k === x?.kind) ?? null
    if (!kind || !src || src.senderType !== 'user' || typeof x.content !== 'string' || !x.content.trim() || typeof x.quote !== 'string' || norm(x.quote).length < 2 || !norm(src.content).includes(norm(x.quote))) {
      dropped++
      continue
    }
    const content = x.content.trim().slice(0, MEMORY_BUDGET.itemChars)
    const check = memoryCheck(`${content} ${src.content}`)
    if (!check.ok || proposals.some((p) => similarity(p.content, content) >= 0.75)) {
      dropped++
      continue
    }
    const dup = findDuplicate(content, existing)
    if (dup) {
      // 已经记得这件事：这条消息只作为补充依据合并进去（内容不改）；已经是依据的就忽略
      if (!dup.sourceMessageIds.includes(src.id)) {
        proposals.push({ kind: dup.kind, content: dup.content, sourceMessageIds: [src.id], quote: x.quote.trim().slice(0, 120), origin: 'suggested', sensitive: check.sensitive, mergeInto: dup.id })
        merged++
      } else dropped++
      continue
    }
    proposals.push({ kind, content, sourceMessageIds: [src.id], quote: x.quote.trim().slice(0, 120), origin: 'suggested', sensitive: check.sensitive })
  }
  return { proposals, dropped, merged }
}

/** 召回原因（预览页面显示） */
export type RecallReason = 'pinned' | 'important' | 'recent-event' | 'topic' | 'time-cue'

export const RECALL_LABEL: Record<RecallReason, string> = {
  pinned: '固定',
  important: '非常重要',
  'recent-event': '最近的共同经历 / 约定',
  topic: '与当前话题相关',
  'time-cue': '聊到了过去的事',
}

export interface Recalled {
  memory: Memory
  reason: RecallReason
  score: number
  /** 命中的关键词（两字片段） */
  hits: string[]
}

export interface RecallOptions {
  now?: number
  /** 角色当前所在的世界：其他世界线保存的记忆不召回 */
  worldId?: string
  /** 当前关系：已确立的关系中，共同经历更容易被召回 */
  relation?: RelationshipStatus
}

/** 会被聊天使用的记忆：已确认、有内容、属于当前世界线（旧数据没有世界字段的视为通用） */
export function usableMemories(all: Memory[], worldId?: string): Memory[] {
  return all.filter((m) => m.status === 'active' && m.content.trim() && (!m.worldId || !worldId || m.worldId === worldId))
}

/** 「上次」「还记得吗」这类聊到过去的说法 */
const TIME_CUE = /(上次|那次|那天|之前|以前|还记得|记得吗|记不记得|昨天|前天|上周|上个月|去年|我们一起|咱们一起)/
const DAY = 86_400_000

/**
 * 本地检索（不需要向量数据库或 Embedding API）：
 *  1. 固定 / 非常重要的（非敏感）常驻，最多约 500 字
 *  2. 最近 3 天的共同经历和约定（非敏感，最多 2 条），保证新会话里也接得上最近发生的事
 *  3. 与当前话题相关的：关键词（相邻两字，去掉常见词）命中数 × 重要程度，加上时间相关性（越新越优先）；
 *     聊到「上次」「还记得吗」时共同经历加分；敏感记忆需要命中更多关键词
 *  4. 只说了「还记得吗」却没有具体关键词时，带上最近的两条共同经历
 *  总字数不超过约 900 字；待确认、已删除、已失效、其他世界线的记忆一律不发送。
 */
export function recallMemories(all: Memory[], recentText: string, opts: RecallOptions & { budget?: typeof MEMORY_BUDGET } = {}): Recalled[] {
  const budget = opts.budget ?? MEMORY_BUDGET
  const now = opts.now ?? Date.now()
  const pool = usableMemories(all, opts.worldId)
  const out: Recalled[] = []
  let used = 0
  const taken = new Set<string>()
  const take = (r: Recalled, cap: number) => {
    const len = Math.min(r.memory.content.length, budget.itemChars)
    if (used + len > cap || taken.has(r.memory.id)) return false
    out.push(r)
    taken.add(r.memory.id)
    used += len
    return true
  }
  const pw = (m: Memory) => 1 + 0.5 * ((m.priority ?? 1) - 1)
  const days = (m: Memory) => Math.max(0, (now - m.createdAt) / DAY)

  const always = pool
    .filter((m) => !m.sensitive && (m.pinned || (m.priority ?? 1) >= 3))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.priority ?? 1) - (a.priority ?? 1) || b.createdAt - a.createdAt)
  for (const m of always) take({ memory: m, reason: m.pinned ? 'pinned' : 'important', score: 100, hits: [] }, budget.pinnedChars)

  const want = features(recentText)
  for (const w of STOP) want.delete(w)
  const timeCue = TIME_CUE.test(recentText)
  const established = opts.relation === 'lover' || opts.relation === 'married' || opts.relation === 'friend' || opts.relation === 'ambiguous'
  const shared = (m: Memory) => m.kind === 'event' || m.kind === 'promise'

  const recentShared = pool
    .filter((m) => !taken.has(m.id) && !m.sensitive && shared(m) && days(m) <= 3)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 2)
  for (const m of recentShared) take({ memory: m, reason: 'recent-event', score: 50, hits: [] }, budget.chars)

  const scored = pool
    .filter((m) => !taken.has(m.id))
    .map((m) => {
      const f = features(m.content)
      const hits = [...want].filter((w) => f.has(w))
      const score =
        hits.length * pw(m) +
        0.5 * Math.exp(-days(m) / 30) +
        (timeCue && shared(m) ? 1 : 0) +
        (established && m.kind === 'event' ? 0.3 : 0) +
        (m.kind === 'recent' ? -0.5 : 0)
      return { memory: m, reason: 'topic' as RecallReason, score, hits }
    })
    .filter((x) => x.hits.length >= (x.memory.sensitive ? 2 : 1))
    .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
  for (const r of scored) take(r, budget.chars)

  if (timeCue && !out.some((r) => shared(r.memory) && r.reason !== 'pinned' && r.reason !== 'important')) {
    const events = pool.filter((m) => !taken.has(m.id) && !m.sensitive && m.kind === 'event').sort((a, b) => b.createdAt - a.createdAt).slice(0, 2)
    for (const m of events) take({ memory: m, reason: 'time-cue', score: 1, hits: [] }, budget.chars)
  }
  return out
}

/** 挑选本次发送的记忆（见 recallMemories） */
export function pickMemories(all: Memory[], recentText: string, budget = MEMORY_BUDGET, opts: RecallOptions = {}): Memory[] {
  return recallMemories(all, recentText, { ...opts, budget }).map((r) => r.memory)
}

export function memorySection(mems: Memory[], user: string): string {
  if (!mems.length) return ''
  const lines = mems.map((m) => `· ${KIND_LABEL[m.kind] ? `（${KIND_LABEL[m.kind]}）` : ''}${m.content.slice(0, MEMORY_BUDGET.itemChars)}`)
  return `【你记得的事】（${user}确认过的记忆，是真实的；自然地体现，不必每次提起，也不要在此之外编造你们的过去）\n${lines.join('\n')}`
}

/** 用用户配置的服务，从最近聊天中提取记忆候选（只返回校验通过的，等待用户确认） */
export async function extractWithAI(
  config: import('../../db/schema').AIConfig,
  charName: string,
  userName: string,
  msgs: Message[],
  existing: Memory[],
  opts: { signal?: AbortSignal; deviceId?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ proposals: MemoryProposal[]; dropped: number; merged: number }> {
  const { streamChat } = await import('./openai')
  const { extractJson } = await import('./organize')
  const out = await streamChat({ config: { ...config, temperature: 0.1, maxTokens: Math.max(config.maxTokens || 0, 1500) }, messages: extractPrompt(charName, userName, msgs), signal: opts.signal, deviceId: opts.deviceId, fetchImpl: opts.fetchImpl })
  let json: unknown
  try {
    json = extractJson(out)
  } catch {
    throw new Error('模型没有按要求返回结果，没有生成任何记忆。可以重试')
  }
  return validateExtracted(json, msgs, existing)
}
