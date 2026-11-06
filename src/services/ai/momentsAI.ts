/**
 * 角色在朋友圈里的发言（纯函数：提示词与结果解析；调用模型见 momentEngine.ts）。
 *
 *  - 角色只依据自己的人设、与用户的关系、用户确认过的记忆、和自己与用户的真实聊天发言，不读取其他角色的任何内容
 *  - 不得编造与用户没有真实发生过的共同经历；角色不能发图片，也看不到用户的配图（没有识图时如实说明，不描述画面）
 *  - 用户的「仅自己可见」动态不会交给任何角色；部分可见的只交给选中的角色
 */
import type { Character, Memory, Message, Moment, MomentComment } from '../../db/schema'
import { layerProfile } from './profile'
import { effectiveRelationship, relationshipSection } from './relationship'
import { memorySection, pickMemories } from './memory'
import { sameActor, visibleComments } from '../moments'

export const MOMENT_AI_LIMITS = {
  /** 角色动态正文最多字数 */
  post: 300,
  /** 角色评论 / 回复最多字数 */
  comment: 120,
  /** 作为参考的最近聊天条数 */
  recentChat: 12,
}

export interface MomentPersonaInput {
  character: Character
  userName: string
  memories?: Memory[]
  /** 这个角色与用户的单聊记录（按时间升序）；只用最近几条作为「真实发生过的事」的参考 */
  chat?: Message[]
}

/** 角色的身份说明：人设核心字段 + 关系 + 相关记忆 + 最近聊天（都属于这个角色自己） */
export function personaBlock({ character: c, userName, memories = [], chat = [] }: MomentPersonaInput, topic = ''): string {
  const core = layerProfile(c).core
  const user = userName || '你'
  const sub = (t: string) => t.replace(/\{\{\s*char\s*\}\}/gi, c.name).replace(/\{\{\s*user\s*\}\}/gi, user)
  const parts: string[] = []
  const field = (label: string, v: string) => v.trim() && parts.push(`【${label}】\n${sub(v.trim())}`)
  field('角色简介', core.bio)
  field('性格', core.personality)
  field('说话风格', core.speakingStyle)
  field('背景故事', core.backstory)
  field(`与${user}的关系`, core.relationToUser)
  const rel = relationshipSection(effectiveRelationship(c), user)
  if (rel) parts.push(sub(rel))
  const recent = chat.filter((m) => !m.deleted && !m.superseded && m.kind === 'text' && m.senderType !== 'system' && m.content.trim()).slice(-MOMENT_AI_LIMITS.recentChat)
  const mem = memorySection(pickMemories(memories.filter((m) => m.characterId === c.id), `${topic}\n${recent.map((m) => m.content).join('\n')}`, undefined, { worldId: c.worldId, relation: effectiveRelationship(c).status }), user)
  if (mem) parts.push(mem)
  if (recent.length) {
    parts.push(
      `【你和${user}最近的聊天】（真实发生过，仅供参考；不要原样复述，不要把私聊里的细节公开说出来）\n` +
        recent.map((m) => `${m.senderType === 'user' ? user : c.name}：${m.content.trim().slice(0, 120)}`).join('\n'),
    )
  }
  return parts.join('\n\n')
}

const HONEST = (user: string) =>
  `只依据上面的设定、记忆和真实聊天，不要编造你和${user}没有真实发生过的共同经历、约定或细节。你不能发图片，也不要假装配了图。`

/** 让角色发一条朋友圈 */
export function postPrompt(input: MomentPersonaInput, now = new Date()): { role: 'system' | 'user'; content: string }[] {
  const { character: c, userName } = input
  const user = userName || '你'
  const time = `${now.getMonth() + 1}月${now.getDate()}日 ${['凌晨', '早上', '上午', '中午', '下午', '傍晚', '晚上', '深夜'][Math.floor(((now.getHours() + 2) % 24) / 3)]}`
  return [
    {
      role: 'system',
      content:
        `你是「${c.name}」。现在你要在朋友圈发一条动态，${user}和你的其他朋友都能看到。\n\n${personaBlock(input)}\n\n` +
        `【要求】\n· 用${c.name}的口吻写，符合你的性格和说话风格；1～3 句，像真人发朋友圈那样自然，可以是日常、心情、看到的东西或你在做的事。\n` +
        `· ${HONEST(user)}\n· 不要写旁白、括号动作、话题标签堆砌、引号或「${c.name}：」前缀。\n· 只输出动态正文本身。`,
    },
    { role: 'user', content: `现在是${time}。发一条动态吧。` },
  ]
}

