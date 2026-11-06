/**
 * 联系人 → 角色：按分组显示（类似微信联系人分组），分组内搜索，多种排序，整理模式下移动分组与手动排序。
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { DEFAULT_WORLD_ID } from '../../db/schema'
import type { Character, Conversation, World } from '../../db/schema'
import Avatar from '../../components/Avatar'
import { ActionSheet, ConfirmDialog } from '../../components/Sheet'
import { QuietEmpty, SearchBox } from '../../components/ui'
import { createGroup, deleteGroup, GroupError, loadGroupSettings, moveCharacter, renameGroup, saveGroupSettings } from '../../db/groupRepo'
import { DEFAULT_GROUP_SETTINGS, groupOf, matches, moveInOrder, sectionize, SORT_LABEL, UNGROUPED, type CharacterSort, type GroupSection } from '../../lib/characterGroups'

const chip = 'press shrink-0 h-7 px-3 rounded-full text-[12px] border'

export default function CharactersPane() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [editing, setEditing] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [moving, setMoving] = useState<Character | null>(null)
  const [naming, setNaming] = useState<{ id?: string; name: string; error?: string } | null>(null)
  const [groupMenu, setGroupMenu] = useState<GroupSection | null>(null)
  const [deleting, setDeleting] = useState<GroupSection | null>(null)
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const worlds = useLiveQuery(() => db.worlds.toArray(), [], [] as World[])
  const convs = useLiveQuery(() => db.conversations.toArray(), [], [] as Conversation[])
  const gs = useLiveQuery(loadGroupSettings, [], DEFAULT_GROUP_SETTINGS)
  const worldName = useMemo(() => new Map(worlds.map((w) => [w.id, w.name])), [worlds])
  const lastChat = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of convs) if (v.type === 'single' && v.characterIds.length === 1) m.set(v.characterIds[0], Math.max(m.get(v.characterIds[0]) ?? 0, v.lastMessageAt ?? 0))
    return m
  }, [convs])

  const sections = useMemo(() => {
    const all = sectionize(chars, gs, lastChat).map((s) => ({ ...s, characters: s.characters.filter((c) => matches(c, q)) }))
    return filter === 'all' ? all : all.filter((s) => s.id === filter)
  }, [chars, gs, lastChat, q, filter])

  if (chars.length === 0) {
    return <QuietEmpty eyebrow="Characters" title="还没有角色" hint="轻点右上角 ＋，新建角色或导入角色卡" />
  }

  const toggleCollapse = (id: string) =>
    void saveGroupSettings({ collapsed: gs.collapsed.includes(id) ? gs.collapsed.filter((x) => x !== id) : [...gs.collapsed, id] })
  const setSort = (sort: CharacterSort) => {
    // 切换到手动排序时，以当前看到的顺序为起点
    const order = sort === 'manual' && !gs.order.length ? sectionize(chars, gs, lastChat).flatMap((s) => s.characters.map((c) => c.id)) : gs.order
    void saveGroupSettings({ sort, order })
  }
  const saveName = async () => {
    if (!naming) return
    try {
      if (naming.id) await renameGroup(naming.id, naming.name)
      else await createGroup(naming.name)
      setNaming(null)
    } catch (e) {
      setNaming({ ...naming, error: e instanceof GroupError ? e.message : String(e) })
    }
  }
  const total = sections.reduce((n, s) => n + s.characters.length, 0)
  const showSections = filter === 'all' && (gs.groups.length > 0 || editing)

  const row = (c: Character, s: GroupSection, i: number) => {
    const w = c.worldId !== DEFAULT_WORLD_ID ? worldName.get(c.worldId) : undefined
    return (
      <div key={c.id} className="flex items-center hairline-b">
        <button onClick={() => (editing ? setMoving(c) : nav(`/character/${c.id}`))} className="press flex-1 min-w-0 flex items-center gap-3.5 px-4 py-3 text-left">
          <Avatar name={c.name} src={c.avatar} size="list" />
          <div className="min-w-0 flex-1">
            <div className="text-[16px] truncate">{c.name}</div>
            <div className="text-[13px] text-[var(--c-text-3)] truncate">{c.bio || '暂无简介'}</div>
          </div>
          {!editing && w && <span className="serif-zh shrink-0 max-w-[30%] truncate text-[12px] tracking-wider text-[var(--c-brand-soft)]">{w}</span>}
          {editing && <span className="shrink-0 text-[12px] text-[var(--c-accent-strong)]">移动到…</span>}
        </button>
        {editing && gs.sort === 'manual' && !q.trim() && (
          <div className="shrink-0 flex flex-col pr-3">
            <button aria-label={`上移 ${c.name}`} disabled={i === 0} onClick={() => void saveGroupSettings({ order: moveInOrder(s.characters, c.id, -1, chars, gs, lastChat) })} className="press h-6 w-8 text-[13px] text-[var(--c-text-2)] disabled:opacity-25">↑</button>
            <button aria-label={`下移 ${c.name}`} disabled={i === s.characters.length - 1} onClick={() => void saveGroupSettings({ order: moveInOrder(s.characters, c.id, 1, chars, gs, lastChat) })} className="press h-6 w-8 text-[13px] text-[var(--c-text-2)] disabled:opacity-25">↓</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder={filter === 'all' ? '搜索角色' : `在「${sections[0]?.name ?? ''}」中搜索`} />
      <div className="flex items-center gap-1.5 overflow-x-auto px-4 pb-2 no-scrollbar">
        {[{ id: 'all', name: '全部' }, ...gs.groups, { id: UNGROUPED, name: '未分组' }].map((g) => (
          <button
            key={g.id}
            onClick={() => setFilter(g.id)}
            className={`${chip} ${filter === g.id ? 'border-[var(--c-accent)] bg-[var(--c-accent)] text-white' : 'border-[var(--c-line)] bg-white/45 text-[var(--c-text-2)]'}`}
          >
            {g.name}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 px-4 pb-2 text-[12px]">
        <button onClick={() => setSortOpen(true)} className="press text-[var(--c-text-2)]">
          {SORT_LABEL[gs.sort]} ▾
        </button>
        <span className="flex-1" />
        {editing && (
          <button onClick={() => setNaming({ name: '' })} className="press text-[var(--c-accent-strong)]">
            新建分组
          </button>
        )}
        <button onClick={() => setEditing(!editing)} className={`press ${editing ? 'text-[var(--c-accent-strong)] font-medium' : 'text-[var(--c-text-2)]'}`}>
          {editing ? '完成' : '整理分组'}
        </button>
      </div>
      {editing && (
        <p className="px-4 pb-2 text-[11.5px] text-[var(--c-text-3)]">
          点角色可以移动到其他分组；点分组右侧的「编辑」可以重命名或删除分组。{gs.sort === 'manual' ? '用 ↑ ↓ 调整顺序。' : '选择「手动排序」后可以调整顺序。'}
        </p>
      )}

      {total === 0 && <div className="py-16 text-center text-sm text-[var(--c-text-3)]">{q.trim() ? '没有找到相关角色' : '这个分组还没有角色'}</div>}

      {sections.map((s) => {
        if (!showSections) return s.characters.map((c, i) => row(c, s, i))
        if (!s.characters.length && (q.trim() || (s.id === UNGROUPED && !editing))) return null
        const collapsed = gs.collapsed.includes(s.id) && !q.trim()
        return (
          <div key={s.id}>
            <div className="flex items-center px-4 pt-3 pb-1.5 hairline-b bg-white/25">
              <button onClick={() => toggleCollapse(s.id)} className="press flex-1 text-left text-[12.5px] text-[var(--c-text-2)]">
                <span className="inline-block w-4 text-[10px] text-[var(--c-text-3)]">{collapsed ? '▸' : '▾'}</span>
                {s.name}
                <span className="ml-1.5 text-[var(--c-text-3)]">{s.characters.length}</span>
              </button>
              {editing && s.id !== UNGROUPED && (
                <button onClick={() => setGroupMenu(s)} className="press text-[12px] text-[var(--c-accent-strong)]">
                  编辑
                </button>
              )}
            </div>
            {!collapsed && s.characters.map((c, i) => row(c, s, i))}
          </div>
        )
      })}
      <div className="py-5 text-center text-xs text-[var(--c-text-3)]">{chars.length} 位角色{gs.groups.length ? ` · ${gs.groups.length} 个分组` : ''}</div>

      {sortOpen && (
        <ActionSheet
          title="排序方式"
          onClose={() => setSortOpen(false)}
          actions={(Object.keys(SORT_LABEL) as CharacterSort[]).map((k) => ({ label: `${gs.sort === k ? '✓ ' : ''}${SORT_LABEL[k]}`, onClick: () => setSort(k) }))}
        />
      )}
      {moving && (
        <ActionSheet
          title={`把「${moving.name}」移动到`}
          onClose={() => setMoving(null)}
          actions={[
            ...gs.groups.map((g) => ({ label: `${groupOf(moving, gs.groups) === g.id ? '✓ ' : ''}${g.name}`, onClick: () => void moveCharacter(moving.id, g.id) })),
            { label: `${groupOf(moving, gs.groups) === UNGROUPED ? '✓ ' : ''}未分组`, onClick: () => void moveCharacter(moving.id, null) },
            { label: '新建分组…', onClick: () => setNaming({ name: '' }) },
          ]}
        />
      )}
      {groupMenu && (
        <ActionSheet
          title={`分组「${groupMenu.name}」`}
          onClose={() => setGroupMenu(null)}
          actions={[
            { label: '重命名', onClick: () => setNaming({ id: groupMenu.id, name: groupMenu.name }) },
            { label: '删除分组', danger: true, onClick: () => setDeleting(groupMenu) },
          ]}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`删除分组「${deleting.name}」？`}
          message={deleting.characters.length ? `其中的 ${deleting.characters.length} 位角色会移到「未分组」，角色和聊天记录都不会被删除。` : '这个分组是空的。'}
          confirmText="删除"
          danger
          onConfirm={() => {
            void deleteGroup(deleting.id)
            if (filter === deleting.id) setFilter('all')
            setDeleting(null)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
      {naming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-8" onClick={() => setNaming(null)}>
          <div className="absolute inset-0 sheet-overlay sheet-fade" />
          <div className="card relative w-full max-w-xs px-5 pt-5 pb-4" onClick={(e) => e.stopPropagation()}>
            <div className="serif-zh text-center text-[16px] text-[var(--c-brand)]">{naming.id ? '重命名分组' : '新建分组'}</div>
            <input
              autoFocus
              value={naming.name}
              maxLength={20}
              onChange={(e) => setNaming({ ...naming, name: e.target.value, error: undefined })}
              onKeyDown={(e) => e.key === 'Enter' && void saveName()}
              placeholder="例如：恋人、朋友、原创角色"
              className="mt-3 w-full rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none focus:border-[var(--c-accent)]"
            />
            {naming.error && <div className="mt-1.5 text-[12px] text-[var(--c-danger)]">{naming.error}</div>}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setNaming(null)} className="press h-10 rounded-full text-[14px] text-[var(--c-text-2)]">取消</button>
              <button onClick={() => void saveName()} className="press h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px]">保存</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
