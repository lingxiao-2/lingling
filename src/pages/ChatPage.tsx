import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import { db } from '../db/db'
import { markRead, saveDraft, sendUserMessage, softDeleteMessage } from '../db/repo'
import type { Message } from '../db/schema'
import NavBar, { NavButton } from '../components/NavBar'
import Avatar from '../components/Avatar'
import { ActionSheet } from '../components/Sheet'
import { useProfile } from '../store/profile'
import { formatChatTime } from '../lib/util'
import { useLongPress } from '../lib/usePress'

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

function Bubble({
  msg,
  mine,
  name,
  avatar,
  onMenu,
}: {
  msg: Message
  mine: boolean
  name: string
  avatar?: string
  onMenu: () => void
}) {
  const press = useLongPress(onMenu)
  return (
    <div className={`flex items-start gap-2.5 px-3 ${mine ? 'flex-row-reverse' : ''}`}>
      <Avatar name={name} src={avatar} size="chat" />
      <div className={`flex flex-col max-w-[72%] ${mine ? 'items-end' : 'items-start'}`}>
        <div
          {...press}
          className={`select-none whitespace-pre-wrap break-words px-3.5 py-2.5 rounded-2xl text-[15.5px] leading-relaxed shadow-[0_1px_2px_rgba(60,90,130,0.08)] ${
            mine
              ? 'bg-[var(--c-bubble-me)] rounded-tr-md'
              : 'bg-[var(--c-bubble-them)] rounded-tl-md'
          }`}
          style={{ WebkitTouchCallout: 'none' }}
        >
          {msg.content}
        </div>
        {msg.status === 'failed' && <span className="mt-1 text-[11px] text-[var(--c-danger)]">发送失败</span>}
      </div>
    </div>
  )
}

export default function ChatPage() {
  const { convId = '' } = useParams()
  const nav = useNavigate()
  const profile = useProfile()

  const conv = useLiveQuery(async () => (await db.conversations.get(convId)) ?? null, [convId])
  const charId = conv?.characterIds[0]
  const character = useLiveQuery(
    async () => (charId ? (await db.characters.get(charId)) ?? null : null),
    [charId],
  )
  const messages = useLiveQuery(
    () => db.messages.where('conversationId').equals(convId).sortBy('createdAt'),
    [convId],
  )
  const visible = useMemo(() => (messages ?? []).filter((m) => !m.deleted), [messages])

  const [text, setText] = useState('')
  const [menuMsg, setMenuMsg] = useState<Message | null>(null)
  const [showJump, setShowJump] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const draftReady = useRef(false)
  const latestText = useRef('')
  const initialScrolled = useRef(false)
  const stickNext = useRef(false)

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

  /* ---- 滚动：仅首次进入和自己发送时滚到底部，新消息不强制滚动 ---- */
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
    }
  }, [messages, scrollToBottom])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_THRESHOLD)
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
    }
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

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title={title}
        back="/"
        right={
          charId && (
            <NavButton label="角色资料" icon="more" onClick={() => nav(`/character/${charId}`)} />
          )
        }
      />

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto py-3 flex flex-col gap-3"
          style={{ overscrollBehavior: 'contain' }}
        >
          <div className="mx-auto max-w-[85%] text-center text-[11px] leading-relaxed text-[var(--c-text-3)] px-3 py-1.5 rounded-full bg-white/50">
            当前版本只保存你发出的消息，AI 回复将在下一轮开发中接入
          </div>

          {visible.map((m, i) => {
            const prev = visible[i - 1]
            const mine = m.senderType === 'user'
            return (
              <div key={m.id} className="flex flex-col gap-3">
                {(!prev || m.createdAt - prev.createdAt > GAP_MS) && (
                  <div className="text-center text-[11px] text-[var(--c-text-3)]">
                    {formatChatTime(m.createdAt)}
                  </div>
                )}
                <Bubble
                  msg={m}
                  mine={mine}
                  name={mine ? profile.nickname : title}
                  avatar={mine ? profile.avatar : character?.avatar}
                  onMenu={() => setMenuMsg(m)}
                />
              </div>
            )
          })}
        </div>

        {showJump && (
          <button
            onClick={() => scrollToBottom(true)}
            className="press absolute right-4 bottom-3 h-9 pl-3 pr-3.5 rounded-full glass shadow-md flex items-center gap-1 text-xs text-[var(--c-accent-strong)]"
          >
            <Icon name="scrollDown" size="xs" />
            回到底部
          </button>
        )}
      </div>

      <footer
        className="glass hairline-t shrink-0 px-3 pt-2"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 8px)' }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入消息"
            enterKeyHint="enter"
            className="flex-1 min-w-0 resize-none rounded-2xl bg-white/90 px-3.5 py-2.5 text-[16px] leading-snug outline-none"
            style={{ maxHeight: MAX_INPUT_HEIGHT }}
          />
          <button
            aria-label="发送"
            onClick={() => void send()}
            disabled={!text.trim()}
            className="press h-10 w-10 shrink-0 rounded-full bg-[var(--c-accent)] text-white flex items-center justify-center disabled:opacity-35"
          >
            <Icon name="send" size="md" />
          </button>
        </div>
      </footer>

      {menuMsg && (
        <ActionSheet
          title={menuMsg.content.slice(0, 30)}
          onClose={() => setMenuMsg(null)}
          actions={[
            { label: '复制', onClick: () => void copyText(menuMsg.content) },
            { label: '删除', danger: true, onClick: () => void softDeleteMessage(menuMsg) },
          ]}
        />
      )}
    </div>
  )
}
