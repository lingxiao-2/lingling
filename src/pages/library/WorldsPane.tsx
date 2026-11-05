import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { DEFAULT_WORLD_ID } from '../../db/schema'
import type { Character, World, WorldLorebookLink } from '../../db/schema'
import WorldCover from '../../components/WorldCover'
import { QuietEmpty } from '../../components/ui'

export default function WorldsPane() {
  const nav = useNavigate()
  const worlds = useLiveQuery(
    async () => (await db.worlds.toArray()).filter((w) => w.id !== DEFAULT_WORLD_ID),
    [],
    [] as World[],
  )
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const links = useLiveQuery(() => db.worldLorebooks.toArray(), [], [] as WorldLorebookLink[])

  const residents = useMemo(() => {
    const m = new Map<string, Character[]>()
    for (const c of chars) m.set(c.worldId, [...(m.get(c.worldId) ?? []), c])
    return m
  }, [chars])
  const bookCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of links) m.set(l.worldId, (m.get(l.worldId) ?? 0) + 1)
    return m
  }, [links])

  const sorted = [...worlds].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
  const unassigned = residents.get(DEFAULT_WORLD_ID)?.length ?? 0

  if (sorted.length === 0) {
    return (
      <QuietEmpty
        eyebrow="Private Worlds"
        title="你的第一个世界"
        hint="轻点右上角 ＋，新建世界或从本地文件导入"
      />
    )
  }

  return (
    <div className="px-4 pb-8">
      <div className="pt-6 pb-5 text-center">
        <div className="eyebrow">Private Worlds</div>
        <div className="serif-zh mt-2 text-[18px] tracking-[0.14em] text-[var(--c-brand)]">私人世界收藏</div>
        <div className="mt-1.5 text-[11px] text-[var(--c-text-3)] tracking-wider">共 {sorted.length} 个世界</div>
      </div>

      <div className="flex flex-col gap-6">
        {sorted.map((w) => {
          const people = residents.get(w.id) ?? []
          return (
            <button key={w.id} onClick={() => nav(`/world/${w.id}`)} className="press block w-full text-left">
              <WorldCover
                name={w.name}
                cover={w.cover}
                className="h-[176px] rounded-[22px] shadow-[0_10px_28px_rgba(70,105,145,0.16)]"
              >
                <div className="absolute inset-0 cover-shade" />
                <div className="absolute left-5 right-5 bottom-4 text-white">
                  <div className="serif-zh text-[22px] tracking-[0.16em] leading-tight truncate drop-shadow-sm">
                    {w.name}
                  </div>
                  {w.tagline && <div className="mt-1 text-[12px] tracking-wide text-white/85 truncate">{w.tagline}</div>}
                </div>
              </WorldCover>
              <div className="mt-2.5 px-1 flex items-center gap-2 text-[11.5px] text-[var(--c-text-3)] tracking-wide">
                <div className="flex -space-x-1.5">
                  {people.slice(0, 4).map((c) =>
                    c.avatar ? (
                      <img key={c.id} src={c.avatar} alt="" className="h-5 w-5 rounded-full object-cover ring-2 ring-[var(--c-bg)]" />
                    ) : (
                      <span
                        key={c.id}
                        className="h-5 w-5 rounded-full bg-[var(--c-accent-soft)] ring-2 ring-[var(--c-bg)] text-[9px] text-[var(--c-accent-strong)] flex items-center justify-center"
                      >
                        {Array.from(c.name)[0]}
                      </span>
                    ),
                  )}
                </div>
                <span>
                  {people.length} 位居民 · {bookCount.get(w.id) ?? 0} 本世界书
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {unassigned > 0 && (
        <div className="mt-8 text-center text-[11px] text-[var(--c-text-3)]">还有 {unassigned} 位角色未归入任何世界</div>
      )}
    </div>
  )
}
