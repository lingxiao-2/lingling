/**
 * 回复引擎：在页面之外维护每个会话的生成状态，离开聊天页后生成也会继续并保存。
 *  - 用户连续发送的消息在 0.8 秒内聚合为一次请求（各自仍是独立的消息记录）
 *  - 一次模型调用生成 1～5 条消息（见 messageFormat.ts），流式解析：写完一条就按自然节奏发出一条
 *  - 每条消息的 ID 由「本次回复 ID + 序号」决定，重复保存只会覆盖同一条，不会产生重复消息
 *  - 同一会话同一时间只有一个请求；生成中又有新消息，则在本次完成后再回复一轮
 *  - 重新生成：保留旧版本（superseded），只有当前版本进入后续上下文；可切换版本
 *  - 只在用户发送、重试、重新生成时请求，不会自动发起无上限的请求
 */
import { useSyncExternalStore } from 'react'
import { db, DEFAULT_PROFILE } from '../../db/db'
import { getDeviceId, normalizeAIConfig } from './service'
import { DEFAULT_WORLD_ID } from '../../db/schema'
import type { AIConfig, Lorebook, Memory, Message, Sticker, UserProfile } from '../../db/schema'
import { uid } from '../../lib/util'
import { buildContext } from './context'
import { proposeFromRequests } from './memory'
import { capParts, MAX_PARTS, parseReply, type ReplyPart } from './messageFormat'
import { AIError, streamChat } from './openai'
import type { ChatTurn, ContentPart } from './provider'
import { analysesFor, analyzeSticker, visionStatus } from '../vision/stickerVision'
import { getStickerImage } from '../../db/stickerRepo'

export type ReplyStatus = 'idle' | 'waiting' | 'generating' | 'error'

export interface ReplyState {
  status: ReplyStatus
  /** 正在生成、尚未发出的那条文字（已去掉格式标记） */
  partial: string
  /** 本轮已经发出的条数 */
  delivered?: number
  error?: string
  errorKind?: AIError['kind']
  /** 正在重新生成的版本家族 */
  regenerating?: string
  /** vision：正在看用户发来的表情包 */
  phase?: 'vision'
  /** 识图没有成功时的说明（不影响回复，回复会按「没看懂图片」处理） */
  visionNote?: string
}

const IDLE: ReplyState = { status: 'idle', partial: '' }
const states = new Map<string, ReplyState>()
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const aborts = new Map<string, AbortController>()
const flushers = new Map<string, () => void>()
const pendingAgain = new Set<string>()
let viewing: string | null = null

export const AGGREGATE_MS = 800

/** 逐条发出的节奏：按上一条的长度模拟打字时间（毫秒） */
export const PACE = { min: 420, perChar: 32, max: 1500, sticker: 650 }
let paceScale = 1
/** 仅供测试：0 表示不等待 */
export function setPaceScaleForTesting(k: number) {
  paceScale = k
}

export function paceFor(part: ReplyPart): number {
  if (part.type === 'sticker') return PACE.sticker * paceScale
  return Math.min(PACE.max, Math.max(PACE.min, part.text.length * PACE.perChar)) * paceScale
}

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
  return normalizeAIConfig((await db.settings.get('ai-config'))?.value as Partial<AIConfig> | undefined)
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

