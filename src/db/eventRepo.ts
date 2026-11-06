/** 日历读写。删除先进入「最近删除」，可以恢复；彻底删除只允许已在最近删除中的事件。 */
import { db } from './db'
import type { CalEvent } from './schema'
import { uid } from '../lib/util'
import { EVENT_LIMITS, validateEvent } from '../life/calendar'

export type EventInput = Pick<CalEvent, 'title' | 'kind' | 'allDay' | 'date' | 'startTime' | 'endTime' | 'location' | 'note' | 'repeat' | 'characterId' | 'anniversaryType' | 'diaryIds'>

export class EventError extends Error {}

function clean(i: EventInput): EventInput {
  return {
    ...i,
    title: i.title.trim().slice(0, EVENT_LIMITS.title),
    location: i.location.trim().slice(0, EVENT_LIMITS.location),
    note: i.note.slice(0, EVENT_LIMITS.note),
    startTime: i.allDay ? undefined : i.startTime,
    endTime: i.allDay ? undefined : i.endTime || undefined,
    characterId: i.kind === 'event' ? undefined : i.characterId || undefined,
    anniversaryType: i.kind === 'anniversary' ? i.anniversaryType ?? 'other' : i.kind === 'birthday' ? 'birthday' : undefined,
    diaryIds: [...new Set(i.diaryIds)],
  }
}

/** 保存（新建或更新）；校验不通过时抛出 EventError（中文原因） */
export async function saveEvent(id: string | null, input: EventInput): Promise<string> {
  const c = clean(input)
  const bad = validateEvent(c)
  if (bad) throw new EventError(bad)
  const now = Date.now()
  if (!id) {
    const e: CalEvent = { ...c, id: uid('evt'), source: 'local', createdAt: now, updatedAt: now }
    await db.events.add(e)
    return e.id
  }
  await db.events.update(id, { ...c, updatedAt: now })
  return id
}

export async function trashEvent(id: string): Promise<void> {
  await db.events.update(id, { deletedAt: Date.now() })
}

export async function restoreEvent(id: string): Promise<void> {
  await db.events.where('id').equals(id).modify((e) => {
    delete e.deletedAt
    e.updatedAt = Date.now()
  })
}

export async function purgeEvent(id: string): Promise<boolean> {
  const e = await db.events.get(id)
  if (!e?.deletedAt) return false
  await db.events.delete(id)
  return true
}

/** 关联到某篇日记的日程（日记页面显示入口用） */
export async function eventsForDiary(diaryId: string): Promise<CalEvent[]> {
  return (await db.events.toArray()).filter((e) => !e.deletedAt && e.diaryIds.includes(diaryId))
}
