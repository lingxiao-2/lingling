/**
 * 桌面布局（纯函数，便于测试与迁移）。
 *
 *  - 三个桌面页面 + 固定 Dock；每页 4 列 × 6 行
 *  - 每页的内容是一个有序列表，按 iPhone 的方式从左上往右下依次排布：应用占 1 格，小组件占 2×2 或 4×2
 *  - 布局带版本号，独立于角色和聊天数据；数据不完整或损坏时修复或退回默认布局，不影响其他数据
 */
import { APP_IDS, isAppId, type AppId } from './apps'

export const GRID = { cols: 4, rows: 6, pages: 3, dock: 4 }
/** 1：只有应用（第四阶段 PR A/B）· 2：加入默认小组件（PR C） */
export const LAYOUT_VERSION = 2

export type WidgetKind = 'clock' | 'music' | 'note' | 'character'
export type WidgetSize = 'small' | 'medium'

export type DesktopItem =
  | { kind: 'app'; app: AppId }
  | { kind: 'widget'; id: string; widget: WidgetKind; size: WidgetSize; characterId?: string }

export interface DesktopLayout {
  version: number
  pages: DesktopItem[][]
  dock: AppId[]
  /** 上次停留的桌面页（从 0 开始） */
  page: number
}

export const DEFAULT_DOCK: AppId[] = ['messages', 'contacts', 'moments', 'me']

const app = (id: AppId): DesktopItem => ({ kind: 'app', app: id })

/** 默认小组件（v2 起）：第 1 页时间日期、便签、角色；第 2 页音乐 */
export const DEFAULT_WIDGETS: { page: number; item: Extract<DesktopItem, { kind: 'widget' }> }[] = [
  { page: 0, item: { kind: 'widget', id: 'w-clock', widget: 'clock', size: 'medium' } },
  { page: 0, item: { kind: 'widget', id: 'w-note', widget: 'note', size: 'small' } },
  { page: 0, item: { kind: 'widget', id: 'w-character', widget: 'character', size: 'small' } },
  { page: 1, item: { kind: 'widget', id: 'w-music', widget: 'music', size: 'medium' } },
]

export function defaultLayout(): DesktopLayout {
  const widgetsOn = (p: number) => DEFAULT_WIDGETS.filter((w) => w.page === p).map((w) => ({ ...w.item }))
  return {
    version: LAYOUT_VERSION,
    pages: [
      [...widgetsOn(0), ...['memory', 'album', 'diary', 'notes', 'calendar', 'music', 'clock', 'weather'].map((x) => app(x as AppId))],
      [...widgetsOn(1), ...['mail', 'gift', 'tarot', 'theme'].map((x) => app(x as AppId))],
      ['worlds', 'lorebooks', 'stickers', 'backup', 'ai'].map((x) => app(x as AppId)),
    ],
    dock: [...DEFAULT_DOCK],
    page: 0,
  }
}

/** 一个项目占几格 */
export function cellsOf(it: DesktopItem): number {
  if (it.kind === 'app') return 1
  return it.size === 'medium' ? 8 : 4
}

/** 这一页的项目是否放得下（按占用格数估算；小组件 2×2 需要成对的空位，这里只做总量限制） */
export function fits(items: DesktopItem[]): boolean {
  return items.reduce((n, it) => n + cellsOf(it), 0) <= GRID.cols * GRID.rows
}

/**
 * 修复布局：去掉未知或重复的应用、多余的页、超出的 Dock；缺失的应用补到最后一页有空位的地方；
 * 页数固定为 3，页码限制在范围内。无法识别的数据退回默认布局。
 */
export function normalizeLayout(raw: unknown): DesktopLayout {
  const d = defaultLayout()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<DesktopLayout>
  if (!Array.isArray(r.pages)) return d
  const seen = new Set<AppId>()
  const dock: AppId[] = []
  for (const x of Array.isArray(r.dock) ? r.dock : []) {
    if (isAppId(x) && !seen.has(x) && dock.length < GRID.dock) {
      dock.push(x)
      seen.add(x)
    }
  }
  const seenWidget = new Set<string>()
  const pages: DesktopItem[][] = []
  for (let i = 0; i < GRID.pages; i++) {
    const out: DesktopItem[] = []
    for (const it of Array.isArray(r.pages[i]) ? (r.pages[i] as unknown[]) : []) {
      const x = it as DesktopItem
      if (x?.kind === 'app' && isAppId(x.app) && !seen.has(x.app)) {
        seen.add(x.app)
        out.push({ kind: 'app', app: x.app })
      } else if (x?.kind === 'widget' && ['clock', 'music', 'note', 'character'].includes(x.widget) && typeof x.id === 'string' && !seenWidget.has(x.id)) {
        seenWidget.add(x.id)
        out.push({ kind: 'widget', id: x.id, widget: x.widget, size: x.size === 'medium' ? 'medium' : 'small', ...(x.characterId ? { characterId: String(x.characterId) } : {}) })
      }
      if (!fits(out)) out.pop()
    }
    pages.push(out)
  }
  // 旧版本（v1）的布局先加入默认小组件，再补缺失的应用，避免应用先占满小组件的位置
  if ((typeof r.version === 'number' ? r.version : 1) < 2) {
    const migrated = migrateToV2({ version: 1, pages, dock, page: 0 }).pages
    pages.splice(0, pages.length, ...migrated)
  }
  // 新版本增加的应用（或丢失的应用）：补到有空位的页
  for (const id of APP_IDS) {
    if (seen.has(id)) continue
    const target = pages.find((p) => fits([...p, { kind: 'app', app: id }])) ?? pages[pages.length - 1]
    target.push({ kind: 'app', app: id })
    seen.add(id)
  }
  const page = typeof r.page === 'number' && Number.isInteger(r.page) ? Math.min(Math.max(r.page, 0), GRID.pages - 1) : 0
  return { version: LAYOUT_VERSION, pages, dock, page }
}

