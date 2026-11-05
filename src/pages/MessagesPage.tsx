import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pin } from 'lucide-react'
import { db } from '../db/db'
import { deleteConversation, setPinned } from '../db/repo'
import type { Character, Conversation } from '../db/schema'
import NavBar from '../components/NavBar'
import Brand from '../components/Brand'
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
        <Avatar name={name} src={character?.avatar} size={48} />
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
            {conv.pinned && <Pin size={11} strokeWidth={1.8} />}
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

export default function MessagesPage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [menuFor, setMenuFor] = useState<Conversation | null>(null)
  const [confirmDel, setConfirmDel] = useState<Conversation | null>(null)

  const convs = useLiveQuery(() => db.conversations.toArray(), [], [] as Conversation[])
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const charMap = useMemo(() => new Map(chars.map((c) => [c.id, c])), [chars])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return convs
      .filter((c) => {
        if (!kw) return true
        const name = c.type === 'group' ? c.title ?? '' : charMap.get(c.characterIds[0])?.name ?? ''
        return name.toLowerCase().includes(kw) || c.lastMessagePreview.toLowerCase().includes(kw)
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastMessageAt - a.lastMessageAt)
  }, [convs, charMap, q])

  return (
    <>
      <NavBar title={<Brand />} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SearchBox value={q} onChange={setQ} placeholder="搜索会话" />
        {list.length === 0 ? (
          q ? (
            <Empty title="没有找到相关会话" />
          ) : (
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
