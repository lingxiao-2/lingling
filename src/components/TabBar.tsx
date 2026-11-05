import { NavLink } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { Icon, type IconName } from '../theme/icons'

const TABS: { to: string; label: string; icon: IconName; end: boolean }[] = [
  { to: '/', label: '消息', icon: 'tabMessages', end: true },
  { to: '/contacts', label: '联系人', icon: 'tabContacts', end: false },
  { to: '/moments', label: '动态', icon: 'tabMoments', end: false },
  { to: '/me', label: '我的', icon: 'tabMe', end: false },
]

/** 底部导航：悬浮的毛玻璃胶囊，细线图标 20px */
export default function TabBar() {
  const unread = useLiveQuery(async () => {
    const all = await db.conversations.toArray()
    return all.reduce((s, c) => s + c.unread, 0)
  }, [], 0)

  return (
    <nav className="shrink-0 relative z-10 px-3 pt-1.5" style={{ paddingBottom: 'calc(var(--safe-bottom) + 6px)' }}>
      <div className="glass-1 h-[56px] rounded-[24px] grid grid-cols-4 shadow-[var(--shadow-float)]">
        {TABS.map(({ to, label, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `press relative flex flex-col items-center justify-center gap-[3px] text-[10px] tracking-wider ${
                isActive ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-text-3)]'
              }`
            }
          >
            <span className="relative">
              <Icon name={icon} size="lg" stroke="thin" />
              {to === '/' && unread > 0 && (
                <span className="absolute -top-1 -right-2.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--c-danger)] text-white text-[9px] leading-[15px] text-center">
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
