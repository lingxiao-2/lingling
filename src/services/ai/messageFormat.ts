/**
 * 自然多消息回复的结构化格式（纯函数，便于测试）。
 *
 * 模型在一次调用里输出一组消息：
 *   <msg>第一条</msg>
 *   <msg>第二条</msg>
 *   <sticker id="k2"/>
 *
 * 为什么不用 JSON：
 *  - 流式输出时可以逐段解析，已经写完的一条马上就能显示，不会出现半截 JSON；
 *  - 不需要转义引号和换行，长回答（代码、列表）也不容易格式出错；
 *  - 不依赖 response_format / JSON 模式，兼容更多 OpenAI 格式的服务商；
 *  - 比 JSON 少一些 Token。
 * 模型完全没有按格式输出时，回退为一条普通文字消息。
 */

export type ReplyPart = { type: 'text'; text: string } | { type: 'sticker'; stickerId: string }

export interface ParsedReply {
  /** 已经完整的消息（流式过程中只包含已结束的部分；结束后包含全部）。未做条数限制，见 capParts */
  parts: ReplyPart[]
  /** 正在生成、尚未结束的那条文字（已去掉标记），用于界面显示 */
  current: string
  /** tagged：按格式输出；plain：普通文字（回退）；pending：还看不出来 */
  mode: 'tagged' | 'plain' | 'pending'
  /** 被丢弃的表情包编号（不在可用列表中——模型编造的或已失效的） */
  rejectedStickers: string[]
}

export const MAX_PARTS = 5

const TOKEN = /<\s*(\/?)\s*msg\s*>|<\s*sticker\b[^>]*?\bid\s*=\s*["']?([\w-]+)["']?[^>]*?\/?\s*>/gi
const ANY_TAG = /<\s*\/?\s*(?:msg|sticker)\b/i

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 清理一条文字：去掉「名字：」前缀、零散的标记和多余空行 */
export function cleanText(text: string, charName = ''): string {
  let t = text.replace(/\r\n/g, '\n')
  t = t.replace(/<\s*\/?\s*(?:msg|sticker)\b[^>]*>/gi, '')
  if (charName) t = t.replace(new RegExp(`^\\s*${escapeRe(charName)}\\s*[:：]\\s*`), '')
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

/** 去掉流式结尾处还没写完的标记，例如「<ms」「</m」「<sticker id="k」 */
function stripDanglingTag(text: string): string {
  return text.replace(/<[^<>]{0,40}$/, '')
}

/**
 * 解析模型输出。
 * @param raw 到目前为止收到的全部文字
 * @param allowedStickers 本次允许使用的表情包：编号 → 真实 ID
 * @param final 是否已经结束（结束时，未闭合的最后一条也算完整）
 */
export function parseReply(raw: string, allowedStickers: Map<string, string>, final: boolean, charName = ''): ParsedReply {
  const rejected: string[] = []
  const text = raw.replace(/\r\n/g, '\n')
  const trimmed = text.trimStart()

  if (!ANY_TAG.test(text)) {
    // 还没有出现任何标记：开头是 "<" 时可能正在写标记，暂时不显示
    if (!final && (trimmed === '' || (trimmed.startsWith('<') && trimmed.length < 12))) {
      return { parts: [], current: '', mode: 'pending', rejectedStickers: rejected }
    }
    const t = cleanText(final ? text : stripDanglingTag(text), charName)
    if (final) return { parts: t ? [{ type: 'text', text: t }] : [], current: '', mode: 'plain', rejectedStickers: rejected }
    return { parts: [], current: t, mode: trimmed.startsWith('<') ? 'pending' : 'plain', rejectedStickers: rejected }
  }

  const parts: ReplyPart[] = []
  let open = false
  let buf = ''
  let last = 0
  const pushText = (t: string) => {
    const c = cleanText(t, charName)
    if (c) parts.push({ type: 'text', text: c })
  }
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    const between = text.slice(last, m.index)
    last = TOKEN.lastIndex
    if (m[2] !== undefined) {
      // 表情包：先结束当前文字
      pushText(buf + between)
      buf = ''
      open = false
      const id = allowedStickers.get(m[2])
      if (id) parts.push({ type: 'sticker', stickerId: id })
      else rejected.push(m[2])
    } else if (m[1] === '/') {
      pushText(buf + between)
      buf = ''
      open = false
    } else {
      // 新的 <msg>：标记外的零散文字（模型偶尔漏写标记）也当作一条消息
      pushText(buf + between)
      buf = ''
      open = true
    }
  }
  const tail = text.slice(last)
  let current = ''
  if (final) {
    pushText(buf + tail)
  } else if (open || tail.trim()) {
    current = cleanText(stripDanglingTag(buf + tail), charName)
  }
  return { parts, current, mode: 'tagged', rejectedStickers: rejected }
}

/**
 * 最多 5 条：第 5 条及之后的内容合并为一条（文字优先；只有表情包时保留第一个）。
 * 前 4 条在流式过程中可能已经显示，所以合并只发生在第 5 条之后，不会改动已显示的消息。
 */
export function capParts(parts: ReplyPart[], max = MAX_PARTS): ReplyPart[] {
  if (parts.length <= max) return parts
  const head = parts.slice(0, max - 1)
  const tail = parts.slice(max - 1)
  const texts = tail.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
  return [...head, texts.length ? { type: 'text', text: texts.map((t) => t.text).join('\n') } : tail[0]]
}

/** 把一组历史消息写回同样的格式，作为上下文中角色的发言（让模型保持格式） */
export function renderAssistantTurn(parts: ReplyPart[], aliasOf: (stickerId: string) => string | undefined): string {
  return parts
    .map((p) => {
      if (p.type === 'text') return `<msg>${p.text}</msg>`
      const alias = aliasOf(p.stickerId)
      return alias ? `<sticker id="${alias}"/>` : ''
    })
    .filter(Boolean)
    .join('\n')
}
