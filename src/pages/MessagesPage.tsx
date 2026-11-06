import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import { db } from '../db/db'
import { deleteConversation, getOrCreateSingleConversation, setPinned } from '../db/repo'
import type { Character, Conversation, Message } from '../db/schema'
import { searchAll } from '../lib/search'
import Avatar from '../components/Avatar'
import { ActionSheet, ConfirmDialog } from '../components/Sheet'
import { Empty, SearchBox } from '../components/ui'
import { formatListTime } from '../lib/util'
import { useLongPress } from '../lib/usePress'

function ConvRow({
  conv,
  character,
  onOpen,
  onMenu,
}: {
  conv: Conversation
  character?: Character
  onOpen: () => void
  onMenu: () => void
}) {
  const press = useLongPress(onMenu)
  const name = conv.type === 'group' ? conv.title ?? '群聊' : character?.name ?? '已删除的角色'
  const hasDraft = conv.draft.trim().length > 0
  return (
    <div
      {...press}
      onClick={() => {
        if (!press.consumeClick()) onOpen()
      }}
      className={`press flex items-center gap-3 px-4 py-3 hairline-b select-none ${
        conv.pinned ? 'bg-white/50' : ''
      }`}
    >
      <div className="relative">
        <Avatar name={name} src={character?.avatar} size="list" />
        {conv.unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--c-danger)] text-white text-[11px] leading-[18px] text-center">
            {conv.unread > 99 ? '99+' : conv.unread}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[16px] truncate">{name}</span>
          <span className="shrink-0 text-[11px] text-[var(--c-text-3)] flex items-center gap-1">
            {conv.pinned && <Icon name="pin" size="xs" stroke="thin" />}
            {formatListTime(conv.lastMessageAt)}
          </span>
        </div>
        <div className="text-[13px] text-[var(--c-text-3)] truncate mt-0.5">
          {hasDraft ? (
            <>
              <span className="text-[var(--c-danger)]">[草稿] </span>
              {conv.draft.trim()}
            </>
          ) : (
            conv.lastMessagePreview || '开始聊天吧'
          )}
        </div>
      </div>
    </div>
  )
}

function Highlight({ text, kw }: { text: string; kw: string }) {
  const i = text.toLowerCase().indexOf(kw.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <span className="text-[var(--c-accent-strong)]">{text.slice(i, i + kw.length)}</span>
      {text.slice(i + kw.length)}
    </>
  )
}

