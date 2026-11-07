/**
 * 快捷指令运行记录与状态（存在 shortcutRuns 表）。
 *
 * 状态只按下面的方向变化，任何回跳都必须带正确的校验码，而且每次运行只处理一次：
 *   等待确认 → 已发起 / 已取消
 *   已发起 → 已确认完成（成功回跳）/ 执行失败（出错回跳）/ 已取消（取消回跳）/ 无法验证（超时没有回跳）
 *   无法验证 → 已确认完成 / 执行失败 / 已取消（迟到的回跳）/ 你确认已完成 / 已取消（你标记没成功）
 * 「你确认已完成」只是你自己的标记，和系统回报分开显示。
 */
import { db } from '../db/db'
import type { ShortcutRun, ShortcutRunStatus } from '../db/schema'
import { uid } from '../lib/util'
import { buildRunUrl, callbackBase, type ParsedCallback } from './shortcuts'

export const STATUS_LABEL: Record<ShortcutRunStatus, string> = {
  awaiting_confirmation: '等待确认',
  launched: '已发起',
  confirmed: '已确认完成',
  unverifiable: '无法验证',
  failed: '执行失败',
  cancelled: '已取消',
  user_reported: '你确认已完成',
}

/** 回到聆聆后多久还没有回跳，就算「无法验证」 */
export const VERIFY_WINDOW_MS = 10_000
/** 发起后多久还没有回跳（例如页面被关闭），重新打开时算「无法验证」 */
export const STALE_MS = 3 * 60_000
/** 同样内容的操作在这段时间内只执行一次 */
export const DEDUPE_MS = 10 * 60_000

const randomNonce = () => {
  const b = new Uint8Array(12)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export function dedupeKey(kind: ShortcutRun['kind'], shortcutName: string, input: string): string {
  return `${kind}|${shortcutName}|${input}`
}

/** 最近是否已经发起过同样的操作（已取消、失败的不算） */
export async function recentDuplicate(key: string, now = Date.now()): Promise<ShortcutRun | undefined> {
  const list = await db.shortcutRuns.where('dedupeKey').equals(key).toArray()
  return list.find((r) => now - r.createdAt < DEDUPE_MS && ['launched', 'confirmed', 'unverifiable', 'user_reported'].includes(r.status))
}

export async function createRun(o: { kind: ShortcutRun['kind']; shortcutName?: string; title: string; lines: string[]; input?: string; url?: string; source: ShortcutRun['source']; characterId?: string; conversationId?: string; base?: string }): Promise<ShortcutRun> {
  const id = uid('run')
  const nonce = randomNonce()
  const now = Date.now()
  const url = o.url ?? buildRunUrl({ name: o.shortcutName!, input: o.input, runId: id, nonce, base: o.base ?? callbackBase() })
  const run: ShortcutRun = {
    id, nonce, kind: o.kind, shortcutName: o.shortcutName, title: o.title, lines: o.lines, input: o.input, url,
    status: 'awaiting_confirmation', source: o.source, characterId: o.characterId, conversationId: o.conversationId,
    dedupeKey: dedupeKey(o.kind, o.shortcutName ?? o.url ?? '', o.input ?? ''), createdAt: now, updatedAt: now,
  }
  await db.shortcutRuns.add(run)
  return run
}

async function transition(id: string, from: ShortcutRunStatus[], patch: Partial<ShortcutRun>): Promise<ShortcutRun | null> {
  return db.transaction('rw', db.shortcutRuns, async () => {
    const r = await db.shortcutRuns.get(id)
    if (!r || !from.includes(r.status)) return null
    const next = { ...r, ...patch, updatedAt: Date.now() }
    await db.shortcutRuns.put(next)
    return next
  })
}

/** 浏览器自动测试无法打开 shortcuts://，测试脚本可以在页面里放一个记录函数代替真正打开（真实使用时不存在） */
const defaultOpener = (url: string) => {
  const hook = (globalThis as { __LINGLING_TEST_OPEN__?: (u: string) => void }).__LINGLING_TEST_OPEN__
  if (typeof hook === 'function') return hook(url)
  window.location.href = url
}
let opener: (url: string) => void = defaultOpener
/** 仅供测试：替换打开链接的方式 */
export function setOpenerForTesting(f: ((url: string) => void) | null) {
  opener = f ?? defaultOpener
}

const LAUNCH_MARK = 'll-run-launched:'
const store = () => (typeof localStorage === 'undefined' ? null : localStorage)

/**
 * 发起：**必须在点按事件里同步调用**（iOS 只允许用户操作直接打开其他 App）。
 * 先同步打开链接、同步写下标记，再异步更新数据库（页面可能马上被挂起，回来后再补写）。
 */
export function launchRun(run: Pick<ShortcutRun, 'id' | 'url' | 'status'>): Promise<ShortcutRun | null> {
  if (run.status !== 'awaiting_confirmation') return Promise.resolve(null)
  try {
    store()?.setItem(LAUNCH_MARK + run.id, String(Date.now()))
  } catch {
    /* 无痕模式等：忽略 */
  }
  opener(run.url)
  return markLaunched(run.id)
}

export async function markLaunched(id: string, at = Date.now()): Promise<ShortcutRun | null> {
  const r = await transition(id, ['awaiting_confirmation'], { status: 'launched', launchedAt: at })
  try {
    store()?.removeItem(LAUNCH_MARK + id)
  } catch {
    /* ignore */
  }
  return r
}

/** 在发起前取消（拒绝执行） */
export async function cancelRun(id: string): Promise<ShortcutRun | null> {
  return transition(id, ['awaiting_confirmation'], { status: 'cancelled', finishedAt: Date.now() })
}

/** 处理回跳：校验码不对、运行不存在、已经处理过的都忽略 */
export async function applyCallback(cb: ParsedCallback): Promise<{ ok: boolean; run?: ShortcutRun; reason?: string; code?: 'not_found' | 'bad_nonce' | 'already_done' }> {
  const r = await db.shortcutRuns.get(cb.runId)
  if (!r) return { ok: false, code: 'not_found', reason: '找不到这次运行（可能是在另一个浏览器或主屏幕 App 中发起的）' }
  if (r.nonce !== cb.nonce) return { ok: false, code: 'bad_nonce', reason: '回跳校验失败，已忽略' }
  const from: ShortcutRunStatus[] = ['launched', 'unverifiable', 'awaiting_confirmation']
  const status: ShortcutRunStatus = cb.status === 'ok' ? 'confirmed' : cb.status === 'cancel' ? 'cancelled' : 'failed'
  const next = await transition(r.id, from, { status, result: cb.result, error: cb.status === 'error' ? cb.error || '快捷指令运行出错' : undefined, finishedAt: Date.now(), launchedAt: r.launchedAt ?? Date.now() })
  if (!next) return { ok: false, code: 'already_done', run: r, reason: '这次运行已经有结果了，回跳只处理一次' }
  return { ok: true, run: next }
}

/** 没有回跳：标记为「无法验证」（不是失败，也不是成功） */
export async function markUnverifiable(id: string, why: string): Promise<ShortcutRun | null> {
  return transition(id, ['launched'], { status: 'unverifiable', error: why })
}

/** 你在 iPhone 上看到了结果 / 确认没有成功 */
export async function userReport(id: string, done: boolean): Promise<ShortcutRun | null> {
  return transition(id, ['unverifiable', 'launched'], done ? { status: 'user_reported', finishedAt: Date.now() } : { status: 'cancelled', error: '你确认没有完成', finishedAt: Date.now() })
}

/**
 * 打开聆聆时整理：补写被挂起前没写完的「已发起」；发起很久还没有回跳的标记为「无法验证」；
 * 很久之前还停在「等待确认」的（页面关掉了）标记为已取消。
 */
export async function sweepRuns(now = Date.now()): Promise<void> {
  const s = store()
  if (s) {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i)
      if (k?.startsWith(LAUNCH_MARK)) await markLaunched(k.slice(LAUNCH_MARK.length), Number(s.getItem(k)) || now)
    }
  }
  const open = await db.shortcutRuns.where('status').anyOf(['launched', 'awaiting_confirmation']).toArray()
  for (const r of open) {
    if (r.status === 'launched' && now - (r.launchedAt ?? r.createdAt) > STALE_MS) await markUnverifiable(r.id, '没有收到快捷指令的回跳')
    if (r.status === 'awaiting_confirmation' && now - r.createdAt > 30 * 60_000 && r.source === 'settings') await cancelRun(r.id)
  }
}

