import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
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
import { configProblem } from '../services/ai/openai'
import { useAIConfigLoaded } from '../store/profile'

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

export default function MessagesPage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [menuFor, setMenuFor] = useState<Conversation | null>(null)
  const [confirmDel, setConfirmDel] = useState<Conversation | null>(null)

  const convs = useLiveQuery(() => db.conversations.toArray(), [], [] as Conversation[])
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  // 读取完成前不显示，避免已配置的用户看到一闪而过的提示
  const ai = useAIConfigLoaded()
  const needsSetup = ai !== undefined && configProblem(ai) !== null
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
        {needsSetup && (
          <button
            onClick={() => nav('/setup')}
            className="press mx-3 mb-1.5 w-[calc(100%-1.5rem)] flex items-center gap-2.5 rounded-full glass-1 h-10 px-4 text-left"
          >
            <Icon name="key" size="sm" className="shrink-0 text-[var(--c-accent-strong)]" />
            <span className="flex-1 min-w-0 truncate text-[13px] text-[var(--c-text-2)]">
              还差一步：<span className="text-[var(--c-accent-strong)]">连接 AI</span>，角色就能回复你
            </span>
            <Icon name="forward" size="sm" className="shrink-0 text-[var(--c-text-3)]" />
          </button>
        )}
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
