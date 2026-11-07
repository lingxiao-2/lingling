/**
 * 真实 iPhone 常用操作：提醒事项、系统日历、打开应用。
 * 每个操作先生成「执行计划」（具体日期、时间、标题），显示给你确认，然后才运行对应的快捷指令。
 * 这些操作写入的是 **iPhone 系统** 的提醒事项 / 日历，与聆聆自己的日历完全分开。
 */
import { isDateString } from '../life/diary'
import type { ShortcutRun } from '../db/schema'
import { cleanText, shortcutFor, type RegisteredShortcut } from './shortcuts'
import { createRun, dedupeKey, recentDuplicate } from './runs'

export const ACTION_LIMITS = { title: 100, notes: 500, location: 100 }
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

/** 「2026-11-08 15:00」→「11月8日（星期日）15:00」 */
export function zhDateTime(date: string, time?: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const w = new Date(y, m - 1, d).getDay()
  const thisYear = new Date().getFullYear() === y
  return `${thisYear ? '' : `${y}年`}${m}月${d}日（星期${WEEK[w]}）${time ? ` ${time}` : ''}`
}

function addMinutes(date: string, time: string, mins: number): { date: string; time: string } {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const t = new Date(y, m - 1, d, hh, mm + mins)
  const p = (n: number) => String(n).padStart(2, '0')
  return { date: `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`, time: `${p(t.getHours())}:${p(t.getMinutes())}` }
}

export interface Plan {
  kind: ShortcutRun['kind']
  shortcut?: RegisteredShortcut
  title: string
  lines: string[]
  /** 交给快捷指令的文本（JSON） */
  input?: string
  /** 直接打开的链接（打开应用） */
  url?: string
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; error: string; code: 'invalid' | 'not_configured' }

const opt = (v: unknown, max: number, label: string): { ok: true; text: string } | { ok: false; error: string } => {
  if (v === undefined || v === null || v === '') return { ok: true, text: '' }
  const r = cleanText(v, max)
  return r.ok ? r : { ok: false, error: `${label}${r.error}` }
}

/* ---------------- 提醒事项 ---------------- */

export interface ReminderInput { title: string; date: string; time?: string; notes?: string }

export async function planReminder(a: ReminderInput, now = new Date()): Promise<PlanResult> {
  const title = cleanText(a.title, ACTION_LIMITS.title)
  if (!title.ok) return { ok: false, code: 'invalid', error: `标题${title.error}` }
  if (!isDateString(a.date)) return { ok: false, code: 'invalid', error: '日期不正确（YYYY-MM-DD）' }
  const time = a.time ?? '09:00'
  if (!TIME.test(time)) return { ok: false, code: 'invalid', error: '时间不正确（HH:MM）' }
  const notes = opt(a.notes, ACTION_LIMITS.notes, '备注')
  if (!notes.ok) return { ok: false, code: 'invalid', error: notes.error }
  const [y, m, d] = a.date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  if (new Date(y, m - 1, d, hh, mm).getTime() < now.getTime() - 60_000) return { ok: false, code: 'invalid', error: '提醒时间已经过去了' }
  const sc = await shortcutFor('reminder')
  if (!sc) return { ok: false, code: 'not_configured', error: '还没有登记「提醒事项」快捷指令（我的 → 连接真实 iPhone）' }
  const input = JSON.stringify({ v: 1, type: 'reminder', title: title.text, due: `${a.date} ${time}`, notes: notes.text })
  return {
    ok: true,
    plan: {
      kind: 'reminder', shortcut: sc, title: `iPhone 提醒事项：${title.text}`, input,
      lines: [`标题：${title.text}`, `提醒时间：${zhDateTime(a.date, time)}${a.time ? '' : '（没有指定时间，默认 09:00）'}`, ...(notes.text ? [`备注：${notes.text}`] : []), '会保存到 iPhone 的「提醒事项」App，不是聆聆'],
    },
  }
}

/* ---------------- 系统日历 ---------------- */

export interface CalendarInput { title: string; date: string; startTime: string; endTime?: string; location?: string; notes?: string }

