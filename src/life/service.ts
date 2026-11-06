/**
 * 【第六阶段起不再被 AI 使用】AI 工具改为 src/tools/lifeTools.ts，并按角色授权（src/tools/permissions.ts）。
 * 这里保留第五阶段的接口与旧设置，不删除任何数据。
 *
 * 生活应用统一数据服务层（为第六阶段「AI 工具调用」预留，本阶段没有任何 AI 调用这里的函数）。
 *
 * 设计
 *  - 每个工具都要先通过用户的授权设置（settings 'life-access'），**默认全部关闭**
 *  - 只读工具只返回必要字段：日记只返回逐篇勾选了「允许 AI 读取」的；相册只返回元数据，不含图片
 *  - 写入类工具只能创建「草稿」，放在待确认列表里（settings 'life-drafts'），用户点确认后才变成真的便签 / 日程
 *  - 最近删除的内容永远不会返回
 *  - 所有结果都是 { ok, data | reason }，未授权时返回原因，不抛异常
 */
import { db } from '../db/db'
import type { CalEvent, Note } from '../db/schema'
import { uid } from '../lib/util'
import { listPhotoMeta } from './albumAccess'
import { listReadableDiaries } from './diaryAccess'
import { addDays, occurrences, validateEvent } from './calendar'
import { isDateString, localDate } from './diary'
import { isBlankNote, visibleNotes } from './notes'
import { saveNote } from '../db/noteRepo'
import { saveEvent, type EventInput } from '../db/eventRepo'

export interface LifeAccessPolicy {
  version: 1
  /** 读取勾选了「允许 AI 读取」的日记 */
  diary: boolean
  notes: boolean
  calendar: boolean
  /** 只读取相册的元数据（名称、备注、日期），不含图片 */
  album: boolean
  /** 创建便签草稿（需要用户确认） */
  noteDrafts: boolean
  /** 创建日程草稿（需要用户确认） */
  eventDrafts: boolean
}

export const DEFAULT_POLICY: LifeAccessPolicy = { version: 1, diary: false, notes: false, calendar: false, album: false, noteDrafts: false, eventDrafts: false }
export const POLICY_KEY = 'life-access'
export const DRAFTS_KEY = 'life-drafts'

export async function getPolicy(): Promise<LifeAccessPolicy> {
  const v = (await db.settings.get(POLICY_KEY))?.value as Partial<LifeAccessPolicy> | undefined
  // 只认明确为 true 的开关；数据损坏时一律当作关闭
  const out = { ...DEFAULT_POLICY }
  for (const k of ['diary', 'notes', 'calendar', 'album', 'noteDrafts', 'eventDrafts'] as const) out[k] = v?.[k] === true
  return out
}

export async function setPolicy(patch: Partial<Omit<LifeAccessPolicy, 'version'>>): Promise<LifeAccessPolicy> {
  const next = { ...(await getPolicy()), ...patch, version: 1 as const }
  await db.settings.put({ key: POLICY_KEY, value: next })
  return next
}

export type LifeResult<T> = { ok: true; data: T } | { ok: false; reason: string }

export interface LifeDraft {
  id: string
  type: 'note' | 'event'
  /** 谁提出的（例如角色名），只用于显示 */
  proposedBy: string
  createdAt: number
  status: 'pending' | 'confirmed' | 'rejected'
  note?: Pick<Note, 'title' | 'kind' | 'text' | 'items'>
  event?: EventInput
  /** 确认后生成的真实便签 / 日程 ID */
  resultId?: string
}

export interface LifeToolSpec {
  name: string
  description: string
  /** 需要打开的授权开关 */
  permission: keyof Omit<LifeAccessPolicy, 'version'>
  /** JSON Schema，供第六阶段直接作为工具定义使用 */
  parameters: Record<string, unknown>
}

