/**
 * 回复引擎：在页面之外维护每个会话的生成状态，离开聊天页后生成也会继续并保存。
 *  - 用户连续发送的消息在 0.8 秒内聚合为一次请求（各自仍是独立的消息记录）
 *  - 同一会话同一时间只有一个请求；生成中又有新消息，则在本次完成后再回复一轮
 *  - 重新生成：保留旧版本（superseded），只有当前版本进入后续上下文；可切换版本
 *  - 只在用户发送、重试、重新生成时请求，不会自动发起无上限的请求
 */
import { useSyncExternalStore } from 'react'
import { db, DEFAULT_AI_CONFIG, DEFAULT_PROFILE } from '../../db/db'
import { DEFAULT_WORLD_ID } from '../../db/schema'
import type { AIConfig, Lorebook, Message, UserProfile } from '../../db/schema'
import { uid } from '../../lib/util'
import { buildContext, splitReply } from './context'
import { AIError, streamChat } from './openai'

export type ReplyStatus = 'idle' | 'waiting' | 'generating' | 'error'

export interface ReplyState {
  status: ReplyStatus
  /** 流式生成中的文字 */
  partial: string
  error?: string
  errorKind?: AIError['kind']
  /** 正在重新生成的版本家族 */
  regenerating?: string
}

const IDLE: ReplyState = { status: 'idle', partial: '' }
const states = new Map<string, ReplyState>()
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const aborts = new Map<string, AbortController>()
const pendingAgain = new Set<string>()
let viewing: string | null = null

export const AGGREGATE_MS = 800

function set(convId: string, s: ReplyState) {
  states.set(convId, s)
  for (const l of listeners) l()
}

export function getReplyState(convId: string): ReplyState {
  return states.get(convId) ?? IDLE
}

export function useReplyState(convId: string): ReplyState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => getReplyState(convId),
  )
}

/** 聊天页打开时登记，用于判断回复是否计入未读 */
export function setViewing(convId: string | null) {
  viewing = convId
}

async function loadConfig(): Promise<AIConfig> {
  const v = (await db.settings.get('ai-config'))?.value as Partial<AIConfig> | undefined
  return { ...DEFAULT_AI_CONFIG, ...(v ?? {}) }
}

/** 用户发送后调用：0.8 秒内的连续发送合并为一次请求 */
export function scheduleReply(convId: string) {
  const cur = getReplyState(convId)
  if (cur.status === 'generating') {
    pendingAgain.add(convId)
    return
  }
  const t = timers.get(convId)
  if (t) clearTimeout(t)
  set(convId, { status: 'waiting', partial: '' })
  timers.set(
    convId,
    setTimeout(() => {
      timers.delete(convId)
      void runReply(convId)
    }, AGGREGATE_MS),
  )
}

export function stopReply(convId: string) {
  const t = timers.get(convId)
  if (t) {
    clearTimeout(t)
    timers.delete(convId)
    set(convId, IDLE)
  }
  pendingAgain.delete(convId)
  aborts.get(convId)?.abort()
}

export function dismissError(convId: string) {
  if (getReplyState(convId).status === 'error') set(convId, IDLE)
}

/** 当前会话中最后一组 AI 回复（且它之后没有用户消息）——可重新生成的对象 */
export function lastReplyGroup(messages: Message[]): Message[] | null {
  const active = messages.filter((m) => !m.deleted && !m.superseded)
  const last = active[active.length - 1]
  if (!last || last.senderType !== 'character' || !last.replyGroupId) return null
  return active.filter((m) => m.replyGroupId === last.replyGroupId)
}

export async function regenerate(convId: string) {
  const msgs = await db.messages.where('conversationId').equals(convId).sortBy('createdAt')
  const group = lastReplyGroup(msgs)
  if (!group) return
  await runReply(convId, group[0].versionFamily ?? group[0].replyGroupId)
}

