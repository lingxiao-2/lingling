/** 桌面「记忆」应用：按角色进入各自的长期记忆（每个角色的记忆互相独立） */
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { Empty } from '../components/ui'
import { db } from '../db/db'

export default function MemoriesHubPage() {
  const nav = useNavigate()
  const rows = useLiveQuery(async () => {
    const [chars, mems] = await Promise.all([db.characters.toArray(), db.memories.toArray()])
    return chars
      .map((c) => ({
        c,
        active: mems.filter((m) => m.characterId === c.id && m.status === 'active' && m.content).length,
        pending: mems.filter((m) => m.characterId === c.id && m.status === 'pending').length,
      }))
      .sort((a, b) => b.pending - a.pending || b.active - a.active || a.c.name.localeCompare(b.c.name))
  }, [])
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="记忆" back="/" />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <p className="mx-6 mt-2 text-[11.5px] leading-relaxed text-[var(--c-text-3)]">每个角色的记忆互相独立，只在和这个角色聊天时使用。</p>
        {rows && rows.length === 0 && <Empty title="还没有角色" hint="在联系人中添加或导入角色后，这里会显示每个角色的记忆。" />}
        {rows && rows.length > 0 && (
          <div className="mx-3 mt-3 card overflow-hidden">
            {rows.map(({ c, active, pending }) => (
              <button key={c.id} onClick={() => nav(`/character/${c.id}/memories`)} className="press w-full flex items-center gap-3 px-4 py-3 text-left hairline-b last:border-b-0">
                <Avatar name={c.name} src={c.avatar} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[15px] text-[var(--c-text)]">{c.name}</span>
                  <span className="block text-[12px] text-[var(--c-text-3)]">
                    已记住 {active} 条{pending ? ` · ${pending} 条待确认` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
