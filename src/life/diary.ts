/** 日记的纯函数：心情、标签、搜索、按日期筛选、月历标记、日期格式。 */
import type { Diary, DiaryMood } from '../db/schema'

export const DIARY_LIMITS = { title: 60, body: 20000, tags: 8, tag: 12 }

export const MOODS: { id: DiaryMood; label: string; en: string; color: string }[] = [
  { id: 'calm', label: '平静', en: 'calm', color: '#9fb8d6' },
  { id: 'happy', label: '开心', en: 'happy', color: '#f0c98a' },
  { id: 'tender', label: '温柔', en: 'tender', color: '#e8b4c4' },
  { id: 'excited', label: '期待', en: 'excited', color: '#b4d6c6' },
  { id: 'missing', label: '想念', en: 'missing', color: '#c3b4e3' },
  { id: 'tired', label: '疲惫', en: 'tired', color: '#c2c8d2' },
  { id: 'sad', label: '低落', en: 'blue', color: '#8fa3c0' },
  { id: 'anxious', label: '不安', en: 'uneasy', color: '#d1b6a0' },
]

export const moodOf = (id?: DiaryMood) => MOODS.find((m) => m.id === id)

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
const MON_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** 本地日期 YYYY-MM-DD */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** 合法的 YYYY-MM-DD（不接受 2026-13-40 这类会被 Date 自动进位的日期） */
export function isDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && localDate(parseDate(s)) === s
}

export function dateParts(s: string) {
  const d = parseDate(s)
  return { day: String(d.getDate()).padStart(2, '0'), monEn: MON_EN[d.getMonth()], year: d.getFullYear(), week: WEEK[d.getDay()], zh: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` }
}

/** 整理标签：去掉 #、空白和重复，最多 8 个，每个最多 12 字 */
export function normalizeTags(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(/[,，、\s#]+/)
  const out: string[] = []
  for (const t of raw) {
    const v = t.replace(/^#+/, '').trim().slice(0, DIARY_LIMITS.tag)
    if (v && !out.includes(v)) out.push(v)
    if (out.length >= DIARY_LIMITS.tags) break
  }
  return out
}

/** 是否还是空白（标题、正文、照片都没有）——空白的新日记不会保存 */
export function isBlank(d: Pick<Diary, 'title' | 'body' | 'photoIds'>): boolean {
  return !d.title.trim() && !d.body.trim() && !d.photoIds.length
}

export interface DiaryFilter {
  query?: string
  /** YYYY-MM：只看某个月 */
  month?: string
  /** YYYY-MM-DD：只看某一天 */
  date?: string
  tag?: string
}

/** 筛选并按日期从新到旧排序（不含最近删除） */
export function filterDiaries(list: Diary[], f: DiaryFilter = {}): Diary[] {
  const words = (f.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return list
    .filter((d) => !d.deletedAt)
    .filter((d) => !f.date || d.date === f.date)
    .filter((d) => !f.month || d.date.startsWith(f.month))
    .filter((d) => !f.tag || d.tags.includes(f.tag))
    .filter((d) => {
      if (!words.length) return true
      const hay = `${d.title}\n${d.body}\n${d.tags.join(' ')}\n${moodOf(d.mood)?.label ?? ''}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt)
}

/** 这个月里有日记的日期（用于月历上的小点） */
export function daysWithEntries(list: Diary[], month: string): Set<number> {
  return new Set(list.filter((d) => !d.deletedAt && d.date.startsWith(month)).map((d) => parseDate(d.date).getDate()))
}

/** 月历格子：前面补空位，周日开始 */
export function monthGrid(year: number, month0: number): (number | null)[] {
  const first = new Date(year, month0, 1).getDay()
  const days = new Date(year, month0 + 1, 0).getDate()
  return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
}

/** 最常用的标签 */
export function topTags(list: Diary[], n = 8): string[] {
  const count = new Map<string, number>()
  for (const d of list) if (!d.deletedAt) for (const t of d.tags) count.set(t, (count.get(t) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([t]) => t)
}

export function snippet(body: string, n = 70): string {
  const t = body.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
