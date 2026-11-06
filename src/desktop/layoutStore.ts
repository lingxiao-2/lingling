/**
 * 桌面布局的保存（沿用 IndexedDB 的 settings 表，独立的一项 'desktop-layout'，不修改数据库结构）。
 *  - 第一次进入桌面时生成并保存默认布局；之后只读取，不会再用默认布局覆盖用户的自定义布局
 *  - 读到的数据先经过 normalizeLayout 修复（损坏时退回默认），不影响角色、聊天等其他数据
 *  - 恢复默认只改写这一项
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { defaultLayout, normalizeLayout, setPage, setWidgetCharacter, setWidgetNote, type DesktopLayout } from './layout'

export const LAYOUT_KEY = 'desktop-layout'

export async function loadLayout(): Promise<DesktopLayout> {
  return db.transaction('rw', [db.settings], async () => {
    const row = await db.settings.get(LAYOUT_KEY)
    if (!row) {
      const d = defaultLayout()
      await db.settings.put({ key: LAYOUT_KEY, value: d })
      return d
    }
    const fixed = normalizeLayout(row.value)
    // 修复过的数据写回（例如新版本新增了应用）；内容相同就不写
    if (JSON.stringify(fixed) !== JSON.stringify(row.value)) await db.settings.put({ key: LAYOUT_KEY, value: fixed })
    return fixed
  })
}

export async function saveLayout(l: DesktopLayout): Promise<void> {
  await db.settings.put({ key: LAYOUT_KEY, value: normalizeLayout(l) })
}

/**
 * 只保存当前页码：在同一个事务里读取最新保存的布局再改页码，
 * 不会用旧的布局覆盖刚刚拖动后保存的结果。
 */
export async function savePage(page: number): Promise<void> {
  await db.transaction('rw', [db.settings], async () => {
    const row = await db.settings.get(LAYOUT_KEY)
    if (!row) return
    const cur = normalizeLayout(row.value)
    const next = setPage(cur, page)
    if (next !== cur) await db.settings.put({ key: LAYOUT_KEY, value: next })
  })
}

/** 恢复默认桌面布局（只改写桌面布局这一项） */
export async function resetLayout(): Promise<DesktopLayout> {
  const d = defaultLayout()
  await db.settings.put({ key: LAYOUT_KEY, value: d })
  return d
}

/** 订阅已保存的布局；第一次读取时如果没有，会生成默认布局 */
export function useDesktopLayout(): DesktopLayout | undefined {
  return useLiveQuery(async () => {
    const row = await db.settings.get(LAYOUT_KEY)
    return row ? normalizeLayout(row.value) : undefined
  }, [])
}

/** 角色小组件换一个角色（在同一个事务里读取最新布局，只改这一个小组件） */
export async function saveWidgetCharacter(widgetId: string, characterId: string | undefined): Promise<void> {
  await db.transaction('rw', [db.settings], async () => {
    const row = await db.settings.get(LAYOUT_KEY)
    const cur = row ? normalizeLayout(row.value) : defaultLayout()
    await db.settings.put({ key: LAYOUT_KEY, value: setWidgetCharacter(cur, widgetId, characterId) })
  })
}

/** 桌面便签小组件的内容（轻量，保存在 settings 的 desktop-note；以后与完整便签 / 日记应用联动） */
export const NOTE_KEY = 'desktop-note'
export interface DesktopNote {
  text: string
  updatedAt: number
}
export const NOTE_MAX = 200

export async function saveNote(text: string): Promise<DesktopNote> {
  const note = { text: text.replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX), updatedAt: Date.now() }
  await db.settings.put({ key: NOTE_KEY, value: note })
  return note
}

export function useDesktopNote(): DesktopNote | undefined {
  return useLiveQuery(async () => (await db.settings.get(NOTE_KEY))?.value as DesktopNote | undefined, [])
}

/** 便签小组件换一张便签（同一个事务里读取最新布局，只改这一个小组件） */
export async function saveWidgetNote(widgetId: string, noteId: string | undefined): Promise<void> {
  await db.transaction('rw', [db.settings], async () => {
    const row = await db.settings.get(LAYOUT_KEY)
    const cur = row ? normalizeLayout(row.value) : defaultLayout()
    await db.settings.put({ key: LAYOUT_KEY, value: setWidgetNote(cur, widgetId, noteId) })
  })
}

/** 桌面上第一个便签小组件的 ID（没有则为 null） */
export async function firstNoteWidget(): Promise<string | null> {
  const row = await db.settings.get(LAYOUT_KEY)
  const l = row ? normalizeLayout(row.value) : defaultLayout()
  for (const p of l.pages) for (const it of p) if (it.kind === 'widget' && it.widget === 'note') return it.id
  return null
}
