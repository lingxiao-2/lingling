import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db'
import { DEFAULT_WORLD_ID } from '../../db/schema'
import type { Character, World } from '../../db/schema'
import Avatar from '../../components/Avatar'
import { QuietEmpty, SearchBox } from '../../components/ui'

export default function CharactersPane() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const worlds = useLiveQuery(() => db.worlds.toArray(), [], [] as World[])
  const worldName = useMemo(() => new Map(worlds.map((w) => [w.id, w.name])), [worlds])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return chars
      .filter((c) => !kw || c.name.toLowerCase().includes(kw) || c.bio.toLowerCase().includes(kw))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }, [chars, q])

  if (chars.length === 0) {
    return <QuietEmpty eyebrow="Characters" title="还没有角色" hint="轻点右上角 ＋，新建角色或导入角色卡" />
  }

  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="搜索角色" />
      {list.length === 0 ? (
        <div className="py-16 text-center text-sm text-[var(--c-text-3)]">没有找到相关角色</div>
      ) : (
        list.map((c) => {
          const w = c.worldId !== DEFAULT_WORLD_ID ? worldName.get(c.worldId) : undefined
          return (
            <button
              key={c.id}
              onClick={() => nav(`/character/${c.id}`)}
              className="press w-full flex items-center gap-3.5 px-4 py-3 hairline-b text-left"
            >
              <Avatar name={c.name} src={c.avatar} size="list" />
              <div className="min-w-0 flex-1">
                <div className="text-[16px] truncate">{c.name}</div>
                <div className="text-[13px] text-[var(--c-text-3)] truncate">{c.bio || '暂无简介'}</div>
              </div>
              {w && (
                <span className="serif-zh shrink-0 max-w-[30%] truncate text-[12px] tracking-wider text-[var(--c-brand-soft)]">
                  {w}
                </span>
              )}
            </button>
          )
        })
      )}
      <div className="py-5 text-center text-xs text-[var(--c-text-3)]">{chars.length} 位角色</div>
    </>
  )
}
