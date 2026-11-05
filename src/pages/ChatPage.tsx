import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import { db } from '../db/db'
import { markRead, saveDraft, sendUserMessage, softDeleteMessage } from '../db/repo'
import type { Message } from '../db/schema'
import NavBar, { NavButton } from '../components/NavBar'
import Avatar from '../components/Avatar'
import { ActionSheet } from '../components/Sheet'
import type { SheetAction } from '../components/Sheet'
import { useAIConfig, useProfile } from '../store/profile'
import { ChatWallpaper } from '../components/Wallpaper'
import { useThemeSettings } from '../theme/theme'
import { DEFAULT_WORLD_ID } from '../db/schema'
import { formatChatTime } from '../lib/util'
import { useLongPress } from '../lib/usePress'
import { configProblem } from '../services/ai/openai'
import {
  dismissError,
  lastReplyGroup,
  regenerate,
  runReply,
  scheduleReply,
  setViewing,
  stopReply,
  switchVersion,
  useReplyState,
  versionInfo,
} from '../services/ai/replyEngine'

const GAP_MS = 5 * 60 * 1000
const BOTTOM_THRESHOLD = 80
const MAX_INPUT_HEIGHT = 140

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } finally {
      document.body.removeChild(ta)
    }
  }
}

/** 一行消息：对方头像在左，自己的头像在右（28px） */
function Row({
  mine,
  name,
  avatar,
  showAvatar,
  children,
}: {
  mine: boolean
  name: string
  avatar?: string
  showAvatar: boolean
  children: ReactNode
}) {
  return (
    <div className={`flex items-start gap-2 px-3 ${mine ? 'flex-row-reverse' : ''}`}>
      <div className="pt-0.5 w-7 shrink-0">{showAvatar && <Avatar name={name} src={avatar} size="chat" />}</div>
      <div className={`flex flex-col min-w-0 max-w-[72%] ${mine ? 'items-end' : 'items-start'}`}>{children}</div>
    </div>
  )
}

