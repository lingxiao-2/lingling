/** 日记读写。删除先进入「最近删除」，可以恢复；彻底删除只允许已在最近删除中的日记。 */
import { db } from './db'
import type { Diary } from './schema'
import { uid } from '../lib/util'
import { DIARY_LIMITS, isBlank, isDateString, localDate, normalizeTags } from '../life/diary'

export type DiaryPatch = Partial<Pick<Diary, 'date' | 'title' | 'body' | 'mood' | 'tags' | 'photoIds' | 'aiReadable'>>

function clean(p: DiaryPatch): DiaryPatch {
  const out: DiaryPatch = { ...p }
  if (p.title !== undefined) out.title = p.title.slice(0, DIARY_LIMITS.title)
  if (p.body !== undefined) out.body = p.body.slice(0, DIARY_LIMITS.body)
  if (p.tags !== undefined) out.tags = normalizeTags(p.tags)
  if (p.photoIds !== undefined) out.photoIds = [...new Set(p.photoIds)]
  if (p.date !== undefined && !isDateString(p.date)) delete out.date
  if (p.aiReadable !== undefined) out.aiReadable = p.aiReadable === true
  return out
}

/**
 * 自动保存：id 为空时，内容不是空白才新建（空白的新日记不保存）；有 id 时更新。返回日记 id（未保存时为 null）。
 */
export async function saveDiary(id: string | null, patch: DiaryPatch): Promise<string | null> {
  const p = clean(patch)
  const now = Date.now()
  if (!id) {
    const d: Diary = { id: uid('dia'), date: p.date ?? localDate(), title: p.title ?? '', body: p.body ?? '', mood: p.mood, tags: p.tags ?? [], photoIds: p.photoIds ?? [], aiReadable: p.aiReadable ?? false, createdAt: now, updatedAt: now }
    if (isBlank(d)) return null
    await db.diaries.add(d)
    return d.id
  }
  await db.diaries.update(id, { ...p, updatedAt: now })
  return id
}

export async function trashDiary(id: string): Promise<void> {
  await db.diaries.update(id, { deletedAt: Date.now() })
}

export async function restoreDiary(id: string): Promise<void> {
  await db.diaries.where('id').equals(id).modify((d) => {
    delete d.deletedAt
    d.updatedAt = Date.now()
  })
}

export async function purgeDiary(id: string): Promise<boolean> {
  const d = await db.diaries.get(id)
  if (!d?.deletedAt) return false
  await db.diaries.delete(id)
  return true
}
