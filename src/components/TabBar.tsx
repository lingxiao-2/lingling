import { NavLink } from 'react-router-dom'
import { MessageCircle, Users, Aperture, UserRound } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'

const TABS = [
  { to: '/', label: '消息', Icon: MessageCircle, end: true },
  { to: '/contacts', label: '联系人', Icon: Users, end: false },
  { to: '/moments', label: '动态', Icon: Aperture, end: false },
  { to: '/me', label: '我的', Icon: UserRound, end: false },
]

export default function TabBar() {
  const unread = useLiveQuery(async () => {
    const all = await db.conversations.toArray()
    return all.reduce((s, c) => s + c.unread, 0)
  }, [], 0)

  return (
    <nav
      className="glass hairline-t shrink-0 relative z-10"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="h-14 grid grid-cols-4">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `press relative flex flex-col items-center justify-center gap-0.5 text-[11px] ${
                isActive ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-text-3)]'
              }`
            }
          >
            <span className="relative">
              <Icon size={23} strokeWidth={1.5} />
              {to === '/' && unread > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--c-danger)] text-white text-[10px] leading-4 text-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
