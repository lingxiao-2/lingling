/** 最近删除的便签：恢复或彻底删除 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../../components/NavBar'
import { ConfirmDialog } from '../../components/Sheet'
import { db } from '../../db/db'
import type { Note } from '../../db/schema'
import { purgeNote, restoreNote } from '../../db/noteRepo'
import { previewLines } from '../../life/notes'

export default function NotesTrashPage() {
  const list = useLiveQuery(() => db.notes.toArray(), [], [] as Note[]).filter((n) => n.deletedAt).sort((a, b) => b.deletedAt! - a.deletedAt!)
  const [purging, setPurging] = useState<Note | null>(null)
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="最近删除" back="/notes" />
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        <p className="mx-6 mt-2 text-[11.5px] text-[var(--c-text-3)]">这里的便签可以恢复；彻底删除后无法找回。</p>
        {list.length === 0 && <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">没有最近删除的便签</p>}
        <div className="mx-4 mt-3 space-y-2">
          {list.map((n) => (
            <div key={n.id} className="card px-4 py-3">
              <div className="text-[14px] text-[var(--c-text)] truncate">{n.title || previewLines(n, 1)[0]?.text || '空白便签'}</div>
              <div className="mt-2 flex gap-4 text-[13px]">
                <button className="press text-[var(--c-accent-strong)]" onClick={() => void restoreNote(n.id)}>恢复</button>
                <button className="press text-[var(--c-danger)]" onClick={() => setPurging(n)}>彻底删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {purging && <ConfirmDialog title="彻底删除这张便签？" message="彻底删除后无法恢复。" confirmText="彻底删除" danger onCancel={() => setPurging(null)} onConfirm={() => void purgeNote(purging.id).then(() => setPurging(null))} />}
    </div>
  )
}
