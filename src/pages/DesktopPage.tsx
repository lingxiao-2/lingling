/**
 * 虚拟手机桌面：三个横向滑动的桌面页 + 页面指示器 + 固定 Dock + 编辑模式。
 *
 *  - 横向滑动：原生滚动 + scroll-snap（iOS Safari 上最可靠、最省电），每次只翻一页
 *  - 长按图标约 0.5 秒进入编辑模式（手指移动超过 10px 视为滑动，不会进入编辑）；进入编辑的那次按压不会打开应用
 *  - 编辑模式：图标轻微晃动；按住图标拖动可以调整位置、拖进 Dock、拖到屏幕边缘停一下翻到相邻页；点按不会打开应用
 *  - 布局、顺序和当前页保存在本机（settings 表的 desktop-layout），刷新后不变；可以恢复默认布局
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import AppIcon from '../desktop/AppIcon'
import { appHref, APPS, type AppId } from '../desktop/apps'
import { cellsOf, defaultLayout, GRID, itemAt, moveItem, type DesktopItem, type DesktopLayout, type Slot } from '../desktop/layout'
import { loadLayout, resetLayout, saveLayout, savePage, saveWidgetCharacter, useDesktopLayout } from '../desktop/layoutStore'
import { migrateLegacyDesktopNote } from '../db/noteRepo'
import { WidgetView } from '../desktop/widgets'
import { ActionSheet } from '../components/Sheet'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { getOrCreateSingleConversation } from '../db/repo'
import { useUnreadTotal } from '../desktop/useUnread'
import { deskMetrics } from '../desktop/metrics'
import DeskOrnaments from '../desktop/DeskOrnaments'
import { ConfirmDialog } from '../components/Sheet'

export const LONG_PRESS_MS = 480
const MOVE_CANCEL = 10
const DRAG_START = 6
const EDGE = 22
const EDGE_HOLD_MS = 550

const slotKey = (s: Slot | null) => (s ? (s.area === 'dock' ? `d${s.index}` : `p${s.page}-${s.index}`) : '')

function readSlot(el: Element | null): Slot | null {
  const t = el?.closest<HTMLElement>('[data-slot]')
  if (t) {
    const [area, a, b] = (t.dataset.slot ?? '').split(':')
    return area === 'dock' ? { area: 'dock', index: Number(a) } : { area: 'page', page: Number(a), index: Number(b) }
  }
  return null
}

type WidgetItem = Extract<DesktopItem, { kind: 'widget' }>

interface Press {
  id: number
  x: number
  y: number
  slot: Slot
  timer?: ReturnType<typeof setTimeout>
}

interface Drag {
  from: Slot
  item: DesktopItem
  x: number
  y: number
  over: Slot | null
}

export default function DesktopPage() {
  const nav = useNavigate()
  const unread = useUnreadTotal()
  const saved = useDesktopLayout()
  const [fallback] = useState(defaultLayout)
  const layout: DesktopLayout = saved ?? fallback
  const [page, setPageState] = useState(layout.page)
  const [editing, setEditing] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const chars = useLiveQuery(() => (picking ? db.characters.toArray() : []), [picking], [])
  const pager = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const suppressClick = useRef(false)
  const edgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const restored = useRef(false)

  // 第一次进入：生成并保存默认布局（以后不会再覆盖）；旧版桌面便签复制成一张便签（只执行一次）
  useEffect(() => {
    void loadLayout().then(() => migrateLegacyDesktopNote())
  }, [])

  // 读取到保存的布局后，停在上次的那一页（只做一次）
  useLayoutEffect(() => {
    if (!saved || restored.current) return
    restored.current = true
    const el = pager.current
    if (el) el.scrollLeft = el.clientWidth * saved.page
    setPageState(saved.page)
  }, [saved])

  // 图标、行距、列间距与小组件尺寸按屏幕宽度计算（见 metrics.ts），屏幕太矮时再按高度缩小
  const [metrics, setMetrics] = useState(() => deskMetrics(390, 640))
  useLayoutEffect(() => {
    const el = pager.current
    if (!el) return
    const fit = () => el.clientWidth && setMetrics(deskMetrics(el.clientWidth, el.clientHeight, GRID.rows))
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [editing])

  useEffect(() => () => {
    clearTimeout(edgeTimer.current)
    clearTimeout(scrollTimer.current)
    clearTimeout(press.current?.timer)
  }, [])

  const commit = (next: DesktopLayout | null) => {
    if (next && next !== layout) void saveLayout(next)
  }

  const onScroll = () => {
    const el = pager.current
    if (!el || !el.clientWidth) return
    const p = Math.min(Math.max(Math.round(el.scrollLeft / el.clientWidth), 0), GRID.pages - 1)
    if (p !== page) setPageState(p)
    clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      if (saved && restored.current) void savePage(p)
    }, 300)
  }
  const goPage = (p: number) => pager.current?.scrollTo({ left: p * pager.current.clientWidth, behavior: 'smooth' })

  /* ---------- 按压、长按、拖动 ---------- */
  const onPointerDown = (e: ReactPointerEvent, slot: Slot) => {
    if (e.button !== 0 || press.current) return
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, slot }
    if (!editing) {
      press.current.timer = setTimeout(() => {
        setEditing(true)
        suppressClick.current = true
        navigator.vibrate?.(8)
      }, LONG_PRESS_MS)
    } else {
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y)
    if (!editing) {
      // 手指在动：这是滑动，不是长按
      if (dist > MOVE_CANCEL) {
        clearTimeout(p.timer)
        press.current = null
      }
      return
    }
    if (!drag && dist < DRAG_START) return
    const item = itemAt(layout, p.slot)
    if (!item) return
    const over = readSlot(document.elementFromPoint(e.clientX, e.clientY)) ?? dropAreaAt(e.clientX, e.clientY)
    setDrag({ from: p.slot, item, x: e.clientX, y: e.clientY, over })
    // 拖到屏幕边缘停一下：翻到相邻页
    const nearEdge = e.clientX < EDGE ? -1 : e.clientX > window.innerWidth - EDGE ? 1 : 0
    if (nearEdge && !edgeTimer.current) {
      edgeTimer.current = setTimeout(() => {
        edgeTimer.current = undefined
        const target = page + nearEdge
        if (target >= 0 && target < GRID.pages) goPage(target)
      }, EDGE_HOLD_MS)
    } else if (!nearEdge && edgeTimer.current) {
      clearTimeout(edgeTimer.current)
      edgeTimer.current = undefined
    }
  }

  /** 指针下面不是图标时：落在某一页的空白处 → 放到这一页最后；落在 Dock 空白处 → 放到 Dock 最后 */
  const dropAreaAt = (x: number, y: number): Slot | null => {
    const el = document.elementFromPoint(x, y)
    const area = el?.closest<HTMLElement>('[data-drop]')
    if (!area) return null
    if (area.dataset.drop === 'dock') return { area: 'dock', index: layout.dock.length }
    const pg = Number(area.dataset.drop)
    return { area: 'page', page: pg, index: layout.pages[pg]?.length ?? 0 }
  }

  const endPress = (e: ReactPointerEvent, cancelled: boolean) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    clearTimeout(p.timer)
    clearTimeout(edgeTimer.current)
    edgeTimer.current = undefined
    press.current = null
    if (drag) {
      if (!cancelled && drag.over) commit(moveItem(layout, drag.from, drag.over))
      setDrag(null)
      suppressClick.current = true
    }
  }

  /** 小组件点按：时间进入时钟；音乐进入音乐应用；便签打开编辑；角色进入聊天（未选择时选择角色）。编辑模式下点角色小组件可以更换角色 */
  const onClickWidget = (it: WidgetItem) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (editing) {
      if (it.widget === 'character') setPicking(it.id)
      return
    }
    if (it.widget === 'clock') nav(appHref('clock'))
    else if (it.widget === 'weather') nav(appHref('weather'))
    else if (it.widget === 'music') nav(appHref('music'))
    else if (it.widget === 'note') {
      // 打开指定的那张便签；没有指定或已删除时，到便签应用里写一张或选一张
      if (!it.noteId) return nav(`/notes/new?widget=${it.id}`)
      void db.notes.get(it.noteId).then((n) => nav(n && !n.deletedAt ? `/notes/${n.id}` : `/notes?pickFor=${it.id}`))
    }
    else if (it.widget === 'character') {
      if (!it.characterId) return setPicking(it.id)
      void db.characters.get(it.characterId).then(async (c) => {
        if (!c) return setPicking(it.id)
        nav(`/chat/${await getOrCreateSingleConversation(c.id)}`)
      })
    }
  }

  const onClickItem = (id: AppId) => {
    if (suppressClick.current || editing) {
      suppressClick.current = false
      return
    }
    nav(appHref(id))
  }

  const handlers = (slot: Slot) => ({
    'data-slot': slot.area === 'dock' ? `dock:${slot.index}` : `page:${slot.page}:${slot.index}`,
    onPointerDown: (e: ReactPointerEvent) => onPointerDown(e, slot),
    onPointerMove,
    onPointerUp: (e: ReactPointerEvent) => endPress(e, false),
    onPointerCancel: (e: ReactPointerEvent) => endPress(e, true),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  })

  const dragging = (s: Slot) => !!drag && slotKey(drag.from) === slotKey(s)
  const isOver = (s: Slot) => !!drag && slotKey(drag.over) === slotKey(s) && !dragging(s)
  const cellClass = (s: Slot) =>
    `${editing ? 'desk-wiggle touch-none' : ''} ${dragging(s) ? 'opacity-25' : ''} ${isOver(s) ? 'desk-target' : ''}`

  const renderItem = (it: DesktopItem, s: Extract<Slot, { area: 'page' }>): ReactNode => {
    if (it.kind === 'widget') {
      return (
        <div
          key={it.id}
          {...handlers(s)}
          role="button"
          onClick={() => onClickWidget(it)}
          className={`desk-wslot ${it.size === 'medium' ? 'col-span-4' : 'col-span-2'} row-span-2 press ${cellClass(s)}`}
        >
          <WidgetView item={it} />
        </div>
      )
    }
    return (
      <div key={it.app} className="flex items-start justify-center">
        <button {...handlers(s)} aria-label={APPS[it.app].name} className={`press ${cellClass(s)}`} onClick={() => onClickItem(it.app)}>
          <AppIcon id={it.app} badge={it.app === 'messages' ? unread : 0} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="desk h-dvh flex flex-col overflow-hidden relative"
      style={{
        paddingTop: 'calc(var(--safe-top) + 18px)',
        ['--desk-icon' as string]: `${metrics.icon}px`,
        ['--desk-row' as string]: `${metrics.row}px`,
        ['--desk-gap' as string]: `${metrics.gap}px`,
      }}
      data-editing={editing || undefined}
    >
      <DeskOrnaments />
      {editing && (
        <div className="absolute left-0 right-0 z-20 flex justify-between px-4" style={{ top: 'calc(var(--safe-top) + 4px)' }}>
          <button className="press h-8 px-3.5 rounded-full glass-3 text-[13px] text-[var(--c-text-2)]" onClick={() => setConfirmReset(true)}>
            恢复默认
          </button>
          <button className="press h-8 px-4 rounded-full bg-[var(--c-accent)] text-white text-[13px]" onClick={() => setEditing(false)}>
            完成
          </button>
        </div>
      )}
      <div
        ref={pager}
        onScroll={onScroll}
        className={`desk-pager flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden ${editing ? 'pt-8' : ''}`}
        aria-label="桌面"
      >
        {layout.pages.map((items, i) => (
          <section key={i} data-drop={i} className="desk-page w-full shrink-0 h-full" style={{ paddingLeft: metrics.pad, paddingRight: metrics.pad }} aria-label={`第 ${i + 1} 页`} aria-hidden={i !== page}>
            <div className="relative h-full">
              {/* 空位较多的页：底部一行很淡的冬日来信落款（只是装饰，不接收点按，不影响拖放） */}
              {items.reduce((n, it) => n + cellsOf(it), 0) <= 16 && <Signature index={i} />}
              <div className="relative grid grid-cols-4 content-start" style={{ gridTemplateRows: `repeat(${GRID.rows}, var(--desk-row))` }}>
                {items.map((it, index) => renderItem(it, { area: 'page', page: i, index }))}
              </div>
            </div>
          </section>
        ))}
      </div>

      <div className="shrink-0 flex justify-center gap-[7px] py-3" role="tablist" aria-label="桌面页">
        {layout.pages.map((_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === page}
            aria-label={`第 ${i + 1} 页`}
            onClick={() => goPage(i)}
            className={`desk-dot ${i === page ? 'desk-dot-on' : ''}`}
          />
        ))}
      </div>

      <nav className="shrink-0" style={{ paddingLeft: metrics.pad - 4, paddingRight: metrics.pad - 4, paddingBottom: 'calc(var(--safe-bottom) + 10px)' }} aria-label="Dock">
        <div data-drop="dock" style={{ height: metrics.dock }} className={`desk-dock grid grid-cols-4 items-center px-1 ${drag && drag.over?.area === 'dock' ? 'desk-dock-over' : ''}`}>
          {layout.dock.map((id, index) => {
            const s: Slot = { area: 'dock', index }
            return (
              <div key={id} className="flex justify-center">
                <button {...handlers(s)} aria-label={APPS[id].name} className={`press ${cellClass(s)}`} onClick={() => onClickItem(id)}>
                  <AppIcon id={id} badge={id === 'messages' ? unread : 0} showLabel={false} />
                </button>
              </div>
            )
          })}
        </div>
      </nav>

      {drag && (
        <div className="fixed z-50 pointer-events-none" style={{ left: drag.x, top: drag.y, transform: 'translate(-50%, -60%) scale(1.12)' }} aria-hidden>
          {drag.item.kind === 'app' ? <AppIcon id={drag.item.app} showLabel={false} /> : <div className="h-[60px] w-[120px] rounded-[18px] glass-1" />}
        </div>
      )}
      {picking && (
        <ActionSheet
          title="角色小组件显示谁？"
          subtitle={chars.length ? '点按小组件会直接进入和 TA 的聊天，不会调用 AI' : '还没有角色，可以先在联系人中添加'}
          actions={[
            ...chars.map((c) => ({ label: c.name, onClick: () => { const id = picking; setPicking(null); void saveWidgetCharacter(id, c.id) } })),
            ...(chars.length ? [{ label: '不显示角色', onClick: () => { const id = picking; setPicking(null); void saveWidgetCharacter(id, undefined) } }] : []),
          ]}
          onClose={() => setPicking(null)}
        />
      )}
      {confirmReset && (
        <ConfirmDialog
          title="恢复默认桌面布局？"
          message="只会重置桌面上图标和小组件的位置，不会影响角色、聊天、动态、记忆等任何数据。"
          confirmText="恢复默认"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false)
            void resetLayout().then(() => goPage(0))
          }}
        />
      )}
    </div>
  )
}

