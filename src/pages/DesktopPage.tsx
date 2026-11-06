/**
 * 虚拟手机桌面：三个横向滑动的桌面页 + 页面指示器 + 固定 Dock。
 *  - 横向滑动使用原生滚动 + scroll-snap（iOS Safari 上最可靠、最省电的触摸滑动方式），每次只翻一页
 *  - Dock 在滑动容器之外，始终固定
 *  - 点开应用进入原有页面（浏览器返回即回到桌面，并停在原来那一页）
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import AppIcon from '../desktop/AppIcon'
import { appHref, APPS, type AppId } from '../desktop/apps'
import { defaultLayout, GRID, type DesktopItem, type DesktopLayout } from '../desktop/layout'
import { useUnreadTotal } from '../desktop/useUnread'

const PAGE_KEY = 'lingling-desktop-page'

function readPage(): number {
  try {
    const n = Number(sessionStorage.getItem(PAGE_KEY))
    return Number.isInteger(n) && n >= 0 && n < GRID.pages ? n : 0
  } catch {
    return 0
  }
}

/** 小组件占位（小组件本身在后续版本接入） */
function WidgetSlot({ item }: { item: Extract<DesktopItem, { kind: 'widget' }> }) {
  return <div className={`${item.size === 'medium' ? 'col-span-4' : 'col-span-2'} row-span-2 m-1.5 rounded-[22px] glass-1`} />
}

export function DesktopGrid({ items, renderApp }: { items: DesktopItem[]; renderApp: (id: AppId) => ReactNode }) {
  return (
    <div className="h-full grid grid-cols-4" style={{ gridTemplateRows: `repeat(${GRID.rows}, minmax(0, 1fr))` }}>
      {items.map((it) => (it.kind === 'app' ? <div key={it.app} className="flex items-start justify-center pt-1">{renderApp(it.app)}</div> : <WidgetSlot key={it.id} item={it} />))}
    </div>
  )
}

export default function DesktopPage() {
  const nav = useNavigate()
  const unread = useUnreadTotal()
  const [layout] = useState<DesktopLayout>(() => ({ ...defaultLayout(), page: readPage() }))
  const [page, setPage] = useState(layout.page)
  const pager = useRef<HTMLDivElement>(null)

  // 回到桌面时停在原来那一页
  useLayoutEffect(() => {
    const el = pager.current
    if (el) el.scrollLeft = el.clientWidth * layout.page
  }, [layout.page])

  useEffect(() => {
    try {
      sessionStorage.setItem(PAGE_KEY, String(page))
    } catch {
      /* 隐私模式：只是不记住页码 */
    }
  }, [page])

  const onScroll = () => {
    const el = pager.current
    if (!el || !el.clientWidth) return
    const p = Math.round(el.scrollLeft / el.clientWidth)
    if (p !== page) setPage(Math.min(Math.max(p, 0), GRID.pages - 1))
  }
  const goPage = (p: number) => pager.current?.scrollTo({ left: p * pager.current.clientWidth, behavior: 'smooth' })

  const open = (id: AppId) => nav(appHref(id))
  const icon = (id: AppId) => (
    <button key={id} aria-label={APPS[id].name} className="press" onClick={() => open(id)}>
      <AppIcon id={id} badge={id === 'messages' ? unread : 0} />
    </button>
  )

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ paddingTop: 'calc(var(--safe-top) + 14px)' }}>
      <div ref={pager} onScroll={onScroll} className="desk-pager flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden" aria-label="桌面">
        {layout.pages.map((items, i) => (
          <section key={i} className="desk-page w-full shrink-0 h-full px-[18px]" aria-label={`第 ${i + 1} 页`} aria-hidden={i !== page}>
            <DesktopGrid items={items} renderApp={icon} />
          </section>
        ))}
      </div>

      <div className="shrink-0 flex justify-center gap-2 py-2.5" role="tablist" aria-label="桌面页">
        {layout.pages.map((_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === page}
            aria-label={`第 ${i + 1} 页`}
            onClick={() => goPage(i)}
            className={`h-[7px] w-[7px] rounded-full transition-colors ${i === page ? 'bg-[var(--c-accent-strong)]' : 'bg-white/70 shadow-[inset_0_0_0_0.5px_rgba(120,150,190,0.35)]'}`}
          />
        ))}
      </div>

      <nav className="shrink-0 px-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 8px)' }} aria-label="Dock">
        <div className="desk-dock h-[88px] rounded-[32px] grid grid-cols-4 items-center px-2">
          {layout.dock.map((id) => (
            <div key={id} className="flex justify-center">
              <button aria-label={APPS[id].name} className="press" onClick={() => open(id)}>
                <AppIcon id={id} badge={id === 'messages' ? unread : 0} showLabel={false} />
              </button>
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}