/**
 * 发起后回到聆聆（页面重新可见）：等待一小段时间，仍然没有回跳就标记为「无法验证」。
 * 页面一直没有离开（例如你在「是否打开快捷指令」时点了取消）也算无法验证，并说明原因。
 */
export function watchAfterLaunch(id: string, opts: { doc?: Document; windowMs?: number } = {}): () => void {
  const doc = opts.doc ?? document
  const windowMs = opts.windowMs ?? VERIFY_WINDOW_MS
  let left = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (why: string) => {
    clearTimeout(timer)
    timer = setTimeout(() => void markUnverifiable(id, why), windowMs)
  }
  const onVis = () => {
    if (doc.visibilityState === 'hidden') {
      left = true
      clearTimeout(timer)
    } else if (left) arm('回到聆聆后没有收到快捷指令的回跳')
  }
  doc.addEventListener('visibilitychange', onVis)
  // 一直没有离开页面：可能没有打开快捷指令
  timer = setTimeout(() => {
    if (!left) void markUnverifiable(id, '页面没有切换到快捷指令，可能没有打开（例如点了「取消」）')
  }, windowMs * 2)
  return () => {
    clearTimeout(timer)
    doc.removeEventListener('visibilitychange', onVis)
  }
}

export async function listRuns(opts: { conversationId?: string; limit?: number } = {}): Promise<ShortcutRun[]> {
  const all = await db.shortcutRuns.orderBy('createdAt').reverse().toArray()
  return all.filter((r) => !opts.conversationId || r.conversationId === opts.conversationId).slice(0, opts.limit ?? 100)
}

export async function clearRuns(): Promise<void> {
  await db.shortcutRuns.where('status').noneOf(['awaiting_confirmation', 'launched']).delete()
}