const SIGNATURES = ['Lingling · a winter letter', 'with love, from the snow', 'Lingling · a winter letter']

function Signature({ index }: { index: number }) {
  return (
    <div className="desk-signature pointer-events-none absolute inset-x-0 bottom-[6%] flex flex-col items-center" aria-hidden>
      <svg width="34" height="34" viewBox="0 0 34 34" fill="none" className="opacity-80">
        <circle cx="17" cy="17" r="15.5" stroke="#fff" strokeWidth="0.8" />
        <circle cx="17" cy="17" r="12.5" stroke="#b5c8de" strokeWidth="0.6" />
        <path d="M17 8v18M9.2 12.5l15.6 9M9.2 21.5l15.6-9" stroke="#9fb5d0" strokeWidth="0.9" strokeLinecap="round" />
      </svg>
      <div className="mt-2 text-[24px] leading-none text-[#8aa2c1]" style={{ fontFamily: 'var(--font-script)', textShadow: '0 0 10px rgba(255,255,255,0.95)' }}>
        {SIGNATURES[index % SIGNATURES.length]}
      </div>
      <span className="mt-2 h-px w-24 bg-[linear-gradient(90deg,rgba(160,182,210,0),rgba(160,182,210,0.6),rgba(160,182,210,0))]" />
    </div>
  )
}
