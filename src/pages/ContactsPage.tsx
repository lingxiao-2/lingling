import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { UserPlus } from 'lucide-react'
import { db } from '../db/db'
import type { Character } from '../db/schema'
import NavBar, { NavButton } from '../components/NavBar'
import Avatar from '../components/Avatar'
import { Empty, PrimaryButton, SearchBox } from '../components/ui'

export default function ContactsPage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return chars
      .filter((c) => !kw || c.name.toLowerCase().includes(kw) || c.bio.toLowerCase().includes(kw))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }, [chars, q])

  return (
    <>
      <NavBar
        title="联系人"
        right={
          <NavButton label="创建角色" onClick={() => nav('/character/new')}>
            <UserPlus size={22} strokeWidth={1.5} />
          </NavButton>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SearchBox value={q} onChange={setQ} placeholder="搜索角色" />
        {chars.length === 0 ? (
          <Empty
            title="还没有 AI 角色"
            hint="创建你的第一个角色，设定 TA 的性格、说话方式和背景故事。"
            action={<PrimaryButton onClick={() => nav('/character/new')}>创建角色</PrimaryButton>}
          />
        ) : list.length === 0 ? (
          <Empty title="没有找到相关角色" />
        ) : (
          <>
            {list.map((c) => (
              <button
                key={c.id}
                onClick={() => nav(`/character/${c.id}`)}
                className="press w-full flex items-center gap-3 px-4 py-3 hairline-b text-left"
              >
                <Avatar name={c.name} src={c.avatar} size={46} />
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] truncate">{c.name}</div>
                  <div className="text-[13px] text-[var(--c-text-3)] truncate">{c.bio || '暂无简介'}</div>
                </div>
              </button>
            ))}
            <div className="py-4 text-center text-xs text-[var(--c-text-3)]">{chars.length} 位角色</div>
          </>
        )}
      </div>
    </>
  )
}
