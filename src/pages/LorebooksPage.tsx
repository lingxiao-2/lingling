import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileDown } from 'lucide-react'
import NavBar, { NavButton } from '../components/NavBar'
import { Empty, PrimaryButton } from '../components/ui'
import { db } from '../db/db'
import type { CharacterLorebookLink, Lorebook } from '../db/schema'

export default function LorebooksPage() {
  const nav = useNavigate()
  const books = useLiveQuery(() => db.lorebooks.orderBy('updatedAt').reverse().toArray(), [], [] as Lorebook[])
  const links = useLiveQuery(() => db.characterLorebooks.toArray(), [], [] as CharacterLorebookLink[])
  const linkCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of links) m.set(l.lorebookId, (m.get(l.lorebookId) ?? 0) + 1)
    return m
  }, [links])

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title="世界书"
        back
        right={
          <NavButton label="导入世界书" onClick={() => nav('/import?kind=lorebook')}>
            <FileDown size={21} strokeWidth={1.5} />
          </NavButton>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <div className="mx-3 mt-3 rounded-2xl bg-[var(--c-accent-soft)] px-4 py-3 text-xs leading-relaxed text-[var(--c-text-2)]">
          世界书与角色人设、聊天记忆分开保存，一本世界书可以关联多个角色。当前版本尚未接入 AI，世界书暂时不会影响对话。
        </div>
        {books.length === 0 ? (
          <Empty
            title="还没有世界书"
            hint="可导入 SillyTavern 世界书 JSON、Markdown 或 TXT。"
            action={<PrimaryButton onClick={() => nav('/import?kind=lorebook')}>导入世界书</PrimaryButton>}
          />
        ) : (
          <div className="mt-3">
            {books.map((b) => (
              <button
                key={b.id}
                onClick={() => nav(`/lorebook/${b.id}`)}
                className="press w-full flex items-center gap-3 px-4 py-3 hairline-b text-left"
              >
                <span className="h-[46px] w-[46px] shrink-0 rounded-xl bg-white flex items-center justify-center title-en text-xl text-[var(--c-accent)]">
                  {Array.from(b.name)[0] ?? 'W'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] truncate">{b.name}</div>
                  <div className="text-[13px] text-[var(--c-text-3)] truncate">
                    {b.entries.length} 个条目 · 关联 {linkCount.get(b.id) ?? 0} 个角色
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