/**
 * v1 → v2：用户之前保存的布局里没有小组件。把默认小组件加到它原本所在页的最前面；
 * 那一页放不下就放到后面有空位的页，都放不下就不加。用户自己排好的应用顺序和 Dock 不变。
 */
export function migrateToV2(l: DesktopLayout): DesktopLayout {
  const pages = l.pages.map((p) => [...p])
  const has = new Set(pages.flat().flatMap((x) => (x.kind === 'widget' ? [x.id] : [])))
  // 倒序插入，保证同一页内的顺序与默认布局一致
  for (const w of [...DEFAULT_WIDGETS].reverse()) {
    if (has.has(w.item.id)) continue
    for (let i = 0; i < pages.length; i++) {
      const p = (w.page + i) % pages.length
      const trial = [{ ...w.item }, ...pages[p]]
      if (fits(trial)) {
        pages[p] = trial
        break
      }
    }
  }
  return { ...l, version: 2, pages }
}

/** 设置角色小组件显示的角色 */
export function setWidgetCharacter(l: DesktopLayout, widgetId: string, characterId: string | undefined): DesktopLayout {
  return {
    ...l,
    pages: l.pages.map((p) => p.map((it) => (it.kind === 'widget' && it.id === widgetId ? { ...it, characterId } : it))),
  }
}

/** 桌面上的一个位置：某一页的第几个，或 Dock 的第几个 */
export type Slot = { area: 'page'; page: number; index: number } | { area: 'dock'; index: number }

function clone(l: DesktopLayout): DesktopLayout {
  return { ...l, pages: l.pages.map((p) => [...p]), dock: [...l.dock] }
}

export function itemAt(l: DesktopLayout, s: Slot): DesktopItem | undefined {
  if (s.area === 'dock') {
    const id = l.dock[s.index]
    return id ? { kind: 'app', app: id } : undefined
  }
  return l.pages[s.page]?.[s.index]
}

/**
 * 移动一个图标或小组件，返回新的布局；做不到时返回 null（原布局不变）：
 *  - 页内或跨页：从原位置取出，插入目标位置（index 超出时放到最后）；目标页放不下时不移动
 *  - 放进 Dock：只能放应用；Dock 已满（4 个）时与目标位置的应用互换
 *  - 从 Dock 拖到桌面：插入目标页；放不下时不移动
 */
export function moveItem(l: DesktopLayout, from: Slot, to: Slot): DesktopLayout | null {
  const it = itemAt(l, from)
  if (!it) return null
  if (from.area === to.area && (from.area === 'dock' || (to.area === 'page' && from.page === to.page)) && from.index === to.index) return l
  const n = clone(l)
  if (to.area === 'dock') {
    if (it.kind !== 'app') return null
    if (from.area === 'dock') {
      n.dock.splice(from.index, 1)
      n.dock.splice(Math.min(to.index, n.dock.length), 0, it.app)
      return n
    }
    n.pages[from.page].splice(from.index, 1)
    if (n.dock.length < GRID.dock) {
      n.dock.splice(Math.min(to.index, n.dock.length), 0, it.app)
    } else {
      // Dock 已满：与目标位置的应用互换
      const i = Math.min(to.index, n.dock.length - 1)
      const out = n.dock[i]
      n.dock[i] = it.app
      n.pages[from.page].splice(from.index, 0, { kind: 'app', app: out })
    }
    return n
  }
  if (from.area === 'dock') n.dock.splice(from.index, 1)
  else n.pages[from.page].splice(from.index, 1)
  const target = n.pages[to.page]
  if (!target) return null
  target.splice(Math.min(to.index, target.length), 0, it)
  if (!fits(target)) return null
  return n
}

export function setPage(l: DesktopLayout, page: number): DesktopLayout {
  const p = Math.min(Math.max(Math.round(page), 0), GRID.pages - 1)
  return p === l.page ? l : { ...l, page: p }
}
