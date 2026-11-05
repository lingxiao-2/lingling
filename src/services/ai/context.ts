/**
 * 构建发送给模型的上下文（纯函数，便于测试）。
 * 数据边界：
 *  - 只使用当前角色自己的人设、所在世界、关联的世界书，以及本会话的聊天记录
 *  - 已删除、被重新生成替换（superseded）的消息不进入上下文
 *  - 示例对话只作为语气参考，明确告知模型它不是真实发生过的对话
 */
import type { Character, Lorebook, LoreEntry, Message, Sticker, World } from '../../db/schema'
import type { ChatTurn } from './provider'
import { renderAssistantTurn, type ReplyPart } from './messageFormat'
import { formatSection, stickerFrequency, styleSection, type StickerOption } from './style'
import { layerProfile, pickRelated } from './profile'

/** 一次最多向模型提供多少个表情包（控制 Token） */
export const MAX_OFFERED_STICKERS = 24

export interface ContextBudget {
  /** 聊天历史的最大字数（从最新往前取） */
  historyChars: number
  /** 世界书条目的最大字数 */
  loreChars: number
  /** 世界设定的最大字数 */
  worldChars: number
  /** 用于触发世界书关键词的最近消息条数 */
  scanDepth: number
}

export const DEFAULT_BUDGET: ContextBudget = { historyChars: 6000, loreChars: 3000, worldChars: 2000, scanDepth: 6 }

export interface ContextInput {
  character: Character
  userName: string
  world?: World | null
  /** 角色关联的世界书 + 所在世界关联的世界书（调用方去重） */
  lorebooks: Lorebook[]
  /** 本会话全部消息（按时间升序） */
  history: Message[]
  /** 用户的表情包收藏（用于提供给 AI 选择，以及把历史中的表情包写进上下文） */
  stickers?: Sticker[]
  budget?: Partial<ContextBudget>
}

export interface BuiltContext {
  messages: ChatTurn[]
  /** 实际注入的世界书条目名称（用于界面提示与调试） */
  usedEntries: string[]
  /** 本次附带的扩展人设资料段数（长篇人设） */
  relatedProfileChunks: number
  historyCount: number
  /** 本次允许 AI 使用的表情包：短编号 → 真实 ID（解析回复时据此校验） */
  stickerMap: Map<string, string>
}

/** 可以提供给 AI 的表情包：有含义描述、允许 AI 使用；常用的优先 */
export function offeredStickers(stickers: Sticker[]): { options: StickerOption[]; map: Map<string, string> } {
  const usable = stickers
    .filter((s) => s.aiUsable && s.name.trim())
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.createdAt - a.createdAt)
    .slice(0, MAX_OFFERED_STICKERS)
  const map = new Map<string, string>()
  const options = usable.map((s, i) => {
    const alias = `k${i + 1}`
    map.set(alias, s.id)
    return { alias, name: s.name.trim().slice(0, 20) }
  })
  return { options, map }
}

