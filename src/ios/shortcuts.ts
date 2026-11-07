/**
 * iOS 快捷指令桥接：白名单、链接构造、回跳解析。
 *  - 只能运行你在「连接真实 iPhone」中登记过的快捷指令（白名单），AI 和网页都不能自己添加
 *  - 参数只允许纯文本：去掉控制字符、限制长度，再经过 URL 编码；没有任何拼接进链接结构的地方
 *  - 使用 shortcuts://x-callback-url/run-shortcut：成功 / 取消 / 出错时快捷指令会回跳到聆聆，
 *    回跳带有本次运行的 ID 与校验码；没有回跳时只能显示「已发起」或「无法验证」，绝不显示成功
 */
import { db } from '../db/db'
import { uid } from '../lib/util'

export type ShortcutPurpose = 'test' | 'reminder' | 'calendar' | 'open_app' | 'custom'

export interface RegisteredShortcut {
  id: string
  /** 快捷指令 App 中的名称（必须完全一致） */
  name: string
  purpose: ShortcutPurpose
  /** 你写的说明（自定义快捷指令给 AI 看的用途） */
  description: string
  /** 是否允许 AI 在你确认后运行（自定义快捷指令默认不允许） */
  allowAI: boolean
  createdAt: number
}

export const SHORTCUTS_KEY = 'ios-shortcuts'
export const LIMITS = { name: 60, description: 120, input: 1500 }

/** 推荐的快捷指令名称（照着「连接真实 iPhone」中的步骤创建） */
export const RECOMMENDED: Record<Exclude<ShortcutPurpose, 'custom'>, string> = {
  test: '聆聆测试',
  reminder: '聆聆提醒事项',
  calendar: '聆聆日历',
  open_app: '聆聆打开应用',
}

/** 去掉控制字符（保留换行与制表符），限制长度；不合法时返回原因 */
export function cleanText(s: unknown, max: number): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof s !== 'string') return { ok: false, error: '内容必须是文字' }
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').trim()
  if (!t) return { ok: false, error: '内容为空' }
  if (t.length > max) return { ok: false, error: `内容太长（最多 ${max} 个字）` }
  return { ok: true, text: t }
}

export function validName(name: unknown): string | null {
  const r = cleanText(name, LIMITS.name)
  if (!r.ok) return `快捷指令名称${r.error}`
  if (/[\n\t]/.test(r.text)) return '快捷指令名称不能换行'
  return null
}

/* ---------------- 白名单 ---------------- */

export async function listShortcuts(): Promise<RegisteredShortcut[]> {
  const v = (await db.settings.get(SHORTCUTS_KEY))?.value as { shortcuts?: unknown } | undefined
  const list = Array.isArray(v?.shortcuts) ? v!.shortcuts : []
  const PURPOSES: ShortcutPurpose[] = ['test', 'reminder', 'calendar', 'open_app', 'custom']
  return list.flatMap((x) => {
    const s = x as Partial<RegisteredShortcut>
    if (typeof s?.id !== 'string' || validName(s.name) || !PURPOSES.includes(s.purpose as ShortcutPurpose)) return []
    return [{ id: s.id, name: s.name!.trim(), purpose: s.purpose!, description: typeof s.description === 'string' ? s.description.slice(0, LIMITS.description) : '', allowAI: s.allowAI === true, createdAt: Number(s.createdAt) || 0 }]
  })
}

async function writeShortcuts(list: RegisteredShortcut[]) {
  await db.settings.put({ key: SHORTCUTS_KEY, value: { version: 1, shortcuts: list } })
}

/** 只由设置页调用：登记一个快捷指令（同一用途的预设快捷指令只能有一个，自定义的名称不能重复） */
export async function registerShortcut(input: { name: string; purpose: ShortcutPurpose; description?: string; allowAI?: boolean }): Promise<RegisteredShortcut> {
  const bad = validName(input.name)
  if (bad) throw new Error(bad)
  const name = input.name.trim()
  const list = await listShortcuts()
  if (list.some((s) => s.name === name)) throw new Error('这个快捷指令已经登记过了')
  const rest = input.purpose === 'custom' ? list : list.filter((s) => s.purpose !== input.purpose)
  const item: RegisteredShortcut = { id: uid('sc'), name, purpose: input.purpose, description: (input.description ?? '').trim().slice(0, LIMITS.description), allowAI: input.purpose === 'custom' ? input.allowAI === true : true, createdAt: Date.now() }
  await writeShortcuts([...rest, item])
  return item
}

export async function updateShortcut(id: string, patch: Partial<Pick<RegisteredShortcut, 'description' | 'allowAI'>>): Promise<void> {
  const list = await listShortcuts()
  await writeShortcuts(list.map((s) => (s.id === id ? { ...s, ...('description' in patch ? { description: String(patch.description ?? '').slice(0, LIMITS.description) } : {}), ...('allowAI' in patch ? { allowAI: patch.allowAI === true } : {}) } : s)))
}

export async function removeShortcut(id: string): Promise<void> {
  await writeShortcuts((await listShortcuts()).filter((s) => s.id !== id))
}

export async function shortcutFor(purpose: Exclude<ShortcutPurpose, 'custom'>): Promise<RegisteredShortcut | undefined> {
  return (await listShortcuts()).find((s) => s.purpose === purpose)
}

/* ---------------- 链接 ---------------- */

/** 回跳地址：当前网页的地址（不含 #），加上状态、运行 ID 与校验码 */
export function callbackBase(loc: { origin: string; pathname: string } = location): string {
  return `${loc.origin}${loc.pathname}`
}

export function buildRunUrl(opts: { name: string; input?: string; runId: string; nonce: string; base: string }): string {
  const q = new URLSearchParams()
  q.set('name', opts.name)
  if (opts.input !== undefined) {
    q.set('input', 'text')
    q.set('text', opts.input)
  }
  const cb = (status: 'ok' | 'cancel' | 'error') => `${opts.base}?${new URLSearchParams({ lingling_cb: status, run: opts.runId, k: opts.nonce }).toString()}`
  q.set('x-success', cb('ok'))
  q.set('x-cancel', cb('cancel'))
  q.set('x-error', cb('error'))
  return `shortcuts://x-callback-url/run-shortcut?${q.toString()}`
}

export interface ParsedCallback {
  status: 'ok' | 'cancel' | 'error'
  runId: string
  nonce: string
  result?: string
  error?: string
}

/**
 * 解析回跳。快捷指令在回跳地址后追加 result / errorMessage 时，可能用「?」而不是「&」，
 * 所以先把第一个「?」之后的「?」都当作「&」。
 */
export function parseCallback(search: string): ParsedCallback | null {
  const raw = search.replace(/^\?/, '')
  if (!raw.includes('lingling_cb=')) return null
  const q = new URLSearchParams(raw.replace(/\?/g, '&'))
  const status = q.get('lingling_cb')
  const runId = q.get('run') ?? ''
  const nonce = q.get('k') ?? ''
  if ((status !== 'ok' && status !== 'cancel' && status !== 'error') || !/^[\w-]{1,80}$/.test(runId) || !/^[\w-]{8,80}$/.test(nonce)) return null
  const result = q.get('result') ?? undefined
  const error = q.get('errorMessage') ?? q.get('error') ?? undefined
  return { status, runId, nonce, result: result?.slice(0, 500), error: error?.slice(0, 300) }
}