export async function runReply(convId: string, regenerateFamily?: string): Promise<void> {
  if (getReplyState(convId).status === 'generating') return
  const ctrl = new AbortController()
  aborts.set(convId, ctrl)
  set(convId, { status: 'generating', partial: '', regenerating: regenerateFamily })
  let partial = ''
  try {
    const conv = await db.conversations.get(convId)
    if (!conv) return set(convId, IDLE)
    const character = await db.characters.get(conv.characterIds[0])
    if (!character) throw new AIError('角色不存在或已被删除', 'config')
    const config = await loadConfig()
    const profile = { ...DEFAULT_PROFILE, ...(((await db.settings.get('profile'))?.value as UserProfile | undefined) ?? {}) }
    const world = character.worldId !== DEFAULT_WORLD_ID ? await db.worlds.get(character.worldId) : undefined
    const charBookIds = (await db.characterLorebooks.where('characterId').equals(character.id).toArray()).map((l) => l.lorebookId)
    const worldBookIds = world ? (await db.worldLorebooks.where('worldId').equals(world.id).toArray()).map((l) => l.lorebookId) : []
    const books = (await db.lorebooks.bulkGet([...new Set([...charBookIds, ...worldBookIds])])).filter((b): b is Lorebook => !!b)
    let history = await db.messages.where('conversationId').equals(convId).sortBy('createdAt')
    if (regenerateFamily) {
      // 重新生成：上下文中排除当前版本
      history = history.filter((m) => (m.versionFamily ?? m.replyGroupId) !== regenerateFamily)
    }
    if (!history.some((m) => m.senderType === 'user' && !m.deleted)) return set(convId, IDLE)

    const ctx = buildContext({ character, userName: profile.nickname, world, lorebooks: books, history })
    const text = await streamChat({
      config,
      messages: ctx.messages,
      signal: ctrl.signal,
      onDelta: (full) => {
        partial = full
        set(convId, { status: 'generating', partial: full, regenerating: regenerateFamily })
      },
    })
    await saveReply(convId, character.id, character.name, text, config.model, regenerateFamily)
    set(convId, IDLE)
  } catch (e) {
    const err = e instanceof AIError ? e : new AIError(e instanceof Error ? e.message : String(e), 'other')
    if (err.kind === 'aborted') {
      // 手动停止：已生成的部分照常保存，没有内容则什么也不写
      const conv = await db.conversations.get(convId)
      const character = conv ? await db.characters.get(conv.characterIds[0]) : undefined
      const cfg = await loadConfig()
      if (partial.trim() && character) await saveReply(convId, character.id, character.name, partial, cfg.model, regenerateFamily)
      set(convId, IDLE)
    } else {
      set(convId, { status: 'error', partial: '', error: err.message, errorKind: err.kind, regenerating: regenerateFamily })
    }
  } finally {
    aborts.delete(convId)
    if (pendingAgain.has(convId)) {
      pendingAgain.delete(convId)
      if (getReplyState(convId).status !== 'error') scheduleReply(convId)
    }
  }
}

async function saveReply(convId: string, characterId: string, name: string, text: string, model: string, family?: string) {
  const parts = splitReply(text, name)
  if (!parts.length) return
  const groupId = uid('grp')
  const now = Date.now()
  await db.transaction('rw', [db.messages, db.conversations], async () => {
    if (family) {
      const old = (await db.messages.where('conversationId').equals(convId).toArray()).filter(
        (m) => (m.versionFamily ?? m.replyGroupId) === family && !m.superseded,
      )
      for (const m of old) await db.messages.update(m.id, { superseded: true, versionFamily: family })
    }
    let t = now
    for (const content of parts) {
      await db.messages.add({
        id: uid('msg'),
        conversationId: convId,
        senderType: 'character',
        senderId: characterId,
        kind: 'text',
        content,
        status: 'sent',
        replyGroupId: groupId,
        versionFamily: family ?? groupId,
        model,
        createdAt: t,
        updatedAt: t,
      })
      t += 1
    }
    const conv = await db.conversations.get(convId)
    if (conv) {
      const last = parts[parts.length - 1].replace(/\s+/g, ' ')
      await db.conversations.update(convId, {
        lastMessagePreview: last.length > 40 ? `${last.slice(0, 40)}…` : last,
        lastMessageAt: t,
        unread: viewing === convId ? 0 : conv.unread + parts.length,
      })
    }
  })
}

/** 版本信息：返回该家族的版本数量与当前序号（从 1 开始） */
export function versionInfo(messages: Message[], family: string): { count: number; index: number; groups: string[] } {
  const groups: string[] = []
  let active = ''
  for (const m of messages) {
    if (m.deleted || (m.versionFamily ?? m.replyGroupId) !== family || !m.replyGroupId) continue
    if (!groups.includes(m.replyGroupId)) groups.push(m.replyGroupId)
    if (!m.superseded) active = m.replyGroupId
  }
  return { count: groups.length, index: groups.indexOf(active) + 1, groups }
}

/** 切换到同一位置的另一个版本：只改变哪一组生效，不删除任何内容 */
export async function switchVersion(convId: string, family: string, step: -1 | 1) {
  await db.transaction('rw', [db.messages], async () => {
    const msgs = (await db.messages.where('conversationId').equals(convId).sortBy('createdAt')).filter(
      (m) => (m.versionFamily ?? m.replyGroupId) === family && !m.deleted,
    )
    const { index, groups } = versionInfo(msgs, family)
    const next = groups[index - 1 + step]
    if (!next) return
    for (const m of msgs) await db.messages.update(m.id, { superseded: m.replyGroupId !== next })
  })
}