export async function planCalendarEvent(a: CalendarInput): Promise<PlanResult> {
  const title = cleanText(a.title, ACTION_LIMITS.title)
  if (!title.ok) return { ok: false, code: 'invalid', error: `标题${title.error}` }
  if (!isDateString(a.date)) return { ok: false, code: 'invalid', error: '日期不正确（YYYY-MM-DD）' }
  if (!TIME.test(a.startTime ?? '')) return { ok: false, code: 'invalid', error: '开始时间不正确（HH:MM）' }
  if (a.endTime !== undefined && a.endTime !== '' && !TIME.test(a.endTime)) return { ok: false, code: 'invalid', error: '结束时间不正确（HH:MM）' }
  const end = a.endTime ? { date: a.endTime > a.startTime ? a.date : addMinutes(a.date, a.endTime, 24 * 60).date, time: a.endTime } : addMinutes(a.date, a.startTime, 60)
  if (a.endTime && a.endTime === a.startTime) return { ok: false, code: 'invalid', error: '结束时间不能等于开始时间' }
  const loc = opt(a.location, ACTION_LIMITS.location, '地点')
  if (!loc.ok) return { ok: false, code: 'invalid', error: loc.error }
  const notes = opt(a.notes, ACTION_LIMITS.notes, '备注')
  if (!notes.ok) return { ok: false, code: 'invalid', error: notes.error }
  const sc = await shortcutFor('calendar')
  if (!sc) return { ok: false, code: 'not_configured', error: '还没有登记「系统日历」快捷指令（我的 → 连接真实 iPhone）' }
  const input = JSON.stringify({ v: 1, type: 'calendar', title: title.text, start: `${a.date} ${a.startTime}`, end: `${end.date} ${end.time}`, location: loc.text, notes: notes.text })
  return {
    ok: true,
    plan: {
      kind: 'calendar', shortcut: sc, title: `iPhone 日历：${title.text}`, input,
      lines: [
        `标题：${title.text}`,
        `时间：${zhDateTime(a.date, a.startTime)} – ${end.date === a.date ? end.time : zhDateTime(end.date, end.time)}${a.endTime ? '' : '（没有指定结束时间，默认 1 小时）'}`,
        ...(loc.text ? [`地点：${loc.text}`] : []),
        ...(notes.text ? [`备注：${notes.text}`] : []),
        '会添加到 iPhone 的系统「日历」App，不是聆聆的日历',
      ],
    },
  }
}

/* ---------------- 打开应用 ---------------- */

/**
 * 可以直接打开的应用（Apple 自带应用的公开链接）。是否在每个 iOS 版本上都能打开需要真机确认；
 * 其他第三方应用请在快捷指令 App 中创建「打开 App」快捷指令，再登记为自定义快捷指令。
 */
export const APP_LINKS = {
  reminders: { name: '提醒事项', url: 'x-apple-reminderkit://' },
  calendar: { name: '日历', url: 'calshow://' },
  shortcuts: { name: '快捷指令', url: 'shortcuts://' },
  maps: { name: '地图', url: 'maps://' },
  music: { name: '音乐', url: 'music://' },
  notes: { name: '备忘录', url: 'mobilenotes://' },
} as const
export type AppId = keyof typeof APP_LINKS | 'safari'
export const APP_IDS = [...Object.keys(APP_LINKS), 'safari'] as AppId[]

export function planOpenApp(a: { app: string; url?: string }): PlanResult {
  if (a.app === 'safari') {
    let u: URL
    try {
      u = new URL(String(a.url ?? ''))
    } catch {
      return { ok: false, code: 'invalid', error: '要在 Safari 中打开的网址不正确' }
    }
    if (u.protocol !== 'https:' || u.username || u.password || String(a.url).length > 500) return { ok: false, code: 'invalid', error: '只能打开 https 网址' }
    return { ok: true, plan: { kind: 'open_app', title: `在 Safari 中打开 ${u.hostname}`, url: u.toString(), lines: [`网址：${u.toString()}`, '会在新的页面中打开'] } }
  }
  const app = APP_LINKS[a.app as keyof typeof APP_LINKS]
  if (!app) return { ok: false, code: 'invalid', error: `不支持直接打开这个应用；可以在快捷指令中创建「打开 App」后登记为自定义快捷指令` }
  return { ok: true, plan: { kind: 'open_app', title: `打开「${app.name}」`, url: app.url, lines: [`将离开聆聆，打开 iPhone 的「${app.name}」`, '只是打开，不会读取或操作其中的内容'] } }
}

/* ---------------- 自定义快捷指令 ---------------- */

export function planCustom(sc: RegisteredShortcut, text?: string): PlanResult {
  if (sc.purpose !== 'custom') return { ok: false, code: 'invalid', error: '不是自定义快捷指令' }
  let input: string | undefined
  if (text !== undefined && text !== '') {
    const r = cleanText(text, 500)
    if (!r.ok) return { ok: false, code: 'invalid', error: `输入${r.error}` }
    input = r.text
  }
  return { ok: true, plan: { kind: 'custom', shortcut: sc, title: `运行快捷指令「${sc.name}」`, input, lines: [...(sc.description ? [`用途：${sc.description}`] : []), input ? `传入：${input}` : '不传入内容'] } }
}

/* ---------------- 生成运行 ---------------- */

/** 把计划变成一次「等待确认」的运行；10 分钟内已经发起过同样内容的，除非 allowRepeat，否则拒绝 */
export async function prepareRun(plan: Plan, ctx: { source: ShortcutRun['source']; characterId?: string; conversationId?: string; allowRepeat?: boolean; base?: string }): Promise<{ ok: true; run: ShortcutRun } | { ok: false; error: string; duplicateOf?: string }> {
  const key = dedupeKey(plan.kind, plan.shortcut?.name ?? plan.url ?? '', plan.input ?? '')
  const dup = await recentDuplicate(key)
  if (dup && !ctx.allowRepeat) return { ok: false, duplicateOf: dup.id, error: `10 分钟内已经发起过同样的操作（${dup.title}），为避免重复创建没有再次执行` }
  const run = await createRun({ kind: plan.kind, shortcutName: plan.shortcut?.name, url: plan.url, title: plan.title, lines: plan.lines, input: plan.input, source: ctx.source, characterId: ctx.characterId, conversationId: ctx.conversationId, base: ctx.base })
  return { ok: true, run }
}