/** 停止：中断请求；已经写完的消息立即全部发出（不再等待节奏），未写完的一条也保留 */
export function stopReply(convId: string) {
  const t = timers.get(convId)
  if (t) {
    clearTimeout(t)
    timers.delete(convId)
    set(convId, IDLE)
  }
  pendingAgain.delete(convId)
  aborts.get(convId)?.abort()
  flushers.get(convId)?.()
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
  set(convId, { status: 'generating', partial: '', delivered: 0, regenerating: regenerateFamily })

  // 本轮回复的 ID：每条消息的 ID = runId-序号，重复写入只会覆盖同一条
  const runId = uid('grp')
  let raw = ''
  let ready: ReplyPart[] = []
  let finalParts: ReplyPart[] | null = null
  let delivered = 0
  let current = ''
  let flushing = false
  let wake: () => void = () => {}
  let pump: Promise<void> = Promise.resolve()
  let save: ((part: ReplyPart, index: number) => Promise<void>) | null = null
  let visionNote: string | undefined
  flushers.set(convId, () => {
    flushing = true
    wake()
  })

  const publish = () =>
    set(convId, { status: 'generating', partial: current, delivered, regenerating: regenerateFamily })

  /** 等待节奏；停止时立即醒来 */
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (flushing || ms <= 0) return resolve()
      const t = setTimeout(resolve, ms)
      wake = () => {
        clearTimeout(t)
        resolve()
      }
    })

  /** 把已经完整的消息按顺序发出；流式过程中最多先发 4 条，第 5 条及之后等结束后合并 */
  const deliver = () => {
    pump = pump.then(async () => {
      for (;;) {
        const list = finalParts ?? ready.slice(0, MAX_PARTS - 1)
        if (delivered >= list.length || !save) return
        if (delivered > 0) await sleep(paceFor(list[delivered - 1]))
        await save(list[delivered], delivered)
        delivered++
        publish()
      }
    })
    return pump
  }

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
    const stickers: Sticker[] = await db.stickers.toArray()
    let history = await db.messages.where('conversationId').equals(convId).sortBy('createdAt')
    if (regenerateFamily) {
      // 重新生成：上下文中排除当前版本
      history = history.filter((m) => (m.versionFamily ?? m.replyGroupId) !== regenerateFamily)
    }
    if (!history.some((m) => m.senderType === 'user' && !m.deleted)) return set(convId, IDLE)

    // 用户最近发来的表情包：识图开启时先看懂它（同一张图只识别一次）；失败不阻塞回复，也不编造结果
    const analyses = await analysesFor(stickers)
    const lastUserStickers = recentUserStickers(history, stickers)
    const vs = lastUserStickers.length ? await visionStatus() : null
    if (vs?.ok) {
      const pending = lastUserStickers.filter((st) => !(st.hash && analyses.get(st.hash)?.status === 'done'))
      if (pending.length) {
        set(convId, { status: 'generating', partial: '', delivered: 0, regenerating: regenerateFamily, phase: 'vision' })
        for (const st of pending.slice(0, 3)) {
          try {
            const a = await analyzeSticker(st, { signal: ctrl.signal })
            if (a) analyses.set(a.hash, a)
            if (a?.status === 'failed') visionNote = `表情包没有识别成功：${a.error ?? '未知原因'}`
          } catch (e) {
            if ((e as AIError)?.kind === 'aborted') throw e
            visionNote = `表情包没有识别成功：${e instanceof Error ? e.message : String(e)}`
          }
        }
        set(convId, { status: 'generating', partial: '', delivered: 0, regenerating: regenerateFamily })
      }
    } else if (vs && !vs.ok && vs.vision.enabled) {
      visionNote = `表情包识别不可用：${vs.reason}`
    }

    // 长期记忆：用户在聊天中明确要求「记住」的话，原样保存（敏感内容先等用户确认）
    let memories = await db.memories.where('characterId').equals(character.id).toArray()
    const requested = proposeFromRequests(history, memories)
    if (requested.length) {
      const now = Date.now()
      const rows: Memory[] = requested.map((p) => ({
        id: uid('mem'),
        characterId: character.id,
        kind: p.kind,
        content: p.content,
        sourceMessageIds: p.sourceMessageIds,
        quote: p.quote,
        origin: p.origin,
        sensitive: p.sensitive,
        status: p.sensitive ? 'pending' : 'active',
        priority: 2,
        createdAt: now,
        updatedAt: now,
      }))
      await db.memories.bulkAdd(rows)
      memories = [...memories, ...rows]
    }
    const ctx = buildContext({ character, userName: profile.nickname, world, lorebooks: books, history, stickers, analyses, memories })
    if (ctx.usedMemoryIds.length) void db.memories.where('id').anyOf(ctx.usedMemoryIds).modify({ lastUsedAt: Date.now() })
    // 聊天模型本身支持图片时：把最新发来的表情包原图也一起交给它（官方多模态格式）
    if (vs?.ok && vs.vision.mode === 'chat' && vs.vision.attachToChat && lastUserStickers.length) {
      await attachStickerImages(ctx.messages, lastUserStickers.slice(-2))
    }
    const stickerNames = new Map(stickers.map((st) => [st.id, st.name.trim()]))
    save = (part, index) => savePart({ convId, runId, index, part, characterId: character.id, model: config.model, family: regenerateFamily, stickerName: stickerNames.get(part.type === 'sticker' ? part.stickerId : '') })

    const parse = (final: boolean) => parseReply(raw, ctx.stickerMap, final, character.name)
    try {
      raw = await streamChat({
        config,
        messages: ctx.messages,
        signal: ctrl.signal,
        deviceId: config.service === 'lingling' ? await getDeviceId() : '',
        onDelta: (full) => {
          raw = full
          const p = parse(false)
          ready = p.parts
          current = p.current
          publish()
          if (ready.length > delivered) void deliver()
        },
      })
    } catch (e) {
      if (e instanceof AIError && e.kind === 'aborted') {
        // 手动停止：已写完的消息和正在写的那一条都保留，立即发出
        flushing = true
        finalParts = capParts(parse(true).parts)
        current = ''
        await deliver()
        return set(convId, IDLE)
      }
      // 出错：已经写完的消息照常保存（它们是完整的），未写完的一条丢弃；重试时模型能看到已发出的内容
      flushing = true
      finalParts = capParts(ready)
      current = ''
      await deliver()
      throw e
    }
    finalParts = capParts(parse(true).parts)
    current = ''
    publish()
    await deliver()
    if (delivered === 0) throw new AIError('模型没有返回可以显示的内容，请重试或更换模型', 'empty')
    set(convId, visionNote ? { ...IDLE, visionNote } : IDLE)
  } catch (e) {
    const err = e instanceof AIError ? e : new AIError(e instanceof Error ? e.message : String(e), 'other')
    set(convId, { status: 'error', partial: '', error: err.message, errorKind: err.kind, regenerating: delivered > 0 ? undefined : regenerateFamily })
  } finally {
    aborts.delete(convId)
    flushers.delete(convId)
    if (pendingAgain.has(convId)) {
      pendingAgain.delete(convId)
      if (getReplyState(convId).status !== 'error') scheduleReply(convId)
    }
  }
}

