/**
 * 角色的聊天表达偏好 → 提示词片段（纯函数）。
 * 这些设置只影响「怎么说」：话量、语气、表情包频率、语言特点、亲疏。
 * 角色卡里的人设永远优先，两者冲突时以人设为准；未设置的项目不写入提示词，避免所有角色都套同一个模板。
 */
import type { Character, ChatStyle } from '../../db/schema'

export const VERBOSITY_LABEL: Record<NonNullable<ChatStyle['verbosity']>, string> = { low: '少', medium: '适中', high: '多' }
export const TONE_LABEL: Record<Exclude<NonNullable<ChatStyle['tone']>, ''>, string> = {
  concise: '简洁',
  lively: '活泼',
  gentle: '温柔',
  cool: '冷淡',
  playful: '幽默',
}
export const STICKER_LABEL: Record<NonNullable<ChatStyle['stickers']>, string> = { never: '从不', sometimes: '偶尔', often: '经常' }
export const CLOSENESS_LABEL: Record<NonNullable<ChatStyle['closeness']>, string> = { auto: '自动', distant: '初识', friendly: '熟悉', close: '亲密' }

const VERBOSITY: Record<NonNullable<ChatStyle['verbosity']>, string> = {
  low: '话少：多数时候只回 1～2 条，每条很短，不主动展开。',
  medium: '',
  high: '话多：常常一口气连发好几条，愿意分享细节和自己的想法。',
}

const TONE: Record<Exclude<NonNullable<ChatStyle['tone']>, ''>, string> = {
  concise: '简洁：直接说重点，少用寒暄和语气词。',
  lively: '活泼：语气轻快，语气词、感叹和小表情可以多一些。',
  gentle: '温柔：语气柔和体贴，先接住对方的情绪再说别的。',
  cool: '冷淡：回复克制、简短，不主动热络，但不失礼。',
  playful: '幽默：爱开玩笑、接梗，但对方认真时会收起玩笑。',
}

/** 角色设置的表情包频率；旧角色没有该字段时，沿用「允许使用表情包」权限（默认偶尔） */
export function stickerFrequency(c: Pick<Character, 'chatStyle' | 'permissions'>): NonNullable<ChatStyle['stickers']> {
  if (c.chatStyle?.stickers) return c.chatStyle.stickers
  return c.permissions?.useStickers === false ? 'never' : 'sometimes'
}

/**
 * 亲疏：auto 时结合人设中的关系与实际聊过的轮数，给模型一个尺度而不是固定模板。
 * @param exchanges 本会话中用户发言的轮数
 */
export function closenessHint(style: ChatStyle | undefined, exchanges: number, userName: string): string {
  const c = style?.closeness ?? 'auto'
  if (c === 'distant') return `亲疏：你们还不太熟，保持礼貌和分寸，不要过分亲昵。`
  if (c === 'friendly') return `亲疏：你们已经是熟悉的朋友，可以随意自然一些。`
  if (c === 'close') return `亲疏：你们关系亲密，说话可以更放松、更有默契。`
  const stage = exchanges < 6 ? '刚开始聊，还在互相了解' : exchanges < 60 ? '已经聊过一些，彼此有了一定了解' : '已经聊了很久，相当熟悉'
  return `亲疏：以角色设定里与${userName}的关系为准；从实际聊天看，你们${stage}，语气的亲近程度要与此相符，不要突然过分亲昵。`
}

export function styleSection(c: Pick<Character, 'chatStyle' | 'permissions'>, exchanges: number, userName: string): string {
  const s = c.chatStyle ?? {}
  const lines: string[] = []
  if (s.verbosity && VERBOSITY[s.verbosity]) lines.push(VERBOSITY[s.verbosity])
  if (s.tone) lines.push(TONE[s.tone])
  if (s.quirks?.trim()) lines.push(`语言特点：${s.quirks.trim().slice(0, 300)}`)
  lines.push(closenessHint(s, exchanges, userName))
  return `【表达偏好】（只影响说话方式；与上面的人设冲突时，以人设为准）\n${lines.map((l) => `· ${l}`).join('\n')}`
}

export interface StickerOption {
  /** 本次请求内的短编号，例如 k1 */
  alias: string
  name: string
}

/** 消息格式说明；stickers 为空时不提表情包，节省 Token */
export function formatSection(freq: NonNullable<ChatStyle['stickers']>, stickers: StickerOption[]): string {
  const lines = [
    '【消息格式】你的回复会显示成一条条聊天气泡。每条消息写成 <msg>内容</msg>，按发送顺序排列，一次 1～5 条；标记以外不要写任何文字。',
    '· 条数和长短由情境决定：日常寒暄、回应情绪时像手机聊天一样简短自然，可以分几条，也可以只回一条；对方认真提问（学习、工作、健康、专业问题）时，优先把问题讲清楚，用 1～2 条完整回答，可以较长。',
    '· 不要每次都发一样多的条数，不要为了凑条数把一句话拆开，也不要套用固定的安慰模板或说教。',
    '· 不要写旁白、括号里的动作描写或 Markdown 标题。',
  ]
  if (freq !== 'never' && stickers.length) {
    lines.push(
      `· 表情包：单独一条写 <sticker id="编号"/>，只能使用下面列表中的编号，不能编造；${
        freq === 'often' ? '可以比较常发，但一次最多一个，并且要贴合情境' : '偶尔在合适的时候发，大多数回复不需要'
      }。`,
      `可用表情包：${stickers.map((s) => `${s.alias}=${s.name}`).join('；')}`,
    )
  }
  return lines.join('\n')
}