function macros(text: string, char: string, user: string): string {
  return text.replace(/\{\{\s*char\s*\}\}/gi, char).replace(/\{\{\s*user\s*\}\}/gi, user).replace(/<USER>/g, user).replace(/<BOT>/g, char)
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 当前有效的消息：未删除、未被替换、不是系统消息 */
export function activeMessages(history: Message[]): Message[] {
  return history.filter((m) => !m.deleted && !m.superseded && m.senderType !== 'system' && m.content.trim())
}

/** 根据最近消息触发世界书条目：常驻条目始终加入，其余需命中关键词（不区分大小写） */
export function triggeredEntries(books: Lorebook[], recentText: string, maxChars: number): LoreEntry[] {
  const scan = recentText.toLowerCase()
  const seen = new Set<string>()
  const constant: LoreEntry[] = []
  const hit: LoreEntry[] = []
  for (const b of books) {
    for (const e of b.entries) {
      if (!e.enabled || !e.content.trim() || seen.has(e.id)) continue
      if (e.constant) {
        seen.add(e.id)
        constant.push(e)
      } else if (e.keys.some((k) => k.trim() && scan.includes(k.trim().toLowerCase()))) {
        seen.add(e.id)
        hit.push(e)
      }
    }
  }
  const out: LoreEntry[] = []
  let used = 0
  for (const e of [...constant, ...hit]) {
    if (used + e.content.length > maxChars && out.length > 0) break
    out.push(e)
    used += e.content.length
  }
  return out
}

export function buildContext(input: ContextInput): BuiltContext {
  const budget = { ...DEFAULT_BUDGET, ...(input.budget ?? {}) }
  const c = input.character
  const name = c.name
  const user = input.userName || '你'
  const m = (t: string | undefined) => macros((t ?? '').trim(), name, user)

  const active = activeMessages(input.history)
  const recent = active.slice(-budget.scanDepth).map((x) => x.content).join('\n')
  const entries = triggeredEntries(input.lorebooks, recent, budget.loreChars)

  const parts: string[] = [
    `你是「${name}」，正在一款聊天软件里和「${user}」聊天。请以${name}的身份、用第一人称自然地回复，不要替${user}说话或描写${user}的行为。` +
      `平时不必主动谈论技术细节；但如果${user}认真地问你是不是真人，要诚实说明你是 AI 扮演的角色。不要刻意让${user}依赖你，也不要劝${user}疏远现实中的人。`,
  ]
  // 长篇人设分层：核心设定每次发送；超出预算的部分按与最近聊天的相关程度挑选（见 profile.ts）
  const layered = layerProfile(c)
  const related = pickRelated(layered.pool, recent)
  const field = (label: string, v: string) => v && parts.push(`【${label}】\n${v}`)
  field('角色简介', m(layered.core.bio))
  field('性格', m(layered.core.personality))
  field('说话风格', m(layered.core.speakingStyle))
  field('背景故事', m(layered.core.backstory))
  field(`与${user}的关系`, m(layered.core.relationToUser))
  for (const e of layered.coreExtras) field(e.label, m(e.text))
  if (related.length) {
    parts.push(`【与当前话题相关的角色资料】（节选，供参考）\n${related.map((r) => `· ${r.label}：${m(r.text)}`).join('\n')}`)
  }
  if (input.world) {
    const w = input.world
    const body = [w.tagline, w.description].filter((x) => x && x.trim()).join('\n')
    parts.push(`【所在世界：${w.name}】${body ? `\n${clip(m(body), budget.worldChars)}` : ''}`)
  }
  if (entries.length) {
    parts.push(`【相关设定】\n${entries.map((e) => `· ${e.name}：${m(e.content)}`).join('\n')}`)
  }
  if (c.exampleDialogue?.trim()) {
    parts.push(`【说话示例】（仅用于参考语气，不是你们真实发生过的对话，不要当作记忆）\n${clip(m(c.exampleDialogue), 1500)}`)
  }
  const exchanges = active.filter((x) => x.senderType === 'user').length
  parts.push(styleSection(c, exchanges, user))
  const freq = stickerFrequency(c)
  const offered = freq === 'never' ? { options: [], map: new Map<string, string>() } : offeredStickers(input.stickers ?? [])
  parts.push(formatSection(freq, offered.options))
  parts.push('只依据以上设定和下面真实发生过的聊天内容回应，不要编造你们没有共同经历过的事情；不确定时可以自然地询问。')
  const stickerName = new Map((input.stickers ?? []).map((st) => [st.id, st.name.trim()]))
  const aliasOf = new Map([...offered.map].map(([a, id]) => [id, a]))

  // 聊天历史：从最新往前，直到超出字数预算（至少保留最后一条）
  const picked: Message[] = []
  let used = 0
  for (let i = active.length - 1; i >= 0; i--) {
    const len = active[i].content.length
    if (picked.length > 0 && used + len > budget.historyChars) break
    picked.unshift(active[i])
    used += len
  }

  // 相邻的同一方消息合并为一轮：用户的多条用空行分隔；角色的多条按消息格式写回，帮助模型保持格式
  const turns: { role: 'user' | 'assistant'; items: Message[] }[] = []
  for (const msg of picked) {
    const role = msg.senderType === 'user' ? 'user' : 'assistant'
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.items.push(msg)
    else turns.push({ role, items: [msg] })
  }
  const chat: ChatTurn[] = turns
    .map((t): ChatTurn => {
      if (t.role === 'user') {
        const content = t.items
          .map((x) => (x.kind === 'sticker' ? `[发来一个表情包${stickerName.get(x.stickerId ?? '') ? `：${stickerName.get(x.stickerId ?? '')}` : ''}]` : x.content))
          .join('\n\n')
        return { role: 'user', content }
      }
      const items: ReplyPart[] = t.items.map((x) =>
        x.kind === 'sticker' && x.stickerId ? { type: 'sticker', stickerId: x.stickerId } : { type: 'text', text: x.content },
      )
      return { role: 'assistant', content: renderAssistantTurn(items, (id) => aliasOf.get(id)) }
    })
    .filter((t) => t.content.trim())
    // 去掉空的一轮后，可能出现相邻同一方，再合并一次
    .reduce<ChatTurn[]>((acc, t) => {
      const prev = acc[acc.length - 1]
      if (prev && prev.role === t.role) prev.content += t.role === 'user' ? `\n\n${t.content}` : `\n${t.content}`
      else acc.push({ ...t })
      return acc
    }, [])

  return {
    messages: [{ role: 'system', content: parts.join('\n\n') }, ...chat],
    usedEntries: entries.map((e) => e.name),
    relatedProfileChunks: related.length,
    historyCount: picked.length,
    stickerMap: offered.map,
  }
}

/** 把模型输出拆成 1～4 条消息；去掉模型偶尔加上的「名字：」前缀 */
export function splitReply(text: string, charName: string, max = 4): string[] {
  const prefix = new RegExp(`^\\s*(?:${charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*[:：]\\s*`)
  const parts = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => p.replace(prefix, '').trim())
    .filter(Boolean)
  if (parts.length <= max) return parts
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join('\n')]
}
