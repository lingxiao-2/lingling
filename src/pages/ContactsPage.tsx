import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileDown, MoreHorizontal, UserPlus } from 'lucide-react'
import { db } from '../db/db'
import type { Character } from '../db/schema'
import NavBar, { NavButton } from '../components/NavBar'
import Avatar from '../components/Avatar'
import { ActionSheet } from '../components/Sheet'
import { Empty, PrimaryButton, SearchBox } from '../components/ui'

export default function ContactsPage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState(false)
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const bookCount = useLiveQuery(() => db.lorebooks.count(), [], 0)

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
        sideWidth={120}
        right={
          <>
            <NavButton label="导入角色" onClick={() => nav('/import?kind=character')}>
              <FileDown size={21} strokeWidth={1.5} />
            </NavButton>
            <NavButton label="新建角色" onClick={() => nav('/character/new')}>
              <UserPlus size={21} strokeWidth={1.5} />
            </NavButton>
            <NavButton label="管理" onClick={() => setMenu(true)}>
              <MoreHorizontal size={21} strokeWidth={1.5} />
            </NavButton>
          </>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SearchBox value={q} onChange={setQ} placeholder="搜索角色" />

        <button
          onClick={() => nav('/lorebooks')}
          className="press w-full flex items-center gap-3 px-4 py-3 hairline-b text-left"
        >
          <span className="h-[46px] w-[46px] rounded-xl bg-[var(--c-accent-soft)] flex items-center justify-center title-en text-lg text-[var(--c-accent-strong)]">
            W
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px]">世界书</div>
            <div className="text-[13px] text-[var(--c-text-3)]">
              {bookCount ? `${bookCount} 本，可关联到角色` : '导入世界观设定并关联到角色'}
            </div>
          </div>
        </button>

        {chars.length === 0 ? (
          <Empty
            title="还没有 AI 角色"
            hint="新建一个角色，或从「文件」导入 SillyTavern 角色卡、JSON、TXT、Markdown。"
            action={
              <div className="flex gap-3">
                <PrimaryButton onClick={() => nav('/character/new')}>新建角色</PrimaryButton>
                <button
                  onClick={() => nav('/import?kind=character')}
                  className="press h-11 px-6 rounded-full border border-[var(--c-accent)] text-[var(--c-accent-strong)] text-[15px]"
                >
                  导入角色
                </button>
              </div>
            }
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

      {menu && (
        <ActionSheet
          onClose={() => setMenu(false)}
          actions={[
            { label: '新建角色', onClick: () => nav('/character/new') },
            { label: '导入角色', onClick: () => nav('/import?kind=character') },
            { label: '世界书管理', onClick: () => nav('/lorebooks') },
            { label: '导入世界书', onClick: () => nav('/import?kind=lorebook') },
          ]}
        />
      )}
    </>
  )
}
