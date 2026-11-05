import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import NavBar, { NavButton } from '../components/NavBar'
import Avatar from '../components/Avatar'
import WorldCover from '../components/WorldCover'
import PickerSheet from '../components/PickerSheet'
import { ActionSheet, ConfirmDialog } from '../components/Sheet'
import { db } from '../db/db'
import { DEFAULT_WORLD_ID } from '../db/schema'
import type { Character, Lorebook, World } from '../db/schema'
import { deleteWorld, linkWorldLorebook, setCharacterWorld, unlinkWorldLorebook } from '../db/repo'

function Heading({ en, zh, action }: { en: string; zh: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-end justify-between px-5 pt-8 pb-3">
      <div>
        <div className="eyebrow">{en}</div>
        <div className="serif-zh mt-1 text-[17px] tracking-[0.12em] text-[var(--c-brand)]">{zh}</div>
      </div>
      {action && (
        <button onClick={action.onClick} className="press text-[13px] text-[var(--c-accent-strong)] px-1 pb-0.5">
          {action.label}
        </button>
      )}
    </div>
  )
}

export default function WorldDetailPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const world = useLiveQuery(async () => (await db.worlds.get(id)) ?? null, [id])
  const allChars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const allWorlds = useLiveQuery(() => db.worlds.toArray(), [], [] as World[])
  const allBooks = useLiveQuery(() => db.lorebooks.toArray(), [], [] as Lorebook[])
  const bookIds = useLiveQuery(
    async () => (await db.worldLorebooks.where('worldId').equals(id).toArray()).map((l) => l.lorebookId),
    [id],
    [] as string[],
  )
  const [expanded, setExpanded] = useState(false)
  const [picker, setPicker] = useState<'residents' | 'books' | null>(null)
  const [menu, setMenu] = useState<'residents' | 'books' | null>(null)
  const [removeChar, setRemoveChar] = useState<Character | null>(null)
  const [unlinkBook, setUnlinkBook] = useState<Lorebook | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)

  if (!world || id === DEFAULT_WORLD_ID) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="世界" back />
        <div className="p-10 text-center text-sm text-[var(--c-text-3)]">
          {world === undefined ? '加载中…' : '世界不存在或已被删除'}
        </div>
      </div>
    )
  }

  const residents = allChars.filter((c) => c.worldId === id)
  const books = allBooks.filter((b) => bookIds.includes(b.id))
  const worldName = new Map(allWorlds.map((w) => [w.id, w.name]))
  const longDesc = world.description.length > 160 || world.description.split('\n').length > 6

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title={world.name}
        back
        right={
          <NavButton label="编辑世界" icon="edit" onClick={() => nav(`/world/${id}/edit`)} />
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-12">
        <div className="px-4 pt-4">
          <WorldCover name={world.name} cover={world.cover} className="h-[210px] rounded-[24px] shadow-[0_12px_30px_rgba(70,105,145,0.18)]">
            <div className="absolute inset-0 cover-shade" />
            <div className="absolute left-6 right-6 bottom-5 text-white">
              <div className="eyebrow" style={{ color: "rgba(255,255,255,0.78)" }}>
                World
              </div>
              <div className="serif-zh mt-1.5 text-[26px] tracking-[0.18em] leading-tight break-words">{world.name}</div>
              {world.tagline && <div className="mt-1.5 text-[13px] tracking-wide text-white/85">{world.tagline}</div>}
            </div>
          </WorldCover>
        </div>

        <Heading en="Setting" zh="世界设定" />
        <div className="mx-4 card px-5 py-4">
          {world.description ? (
            <>
              <div
                className={`serif-zh text-[15px] leading-[1.9] text-[var(--c-text)] whitespace-pre-wrap break-words ${
                  expanded ? '' : 'line-clamp-6'
                }`}
              >
                {world.description}
              </div>
              {longDesc && (
                <button onClick={() => setExpanded((v) => !v)} className="press mt-2 text-xs text-[var(--c-accent-strong)]">
                  {expanded ? '收起' : '展开全文'}
                </button>
              )}
            </>
          ) : (
            <button onClick={() => nav(`/world/${id}/edit`)} className="press text-sm text-[var(--c-text-3)]">
              还没有写下设定，轻点编辑
            </button>
          )}
        </div>

        <Heading en="Residents" zh={`居民 · ${residents.length}`} action={{ label: '添加', onClick: () => setMenu('residents') }} />
        {residents.length === 0 ? (
          <div className="mx-4 card px-5 py-4 text-sm text-[var(--c-text-3)]">还没有居民。添加角色后，TA 将归属于这个世界。</div>
        ) : (
          <div className="mx-4 card overflow-hidden">
            {residents.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hairline-b last:border-b-0">
                <button onClick={() => nav(`/character/${c.id}`)} className="press flex flex-1 min-w-0 items-center gap-3 text-left">
                  <Avatar name={c.name} src={c.avatar} size="list" />
                  <span className="min-w-0">
                    <span className="block text-[15px] truncate">{c.name}</span>
                    {c.bio && <span className="block text-xs text-[var(--c-text-3)] truncate">{c.bio}</span>}
                  </span>
                </button>
                <button
                  onClick={() => setRemoveChar(c)}
                  className="press shrink-0 text-xs text-[var(--c-text-3)] px-2.5 h-7 rounded-full border border-[var(--c-line)]"
                >
                  移出
                </button>
              </div>
            ))}
          </div>
        )}

        <Heading en="Lorebooks" zh={`世界书 · ${books.length}`} action={{ label: '关联', onClick: () => setMenu('books') }} />
        {books.length === 0 ? (
          <div className="mx-4 card px-5 py-4 text-sm text-[var(--c-text-3)]">还没有关联世界书。</div>
        ) : (
          <div className="mx-4 card overflow-hidden">
            {books.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 hairline-b last:border-b-0">
                <button onClick={() => nav(`/lorebook/${b.id}`)} className="press flex-1 min-w-0 text-left">
                  <div className="text-[15px] truncate">{b.name}</div>
                  <div className="text-xs text-[var(--c-text-3)]">{b.entries.length} 个条目</div>
                </button>
                <button
                  onClick={() => setUnlinkBook(b)}
                  className="press shrink-0 text-xs text-[var(--c-text-3)] px-2.5 h-7 rounded-full border border-[var(--c-line)]"
                >
                  解除关联
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="mx-6 mt-5 text-[11px] leading-relaxed text-[var(--c-text-3)]">
          世界、角色与世界书分别保存，这里只记录它们之间的关联。当前版本尚未接入 AI，世界设定暂时不会影响对话。
        </p>
        <div className="flex justify-center mt-6">
          <button onClick={() => setConfirmDel(true)} className="press text-sm text-[var(--c-danger)] px-4 py-2">
            删除这个世界
          </button>
        </div>
      </div>

      {menu === 'residents' && (
        <ActionSheet
          title="添加居民"
          subtitle={`角色将归属于「${world.name}」`}
          onClose={() => setMenu(null)}
          actions={[
            { label: '选择已有角色', hint: '从联系人中挑选', icon: <Icon name="people" />, onClick: () => setPicker('residents') },
            { label: '新建', hint: '在这个世界里创造一个角色', icon: <Icon name="character" />, onClick: () => nav(`/character/new?world=${id}`) },
            {
              label: '从本地文件导入',
              hint: 'SillyTavern 角色卡、JSON、TXT、Markdown',
              icon: <Icon name="import" />,
              onClick: () => nav(`/import?kind=character&world=${id}`),
            },
          ]}
        />
      )}
      {menu === 'books' && (
        <ActionSheet
          title="关联世界书"
          subtitle={`世界书将与「${world.name}」关联`}
          onClose={() => setMenu(null)}
          actions={[
            { label: '选择已有世界书', hint: '世界书可同时关联多个世界', icon: <Icon name="lorebook" />, onClick: () => setPicker('books') },
            {
              label: '从本地文件导入',
              hint: 'SillyTavern 世界书、JSON、Markdown、TXT',
              icon: <Icon name="import" />,
              onClick: () => nav(`/import?kind=lorebook&world=${id}`),
            },
          ]}
        />
      )}
      {picker === 'residents' && (
        <PickerSheet
          title="添加居民"
          options={allChars
            .filter((c) => c.worldId !== id)
            .map((c) => ({
              id: c.id,
              name: c.name,
              avatar: c.avatar,
              hint:
                c.worldId === DEFAULT_WORLD_ID
                  ? '未归入世界'
                  : `当前在「${worldName.get(c.worldId) ?? '其他世界'}」，加入后会移到这里`,
            }))}
          emptyText={allChars.length ? '所有角色都已在这个世界中' : '还没有角色'}
          onClose={() => setPicker(null)}
          onConfirm={(ids) => void Promise.all(ids.map((cid) => setCharacterWorld(cid, id)))}
        />
      )}
      {picker === 'books' && (
        <PickerSheet
          title="关联世界书"
          showAvatar={false}
          options={allBooks
            .filter((b) => !bookIds.includes(b.id))
            .map((b) => ({ id: b.id, name: b.name, hint: `${b.entries.length} 个条目` }))}
          emptyText={allBooks.length ? '所有世界书都已关联' : '还没有世界书'}
          onClose={() => setPicker(null)}
          onConfirm={(ids) => void Promise.all(ids.map((bid) => linkWorldLorebook(id, bid)))}
        />
      )}
      {removeChar && (
        <ConfirmDialog
          title={`将「${removeChar.name}」移出？`}
          message="角色会回到「未归入世界」，角色本身和聊天记录都不受影响。"
          confirmText="移出"
          onCancel={() => setRemoveChar(null)}
          onConfirm={() => {
            void setCharacterWorld(removeChar.id, DEFAULT_WORLD_ID)
            setRemoveChar(null)
          }}
        />
      )}
      {unlinkBook && (
        <ConfirmDialog
          title="解除关联？"
          message={`「${unlinkBook.name}」将不再关联这个世界，世界书本身不会被删除。`}
          confirmText="解除"
          onCancel={() => setUnlinkBook(null)}
          onConfirm={() => {
            void unlinkWorldLorebook(id, unlinkBook.id)
            setUnlinkBook(null)
          }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`删除「${world.name}」？`}
          message="只删除世界本身的设定。居民角色会回到「未归入世界」，关联的世界书会保留，聊天记录不受影响。"
          confirmText="删除"
          danger
          onCancel={() => setConfirmDel(false)}
          onConfirm={async () => {
            await deleteWorld(id)
            nav('/contacts?tab=worlds', { replace: true })
          }}
        />
      )}
    </div>
  )
}
