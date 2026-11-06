/** 便签读写。删除先进入「最近删除」，可以恢复；彻底删除只允许已在最近删除中的便签。 */
import { db } from './db'
import type { Note } from './schema'
import { uid } from '../lib/util'
import { isBlankNote, NOTE_LIMITS } from '../life/notes'
import { LAYOUT_KEY, NOTE_KEY, type DesktopNote } from '../desktop/layoutStore'
import { normalizeLayout, setWidgetNote } from '../desktop/layout'

export type NotePatch = Partial<Pick<Note, 'title' | 'kind' | 'text' | 'items' | 'color' | 'pinned'>>

function clean(p: NotePatch): NotePatch {
  const out: NotePatch = { ...p }
  if (p.title !== undefined) out.title = p.title.slice(0, NOTE_LIMITS.title)
  if (p.text !== undefined) out.text = p.text.slice(0, NOTE_LIMITS.text)
  if (p.items !== undefined) out.items = p.items.slice(0, NOTE_LIMITS.items).map((i) => ({ id: i.id, text: i.text.slice(0, NOTE_LIMITS.item), done: !!i.done }))
  return out
}

/** 自动保存：id 为空且内容空白时不新建；返回便签 id（未保存时为 null） */
export async function saveNote(id: string | null, patch: NotePatch): Promise<string | null> {
  const p = clean(patch)
  const now = Date.now()
  if (!id) {
    const n: Note = { id: uid('note'), title: p.title ?? '', kind: p.kind ?? 'text', text: p.text ?? '', items: p.items ?? [], color: p.color ?? 'pearl', pinned: p.pinned ?? false, createdAt: now, updatedAt: now }
    if (isBlankNote(n)) return null
    await db.notes.add(n)
    return n.id
  }
  await db.notes.update(id, { ...p, updatedAt: now })
  return id
}

export async function trashNote(id: string): Promise<void> {
  await db.notes.update(id, { deletedAt: Date.now() })
}

export async function restoreNote(id: string): Promise<void> {
  await db.notes.where('id').equals(id).modify((n) => {
    delete n.deletedAt
    n.updatedAt = Date.now()
  })
}

export async function purgeNote(id: string): Promise<boolean> {
  const n = await db.notes.get(id)
  if (!n?.deletedAt) return false
  await db.notes.delete(id)
  return true
}

export const LEGACY_MIGRATED_KEY = 'desktop-note-migrated'

/**
 * 旧版桌面便签（settings 的 desktop-note，只有一段文字）→ 复制成一张便签，并让桌面上还没有指定便签的小组件显示它。
 * 只执行一次（记录在 settings 的 desktop-note-migrated）；原来的 desktop-note 记录保留不删。
 */
export async function migrateLegacyDesktopNote(): Promise<string | null> {
  return db.transaction('rw', [db.settings, db.notes], async () => {
    if (await db.settings.get(LEGACY_MIGRATED_KEY)) return null
    const legacy = (await db.settings.get(NOTE_KEY))?.value as DesktopNote | undefined
    let id: string | null = null
    if (legacy?.text?.trim()) {
      const now = Date.now()
      id = uid('note')
      await db.notes.add({ id, title: '', kind: 'text', text: legacy.text, items: [], color: 'pearl', pinned: false, createdAt: legacy.updatedAt || now, updatedAt: legacy.updatedAt || now })
      const row = await db.settings.get(LAYOUT_KEY)
      if (row) {
        let l = normalizeLayout(row.value)
        for (const p of l.pages) for (const it of p) if (it.kind === 'widget' && it.widget === 'note' && !it.noteId) l = setWidgetNote(l, it.id, id)
        await db.settings.put({ key: LAYOUT_KEY, value: l })
      }
    }
    await db.settings.put({ key: LEGACY_MIGRATED_KEY, value: { at: Date.now(), noteId: id } })
    return id
  })
}
