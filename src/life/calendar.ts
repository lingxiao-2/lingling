/**
 * 日历的纯函数：重复规则、某天 / 某段时间的日程、纪念日周年数、搜索、校验，
 * 以及为下一阶段「通过 iOS 快捷指令添加到系统日历」准备的标准数据格式（JSON 与 .ics）。
 * 本阶段不访问 iPhone 系统日历；导出文件需要用户自己打开添加，聆聆不会声称已经同步。
 */
import type { AnniversaryType, CalEvent, EventKind, EventRepeat } from '../db/schema'
import { isDateString, localDate, parseDate } from './diary'

export const EVENT_LIMITS = { title: 60, location: 80, note: 1000 }

export const KIND_LABEL: Record<EventKind, string> = { event: '日程', anniversary: '纪念日', birthday: '生日' }
export const REPEAT_LABEL: Record<EventRepeat, string> = { none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }
export const ANNIV_LABEL: Record<AnniversaryType, string> = { met: '初次认识', together: '交往纪念日', birthday: '角色生日', other: '其他纪念日' }

const isTime = (t?: string) => !!t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

/** 校验：标题必填、日期合法、时间格式正确且结束不早于开始；返回中文问题或 null */
export function validateEvent(e: Pick<CalEvent, 'title' | 'date' | 'allDay' | 'startTime' | 'endTime'>): string | null {
  if (!e.title.trim()) return '请填写标题'
  if (!isDateString(e.date)) return '日期不正确'
  if (!e.allDay) {
    if (!isTime(e.startTime)) return '请填写开始时间'
    if (e.endTime && !isTime(e.endTime)) return '结束时间不正确'
    if (e.endTime && e.endTime < e.startTime!) return '结束时间不能早于开始时间'
  }
  return null
}

/** 纪念日和生日默认每年重复 */
export function defaultRepeat(kind: EventKind): EventRepeat {
  return kind === 'event' ? 'none' : 'yearly'
}

/** 这个事件在某一天是否发生（按重复规则计算；某月没有 31 号、非闰年没有 2 月 29 日时那一次跳过） */
export function occursOn(e: Pick<CalEvent, 'date' | 'repeat' | 'deletedAt'>, day: string): boolean {
  if (e.deletedAt || day < e.date) return false
  if (day === e.date) return true
  const a = parseDate(e.date)
  const b = parseDate(day)
  switch (e.repeat) {
    case 'daily':
      return true
    case 'weekly':
      return a.getDay() === b.getDay()
    case 'monthly':
      return a.getDate() === b.getDate()
    case 'yearly':
      return a.getDate() === b.getDate() && a.getMonth() === b.getMonth()
    default:
      return false
  }
}

export interface Occurrence {
  event: CalEvent
  date: string
}

function* days(from: string, to: string) {
  const d = parseDate(from)
  const end = parseDate(to)
  while (d <= end) {
    yield localDate(d)
    d.setDate(d.getDate() + 1)
  }
}

/** 一段日期（含首尾）内的所有发生（全天的排在同一天的前面，其余按开始时间） */
export function occurrences(events: CalEvent[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = []
  for (const day of days(from, to)) for (const e of events) if (occursOn(e, day)) out.push({ event: e, date: day })
  return out.sort((x, y) => x.date.localeCompare(y.date) || Number(y.event.allDay) - Number(x.event.allDay) || (x.event.startTime ?? '').localeCompare(y.event.startTime ?? ''))
}

export function addDays(day: string, n: number): string {
  const d = parseDate(day)
  d.setDate(d.getDate() + n)
  return localDate(d)
}

/** 纪念日 / 生日在某一天是第几周年（第一次当天为 0） */
export function yearsSince(e: Pick<CalEvent, 'date'>, day: string): number {
  return parseDate(day).getFullYear() - parseDate(e.date).getFullYear()
}

export function anniversaryText(e: CalEvent, day: string): string {
  if (e.kind === 'event') return ''
  const n = yearsSince(e, day)
  if (n <= 0) return e.kind === 'birthday' ? '生日' : '这一天'
  return e.kind === 'birthday' ? `${n} 岁生日` : `${n} 周年`
}

/** 搜索标题、地点、备注（不含最近删除） */
export function searchEvents(list: CalEvent[], q: string): CalEvent[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return list
    .filter((e) => !e.deletedAt)
    .filter((e) => {
      const hay = `${e.title}\n${e.location}\n${e.note}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}

/* ---------- 为 iOS 快捷指令 / 系统日历准备的标准格式（本阶段只导出，不同步） ---------- */

export interface ShortcutEventPayload {
  /** 格式版本，以后的快捷指令据此解析 */
  format: 'lingling-event'
  version: 1
  /** 聆聆内的事件 ID，用于以后避免重复添加 */
  linglingId: string
  title: string
  isAllDay: boolean
  /** 本地时间 ISO（无时区）：YYYY-MM-DDTHH:mm:00；全天事件为当天 00:00 */
  start: string
  end: string
  location: string
  notes: string
  recurrence: { frequency: Exclude<EventRepeat, 'none'>; interval: 1 } | null
  /** 明确标记：这是从聆聆导出的数据，不代表已经写入 iPhone 日历 */
  syncedToSystemCalendar: false
}

export function toShortcutPayload(e: CalEvent): ShortcutEventPayload {
  const start = e.allDay ? `${e.date}T00:00:00` : `${e.date}T${e.startTime}:00`
  const end = e.allDay ? `${addDays(e.date, 1)}T00:00:00` : `${e.date}T${e.endTime || e.startTime}:00`
  return {
    format: 'lingling-event',
    version: 1,
    linglingId: e.id,
    title: e.title,
    isAllDay: e.allDay,
    start,
    end,
    location: e.location,
    notes: e.note,
    recurrence: e.repeat === 'none' ? null : { frequency: e.repeat, interval: 1 },
    syncedToSystemCalendar: false,
  }
}

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`)

/** .ics 文件（iPhone 上用户点开后可以手动选择「添加到日历」） */
export function toICS(e: CalEvent, now = new Date()): string {
  const compact = (s: string) => s.replace(/[-:]/g, '')
  const p = toShortcutPayload(e)
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lingling//Calendar//ZH',
    'BEGIN:VEVENT',
    `UID:${e.id}@lingling.local`,
    `DTSTAMP:${stamp}`,
    e.allDay ? `DTSTART;VALUE=DATE:${compact(e.date)}` : `DTSTART:${compact(p.start)}`,
    e.allDay ? `DTEND;VALUE=DATE:${compact(addDays(e.date, 1))}` : `DTEND:${compact(p.end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    ...(e.note ? [`DESCRIPTION:${icsEscape(e.note)}`] : []),
    ...(e.repeat !== 'none' ? [`RRULE:FREQ=${e.repeat.toUpperCase()}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n') + '\r\n'
}