interface SavePartInput {
  convId: string
  runId: string
  index: number
  part: ReplyPart
  characterId: string
  model: string
  family?: string
  stickerName?: string
}

/** 保存一条回复。ID 固定为 runId-序号：同一条重复保存只会覆盖，不会重复 */
export async function savePart({ convId, runId, index, part, characterId, model, family, stickerName }: SavePartInput) {
  const id = `${runId}-${index}`
  await db.transaction('rw', [db.messages, db.conversations], async () => {
    if (await db.messages.get(id)) return
    if (index === 0 && family) {
      const old = (await db.messages.where('conversationId').equals(convId).toArray()).filter(
        (m) => (m.versionFamily ?? m.replyGroupId) === family && !m.superseded && m.replyGroupId !== runId,
      )
      for (const m of old) await db.messages.update(m.id, { superseded: true, versionFamily: family })
    }
    const conv = await db.conversations.get(convId)
    const t = Math.max(Date.now(), (conv?.lastMessageAt ?? 0) + 1)
    const content = part.type === 'text' ? part.text : `[表情包]${stickerName ? ` ${stickerName}` : ''}`
    await db.messages.add({
      id,
      conversationId: convId,
      senderType: 'character',
      senderId: characterId,
      kind: part.type,
      content,
      stickerId: part.type === 'sticker' ? part.stickerId : undefined,
      status: 'sent',
      replyGroupId: runId,
      versionFamily: family ?? runId,
      model,
      createdAt: t,
      updatedAt: t,
    })
    if (conv) {
      const preview = part.type === 'text' ? part.text.replace(/\s+/g, ' ') : '[表情包]'
      await db.conversations.update(convId, {
        lastMessagePreview: preview.length > 40 ? `${preview.slice(0, 40)}…` : preview,
        lastMessageAt: t,
        unread: viewing === convId ? 0 : conv.unread + 1,
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

/** 最后一轮用户发言（最近一条 AI 回复之后）里的表情包 */
export function recentUserStickers(history: Message[], stickers: Sticker[]): Sticker[] {
  const byId = new Map(stickers.map((s) => [s.id, s]))
  const out: Sticker[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.deleted || m.superseded) continue
    if (m.senderType === 'character') break
    if (m.senderType === 'user' && m.kind === 'sticker') {
      const st = byId.get(m.stickerId ?? '')
      if (st && !out.includes(st)) out.unshift(st)
    }
  }
  return out
}

/** 把表情包原图附加到最后一条用户消息（只用于支持图片输入的聊天模型） */
async function attachStickerImages(messages: ChatTurn[], stickers: Sticker[]) {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  if (!last || typeof last.content !== 'string') return
  const { renderVisionImage } = await import('../vision/visionImage')
  const parts: ContentPart[] = [{ type: 'text', text: last.content }]
  for (const st of stickers) {
    const url = await getStickerImage(st.id)
    if (!url) continue
    try {
      const img = await renderVisionImage(url)
      parts.push({ type: 'image_url', image_url: { url: img.dataUrl, detail: 'low' } })
    } catch {
      /* 图片处理失败：只发文字描述 */
    }
  }
  if (parts.length > 1) last.content = parts
}
