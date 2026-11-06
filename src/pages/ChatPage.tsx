import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import { db } from '../db/db'
import { markRead, saveDraft, sendUserMessage, softDeleteMessage } from '../db/repo'
import type { Message, Sticker } from '../db/schema'
import { listStickers, sendUserSticker } from '../db/stickerRepo'
import StickerPanel from '../components/StickerPanel'
import { StickerPicture } from '../components/StickerView'
import NavBar from '../components/NavBar'
import { BOW_SVG, dataUri } from '../assets/winter/ornaments'
import Avatar from '../components/Avatar'
import { ActionSheet } from '../components/Sheet'
import ContextUsedSheet from '../components/ContextUsedSheet'
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
/**
 * 一行消息：对方头像在左，自己的头像在右。
 * 头像的垂直中心与气泡第一行文字的中心对齐（气泡上内边距 8 + 行高的一半）。
 */
function Row({
  mine,
  name,
  avatar,
  showAvatar,
  avatarSize,
  fontSize,
  children,
}: {
  mine: boolean
  name: string
  avatar?: string
  showAvatar: boolean
  avatarSize: number
  fontSize: number
  children: ReactNode
}) {
  const offset = Math.max(0, Math.round(1 + 6.5 + (fontSize * 1.55) / 2 - avatarSize / 2))
  return (
    <div className={`flex items-start gap-2.5 pl-[24px] pr-[22px] ${mine ? 'flex-row-reverse pl-[22px] pr-[24px]' : ''}`}>
      <div className="shrink-0" style={{ width: avatarSize, paddingTop: offset }}>
        {showAvatar && <Avatar name={name} src={avatar} size={avatarSize} />}
      </div>
      <div className={`flex flex-col min-w-0 max-w-[70%] ${mine ? 'items-end' : 'items-start'}`}>{children}</div>
    </div>
  )
}

const EMOJIS = '😊 🥰 😌 🤭 😳 🥺 😭 😆 😴 🤔 😮 🙈 💗 💙 🤍 ✨ ⭐ 🌙 ☃️ ❄️ 🌨️ 🎐 🍵 ☕ 🧣 🧤 🎁 🌷 🌸 🍰 🐻‍❄️ 🐰 👋 👍 🙏 💭 🎶 📮 💌 🕯️'.split(' ')

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

/** 表情包消息：按原始比例显示图片（GIF 正常播放），不加气泡背景；表情包被删除后显示提示 */
function StickerBubble({ sticker, mine, onMenu }: { sticker?: Sticker; mine: boolean; onMenu: () => void }) {
  const { consumeClick: _c, ...press } = useLongPress(onMenu)
  void _c
  if (!sticker) {
    return (
      <div {...press} className={`bubble select-none text-[12px] opacity-70 ${mine ? 'bubble-me' : 'bubble-them'}`}>
        表情包已删除
      </div>
    )
  }
  return (
    <div {...press} className="select-none" style={{ WebkitTouchCallout: 'none' }}>
      <StickerPicture sticker={sticker} max={120} className="rounded-[10px] drop-shadow-[0_2px_6px_rgba(70,96,140,.18)]" />
    </div>
  )
}

