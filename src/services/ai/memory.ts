/**
 * 长期记忆（纯函数）。
 *
 *  分层：角色基础人设、世界设定、与用户的固定关系 → 由人设 / 世界 / 关系模块负责（不在这里重复保存）
 *        重要共同经历（event）、用户希望角色记住的事（user-fact）、最近聊天事件（recent）→ 本模块
 *        临时上下文 → 最近的聊天记录本身，不保存
 *  原则：
 *   - 只保存用户确认过的内容；提议的记忆只来自「用户自己说的话」或「真实发生在聊天中的事」，
 *     并且必须能在用户的原话中找到依据 —— AI 自己编造的情节不会成为记忆
 *   - 每个角色的记忆独立（characterId），不会串到其他角色
 *   - 身份证号、银行卡号等不保存；健康、财务等敏感内容标记为敏感，只在话题相关时才发送
 *   - 发送时：固定 / 重要的优先，其余按与当前话题的相关程度挑选，限制总字数，避免每次发送全部
 */
import type { Memory, MemoryKind, Message } from '../../db/schema'
import { features } from './profile'

export const MEMORY_BUDGET = {
  /** 每次发送的记忆总字数上限 */
  chars: 900,
  /** 固定 / 非常重要的记忆最多占用的字数 */
  pinnedChars: 500,
  itemChars: 200,
}

export const KIND_LABEL: Partial<Record<MemoryKind, string>> = {
  'user-fact': '要记住的事',
  event: '共同经历',
  recent: '最近的事',
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

/** 两段文字的相似程度（0～1，按相邻两字特征） */
export function similarity(a: string, b: string): number {
  const fa = features(a)
  const fb = features(b)
  if (!fa.size || !fb.size) return a.trim() === b.trim() ? 1 : 0
  let inter = 0
  for (const x of fa) if (fb.has(x)) inter++
  return inter / Math.min(fa.size, fb.size)
}

/** 找出与新内容重复的已有记忆（同一角色内） */
export function findDuplicate(content: string, existing: Memory[], threshold = 0.75): Memory | undefined {
  return existing.filter((m) => m.status !== 'invalidated').find((m) => similarity(content, m.content) >= threshold)
}

/** 「记住 / 别忘了 / 记得」：用户明确要求角色记住的话 */
const REMEMBER = /(记住|记好|别忘了|不要忘了|不要忘记|千万记得|你要记得|帮我记|记一下)/

export interface MemoryProposal {
  kind: MemoryKind
  content: string
  sourceMessageIds: string[]
  quote: string
  origin: 'user-request' | 'suggested'
  sensitive: boolean
}

/** 从用户的消息中找出「请记住……」，原样作为提议（不改写、不推断） */
export function proposeFromRequests(history: Message[], existing: Memory[]): MemoryProposal[] {
  const out: MemoryProposal[] = []
  const handled = new Set(existing.flatMap((m) => m.sourceMessageIds))
  for (const m of history) {
    if (m.senderType !== 'user' || m.deleted || m.kind !== 'text' || handled.has(m.id)) continue
    const t = m.content.trim()
    if (!REMEMBER.test(t) || t.length < 4) continue
    const content = t.replace(/^(你)?(要|得|一定要)?(记住|记好|记一下|帮我记(一下)?)[，,：:\s]*/, '').slice(0, MEMORY_BUDGET.itemChars) || t
    const check = memoryCheck(content)
    if (!check.ok) continue
    if (findDuplicate(content, existing) || out.some((p) => similarity(p.content, content) >= 0.75)) continue
    out.push({ kind: 'user-fact', content, sourceMessageIds: [m.id], quote: t.slice(0, 120), origin: 'user-request', sensitive: check.sensitive })
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
        '4. kind 只能是 user-fact（关于对方的事实或偏好）或 event（两人真实经历或约定的事）。\n' +
        '5. 没有值得记住的就返回空数组。只输出 JSON：{"memories":[{"kind":"user-fact","content":"…","messageId":"…","quote":"…"}]}',
    },
    { role: 'user', content: lines.join('\n') },
  ]
}

/** 校验模型给出的候选：必须引用用户本人的消息，且摘录能在原文中找到 */
export function validateExtracted(raw: unknown, msgs: Message[], existing: Memory[]): { proposals: MemoryProposal[]; dropped: number } {
  const byId = new Map(msgs.map((m) => [m.id, m]))
  const list = (raw as { memories?: unknown[] })?.memories
  const proposals: MemoryProposal[] = []
  let dropped = 0
  const norm = (s: string) => s.replace(/\s+/g, '')
  for (const it of Array.isArray(list) ? list.slice(0, 20) : []) {
    const x = it as { kind?: string; content?: string; messageId?: string; quote?: string }
    const src = x?.messageId ? byId.get(x.messageId) : undefined
    const kind = x?.kind === 'event' ? 'event' : x?.kind === 'user-fact' ? 'user-fact' : null
    if (!kind || !src || src.senderType !== 'user' || typeof x.content !== 'string' || !x.content.trim() || typeof x.quote !== 'string' || norm(x.quote).length < 2 || !norm(src.content).includes(norm(x.quote))) {
      dropped++
      continue
    }
    const content = x.content.trim().slice(0, MEMORY_BUDGET.itemChars)
    const check = memoryCheck(`${content} ${src.content}`)
    if (!check.ok || findDuplicate(content, existing) || proposals.some((p) => similarity(p.content, content) >= 0.75)) {
      dropped++
      continue
    }
    proposals.push({ kind, content, sourceMessageIds: [src.id], quote: x.quote.trim().slice(0, 120), origin: 'suggested', sensitive: check.sensitive })
  }
  return { proposals, dropped }
}

/**
 * 挑选本次发送的记忆：固定 / 非常重要的（非敏感）优先常驻；其余按与最近聊天的相关程度挑选。
 * 敏感记忆只在话题相关时发送。
 */
export function pickMemories(all: Memory[], recentText: string, budget = MEMORY_BUDGET): Memory[] {
  const active = all.filter((m) => m.status === 'active' && m.content.trim())
  const out: Memory[] = []
  let used = 0
  const take = (m: Memory, cap: number) => {
    const len = Math.min(m.content.length, budget.itemChars)
    if (used + len > cap || out.includes(m)) return
    out.push(m)
    used += len
  }
  const always = active
    .filter((m) => !m.sensitive && (m.pinned || (m.priority ?? 1) >= 3))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.priority ?? 1) - (a.priority ?? 1) || b.createdAt - a.createdAt)
  for (const m of always) take(m, budget.pinnedChars)
  const want = features(recentText)
  const scored = active
    .filter((m) => !out.includes(m))
    .map((m) => {
      const f = features(m.content)
      let hit = 0
      for (const w of want) if (f.has(w)) hit++
      return { m, score: hit * (m.priority ?? 1) + (m.kind === 'recent' ? -0.5 : 0) }
    })
    .filter((x) => x.score >= (x.m.sensitive ? 2 : 1))
    .sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt)
  for (const { m } of scored) take(m, budget.chars)
  return out
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
): Promise<{ proposals: MemoryProposal[]; dropped: number }> {
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
