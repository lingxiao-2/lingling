/**
 * 秒表与倒计时。全部按时间点计算（不是每秒累加），所以切换页面、刷新、锁屏回来后时间都是准的。
 * 提醒的真实能力：
 *  - 前台：聆聆在屏幕上时，结束时在页面中提醒（声音与震动视浏览器支持）
 *  - 后台：Safari 在锁屏或切到其他 App 时会暂停网页，**不会响铃**；回来后显示「在你离开期间结束」
 *  - 真实系统提醒：通过快捷指令在 iPhone「提醒事项」中创建一条（需要在「连接真实 iPhone」中设置）
 */
import { db } from '../db/db'
import type { ClockTimer } from '../db/schema'
import { uid } from '../lib/util'

export const TIMER_LIMITS = { name: 30, maxMs: 24 * 3600_000 }

/* ---------- 秒表 ---------- */
export interface Stopwatch { startedAt: number | null; accumulated: number; laps: number[] }
export const STOPWATCH_KEY = 'clock-stopwatch'
export const EMPTY_STOPWATCH: Stopwatch = { startedAt: null, accumulated: 0, laps: [] }

export const elapsed = (s: Stopwatch, now = Date.now()) => s.accumulated + (s.startedAt ? now - s.startedAt : 0)
export const startSw = (s: Stopwatch, now = Date.now()): Stopwatch => (s.startedAt ? s : { ...s, startedAt: now })
export const pauseSw = (s: Stopwatch, now = Date.now()): Stopwatch => (s.startedAt ? { ...s, startedAt: null, accumulated: elapsed(s, now) } : s)
/** 计次：记录当前累计时间 */
export const lapSw = (s: Stopwatch, now = Date.now()): Stopwatch => ({ ...s, laps: [...s.laps, elapsed(s, now)].slice(-99) })

export async function loadStopwatch(): Promise<Stopwatch> {
  const v = (await db.settings.get(STOPWATCH_KEY))?.value as Partial<Stopwatch> | undefined
  return { startedAt: typeof v?.startedAt === 'number' ? v.startedAt : null, accumulated: Number(v?.accumulated) || 0, laps: Array.isArray(v?.laps) ? v!.laps.filter((x) => typeof x === 'number') : [] }
}
export async function saveStopwatch(s: Stopwatch) {
  await db.settings.put({ key: STOPWATCH_KEY, value: s })
}

/** 00:00.00 / 1:02:03.45 */
export function formatMs(ms: number, cs = true): string {
  const t = Math.max(0, Math.floor(ms))
  const h = Math.floor(t / 3600_000)
  const m = Math.floor((t % 3600_000) / 60_000)
  const s = Math.floor((t % 60_000) / 1000)
  const c = Math.floor((t % 1000) / 10)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${h ? `${h}:` : ''}${p(m)}:${p(s)}${cs ? `.${p(c)}` : ''}`
}

/* ---------- 倒计时 ---------- */
export async function createTimer(name: string, durationMs: number, now = Date.now()): Promise<ClockTimer> {
  if (!Number.isFinite(durationMs) || durationMs < 1000) throw new Error('时间至少 1 秒')
  if (durationMs > TIMER_LIMITS.maxMs) throw new Error('最长 24 小时')
  const t: ClockTimer = { id: uid('tmr'), name: name.trim().slice(0, TIMER_LIMITS.name) || '计时', durationMs, status: 'running', endAt: now + durationMs, remainingMs: durationMs, createdAt: now }
  await db.timers.add(t)
  return t
}

export const remaining = (t: ClockTimer, now = Date.now()) => (t.status === 'running' && t.endAt ? Math.max(0, t.endAt - now) : t.status === 'paused' ? t.remainingMs : 0)

export async function pauseTimer(id: string, now = Date.now()) {
  const t = await db.timers.get(id)
  if (t?.status === 'running') await db.timers.update(id, { status: 'paused', remainingMs: remaining(t, now), endAt: undefined })
}
export async function resumeTimer(id: string, now = Date.now()) {
  const t = await db.timers.get(id)
  if (t?.status === 'paused') await db.timers.update(id, { status: 'running', endAt: now + t.remainingMs })
}
export async function cancelTimer(id: string, now = Date.now()) {
  const t = await db.timers.get(id)
  if (t && (t.status === 'running' || t.status === 'paused')) await db.timers.update(id, { status: 'cancelled', remainingMs: remaining(t, now), endAt: undefined, finishedAt: now })
}
export async function renameTimer(id: string, name: string) {
  await db.timers.update(id, { name: name.trim().slice(0, TIMER_LIMITS.name) || '计时' })
}
export async function attachShortcutRun(id: string, runId: string) {
  await db.timers.update(id, { shortcutRunId: runId })
}

/**
 * 检查已经到点的计时：标记为结束。foreground 表示页面正在前台（可以提醒）；
 * 不在前台时到点的，记为「在你离开期间结束」，不假装响过铃。返回本次新结束的计时。
 */
export async function settleTimers(now = Date.now(), foreground = true): Promise<ClockTimer[]> {
  return db.transaction('rw', db.timers, async () => {
    const due = (await db.timers.where('status').equals('running').toArray()).filter((t) => (t.endAt ?? 0) <= now)
    for (const t of due) {
      const late = now - (t.endAt ?? now) > 5000
      await db.timers.update(t.id, { status: 'done', remainingMs: 0, finishedAt: t.endAt, alerted: foreground && !late })
    }
    return due.map((t) => ({ ...t, status: 'done' as const, alerted: foreground && now - (t.endAt ?? now) <= 5000 }))
  })
}

export async function clearHistory() {
  await db.timers.where('status').anyOf(['done', 'cancelled']).delete()
}

/** 「5 分钟」「1 小时 30 分钟」 */
export function durationLabel(ms: number): string {
  const t = Math.round(ms / 1000)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return [h && `${h} 小时`, m && `${m} 分钟`, s && `${s} 秒`].filter(Boolean).join(' ') || '0 秒'
}
