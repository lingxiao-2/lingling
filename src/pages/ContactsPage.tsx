import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, FileDown, Globe, PenLine, UserRound } from 'lucide-react'
import NavBar, { PlusButton } from '../components/NavBar'
import { ActionSheet } from '../components/Sheet'
import type { SheetAction } from '../components/Sheet'
import CharactersPane from './library/CharactersPane'
import WorldsPane from './library/WorldsPane'
import LorebooksPane from './library/LorebooksPane'

type Tab = 'characters' | 'worlds' | 'lorebooks'

const TABS: { id: Tab; label: string }[] = [
  { id: 'characters', label: '角色' },
  { id: 'worlds', label: '世界' },
  { id: 'lorebooks', label: '世界书' },
]

export default function ContactsPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = raw === 'worlds' || raw === 'lorebooks' ? raw : 'characters'
  const [sheet, setSheet] = useState(false)

  const icon = (I: typeof PenLine) => <I size={19} strokeWidth={1.4} />
  const menus: Record<Tab, { title: string; subtitle: string; actions: SheetAction[] }> = {
    characters: {
      title: '添加角色',
      subtitle: '角色拥有独立的人设与聊天',
      actions: [
        { label: '新建', hint: '从空白开始设定一个角色', icon: icon(UserRound), onClick: () => nav('/character/new') },
        {
          label: '从本地文件导入',
          hint: 'SillyTavern 角色卡、JSON、TXT、Markdown',
          icon: icon(FileDown),
          onClick: () => nav('/import?kind=character'),
        },
      ],
    },
    worlds: {
      title: '添加世界',
      subtitle: '世界收纳居民角色与世界书',
      actions: [
        { label: '新建', hint: '写下世界的名字与设定', icon: icon(Globe), onClick: () => nav('/world/new') },
        {
          label: '从本地文件导入',
          hint: '世界设定，以及其中的角色与世界书',
          icon: icon(FileDown),
          onClick: () => nav('/import?kind=world'),
        },
      ],
    },
    lorebooks: {
      title: '添加世界书',
      subtitle: '以关键词组织的设定条目',
      actions: [
        { label: '新建', hint: '手动编写条目', icon: icon(BookOpen), onClick: () => nav('/lorebook/new') },
        {
          label: '从本地文件导入',
          hint: 'SillyTavern 世界书、JSON、Markdown、TXT',
          icon: icon(FileDown),
          onClick: () => nav('/import?kind=lorebook'),
        },
      ],
    },
  }
  const menu = menus[tab]

  return (
    <>
      <NavBar title="联系人" right={<PlusButton label={menu.title} onClick={() => setSheet(true)} />} />

      <div role="tablist" className="shrink-0 flex justify-center gap-10 hairline-b bg-white/40">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className="press lib-tab"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'characters' && <CharactersPane />}
        {tab === 'worlds' && <WorldsPane />}
        {tab === 'lorebooks' && <LorebooksPane />}
      </div>

      {sheet && (
        <ActionSheet title={menu.title} subtitle={menu.subtitle} actions={menu.actions} onClose={() => setSheet(false)} />
      )}
    </>
  )
}