function Bubble({ msg, mine, ornament, onMenu }: { msg: Message; mine: boolean; ornament: boolean; onMenu: () => void }) {
  const press = useLongPress(onMenu)
  return (
    <div
      {...press}
      className={`bubble select-none whitespace-pre-wrap break-words ${mine ? 'bubble-me' : 'bubble-them'} ${ornament ? 'bubble-ornament' : ''}`}
      style={{ WebkitTouchCallout: 'none' }}
    >
      {msg.content}
    </div>
  )
}

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function ChatPage() {
  const { convId = '' } = useParams()
  const nav = useNavigate()
  const profile = useProfile()
  const theme = useThemeSettings()
  const ai = useAIConfig()
  const reply = useReplyState(convId)

  const conv = useLiveQuery(async () => (await db.conversations.get(convId)) ?? null, [convId])
  const charId = conv?.characterIds[0]
  const character = useLiveQuery(
    async () => (charId ? (await db.characters.get(charId)) ?? null : null),
    [charId],
  )
  const worldId = character?.worldId
  const worldName = useLiveQuery(
    async () => (worldId && worldId !== DEFAULT_WORLD_ID ? (await db.worlds.get(worldId))?.name ?? null : null),
    [worldId],
  )
  const messages = useLiveQuery(
    () => db.messages.where('conversationId').equals(convId).sortBy('createdAt'),
    [convId],
  )
  /** 显示的消息：未删除、当前生效的版本；正在重新生成的那一组暂时隐藏 */
  const visible = useMemo(
    () =>
      (messages ?? []).filter(
        (m) =>
          !m.deleted &&
          !m.superseded &&
          !(reply.status === 'generating' && reply.regenerating && (m.versionFamily ?? m.replyGroupId) === reply.regenerating),
      ),
    [messages, reply.status, reply.regenerating],
  )
  const lastGroup = useMemo(() => lastReplyGroup(messages ?? []), [messages])

  const [text, setText] = useState('')
  const [menuMsg, setMenuMsg] = useState<Message | null>(null)
  const [showJump, setShowJump] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const draftReady = useRef(false)
  const latestText = useRef('')
  const initialScrolled = useRef(false)
  const stickNext = useRef(false)
  const atBottom = useRef(true)

  const notConfigured = configProblem(ai)
  const busy = reply.status === 'waiting' || reply.status === 'generating'

  /* ---- 当前正在查看的会话（回复是否计入未读） ---- */
  useEffect(() => {
    setViewing(convId)
    return () => setViewing(null)
  }, [convId])

  /* ---- 草稿：进入时恢复，输入时防抖保存，离开/切后台时立即保存 ---- */
  useEffect(() => {
    draftReady.current = false
    initialScrolled.current = false
    setText('')
    latestText.current = ''
  }, [convId])

  useEffect(() => {
    if (!conv || draftReady.current) return
    draftReady.current = true
    setText(conv.draft)
    latestText.current = conv.draft
  }, [conv])

  useEffect(() => {
    latestText.current = text
    if (!draftReady.current) return
    const t = window.setTimeout(() => void saveDraft(convId, text), 300)
    return () => window.clearTimeout(t)
  }, [text, convId])

  useEffect(() => {
    const flush = () => {
      if (draftReady.current) void saveDraft(convId, latestText.current)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [convId])

  /* ---- 已读 ---- */
  useEffect(() => {
    if (conv && conv.unread > 0) void markRead(convId)
  }, [conv, convId])

  /* ---- 输入框自适应高度 ---- */
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [text])

  /* ---- 滚动：首次进入、自己发送时滚到底部；正在底部时跟随新内容，离开底部则不打扰 ---- */
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useLayoutEffect(() => {
    if (messages === undefined) return
    if (!initialScrolled.current) {
      initialScrolled.current = true
      scrollToBottom()
    } else if (stickNext.current) {
      stickNext.current = false
      scrollToBottom(true)
    } else if (atBottom.current) {
      scrollToBottom()
    }
  }, [messages, scrollToBottom])

  useLayoutEffect(() => {
    if (atBottom.current && (busy || reply.status === 'error')) scrollToBottom()
  }, [reply.partial, reply.status, busy, scrollToBottom])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const far = el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_THRESHOLD
    atBottom.current = !far
    setShowJump(far)
  }

  const send = async () => {
    const content = text.trim()
    if (!content || !conv) return
    stickNext.current = true
    setText('')
    latestText.current = ''
    try {
      await sendUserMessage(convId, content)
    } catch {
      // 保存失败时把内容还给输入框，避免丢字
      stickNext.current = false
      setText(content)
      alert('消息保存失败，请重试')
      return
    }
    if (!notConfigured) scheduleReply(convId)
    taRef.current?.focus()
  }

  if (conv === null || (conv && character === null)) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="聊天" back="/" />
        <div className="p-10 text-center text-sm text-[var(--c-text-3)]">
          {conv === null ? '会话不存在或已被删除' : '该角色已被删除'}
        </div>
      </div>
    )
  }

  const title = character?.name ?? ''
  const firstAt = visible[0]?.createdAt ?? Date.now()
  const firstDate = new Date(firstAt)
  const typing = busy ? `${title}正在输入…` : undefined

  const menuActions = (m: Message): SheetAction[] => {
    const acts: SheetAction[] = [{ label: '复制', onClick: () => void copyText(m.content) }]
    if (m.senderType === 'character' && lastGroup?.some((x) => x.id === m.id) && !busy && !notConfigured) {
      acts.push({ label: '重新生成', onClick: () => void regenerate(convId) })
    }
    acts.push({ label: '删除', danger: true, onClick: () => void softDeleteMessage(m) })
    return acts
  }

  return (
    <div className="h-dvh flex flex-col">
      <ChatWallpaper />
      <NavBar
        title={title}
        subtitle={typing ?? worldName ?? undefined}
        back="/"
        right={charId && <NavButton label="角色资料" icon="more" onClick={() => nav(`/character/${charId}`)} />}
      />

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="chat-text h-full overflow-y-auto pt-2 pb-4 flex flex-col gap-3"
          style={{ overscrollBehavior: 'contain' }}
        >
          {/* 信笺抬头：日期胶囊 + 花体小字（纯装饰，不代表任何状态） */}
          <div className="flex flex-col items-center gap-2 pt-1">
            <span className="pill">
              {firstDate.getMonth() + 1}月{firstDate.getDate()}日 · {WEEK[firstDate.getDay()]}
            </span>
            <div className="flourish w-[78%] text-[17px]">
              <span className="script-en whitespace-nowrap">A letter from winter</span>
            </div>
            {notConfigured && (
              <button onClick={() => nav('/me/api')} className="press pill py-1 text-[11px] text-[var(--c-accent-strong)]" style={{ height: 'auto' }}>
                {ai.service === 'lingling' ? '聆聆默认服务尚未开通，消息只会保存在本地 · 改用自己的 API' : '尚未配置 AI 服务，消息只会保存在本地 · 去设置'}
              </button>
            )}
          </div>

          {visible.map((m, i) => {
            const prev = visible[i - 1]
            const next = visible[i + 1]
            const mine = m.senderType === 'user'
            const family = m.versionFamily ?? m.replyGroupId
            const lastOfGroup = !mine && family && next?.replyGroupId !== m.replyGroupId
            const versions = lastOfGroup && family ? versionInfo(messages ?? [], family) : null
            // 同一方连续的消息只在第一条显示头像
            const showAvatar = !prev || prev.senderType !== m.senderType || m.createdAt - prev.createdAt > GAP_MS
            return (
              <div key={m.id} className="flex flex-col gap-3">
                {prev && m.createdAt - prev.createdAt > GAP_MS && (
                  <div className="flex justify-center">
                    <span className="pill">{formatChatTime(m.createdAt)}</span>
                  </div>
                )}
                <Row mine={mine} name={mine ? profile.nickname : title} avatar={mine ? profile.avatar : character?.avatar} showAvatar={showAvatar}>
                  <Bubble msg={m} mine={mine} ornament={theme.bubble.ornament} onMenu={() => setMenuMsg(m)} />
                  {versions && versions.count > 1 && family && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--c-text-3)]">
                      <button
                        aria-label="上一个版本"
                        disabled={versions.index <= 1 || busy}
                        onClick={() => void switchVersion(convId, family, -1)}
                        className="press h-6 w-6 flex items-center justify-center disabled:opacity-30"
                      >
                        <Icon name="back" size="xs" />
                      </button>
                      <span className="tabular-nums">
                        {versions.index} / {versions.count}
                      </span>
                      <button
                        aria-label="下一个版本"
                        disabled={versions.index >= versions.count || busy}
                        onClick={() => void switchVersion(convId, family, 1)}
                        className="press h-6 w-6 flex items-center justify-center disabled:opacity-30"
                      >
                        <Icon name="forward" size="xs" />
                      </button>
                    </div>
                  )}
                </Row>
              </div>
            )
          })}

          {/* 生成中：真实的流式内容；尚未收到内容时显示输入中的点 */}
          {busy && (
            <Row mine={false} name={title} avatar={character?.avatar} showAvatar>
              <div className="bubble bubble-them whitespace-pre-wrap break-words" aria-live="polite">
                {reply.partial ? (
                  reply.partial
                ) : (
                  <span className="typing-dots" aria-label={`${title}正在输入`}>
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
            </Row>
          )}

          {reply.status === 'error' && (
            <div className="mx-6 mt-1 glass-1 rounded-[var(--radius-card)] px-4 py-3 text-[12.5px] leading-relaxed">
              <div className="flex items-start gap-2 text-[var(--c-danger)]">
                <Icon name="alert" size="sm" className="shrink-0 mt-0.5" />
                <span>{reply.error}</span>
              </div>
              <div className="mt-2.5 flex justify-end gap-2">
                <button onClick={() => dismissError(convId)} className="press h-7 px-3 rounded-full text-[12px] text-[var(--c-text-2)]">
                  关闭
                </button>
                {(reply.errorKind === 'config' || reply.errorKind === 'auth' || reply.errorKind === 'model' || reply.errorKind === 'network') && (
                  <button onClick={() => nav('/me/api')} className="press h-7 px-3 rounded-full border border-[var(--c-line)] bg-white/50 text-[12px] text-[var(--c-text-2)]">
                    检查设置
                  </button>
                )}
                {ai.service === 'lingling' && (reply.errorKind === 'quota' || reply.errorKind === 'unavailable') && (
                  <button onClick={() => nav('/me/api')} className="press h-7 px-3 rounded-full border border-[var(--c-line)] bg-white/50 text-[12px] text-[var(--c-text-2)]">
                    使用自己的 API
                  </button>
                )}
                <button
                  onClick={() => void runReply(convId, reply.regenerating)}
                  className="press h-7 px-3 rounded-full bg-[var(--c-accent)] text-white text-[12px]"
                >
                  重试
                </button>
              </div>
            </div>
          )}
        </div>

        {showJump && (
          <button
            onClick={() => scrollToBottom(true)}
            className="press absolute right-4 bottom-2 h-8 pl-2.5 pr-3 rounded-full glass-1 shadow-[var(--shadow-soft)] flex items-center gap-1 text-[12px] text-[var(--c-accent-strong)]"
          >
            <Icon name="scrollDown" size="xs" />
            回到底部
          </button>
        )}
      </div>

      {/* 悬浮输入栏：发送；生成中且输入框为空时变为「停止」 */}
      <footer className="shrink-0 relative z-10 px-3 pt-1.5" style={{ paddingBottom: 'calc(var(--safe-bottom) + 8px)' }}>
        <div className="glass-1 rounded-[24px] p-1.5 flex items-end gap-1.5 shadow-[var(--shadow-float)]">
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={title ? `写一封信给${title}……` : '写一封信……'}
            enterKeyHint="enter"
            className="flex-1 min-w-0 resize-none rounded-[19px] bg-white/55 border border-white/70 px-3.5 py-[7px] text-[16px] leading-snug outline-none placeholder:text-[var(--c-text-3)]"
            style={{ maxHeight: MAX_INPUT_HEIGHT }}
          />
          {busy && !text.trim() ? (
            <button
              aria-label="停止生成"
              onClick={() => stopReply(convId)}
              className="press h-[34px] w-[34px] shrink-0 rounded-full flex items-center justify-center bg-white/70 border border-[var(--c-line)] text-[var(--c-accent-strong)]"
            >
              <Icon name="stop" size="xs" stroke="bold" />
            </button>
          ) : (
            <button
              aria-label="发送"
              onClick={() => void send()}
              disabled={!text.trim()}
              className={`press h-[34px] w-[34px] shrink-0 rounded-full flex items-center justify-center transition-colors ${
                text.trim() ? 'bg-[var(--c-accent)] text-white' : 'bg-white/50 text-[var(--c-text-3)]'
              }`}
            >
              <Icon name="send" size="sm" />
            </button>
          )}
        </div>
      </footer>

      {menuMsg && (
        <ActionSheet title={menuMsg.content.slice(0, 30)} onClose={() => setMenuMsg(null)} actions={menuActions(menuMsg)} />
      )}
    </div>
  )
}