export const LIFE_TOOLS: LifeToolSpec[] = [
  { name: 'query_diaries', description: '查询用户允许 AI 读取的日记（只包含逐篇授权的日记）', permission: 'diary', parameters: { type: 'object', properties: { query: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, limit: { type: 'integer', maximum: 50 } } } },
  { name: 'query_notes', description: '查询用户的便签', permission: 'notes', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', maximum: 50 } } } },
  { name: 'query_calendar', description: '查询一段日期内的日程（含重复事件与纪念日）', permission: 'calendar', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } },
  { name: 'query_album', description: '查询相册照片的元数据（名称、备注、日期），不含图片内容', permission: 'album', parameters: { type: 'object', properties: { query: { type: 'string' }, albumId: { type: 'string' }, limit: { type: 'integer', maximum: 200 } } } },
  { name: 'create_note_draft', description: '创建一张便签草稿，用户确认后才会保存', permission: 'noteDrafts', parameters: { type: 'object', required: ['text'], properties: { title: { type: 'string' }, text: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } } },
  { name: 'create_event_draft', description: '创建一个日程草稿，用户确认后才会保存', permission: 'eventDrafts', parameters: { type: 'object', required: ['title', 'date'], properties: { title: { type: 'string' }, date: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' }, location: { type: 'string' }, note: { type: 'string' } } } },
]

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const int = (v: unknown, def: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, max) : def)

async function readDrafts(): Promise<LifeDraft[]> {
  const v = (await db.settings.get(DRAFTS_KEY))?.value
  return Array.isArray(v) ? (v as LifeDraft[]) : []
}
async function writeDrafts(list: LifeDraft[]) {
  await db.settings.put({ key: DRAFTS_KEY, value: list.slice(-100) })
}

export async function listDrafts(status: LifeDraft['status'] = 'pending'): Promise<LifeDraft[]> {
  return (await readDrafts()).filter((d) => d.status === status)
}

/** 运行一个工具。未知工具、未授权、参数不合法时返回 { ok: false, reason } */
export async function runLifeTool(name: string, args: Record<string, unknown> = {}, ctx: { proposedBy?: string } = {}): Promise<LifeResult<unknown>> {
  const spec = LIFE_TOOLS.find((t) => t.name === name)
  if (!spec) return { ok: false, reason: `没有这个工具：${name}` }
  const policy = await getPolicy()
  if (!policy[spec.permission]) return { ok: false, reason: '用户没有授权这项访问' }
  switch (name) {
    case 'query_diaries':
      return { ok: true, data: await listReadableDiaries({ query: str(args.query, 100), date: isDateString(args.date) ? args.date : undefined, limit: int(args.limit, 20, 50) }) }
    case 'query_notes':
      return {
        ok: true,
        data: visibleNotes(await db.notes.toArray(), str(args.query, 100))
          .slice(0, int(args.limit, 20, 50))
          .map((n) => ({ id: n.id, title: n.title, kind: n.kind, text: n.kind === 'text' ? n.text : undefined, items: n.kind === 'checklist' ? n.items.map((i) => ({ text: i.text, done: i.done })) : undefined, pinned: n.pinned, updatedAt: new Date(n.updatedAt).toISOString() })),
      }
    case 'query_calendar': {
      const from = isDateString(args.from) ? args.from : localDate()
      const to = isDateString(args.to) && args.to >= from ? args.to : addDays(from, 30)
      if (addDays(from, 366) < to) return { ok: false, reason: '一次最多查询一年' }
      const events = (await db.events.toArray()) as CalEvent[]
      const chars = new Map((await db.characters.toArray()).map((c) => [c.id, c.name]))
      return { ok: true, data: occurrences(events, from, to).map((o) => ({ id: o.event.id, date: o.date, title: o.event.title, kind: o.event.kind, allDay: o.event.allDay, startTime: o.event.startTime, endTime: o.event.endTime, location: o.event.location, character: o.event.characterId ? chars.get(o.event.characterId) ?? null : undefined })) }
    }
    case 'query_album':
      return { ok: true, data: await listPhotoMeta({ query: str(args.query, 100), albumId: str(args.albumId, 60) || undefined, limit: int(args.limit, 50, 200) }) }
    case 'create_note_draft': {
      const items = Array.isArray(args.items) ? args.items.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 50) : []
      const note = { title: str(args.title, 40), kind: items.length ? ('checklist' as const) : ('text' as const), text: str(args.text, 5000), items: items.map((t) => ({ id: uid('it'), text: t.slice(0, 120), done: false })) }
      if (isBlankNote(note)) return { ok: false, reason: '便签内容为空' }
      const d: LifeDraft = { id: uid('draft'), type: 'note', proposedBy: ctx.proposedBy ?? 'AI', createdAt: Date.now(), status: 'pending', note }
      await writeDrafts([...(await readDrafts()), d])
      return { ok: true, data: { draftId: d.id, status: 'pending', message: '已创建草稿，等待用户确认' } }
    }
    case 'create_event_draft': {
      const event: EventInput = { title: str(args.title, 60), kind: 'event', allDay: !args.startTime, date: str(args.date, 10), startTime: str(args.startTime, 5) || undefined, endTime: str(args.endTime, 5) || undefined, location: str(args.location, 80), note: str(args.note, 1000), repeat: 'none', diaryIds: [] }
      const bad = validateEvent(event)
      if (bad) return { ok: false, reason: bad }
      const d: LifeDraft = { id: uid('draft'), type: 'event', proposedBy: ctx.proposedBy ?? 'AI', createdAt: Date.now(), status: 'pending', event }
      await writeDrafts([...(await readDrafts()), d])
      return { ok: true, data: { draftId: d.id, status: 'pending', message: '已创建草稿，等待用户确认' } }
    }
  }
  return { ok: false, reason: '工具没有实现' }
}

/** 用户确认草稿：这时才真正创建便签 / 日程 */
export async function confirmDraft(id: string): Promise<string> {
  const list = await readDrafts()
  const d = list.find((x) => x.id === id && x.status === 'pending')
  if (!d) throw new Error('草稿不存在或已处理')
  const resultId = d.type === 'note' ? await saveNote(null, d.note!) : await saveEvent(null, d.event!)
  if (!resultId) throw new Error('草稿内容为空，没有保存')
  await writeDrafts(list.map((x) => (x.id === id ? { ...x, status: 'confirmed', resultId } : x)))
  return resultId
}

export async function rejectDraft(id: string): Promise<void> {
  const list = await readDrafts()
  await writeDrafts(list.map((x) => (x.id === id && x.status === 'pending' ? { ...x, status: 'rejected' } : x)))
}
