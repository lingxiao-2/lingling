/**
 * 角色来信：真实调用已配置的模型，以角色的人设、语气、关系、世界、长期记忆写信。
 *  - 只在你点「邀请 TA 写信」或「请 TA 回信」时调用
 *  - 只带上这个角色与你之间的往来信件（不读取其他角色的信）
 *  - 模型失败或内容不合格时报错，不保存任何信件，也不使用预设的信件冒充
 */
import { useSyncExternalStore } from 'react'
import { db, DEFAULT_PROFILE } from '../db/db'
import type { Character, Letter, PaperId, UserProfile } from '../db/schema'
import { correspondence, receiveLetter } from '../db/letterRepo'
import { composeWithCharacter } from '../services/ai/compose'
import { AIError } from '../services/ai/openai'

export interface LetterJob { characterId: string; kind: 'invite' | 'reply'; startedAt: number; error?: string; doneId?: string }
const jobs = new Map<string, LetterJob>()
const aborts = new Map<string, AbortController>()
const listeners = new Set<() => void>()
let snapshot: LetterJob[] = []
const emit = () => {
  snapshot = [...jobs.values()]
  for (const l of listeners) l()
}
export function useLetterJobs(): LetterJob[] {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), () => snapshot)
}
export function cancelLetter(characterId: string) {
  aborts.get(characterId)?.abort()
}
export function dismissJob(characterId: string) {
  jobs.delete(characterId)
  emit()
}

export function letterIntro(name: string, user: string) {
  return `你是「${name}」。现在你要以${name}本人的身份，亲笔给「${user}」写一封信（不是聊天消息）。`
}

export function letterOutro(name: string, user: string) {
  return [
    `【写信要求】`,
    `1. 完全用${name}自己的性格、语气和用词来写：内敛的人写得克制含蓄，活泼的人写得轻快直接，冷静的人不要突然甜腻。不要套用统一的甜宠模板或网络情书句式。`,
    `2. 只把设定、长期记忆和最近聊天里真实存在的事当作你们的共同经历；不要编造没有发生过的约会、旅行或回忆。想象和期待可以写，但要写明是想象或期待。`,
    `3. 符合你们现在的关系和所在的世界设定；不要替${user}做决定或描写${user}的行为。`,
    `4. 长度约 200～600 字。第一行写「标题：……」（不超过 15 个字），空一行后写正文；正文以你对${user}的称呼开头，以你的落款结尾。`,
    `5. 只输出这封信，不要任何解释、格式标记或 <msg> 标签。`,
  ].join('\n')
}

/** 解析模型输出：第一行「标题：」；去掉误加的标签；太短的视为失败 */
export function parseLetter(raw: string, fallbackSubject: string): { subject: string; body: string } {
  let text = raw.replace(/<\/?msg>/g, '').replace(/<sticker[^>]*>/g, '').replace(/^```[a-z]*\n?|```$/g, '').trim()
  let subject = ''
  const m = text.match(/^\s*(?:标题|题目|Subject)\s*[:：]\s*(.+)\n/i)
  if (m) {
    subject = m[1].replace(/[《》「」"]/g, '').trim()
    text = text.slice(m[0].length).trim()
  }
  if (text.replace(/\s/g, '').length < 20) throw new AIError('模型返回的信太短了，没有保存，请重试', 'empty')
  return { subject: (subject || fallbackSubject).slice(0, 40), body: text.slice(0, 4000) }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

function historyText(list: Letter[], user: string, exclude?: string): string {
  const prev = list.filter((l) => l.id !== exclude).slice(-3)
  if (!prev.length) return ''
  return `\n\n以下是你们之前的往来信件（节选，按时间先后）：\n${prev.map((l) => `【${l.direction === 'from_user' ? `${user}寄给你` : `你寄给${user}`}】${l.subject}\n${clip(l.body, 300)}`).join('\n\n')}`
}

async function run(character: Character, kind: LetterJob['kind'], task: string, extra: { paper: PaperId; replyToId?: string; prompt?: string; subject: string }, fetchImpl?: typeof fetch): Promise<Letter> {
  if (jobs.get(character.id) && !jobs.get(character.id)!.error && !jobs.get(character.id)!.doneId) throw new AIError(`${character.name}正在写信，请等一下`, 'other')
  const ctrl = new AbortController()
  aborts.set(character.id, ctrl)
  jobs.set(character.id, { characterId: character.id, kind, startedAt: Date.now() })
  emit()
  try {
    const profile = { ...DEFAULT_PROFILE, ...(((await db.settings.get('profile'))?.value as UserProfile | undefined) ?? {}) }
    const user = profile.nickname || '你'
    const out = await composeWithCharacter({ character, intro: letterIntro(character.name, user), outro: letterOutro(character.name, user), task, maxTokens: 1400, signal: ctrl.signal, fetchImpl })
    const { subject, body } = parseLetter(out.text, extra.subject)
    const l = await receiveLetter({ characterId: character.id, subject, body, paper: extra.paper, model: out.model, replyToId: extra.replyToId, prompt: extra.prompt })
    jobs.set(character.id, { characterId: character.id, kind, startedAt: Date.now(), doneId: l.id })
    emit()
    return l
  } catch (e) {
    const msg = e instanceof AIError && e.kind === 'aborted' ? '已取消' : e instanceof Error ? e.message : String(e)
    jobs.set(character.id, { characterId: character.id, kind, startedAt: Date.now(), error: msg })
    emit()
    throw e
  } finally {
    aborts.delete(character.id)
  }
}

/** 邀请角色写一封信（可以给一个主题） */
export async function inviteLetter(characterId: string, opts: { topic?: string; paper?: PaperId; fetchImpl?: typeof fetch } = {}): Promise<Letter> {
  const c = await db.characters.get(characterId)
  if (!c) throw new AIError('角色不存在', 'config')
  const profile = { ...DEFAULT_PROFILE, ...(((await db.settings.get('profile'))?.value as UserProfile | undefined) ?? {}) }
  const user = profile.nickname || '你'
  const topic = opts.topic?.trim().slice(0, 100)
  const task = `请给${user}写一封信。${topic ? `${user}希望这封信写的是：「${topic}」。` : '写你此刻真正想对' + user + '说的话。'}${historyText(await correspondence(c.id), user)}`
  return run(c, 'invite', task, { paper: opts.paper ?? 'snow', prompt: topic, subject: `来自${c.name}的信` }, opts.fetchImpl)
}

/** 请角色回复你寄出的一封信 */
export async function replyToLetter(letterId: string, opts: { paper?: PaperId; fetchImpl?: typeof fetch } = {}): Promise<Letter> {
  const mine = await db.letters.get(letterId)
  if (!mine || mine.direction !== 'from_user' || mine.status !== 'sent' || mine.deletedAt) throw new AIError('只能回复你已经寄出的信', 'other')
  const c = await db.characters.get(mine.characterId)
  if (!c) throw new AIError('角色不存在', 'config')
  const profile = { ...DEFAULT_PROFILE, ...(((await db.settings.get('profile'))?.value as UserProfile | undefined) ?? {}) }
  const user = profile.nickname || '你'
  const task = `${user}给你寄来了一封信：\n【${mine.subject}】\n${mine.body}\n\n请认真读完，回一封信。回应信里真正写到的内容，不要泛泛而谈。${historyText(await correspondence(c.id), user, mine.id)}`
  return run(c, 'reply', task, { paper: opts.paper ?? mine.paper, replyToId: mine.id, subject: `回信：${mine.subject}` }, opts.fetchImpl)
}