function SearchResults({
  kw,
  result,
  charMap,
  onCharacter,
  onConversation,
  onMessage,
}: {
  kw: string
  result: ReturnType<typeof searchAll>
  charMap: Map<string, Character>
  onCharacter: (id: string) => void
  onConversation: (id: string) => void
  onMessage: (convId: string, msgId: string) => void
}) {
  const none = !result.characters.length && !result.conversations.length && !result.messages.length
  if (none) return <Empty title={`没有找到「${kw}」`} hint="可以搜索角色名称、简介或聊天记录中的文字" />
  const head = (t: string) => <div className="px-5 pt-3 pb-1 text-[11.5px] tracking-wider text-[var(--c-text-3)]">{t}</div>
  return (
    <div className="pb-6">
      {result.characters.length > 0 && head('联系人')}
      {result.characters.map((c) => (
        <button key={c.id} onClick={() => onCharacter(c.id)} className="press w-full flex items-center gap-3 px-4 py-2.5 hairline-b text-left">
          <Avatar name={c.name} src={c.avatar} size="list" />
          <div className="min-w-0">
            <div className="text-[15px] truncate"><Highlight text={c.name} kw={kw} /></div>
            {c.bio && <div className="text-[12px] text-[var(--c-text-3)] truncate"><Highlight text={c.bio} kw={kw} /></div>}
          </div>
        </button>
      ))}
      {result.conversations.length > 0 && head('会话')}
      {result.conversations.map((c) => {
        const ch = charMap.get(c.characterIds[0])
        const name = c.type === 'group' ? c.title ?? '群聊' : ch?.name ?? '已删除的角色'
        return (
          <button key={c.id} onClick={() => onConversation(c.id)} className="press w-full flex items-center gap-3 px-4 py-2.5 hairline-b text-left">
            <Avatar name={name} src={ch?.avatar} size="list" />
            <div className="min-w-0 text-[15px] truncate"><Highlight text={name} kw={kw} /></div>
          </button>
        )
      })}
      {result.messages.length > 0 && head(`聊天记录${result.messages.length >= 50 ? '（最近 50 条）' : ''}`)}
      {result.messages.map(({ message, conversation, snippet }) => {
        const ch = charMap.get(conversation.characterIds[0])
        const name = conversation.type === 'group' ? conversation.title ?? '群聊' : ch?.name ?? '已删除的角色'
        return (
          <button key={message.id} onClick={() => onMessage(conversation.id, message.id)} className="press w-full flex items-center gap-3 px-4 py-2.5 hairline-b text-left">
            <Avatar name={name} src={ch?.avatar} size="list" />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2">
                <span className="text-[14.5px] truncate">{name}</span>
                <span className="shrink-0 text-[11px] text-[var(--c-text-3)]">{formatListTime(message.createdAt)}</span>
              </div>
              <div className="text-[12.5px] text-[var(--c-text-2)] truncate">
                {message.senderType === 'user' ? '我：' : ''}
                <Highlight text={snippet} kw={kw} />
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export default function MessagesPage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [menuFor, setMenuFor] = useState<Conversation | null>(null)
  const [confirmDel, setConfirmDel] = useState<Conversation | null>(null)

  const convs = useLiveQuery(() => db.conversations.toArray(), [], [] as Conversation[])
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const charMap = useMemo(() => new Map(chars.map((c) => [c.id, c])), [chars])

  const list = useMemo(
    () => [...convs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastMessageAt - a.lastMessageAt),
    [convs],
  )

  // 搜索：输入停顿 200ms 后在本机的角色、会话和聊天记录中查找
  const [kw, setKw] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setKw(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])
  const messages = useLiveQuery(async () => (kw ? db.messages.toArray() : ([] as Message[])), [kw], [] as Message[])
  const result = useMemo(() => searchAll(kw, chars, convs, messages), [kw, chars, convs, messages])
  const openCharacter = async (id: string) => nav(`/chat/${await getOrCreateSingleConversation(id)}`)

  return (
    <>
      {/* 微信式紧凑顶部：小标题 + 细线图标，不再放大号品牌标题 */}
      <header className="shrink-0 relative z-10 px-2" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="h-11 flex items-center">
          <div className="w-11" />
          <div className="flex-1 text-center serif-zh text-[16.5px] tracking-[0.1em] text-[var(--c-text)]">消息</div>
          <button aria-label="新建聊天" onClick={() => nav('/contacts')} className="press h-11 w-11 flex items-center justify-center text-[var(--c-text)]">
            <Icon name="plus" size="md" stroke="thin" />
          </button>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SearchBox value={q} onChange={setQ} placeholder="搜索联系人、聊天记录" />
        {kw ? (
          <SearchResults
            kw={kw}
            result={result}
            charMap={charMap}
            onCharacter={(id) => void openCharacter(id)}
            onConversation={(id) => nav(`/chat/${id}`)}
            onMessage={(convId, msgId) => nav(`/chat/${convId}?m=${msgId}`)}
          />
        ) : list.length === 0 ? (
          (
            <Empty
              title="还没有会话"
              hint={
                chars.length === 0
                  ? '先到「联系人」创建一个 AI 角色，再开始聊天。'
                  : '到「联系人」选择角色，开始第一次聊天。'
              }
            />
          )
        ) : (
          list.map((c) => (
            <ConvRow
              key={c.id}
              conv={c}
              character={charMap.get(c.characterIds[0])}
              onOpen={() => nav(`/chat/${c.id}`)}
              onMenu={() => setMenuFor(c)}
            />
          ))
        )}
      </div>

      {menuFor && (
        <ActionSheet
          onClose={() => setMenuFor(null)}
          actions={[
            {
              label: menuFor.pinned ? '取消置顶' : '置顶会话',
              onClick: () => void setPinned(menuFor.id, !menuFor.pinned),
            },
            { label: '删除会话', danger: true, onClick: () => setConfirmDel(menuFor) },
          ]}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title="删除这个会话？"
          message="该会话的全部聊天记录将被永久删除，角色本身不会被删除。"
          confirmText="删除"
          danger
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => {
            void deleteConversation(confirmDel.id)
            setConfirmDel(null)
          }}
        />
      )}
    </>
  )
}