/** 用户动态在提示词里的写法：配图如实说明看不到内容 */
export function describeMoment(m: Moment, authorName: string): string {
  const pics = m.imageRefs.length ? `\n（配了 ${m.imageRefs.length} 张图片。你看不到图片内容，不要描述或猜测图片里有什么）` : ''
  return `${authorName}发了一条动态：${m.content.trim() ? `「${m.content.trim().slice(0, 600)}」` : '（只有图片，没有文字）'}${pics}`
}

/** 只保留用户与这个角色之间的评论（角色之间互相看不到） */
export function threadFor(m: Moment, characterId: string): MomentComment[] {
  return visibleComments(m).filter((c) => (c.author.type === 'user' || c.author.id === characterId) && (!c.replyTo || c.replyTo.type === 'user' || c.replyTo.id === characterId))
}

function renderThread(m: Moment, c: Character, user: string): string {
  const t = threadFor(m, c.id)
  if (!t.length) return ''
  const name = (a: MomentComment['author']) => (a.type === 'user' ? user : c.name)
  return `\n评论区（只显示你和${user}的评论）：\n${t.map((x) => `${name(x.author)}${x.replyTo ? ` 回复 ${name(x.replyTo)}` : ''}：${x.content}`).join('\n')}`
}

/** 角色看到用户的动态后：决定是否点赞，以及是否评论 */
export function reactPrompt(input: MomentPersonaInput, m: Moment): { role: 'system' | 'user'; content: string }[] {
  const { character: c, userName } = input
  const user = userName || '你'
  return [
    {
      role: 'system',
      content:
        `你是「${c.name}」。你在朋友圈看到了${user}的动态。\n\n${personaBlock(input, m.content)}\n\n` +
        `【要求】\n· 按你的性格和你们的关系决定：要不要点赞，要不要评论。不是每条都要评论，评论也要短（一句话，像朋友圈评论）。\n` +
        `· ${HONEST(user)}\n· 只输出 JSON：{"like": true 或 false, "comment": "评论内容，不评论就写空字符串"}`,
    },
    { role: 'user', content: describeMoment(m, user) + renderThread(m, c, user) },
  ]
}

/** 用户在评论区跟角色说话后，角色回复一句 */
export function replyPrompt(input: MomentPersonaInput, m: Moment, authorName: string): { role: 'system' | 'user'; content: string }[] {
  const { character: c, userName } = input
  const user = userName || '你'
  return [
    {
      role: 'system',
      content:
        `你是「${c.name}」。${user}在朋友圈的评论区和你说话，请回复一句。\n\n${personaBlock(input, m.content)}\n\n` +
        `【要求】\n· 像朋友圈评论那样简短自然，一句话，符合你的性格。\n· ${HONEST(user)}\n· 只输出回复内容本身，不要「${c.name}：」前缀或引号。`,
    },
    { role: 'user', content: describeMoment(m, authorName) + renderThread(m, c, user) },
  ]
}

/** 清理模型输出的一段文字：去掉标记、名字前缀、成对引号；限制长度 */
export function cleanLine(raw: string, charName: string, max: number): string {
  let t = raw.replace(/\r\n/g, '\n').replace(/<\s*\/?\s*(?:msg|sticker)\b[^>]*>/gi, '').trim()
  const esc = charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  t = t.replace(new RegExp(`^\\s*${esc}\\s*[:：]\\s*`), '')
  t = t.replace(/^[「“"']+|[」”"']+$/g, '').trim()
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 解析点赞 / 评论结果；格式不对时抛出错误（不会随便点赞或编一条评论） */
export function parseReaction(raw: string, charName: string): { like: boolean; comment: string } {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('模型没有按要求返回结果')
  let j: unknown
  try {
    j = JSON.parse(m[0])
  } catch {
    throw new Error('模型没有按要求返回结果')
  }
  const o = j as { like?: unknown; comment?: unknown }
  return { like: o.like === true, comment: typeof o.comment === 'string' ? cleanLine(o.comment, charName, MOMENT_AI_LIMITS.comment) : '' }
}

/** 用户的这条评论，应该由哪个角色来回复（没有就返回 null） */
export function replyTarget(m: Moment, c: MomentComment): string | null {
  if (c.author.type !== 'user') return null
  if (c.replyTo?.type === 'character') return c.replyTo.id
  // 在角色自己的动态下评论（没有指定回复谁）：由作者回复
  if (m.authorType === 'character' && (!c.replyTo || sameActor(c.replyTo, { type: 'character', id: m.authorId }))) return m.authorId
  return null
}
