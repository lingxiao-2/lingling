/** 最近删除的日记：恢复或彻底删除 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../../components/NavBar'
import { ConfirmDialog } from '../../components/Sheet'
import { db } from '../../db/db'
import type { Diary } from '../../db/schema'
import { purgeDiary, restoreDiary } from '../../db/diaryRepo'
import { dateParts, snippet } from '../../life/diary'

export default function DiaryTrashPage() {
  const list = useLiveQuery(() => db.diaries.toArray(), [], [] as Diary[]).filter((d) => d.deletedAt).sort((a, b) => b.deletedAt! - a.deletedAt!)
  const [purging, setPurging] = useState<Diary | null>(null)
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="最近删除" back="/diary" />
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        <p className="mx-6 mt-2 text-[11.5px] text-[var(--c-text-3)]">这里的日记可以恢复；彻底删除后无法找回。最近删除的日记不会被任何 AI 功能读取。</p>
        {list.length === 0 && <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">没有最近删除的日记</p>}
        <div className="mx-4 mt-3 space-y-2">
          {list.map((d) => (
            <div key={d.id} className="card px-4 py-3">
              <div className="text-[14px] text-[var(--c-text)]">{d.title || '无标题'} <span className="text-[11.5px] text-[var(--c-text-3)]">· {dateParts(d.date).zh}</span></div>
              {d.body && <div className="mt-0.5 text-[12.5px] text-[var(--c-text-2)]">{snippet(d.body, 60)}</div>}
              <div className="mt-2 flex gap-4 text-[13px]">
                <button className="press text-[var(--c-accent-strong)]" onClick={() => void restoreDiary(d.id)}>恢复</button>
                <button className="press text-[var(--c-danger)]" onClick={() => setPurging(d)}>彻底删除</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {purging && (
        <ConfirmDialog title="彻底删除这篇日记？" message="彻底删除后无法恢复。" confirmText="彻底删除" danger onCancel={() => setPurging(null)} onConfirm={() => void purgeDiary(purging.id).then(() => setPurging(null))} />
      )}
    </div>
  )
}