const BOW_BG = dataUri(BOW_SVG)

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function ChatPage() {
  const { convId = '' } = useParams()
  // 从搜索结果进入：定位到那条消息并短暂高亮
  const [params] = useSearchParams()
  const focusId = params.get('m')
  const [flash, setFlash] = useState<string | null>(null)
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
  const [usedInfo, setUsedInfo] = useState<Message['contextUsed'] | null>(null)
  const [showJump, setShowJump] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [panelTab, setPanelTab] = useState<'emoji' | 'sticker'>('sticker')
  const stickers = useLiveQuery(listStickers, [], [] as Sticker[])
  const stickerById = useMemo(() => new Map(stickers.map((st) => [st.id, st])), [stickers])

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

  /* ---- 识图没有成功：提示一次（回复照常进行，按「没看懂图片」处理） ---- */
  useEffect(() => {
    if (reply.visionNote) showToast(reply.visionNote)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply.visionNote])

  const focused = useRef(false)
  useEffect(() => {
    if (!focusId || focused.current) return
    const el = document.getElementById(`msg-${focusId}`)
    if (!el) return
    focused.current = true
    stickNext.current = false
    requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }))
    setFlash(focusId)
    const t = setTimeout(() => setFlash(null), 2200)
    return () => clearTimeout(t)
  })

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

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), Math.min(5000, 1800 + msg.length * 40))
  }

  /** 在光标处插入表情（普通 Emoji 插入文字输入框） */
  const insertEmoji = (e: string) => {
    const ta = taRef.current
    const start = ta?.selectionStart ?? text.length
    const end = ta?.selectionEnd ?? text.length
    const next = text.slice(0, start) + e + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      if (!ta) return
      ta.setSelectionRange(start + e.length, start + e.length)
    })
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

  const sendSticker = async (st: Sticker) => {
    if (!conv) return
    stickNext.current = true
    try {
      await sendUserSticker(convId, st)
    } catch {
      stickNext.current = false
      showToast('表情包发送失败，请重试')
      return
    }
    if (!notConfigured) scheduleReply(convId)
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
    const acts: SheetAction[] = m.kind === 'sticker' ? [] : [{ label: '复制', onClick: () => void copyText(m.content) }]
    if (m.senderType === 'character' && lastGroup?.some((x) => x.id === m.id) && !busy && !notConfigured) {
      acts.push({ label: '重新生成', onClick: () => void regenerate(convId) })
    }
    if (m.senderType === 'character') {
      const head = visible.find((x) => x.replyGroupId && x.replyGroupId === m.replyGroupId && x.contextUsed) ?? (m.contextUsed ? m : undefined)
      if (head?.contextUsed) acts.push({ label: '这次用到的记忆与设定', onClick: () => setUsedInfo(head.contextUsed!) })
    }
    acts.push({ label: '删除', danger: true, onClick: () => void softDeleteMessage(m) })
    return acts
  }

  const avatarSize = Math.min(34, Math.max(24, theme.chatText.avatar ?? 28))
  const fontSize = theme.chatText.size
  const decor = theme.bubble.ornament
  const hasText = !!text.trim()

  return (
    <div className="h-dvh flex flex-col">
      <ChatWallpaper />

      {/* 顶部：轻盈的冰晶玻璃胶囊 */}
      <header className="shrink-0 relative z-10 px-5" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
        <div className="ice relative h-[46px] rounded-full flex items-center px-1.5">
          <button aria-label="返回" onClick={() => nav('/')} className="press h-11 w-11 flex items-center justify-center">
            <span className="ice-hi h-[27px] w-[27px] rounded-full flex items-center justify-center text-[#56678a]">
              <Icon name="back" size="sm" stroke="thin" />
            </span>
          </button>
          <div className="flex-1 min-w-0 text-center">
            <div className="serif-zh text-[15.5px] leading-tight tracking-[0.1em] text-[#4b5a73] truncate">{title}</div>
            <div className="serif-zh mt-[2px] text-[10.5px] tracking-[0.12em] text-[#6f7f9c] truncate">
              {typing ?? worldName ?? (character?.bio ? character.bio.slice(0, 18) : 'Winter Letter')}
            </div>
          </div>
          <button
            aria-label="角色资料"
            onClick={() => charId && nav(`/character/${charId}`)}
            className="press h-11 w-11 flex items-center justify-center"
          >
            <span className="ice-hi h-[27px] w-[27px] rounded-full flex items-center justify-center text-[#56678a]">
              <Icon name="more" size="sm" stroke="thin" />
            </span>
          </button>
          {decor && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-[17px] -right-[6px] h-[34px] w-[50px]"
              style={{ backgroundImage: BOW_BG, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', filter: 'drop-shadow(0 2px 3px rgba(90,110,160,.25))' }}
            />
          )}
        </div>
      </header>

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="chat-text h-full overflow-y-auto pt-4 pb-5 flex flex-col gap-[18px]"
          style={{ overscrollBehavior: 'contain' }}
        >
          {/* 信笺抬头：日期标签 + 花体小字（装饰，独立于聊天数据） */}
          <div className="flex flex-col items-center gap-[9px]">
            <span className="ice date-tag">
              {firstDate.getMonth() + 1}月{firstDate.getDate()}日 · {WEEK[firstDate.getDay()]}
              {decor && <span className="mini-flake text-[#7d8fb0]" />}
            </span>
            <div className="script-line w-[80%]">
              <span className="script-en text-[15.5px] whitespace-nowrap">A letter from winter ♡</span>
            </div>
            {notConfigured && (
              <button onClick={() => nav('/me/api')} className="press ice date-tag text-[11px] text-[var(--c-accent-strong)]" style={{ fontFamily: 'inherit' }}>
                {ai.service === 'lingling' ? '聆聆默认服务尚未开通 · 改用自己的 API' : '尚未配置 AI 服务 · 去设置'}
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
              // 同一方连续发出的几条靠得更近，像一组消息
              <div
                key={m.id}
                id={`msg-${m.id}`}
                className={`flex flex-col gap-[18px] transition-colors duration-700 ${flash === m.id ? 'bg-white/45 rounded-[14px]' : ''}`}
                style={showAvatar ? undefined : { marginTop: -10 }}
              >
                {prev && m.createdAt - prev.createdAt > GAP_MS && (
                  <div className="flex justify-center">
                    <span className="ice date-tag tabular-nums" style={{ fontFamily: 'inherit' }}>{formatChatTime(m.createdAt)}</span>
                  </div>
                )}
                <Row
                  mine={mine}
                  name={mine ? profile.nickname : title}
                  avatar={mine ? profile.avatar : character?.avatar}
                  showAvatar={showAvatar}
                  avatarSize={avatarSize}
                  fontSize={fontSize}
                >
                  {m.kind === 'sticker' ? (
                    <StickerBubble sticker={stickerById.get(m.stickerId ?? '')} mine={mine} onMenu={() => setMenuMsg(m)} />
                  ) : (
                    <Bubble msg={m} mine={mine} ornament={decor} onMenu={() => setMenuMsg(m)} />
                  )}
                  {versions && versions.count > 1 && family && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-[#6f7f9c]">
                      <button
                        aria-label="上一个版本"
                        disabled={versions.index <= 1 || busy}
                        onClick={() => void switchVersion(convId, family, -1)}
                        className="press h-7 w-7 flex items-center justify-center disabled:opacity-30"
                      >
                        <Icon name="back" size="xs" stroke="thin" />
                      </button>
                      <span className="tabular-nums">
                        {versions.index} / {versions.count}
                      </span>
                      <button
                        aria-label="下一个版本"
                        disabled={versions.index >= versions.count || busy}
                        onClick={() => void switchVersion(convId, family, 1)}
                        className="press h-7 w-7 flex items-center justify-center disabled:opacity-30"
                      >
                        <Icon name="forward" size="xs" stroke="thin" />
                      </button>
                    </div>
                  )}
                </Row>
              </div>
            )
          })}

          {/* 生成中：写完的消息会逐条出现在上面；正在写的一条较长时（认真回答）显示实时内容，否则显示输入中的点 */}
          {busy && (() => {
            const cont = !!reply.delivered && visible.length > 0 && visible[visible.length - 1].senderType === 'character'
            return (
            <div style={cont ? { marginTop: -10 } : undefined}>
            <Row mine={false} name={title} avatar={character?.avatar} showAvatar={!cont} avatarSize={avatarSize} fontSize={fontSize}>
              <div className="bubble bubble-them whitespace-pre-wrap break-words" aria-live="polite">
                {reply.phase === 'vision' ? (
                  <span className="text-[12px] text-[#6f7f9c]">正在看你发的表情包…</span>
                ) : reply.partial.length >= 40 ? (
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
            </div>
            )
          })()}

          {reply.status === 'error' && (
            <div className="mx-8 ice rounded-[16px] px-4 py-3 text-[12.5px] leading-relaxed">
              <div className="flex items-start gap-2 text-[var(--c-danger)]">
                <Icon name="alert" size="sm" stroke="thin" className="shrink-0 mt-0.5" />
                <span>{reply.error}</span>
              </div>
              <div className="mt-2.5 flex justify-end gap-2">
                <button onClick={() => dismissError(convId)} className="press h-8 px-3 rounded-full text-[12px] text-[#5a6a86]">
                  关闭
                </button>
                {(reply.errorKind === 'config' || reply.errorKind === 'auth' || reply.errorKind === 'model' || reply.errorKind === 'network' ||
                  (ai.service === 'lingling' && (reply.errorKind === 'quota' || reply.errorKind === 'unavailable'))) && (
                  <button onClick={() => nav('/me/api')} className="press ice-hi h-8 px-3 rounded-full text-[12px] text-[#5a6a86]">
                    {ai.service === 'lingling' && (reply.errorKind === 'quota' || reply.errorKind === 'unavailable') ? '使用自己的 API' : '检查设置'}
                  </button>
                )}
                <button
                  onClick={() => void runReply(convId, reply.regenerating)}
                  className="press h-8 px-3.5 rounded-full bg-[var(--c-accent)] text-white text-[12px]"
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
            className="press ice absolute right-5 bottom-2 h-8 pl-2.5 pr-3 rounded-full flex items-center gap-1 text-[12px] text-[#56678a]"
          >
            <Icon name="scrollDown" size="xs" stroke="thin" />
            回到底部
          </button>
        )}
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="ice date-tag text-[12px]" style={{ fontFamily: 'inherit' }}>{toast}</span>
          </div>
        )}
      </div>

      {/* 表情面板：Emoji 插入输入框；表情包点一下直接发送，长按管理 */}
      {emojiOpen && (
        <div className="relative z-10 mx-4 mb-1.5 ice rounded-[20px] px-2.5 pt-1.5 pb-2.5">
          <div className="flex items-center gap-1 px-1 pb-1.5">
            {(['emoji', 'sticker'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setPanelTab(t)}
                className={`press h-7 px-3 rounded-full text-[12px] tracking-[0.06em] ${panelTab === t ? 'ice-hi text-[var(--c-accent-strong)]' : 'text-[#6f7f9c]'}`}
              >
                {t === 'emoji' ? 'Emoji' : '表情包'}
              </button>
            ))}
            {panelTab === 'sticker' && <span className="ml-auto pr-1 text-[10.5px] text-[#8090ad]">点一下发送 · 长按预览</span>}
          </div>
          {panelTab === 'emoji' ? (
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => insertEmoji(e)} className="press h-9 text-[21px] leading-none flex items-center justify-center" aria-label={`插入 ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          ) : (
            <StickerPanel onSend={(st) => void sendSticker(st)} toast={showToast} />
          )}
        </div>
      )}

      {/* 悬浮输入栏：＋（快捷操作）· 输入框 · 表情 · 语音（未开放）/ 发送 / 停止 */}
      <footer className="shrink-0 relative z-10 px-4" style={{ paddingBottom: decor ? 'max(var(--safe-bottom), 4px)' : 'calc(var(--safe-bottom) + 8px)' }}>
        <div className="ice rounded-[26px] pl-1 pr-1 py-[3px] flex items-end gap-0.5">
          <button aria-label="更多操作" onClick={() => setPlusOpen(true)} className="press hit h-[38px] w-10 shrink-0 flex items-center justify-center text-[#6a7b9b]">
            <Icon name="add" size="lg" stroke="thin" />
          </button>
          <div className="ice-hi flex-1 min-w-0 rounded-[20px] flex items-end">
            <textarea
              ref={taRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => setEmojiOpen(false)}
              placeholder={title ? `写一封信给${title}……` : '写一封信……'}
              enterKeyHint="enter"
              className="flex-1 min-w-0 resize-none bg-transparent pl-3.5 pr-1 py-[7px] text-[16px] leading-[1.4] tracking-[0.03em] text-[#424f6a] outline-none placeholder:text-[13.5px] placeholder:tracking-[0.06em] placeholder:text-[#8d9ab3]"
              style={{ maxHeight: MAX_INPUT_HEIGHT }}
            />
            <button
              aria-label="表情"
              onClick={() => setEmojiOpen((v) => !v)}
              className={`press hit h-[38px] w-10 shrink-0 flex items-center justify-center ${emojiOpen ? 'text-[var(--c-accent-strong)]' : 'text-[#6a7b9b]'}`}
            >
              <Icon name="emoji" size="lg" stroke="thin" />
            </button>
          </div>
          {busy && !hasText ? (
            <button aria-label="停止生成" onClick={() => stopReply(convId)} className="press hit h-[38px] w-11 shrink-0 flex items-center justify-center text-[var(--c-accent-strong)]">
              <span className="ice-hi h-[30px] w-[30px] rounded-full flex items-center justify-center">
                <Icon name="stop" size="xs" stroke="bold" />
              </span>
            </button>
          ) : hasText ? (
            <button aria-label="发送" onClick={() => void send()} className="press hit h-[38px] w-11 shrink-0 flex items-center justify-center">
              <span className="h-[30px] w-[30px] rounded-full bg-[var(--c-accent)] text-white flex items-center justify-center shadow-[0_3px_10px_rgba(95,128,170,.35)]">
                <Icon name="send" size="xs" />
              </span>
            </button>
          ) : (
            /* 语音消息尚未实现：图标只作占位，点击会如实提示，不会伪装成已录音 */
            <button
              aria-label="语音消息（尚未开放）"
              onClick={() => showToast('语音消息还在开发中，暂未开放')}
              className="press hit h-[38px] w-10 shrink-0 flex items-center justify-center text-[#6a7b9b] opacity-70"
            >
              <Icon name="voice" size="lg" stroke="thin" />
            </button>
          )}
        </div>
        {decor && (
          <div className="chat-signature h-[26px]" aria-hidden="true">
            <span className="mini-flake" />
            <span className="mini-flake opacity-70" />
            <span className="line" />
            <span className="script-en text-[14px] tracking-[0.02em]">Winter Letter</span>
            <span className="line" />
            <span className="mini-flake opacity-70" />
            <span className="mini-flake" />
          </div>
        )}
      </footer>

      {plusOpen && (
        <ActionSheet
          title="快捷操作"
          onClose={() => setPlusOpen(false)}
          actions={[
            ...(charId ? [{ label: '查看角色资料', icon: <Icon name="character" />, onClick: () => nav(`/character/${charId}`) }] : []),
            { label: '聊天外观', hint: '壁纸、气泡、字体与头像大小', icon: <Icon name="theme" />, onClick: () => nav('/me/theme') },
            ...(lastGroup && !busy && !notConfigured
              ? [{ label: '重新生成上一条回复', icon: <Icon name="regenerate" />, onClick: () => void regenerate(convId) }]
              : []),
          ]}
        />
      )}
      {menuMsg && (
        <ActionSheet title={menuMsg.content.slice(0, 30)} onClose={() => setMenuMsg(null)} actions={menuActions(menuMsg)} />
      )}
      {usedInfo && <ContextUsedSheet used={usedInfo} onClose={() => setUsedInfo(null)} onOpenFull={charId ? () => nav(`/character/${charId}/context`) : undefined} />}

    </div>
  )
}
