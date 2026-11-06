/**
 * 角色动态引擎：每一次请求都由用户的操作触发（点「让 TA 发一条」、发布时选择请角色互动、在评论区和角色说话），
 * 不会在后台定时自动发起请求。只有开启了「参与朋友圈」（permissions.postMoments）的角色才会参与。
 */
import { useSyncExternalStore } from 'react'
import { db, DEFAULT_PROFILE } from '../../db/db'
import type { AIConfig, Character, Moment, MomentComment, UserProfile } from '../../db/schema'
import { addComment, toggleLike } from '../../db/momentRepo'
import { uid } from '../../lib/util'
import { hasLiked, visibleToCharacter } from '../moments'
import { cleanLine, MOMENT_AI_LIMITS, parseReaction, postPrompt, reactPrompt, replyPrompt, replyTarget, type MomentPersonaInput } from './momentsAI'
import { streamChat } from './openai'
import { getDeviceId, normalizeAIConfig } from './service'

/** 一次最多请几个角色来互动（控制请求次数与费用） */
export const MAX_REACTORS = 3

/* ---------- 进行中的状态（界面显示「正在写…」） ---------- */
const busy = new Map<string, string>()
const listeners = new Set<() => void>()
let snapshot: ReadonlyMap<string, string> = new Map()
function setBusy(key: string, label: string | null) {
  if (label) busy.set(key, label)
  else busy.delete(key)
  snapshot = new Map(busy)
  for (const l of listeners) l()
}
export function useMomentBusy(): ReadonlyMap<string, string> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snapshot,
  )
}

export interface EngineOptions {
  fetchImpl?: typeof fetch
  config?: AIConfig
}

export function canJoinMoments(c: Pick<Character, 'permissions'>): boolean {
  return c.permissions?.postMoments !== false
}

async function setup(characterId: string, opts: EngineOptions): Promise<{ input: MomentPersonaInput; config: AIConfig; deviceId: string }> {
  const character = await db.characters.get(characterId)
  if (!character) throw new Error('角色不存在或已被删除')
  if (!canJoinMoments(character)) throw new Error(`「${character.name}」没有开启参与朋友圈`)
  const config = opts.config ?? normalizeAIConfig((await db.settings.get('ai-config'))?.value as Partial<AIConfig> | undefined)
  const profile = { ...DEFAULT_PROFILE, ...(((await db.settings.get('profile'))?.value as UserProfile | undefined) ?? {}) }
  // 只读取这个角色自己的单聊和记忆
  const conv = await db.conversations.filter((v) => v.type === 'single' && v.characterIds.length === 1 && v.characterIds[0] === characterId).first()
  const chat = conv ? await db.messages.where('conversationId').equals(conv.id).sortBy('createdAt') : []
  const memories = await db.memories.where('characterId').equals(characterId).toArray()
  const deviceId = config.service === 'lingling' ? await getDeviceId() : ''
  return { input: { character, userName: profile.nickname, chat, memories }, config, deviceId }
}

async function ask(config: AIConfig, deviceId: string, messages: { role: 'system' | 'user'; content: string }[], opts: EngineOptions): Promise<string> {
  return streamChat({ config: { ...config, maxTokens: Math.min(Math.max(config.maxTokens || 0, 300), 800) }, messages, deviceId, fetchImpl: opts.fetchImpl })
}

/** 让角色发一条动态（一次请求）。角色的动态所有人可见 */
export async function generateCharacterMoment(characterId: string, opts: EngineOptions = {}): Promise<Moment> {
  setBusy(`post:${characterId}`, '正在写动态…')
  try {
    const { input, config, deviceId } = await setup(characterId, opts)
    const content = cleanLine(await ask(config, deviceId, postPrompt(input), opts), input.character.name, MOMENT_AI_LIMITS.post)
    if (!content) throw new Error('模型没有返回内容，没有发布。可以重试')
    const now = Date.now()
    const m: Moment = { id: uid('mom'), authorType: 'character', authorId: characterId, content, imageRefs: [], visibility: 'all', likes: [], comments: [], createdAt: now, updatedAt: now }
    await db.moments.add(m)
    return m
  } finally {
    setBusy(`post:${characterId}`, null)
  }
}

export interface ReactResult {
  characterId: string
  liked: boolean
  comment: string
  error?: string
}

/**
 * 请角色来看用户的动态（每个角色一次请求）：只会交给能看到这条动态、并开启了参与朋友圈的角色，最多 3 个。
 * 某个角色失败不影响其他角色，也不会编造点赞或评论。
 */
export async function reactToMoment(momentId: string, characterIds: string[], opts: EngineOptions = {}): Promise<ReactResult[]> {
  const out: ReactResult[] = []
  for (const id of [...new Set(characterIds)].slice(0, MAX_REACTORS)) {
    const m = await db.moments.get(momentId)
    if (!m || m.deleted || m.authorType !== 'user') break
    if (!visibleToCharacter(m, id)) {
      out.push({ characterId: id, liked: false, comment: '', error: '这个角色看不到这条动态' })
      continue
    }
    setBusy(`react:${momentId}:${id}`, '正在看你的动态…')
    try {
      const { input, config, deviceId } = await setup(id, opts)
      const r = parseReaction(await ask(config, deviceId, reactPrompt(input, m), opts), input.character.name)
      const actor = { type: 'character' as const, id }
      const fresh = await db.moments.get(momentId)
      if (!fresh || fresh.deleted) break
      if (r.like && !hasLiked(fresh, actor)) await toggleLike(momentId, actor)
      if (r.comment) await addComment(momentId, actor, r.comment)
      out.push({ characterId: id, liked: r.like, comment: r.comment })
    } catch (e) {
      out.push({ characterId: id, liked: false, comment: '', error: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(`react:${momentId}:${id}`, null)
    }
  }
  return out
}

/**
 * 用户在评论区和角色说话后，由对应角色回复一句（一次请求）：
 * 在角色的动态下评论 → 作者回复；回复了某个角色的评论 → 那个角色回复。
 */
export async function replyToComment(momentId: string, comment: MomentComment, opts: EngineOptions = {}): Promise<MomentComment | null> {
  const m = await db.moments.get(momentId)
  if (!m || m.deleted) return null
  const target = replyTarget(m, comment)
  if (!target || !visibleToCharacter(m, target)) return null
  const character = await db.characters.get(target)
  if (!character || !canJoinMoments(character)) return null
  setBusy(`reply:${momentId}`, `${character.name}正在回复…`)
  try {
    const { input, config, deviceId } = await setup(target, opts)
    const authorName = m.authorType === 'user' ? input.userName || '你' : character.name
    const text = cleanLine(await ask(config, deviceId, replyPrompt(input, m, authorName), opts), character.name, MOMENT_AI_LIMITS.comment)
    if (!text) return null
    const fresh = await db.moments.get(momentId)
    if (!fresh || fresh.deleted) return null
    return await addComment(momentId, { type: 'character', id: target }, text, { type: 'user', id: 'user' })
  } finally {
    setBusy(`reply:${momentId}`, null)
  }
}
