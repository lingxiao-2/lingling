import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import type { CharacterLorebookLink, Lorebook, WorldLorebookLink } from '../../db/schema'
import { QuietEmpty, SearchBox } from '../../components/ui'

export default function LorebooksPane() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const books = useLiveQuery(() => db.lorebooks.orderBy('updatedAt').reverse().toArray(), [], [] as Lorebook[])
  const charLinks = useLiveQuery(() => db.characterLorebooks.toArray(), [], [] as CharacterLorebookLink[])
  const worldLinks = useLiveQuery(() => db.worldLorebooks.toArray(), [], [] as WorldLorebookLink[])

  const count = (links: { lorebookId: string }[]) => {
    const m = new Map<string, number>()
    for (const l of links) m.set(l.lorebookId, (m.get(l.lorebookId) ?? 0) + 1)
    return m
  }
  const charCount = useMemo(() => count(charLinks), [charLinks])
  const worldCount = useMemo(() => count(worldLinks), [worldLinks])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return books.filter((b) => !kw || b.name.toLowerCase().includes(kw) || b.description.toLowerCase().includes(kw))
  }, [books, q])

  if (books.length === 0) {
    return <QuietEmpty eyebrow="Lorebooks" title="还没有世界书" hint="轻点右上角 ＋，新建世界书或导入世界书文件" />
  }

  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="搜索世界书" />
      {list.length === 0 ? (
        <div className="py-16 text-center text-sm text-[var(--c-text-3)]">没有找到相关世界书</div>
      ) : (
        list.map((b) => {
          const meta = [`${b.entries.length} 个条目`]
          const w = worldCount.get(b.id)
          const c = charCount.get(b.id)
          if (w) meta.push(`${w} 个世界`)
          if (c) meta.push(`${c} 位角色`)
          return (
            <button
              key={b.id}
              onClick={() => nav(`/lorebook/${b.id}`)}
              className="press w-full flex items-center gap-3.5 px-4 py-3 hairline-b text-left"
            >
              <span className="serif-zh h-[46px] w-[38px] shrink-0 rounded-[6px_12px_12px_6px] border-l-[3px] border-[var(--c-accent)] bg-white flex items-center justify-center text-[17px] text-[var(--c-brand)] shadow-[0_1px_3px_rgba(60,90,130,0.1)]">
                {Array.from(b.name)[0] ?? '书'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] truncate">{b.name}</div>
                <div className="text-[13px] text-[var(--c-text-3)] truncate">{meta.join(' · ')}</div>
              </div>
            </button>
          )
        })
      )}
    </>
  )
}
