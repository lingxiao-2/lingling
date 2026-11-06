/** 便签列表：置顶在前、搜索、颜色；从桌面小组件进入「选择一张显示在桌面」 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { db } from '../../db/db'
import type { Note } from '../../db/schema'
import { migrateLegacyDesktopNote } from '../../db/noteRepo'
import { saveWidgetNote } from '../../desktop/layoutStore'
import { colorOf, previewLines, progress, visibleNotes } from '../../life/notes'

export default function NotesListPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const pickFor = params.get('pickFor')
  const all = useLiveQuery(() => db.notes.toArray(), [], undefined as Note[] | undefined)
  const [q, setQ] = useState('')
  useEffect(() => {
    void migrateLegacyDesktopNote()
  }, [])
  const list = visibleNotes(all ?? [], q)
  const trash = (all ?? []).filter((n) => n.deletedAt).length

  const open = (n: Note) => {
    if (pickFor) void saveWidgetNote(pickFor, n.id).then(() => nav('/', { replace: true }))
    else nav(`/notes/${n.id}`)
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="便签" back="/" right={<NavButton label="新建便签" icon="edit" onClick={() => nav(`/notes/new${pickFor ? `?widget=${pickFor}` : ''}`)} />} />
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        {pickFor && <div className="mx-4 mt-2 card px-4 py-2.5 text-[13px] text-[var(--c-text-2)]">选择一张便签显示在桌面上，或点右上角新建一张。</div>}
        <div className="mx-4 mt-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索便签" className="w-full h-9 rounded-full bg-white/55 border border-[var(--c-line)] px-4 text-[15px] outline-none focus:border-[var(--c-accent)]" />
        </div>
        {all && list.length === 0 && (
          <div className="py-12 text-center">
            <div className="desk-serif italic text-[17px] text-[var(--c-brand)]">A little note</div>
            <p className="mt-1 text-[12.5px] text-[var(--c-text-3)]">{q ? '没有找到匹配的便签' : '还没有便签，点右上角写一张。'}</p>
          </div>
        )}
        <div className="mx-4 mt-3 grid grid-cols-2 gap-3">
          {list.map((n) => {
            const c = colorOf(n.color)
            const pr = progress(n.items)
            return (
              <button key={n.id} onClick={() => open(n)} className="press relative text-left rounded-[16px] px-3 pt-3 pb-2.5 min-h-[118px] note-card" style={{ background: c.bg, color: c.ink }}>
                {n.pinned && <span className="absolute right-2.5 top-2 text-[10px] tracking-[0.15em] opacity-60">置顶</span>}
                {n.title && <div className="pr-8 truncate text-[14px] font-medium">{n.title}</div>}
                <div className="mt-1 space-y-0.5 text-[12.5px] leading-[18px] opacity-90">
                  {previewLines(n, 4).map((l, i) => (
                    <div key={i} className={`truncate ${l.done ? 'line-through opacity-50' : ''}`}>{n.kind === 'checklist' ? (l.done ? '☑ ' : '☐ ') : ''}{l.text}</div>
                  ))}
                </div>
                {n.kind === 'checklist' && pr.total > 0 && <div className="mt-1.5 text-[10.5px] opacity-60">完成 {pr.done} / {pr.total}</div>}
              </button>
            )
          })}
        </div>
        <div className="mt-6 text-center">
          <button className="press text-[12.5px] text-[var(--c-text-3)]" onClick={() => nav('/notes/trash')}>最近删除 {trash}</button>
        </div>
      </div>
    </div>
  )
}
