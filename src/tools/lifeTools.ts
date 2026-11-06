/**
 * 生活应用工具：日历、便签、日记（只读）、相册。只调用本应用的数据函数，不拼接查询、不访问网络
 * （唯一例外：用户逐次确认后，把一张照片交给已配置的识图模型）。
 *
 *  - 读取只返回必要字段；最近删除的内容永远不返回
 *  - 写入 / 删除都需要用户在聊天中逐次确认（confirm: true），确认卡片显示草稿预览
 *  - 删除只移到「最近删除」，可以恢复；从不彻底删除
 *  - 日程只保存在聆聆里，结果中明确 syncedToSystemCalendar: false
 *  - 日记只读，只包括逐篇勾选了「允许 AI 读取」的日记；搜索只返回匹配处附近的片段
 *  - 相册默认只有元数据；读取图片要「图片读取」权限 + 逐次确认 + 已配置识图模型，否则如实说明看不到
 */
import { db } from '../db/db'
import type { CalEvent, Note } from '../db/schema'
import { saveEvent, trashEvent, EventError, type EventInput } from '../db/eventRepo'
import { saveNote, trashNote } from '../db/noteRepo'
import { addDays, occurrences, REPEAT_LABEL, validateEvent } from '../life/calendar'
import { filterDiaries, localDate, moodOf } from '../life/diary'
import { isBlankNote, visibleNotes } from '../life/notes'
import { uid } from '../lib/util'
import { listAlbumsMeta, listPhotoMeta } from '../life/albumAccess'
import { fail } from './executor'
import type { ToolDefinition, ToolRegistry, ToolResult } from './registry'

const S = (maxLength: number, description?: string) => ({ type: 'string' as const, maxLength, ...(description ? { description } : {}) })
const DATE = (description: string) => ({ type: 'string' as const, maxLength: 10, format: 'date' as const, description })
const TIME = (description: string) => ({ type: 'string' as const, maxLength: 5, format: 'time' as const, description })
const ID = { type: 'string' as const, maxLength: 64, minLength: 1, description: '先通过列表或搜索得到的 ID' }
const LIMIT = (max: number) => ({ type: 'integer' as const, minimum: 1, maximum: max, description: `最多返回几条（默认 ${Math.min(10, max)}）` })
const ok = (data: unknown, summary: string): ToolResult => ({ ok: true, data, summary })
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const iso = (ts: number) => new Date(ts).toISOString().slice(0, 16)

/* ---------------- 日历 ---------------- */

async function liveEvent(id: unknown): Promise<CalEvent | null> {
  const e = await db.events.get(String(id))
  return e && !e.deletedAt ? e : null
}
const eventLine = (e: Pick<CalEvent, 'title' | 'date' | 'allDay' | 'startTime' | 'endTime' | 'location'>) =>
  `${e.title}（${e.date}${e.allDay ? ' 全天' : ` ${e.startTime ?? ''}${e.endTime ? `–${e.endTime}` : ''}`}${e.location ? ` · ${e.location}` : ''}）`
const NOT_SYNCED = { syncedToSystemCalendar: false, savedIn: '只保存在聆聆的日历里，没有同步到 iPhone 系统日历' }

const calendarTools: ToolDefinition[] = [
  {
    name: 'calendar.list_events',
    label: '查看你的日程',
    description: '查询一段日期内（含首尾，最多 62 天）的日程、纪念日和生日，包含重复事件。不传日期时查询今天起 7 天。',
    parameters: { type: 'object', properties: { from: DATE('开始日期 YYYY-MM-DD'), to: DATE('结束日期 YYYY-MM-DD') } },
    permission: 'calendar_read',
    confirm: false,
    describe: (a) => [`${a.from ?? localDate()} 至 ${a.to ?? addDays(String(a.from ?? localDate()), 7)} 的日程`],
    execute: async (a) => {
      const from = (a.from as string) ?? localDate()
      const to = (a.to as string) ?? addDays(from, 7)
      if (to < from) return fail('invalid', '结束日期早于开始日期')
      if (addDays(from, 62) < to) return fail('invalid', '一次最多查询 62 天')
      const occ = occurrences(await db.events.toArray(), from, to).slice(0, 60)
      return ok(
        { from, to, events: occ.map((o) => ({ id: o.event.id, date: o.date, title: o.event.title, kind: o.event.kind, allDay: o.event.allDay, startTime: o.event.startTime, endTime: o.event.endTime, location: o.event.location || undefined, repeat: o.event.repeat === 'none' ? undefined : o.event.repeat })) },
        `${from}～${to} 共 ${occ.length} 个`,
      )
    },
  },
  {
    name: 'calendar.get_event',
    label: '查看一个日程的详情',
    description: '按 ID 查看一个日程的完整信息（含备注）。',
    parameters: { type: 'object', properties: { id: ID }, required: ['id'] },
    permission: 'calendar_read',
    confirm: false,
    describe: () => ['一个日程的详情'],
    execute: async (a) => {
      const e = await liveEvent(a.id)
      if (!e) return fail('not_found', '没有找到这个日程（可能已删除）')
      return ok({ id: e.id, title: e.title, kind: e.kind, date: e.date, allDay: e.allDay, startTime: e.startTime, endTime: e.endTime, location: e.location, note: clip(e.note, 1000), repeat: REPEAT_LABEL[e.repeat], ...NOT_SYNCED }, `日程 ${e.id}`)
    },
  },
  {
    name: 'calendar.create_draft',
    label: '创建日程',
    description: '为用户创建一个日程草稿。用户在聊天中看到预览并确认后才会保存；用户取消则不保存。只保存在聆聆的日历里，不会同步到 iPhone 系统日历。',
    parameters: {
      type: 'object',
      properties: { title: { ...S(60, '标题'), minLength: 1 }, date: DATE('日期 YYYY-MM-DD'), startTime: TIME('开始时间 HH:MM，不传表示全天'), endTime: TIME('结束时间 HH:MM'), location: S(80, '地点'), note: S(500, '备注') },
      required: ['title', 'date'],
    },
    permission: 'calendar_write',
    confirm: true,
    preview: async (a, ctx) => {
      const input = eventInput(a)
      const bad = validateEvent(input)
      if (bad) return { error: bad }
      return { title: `${ctx.characterName}想帮你创建一个日程`, lines: [eventLine(input), ...(input.note ? [`备注：${input.note}`] : []), '只保存在聆聆的日历里，不会同步到 iPhone 系统日历'] }
    },
    execute: async (a) => {
      try {
        const id = await saveEvent(null, eventInput(a))
        if (!(await db.events.get(id))) return fail('execution_failed', '保存失败，日程没有写入')
        return ok({ id, saved: true, ...NOT_SYNCED }, `已创建日程 ${id}`)
      } catch (e) {
        return fail(e instanceof EventError ? 'invalid' : 'execution_failed', e instanceof Error ? e.message : String(e))
      }
    },
  },
  {
    name: 'calendar.update_event',
    label: '修改日程',
    description: '修改一个已有日程（只传需要修改的字段）。需要用户确认后才会生效。重复日程会整体修改。',
    parameters: {
      type: 'object',
      properties: { id: ID, title: { ...S(60, '新标题'), minLength: 1 }, date: DATE('新日期'), startTime: TIME('新开始时间'), endTime: TIME('新结束时间'), allDay: { type: 'boolean', description: '改为全天' }, location: S(80, '新地点'), note: S(500, '新备注') },
      required: ['id'],
    },
    permission: 'calendar_write',
    confirm: true,
    preview: async (a, ctx) => {
      const e = await liveEvent(a.id)
      if (!e) return { error: '没有找到这个日程（可能已删除）' }
      const next = patched(e, a)
      const bad = validateEvent(next)
      if (bad) return { error: bad }
      return { title: `${ctx.characterName}想修改日程「${e.title}」`, lines: [`原来：${eventLine(e)}`, `改为：${eventLine(next)}`, ...(a.note !== undefined ? [`备注改为：${a.note || '（空）'}`] : []), ...(e.repeat !== 'none' ? ['这是重复日程，会整体修改'] : [])] }
    },
    execute: async (a) => {
      const e = await liveEvent(a.id)
      if (!e) return fail('not_found', '没有找到这个日程（可能已删除）')
      try {
        await saveEvent(e.id, patched(e, a))
        return ok({ id: e.id, updated: true, ...NOT_SYNCED }, `已修改日程 ${e.id}`)
      } catch (err) {
        return fail(err instanceof EventError ? 'invalid' : 'execution_failed', err instanceof Error ? err.message : String(err))
      }
    },
  },
  {
    name: 'calendar.delete_event',
    label: '删除日程',
    description: '删除一个日程（移到「最近删除」，可以恢复）。需要用户确认。',
    parameters: { type: 'object', properties: { id: ID }, required: ['id'] },
    permission: 'calendar_write',
    confirm: true,
    preview: async (a, ctx) => {
      const e = await liveEvent(a.id)
      if (!e) return { error: '没有找到这个日程（可能已删除）' }
      return { title: `${ctx.characterName}想删除日程「${e.title}」`, lines: [eventLine(e), '会移到日历的「最近删除」，可以恢复'], danger: true }
    },
    execute: async (a) => {
      const e = await liveEvent(a.id)
      if (!e) return fail('not_found', '没有找到这个日程（可能已删除）')
      await trashEvent(e.id)
      if (!(await db.events.get(e.id))?.deletedAt) return fail('execution_failed', '删除没有成功')
      return ok({ id: e.id, deleted: true, recoverable: true }, `已删除日程 ${e.id}（可恢复）`)
    },
  },
]

function eventInput(a: Record<string, unknown>): EventInput {
  const start = a.startTime as string | undefined
  return { title: String(a.title ?? '').trim(), kind: 'event', allDay: !start, date: String(a.date ?? ''), startTime: start, endTime: start ? (a.endTime as string | undefined) : undefined, location: String(a.location ?? ''), note: String(a.note ?? ''), repeat: 'none', diaryIds: [] }
}

function patched(e: CalEvent, a: Record<string, unknown>): EventInput {
  const allDay = a.allDay === true ? true : a.startTime ? false : e.allDay
  return {
    title: (a.title as string | undefined)?.trim() ?? e.title,
    kind: e.kind,
    allDay,
    date: (a.date as string | undefined) ?? e.date,
    startTime: allDay ? undefined : (a.startTime as string | undefined) ?? e.startTime,
    endTime: allDay ? undefined : (a.endTime as string | undefined) ?? e.endTime,
    location: (a.location as string | undefined) ?? e.location,
    note: (a.note as string | undefined) ?? e.note,
    repeat: e.repeat,
    characterId: e.characterId,
    anniversaryType: e.anniversaryType,
    diaryIds: e.diaryIds,
  }
}

/* ---------------- 便签 ---------------- */

async function liveNote(id: unknown): Promise<Note | null> {
  const n = await db.notes.get(String(id))
  return n && !n.deletedAt ? n : null
}
const noteBrief = (n: Note) => ({ id: n.id, title: n.title || undefined, kind: n.kind, preview: clip(n.kind === 'text' ? n.text.replace(/\s+/g, ' ') : n.items.map((i) => `${i.done ? '☑' : '☐'}${i.text}`).join(' '), 80), pinned: n.pinned || undefined, updatedAt: iso(n.updatedAt) })
const noteLines = (n: Pick<Note, 'title' | 'kind' | 'text' | 'items'>) => [
  ...(n.title ? [`标题：${n.title}`] : []),
  ...(n.kind === 'text' ? [clip(n.text, 300)] : n.items.slice(0, 12).map((i) => `${i.done ? '☑' : '☐'} ${i.text}`)),
]
const ITEMS = { type: 'array' as const, maxItems: 50, items: S(120), description: '清单项（传了就是清单便签）' }

function draftNote(a: Record<string, unknown>): Pick<Note, 'title' | 'kind' | 'text' | 'items'> {
  const items = ((a.items as string[] | undefined) ?? []).map((t) => t.trim()).filter(Boolean)
  return { title: String(a.title ?? '').trim(), kind: items.length ? 'checklist' : 'text', text: String(a.text ?? ''), items: items.map((t) => ({ id: uid('it'), text: t, done: false })) }
}

const noteTools: ToolDefinition[] = [
  {
    name: 'notes.list',
    label: '查看你的便签',
    description: '列出最近的便签（置顶在前），只返回标题和开头的预览。',
    parameters: { type: 'object', properties: { limit: LIMIT(30) } },
    permission: 'notes_read',
    confirm: false,
    describe: () => ['最近的便签（标题和预览）'],
    execute: async (a) => {
      const list = visibleNotes(await db.notes.toArray()).slice(0, (a.limit as number) ?? 10)
      return ok({ notes: list.map(noteBrief) }, `${list.length} 张便签`)
    },
  },
  {
    name: 'notes.search',
    label: '搜索你的便签',
    description: '按关键词搜索便签（标题、正文、清单项）。',
    parameters: { type: 'object', properties: { query: { ...S(50, '关键词'), minLength: 1 }, limit: LIMIT(20) }, required: ['query'] },
    permission: 'notes_read',
    confirm: false,
    describe: (a) => [`搜索「${a.query}」`],
    execute: async (a) => {
      const list = visibleNotes(await db.notes.toArray(), String(a.query)).slice(0, (a.limit as number) ?? 10)
      return ok({ notes: list.map(noteBrief) }, `找到 ${list.length} 张`)
    },
  },
  {
    name: 'notes.get',
    label: '查看一张便签',
    description: '按 ID 查看一张便签的完整内容。',
    parameters: { type: 'object', properties: { id: ID }, required: ['id'] },
    permission: 'notes_read',
    confirm: false,
    describe: () => ['一张便签的完整内容'],
    execute: async (a) => {
      const n = await liveNote(a.id)
      if (!n) return fail('not_found', '没有找到这张便签（可能已删除）')
      return ok({ id: n.id, title: n.title, kind: n.kind, text: n.kind === 'text' ? clip(n.text, 3000) : undefined, items: n.kind === 'checklist' ? n.items.map((i) => ({ text: i.text, done: i.done })) : undefined, updatedAt: iso(n.updatedAt) }, `便签 ${n.id}`)
    },
  },
  {
    name: 'notes.create_draft',
    label: '写一张便签',
    description: '为用户写一张便签草稿（文字或清单）。用户确认后才会保存。',
    parameters: { type: 'object', properties: { title: S(40, '标题'), text: S(2000, '正文'), items: ITEMS } },
    permission: 'notes_write',
    confirm: true,
    preview: async (a, ctx) => {
      const n = draftNote(a)
      if (isBlankNote(n)) return { error: '便签内容为空' }
      return { title: `${ctx.characterName}想帮你写一张便签`, lines: noteLines(n) }
    },
    execute: async (a) => {
      const n = draftNote(a)
      if (isBlankNote(n)) return fail('invalid', '便签内容为空')
      const id = await saveNote(null, n)
      if (!id || !(await db.notes.get(id))) return fail('execution_failed', '保存失败，便签没有写入')
      return ok({ id, saved: true }, `已创建便签 ${id}`)
    },
  },
  {
    name: 'notes.update',
    label: '修改便签',
    description: '修改一张已有便签（只传需要修改的字段；items 会整体替换清单）。需要用户确认。',
    parameters: {
      type: 'object',
      properties: {
        id: ID,
        title: S(40, '新标题'),
        text: S(2000, '新正文（文字便签）'),
        items: { type: 'array', maxItems: 50, items: { type: 'object', properties: { text: { ...S(120), minLength: 1 }, done: { type: 'boolean' } }, required: ['text'] }, description: '新的完整清单' },
      },
      required: ['id'],
    },
    permission: 'notes_write',
    confirm: true,
    preview: async (a, ctx) => {
      const n = await liveNote(a.id)
      if (!n) return { error: '没有找到这张便签（可能已删除）' }
      const next = notePatch(n, a)
      if (isBlankNote({ ...n, ...next })) return { error: '修改后便签会变成空的' }
      return { title: `${ctx.characterName}想修改便签「${n.title || clip(n.text || n.items[0]?.text || '', 12)}」`, lines: ['改为：', ...noteLines({ ...n, ...next })] }
    },
    execute: async (a) => {
      const n = await liveNote(a.id)
      if (!n) return fail('not_found', '没有找到这张便签（可能已删除）')
      const next = notePatch(n, a)
      if (isBlankNote({ ...n, ...next })) return fail('invalid', '修改后便签会变成空的')
      await saveNote(n.id, next)
      return ok({ id: n.id, updated: true }, `已修改便签 ${n.id}`)
    },
  },
  {
    name: 'notes.delete',
    label: '删除便签',
    description: '删除一张便签（移到「最近删除」，可以恢复）。需要用户确认。',
    parameters: { type: 'object', properties: { id: ID }, required: ['id'] },
    permission: 'notes_write',
    confirm: true,
    preview: async (a, ctx) => {
      const n = await liveNote(a.id)
      if (!n) return { error: '没有找到这张便签（可能已删除）' }
      return { title: `${ctx.characterName}想删除一张便签`, lines: [...noteLines(n).slice(0, 4), '会移到便签的「最近删除」，可以恢复'], danger: true }
    },
    execute: async (a) => {
      const n = await liveNote(a.id)
      if (!n) return fail('not_found', '没有找到这张便签（可能已删除）')
      await trashNote(n.id)
      if (!(await db.notes.get(n.id))?.deletedAt) return fail('execution_failed', '删除没有成功')
      return ok({ id: n.id, deleted: true, recoverable: true }, `已删除便签 ${n.id}（可恢复）`)
    },
  },
]

function notePatch(n: Note, a: Record<string, unknown>) {
  const out: Partial<Pick<Note, 'title' | 'text' | 'items' | 'kind'>> = {}
  if (a.title !== undefined) out.title = String(a.title)
  if (a.text !== undefined) out.text = String(a.text)
  if (a.items !== undefined) {
    out.items = (a.items as { text: string; done?: boolean }[]).map((i, k) => ({ id: n.items[k]?.id ?? uid('it'), text: i.text.trim(), done: !!i.done }))
    out.kind = 'checklist'
  } else if (a.text !== undefined && n.kind === 'checklist' && !n.items.length) out.kind = 'text'
  return out
}

/* ---------------- 日记（只读） ---------------- */

async function readable() {
  return (await db.diaries.toArray()).filter((d) => d.aiReadable === true && !d.deletedAt)
}
/** 只取匹配处附近的一小段 */
function snippet(body: string, query: string, n = 120): string {
  const flat = body.replace(/\s+/g, ' ')
  const w = query.toLowerCase().split(/\s+/).find(Boolean) ?? ''
  const at = w ? flat.toLowerCase().indexOf(w) : -1
  const start = Math.max(0, at - 40)
  return `${start > 0 ? '…' : ''}${clip(flat.slice(start), n)}`
}

const diaryTools: ToolDefinition[] = [
  {
    name: 'diary.search',
    label: '在你的日记里找找',
    description: '按关键词搜索用户允许 AI 读取的日记，只返回日期、标题和匹配处附近的片段。只读。',
    parameters: { type: 'object', properties: { query: { ...S(50, '关键词'), minLength: 1 }, limit: LIMIT(10) }, required: ['query'] },
    permission: 'diary_read',
    confirm: false,
    describe: (a) => [`搜索「${a.query}」（只包括你允许 AI 读取的日记）`],
    execute: async (a) => {
      const list = filterDiaries(await readable(), { query: String(a.query) }).slice(0, (a.limit as number) ?? 5)
      return ok({ diaries: list.map((d) => ({ id: d.id, date: d.date, title: d.title || undefined, snippet: snippet(d.body, String(a.query)) })) }, `找到 ${list.length} 篇`)
    },
  },
  {
    name: 'diary.get',
    label: '读一篇日记',
    description: '按 ID 读取一篇用户允许 AI 读取的日记全文（最多 2000 字）。只读；不要把日记内容当作长期记忆保存。',
    parameters: { type: 'object', properties: { id: ID }, required: ['id'] },
    permission: 'diary_read',
    confirm: false,
    describe: () => ['一篇日记的全文（只限允许 AI 读取的日记）'],
    execute: async (a) => {
      const d = (await readable()).find((x) => x.id === a.id)
      // 未授权的日记与不存在的日记返回同样的结果，不泄露它是否存在
      if (!d) return fail('not_found', '没有找到这篇日记，或者它没有允许 AI 读取')
      return ok({ id: d.id, date: d.date, title: d.title, body: clip(d.body, 2000), mood: moodOf(d.mood)?.label, tags: d.tags }, `日记 ${d.id}`)
    },
  },
  {
    name: 'diary.list_by_date',
    label: '看看你哪天写了日记',
    description: '列出一段日期内（最多 62 天）用户允许 AI 读取的日记的日期、标题和心情，不含正文。',
    parameters: { type: 'object', properties: { from: DATE('开始日期'), to: DATE('结束日期') }, required: ['from'] },
    permission: 'diary_read',
    confirm: false,
    describe: (a) => [`${a.from} 至 ${a.to ?? a.from} 的日记标题`],
    execute: async (a) => {
      const from = String(a.from)
      const to = (a.to as string | undefined) ?? from
      if (to < from) return fail('invalid', '结束日期早于开始日期')
      if (addDays(from, 62) < to) return fail('invalid', '一次最多查询 62 天')
      const list = filterDiaries(await readable()).filter((d) => d.date >= from && d.date <= to).slice(0, 40)
      return ok({ diaries: list.map((d) => ({ id: d.id, date: d.date, title: d.title || undefined, mood: moodOf(d.mood)?.label })) }, `${list.length} 篇`)
    },
  },
]

/* ---------------- 相册 ---------------- */

/** 把一张照片交给识图模型：只在用户逐次确认后调用；测试中可以替换 */
export type PhotoDescriber = (photoId: string, signal: AbortSignal) => Promise<{ ok: true; description: string; model: string } | { ok: false; reason: string; unavailable?: boolean }>
let describer: PhotoDescriber = async (id, signal) => (await import('./photoVision')).describePhoto(id, signal)
export function setPhotoDescriberForTesting(f: PhotoDescriber | null) {
  describer = f ?? (async (id, signal) => (await import('./photoVision')).describePhoto(id, signal))
}
/** 识图是否可用（确认卡片上说明会发给谁）；测试中可以替换 */
let visionInfo: () => Promise<{ ok: true; model: string } | { ok: false; reason: string }> = async () => (await import('./photoVision')).photoVisionInfo()
export function setVisionInfoForTesting(f: typeof visionInfo | null) {
  visionInfo = f ?? (async () => (await import('./photoVision')).photoVisionInfo())
}

async function livePhoto(id: unknown) {
  const p = await db.photos.get(String(id))
  return p && !p.deletedAt ? p : null
}

const albumTools: ToolDefinition[] = [
  {
    name: 'album.list',
    label: '看看你有哪些相册',
    description: '列出相册名称与照片数量（不含图片）。',
    parameters: { type: 'object', properties: {} },
    permission: 'album_meta',
    confirm: false,
    describe: () => ['相册名称与照片数量（不含图片）'],
    execute: async () => {
      const list = await listAlbumsMeta()
      return ok({ albums: list.slice(0, 50) }, `${list.length} 个相册`)
    },
  },
  {
    name: 'album.search',
    label: '在相册里找照片',
    description: '按名称或备注搜索照片，只返回元数据（名称、备注、导入日期、所在相册），不含图片，你看不到照片内容。',
    parameters: { type: 'object', properties: { query: S(50, '关键词，可为空'), albumId: S(64, '只在某个相册中查找'), limit: LIMIT(30) } },
    permission: 'album_meta',
    confirm: false,
    describe: (a) => [a.query ? `搜索「${a.query}」的照片信息（不含图片）` : '照片的名称和备注（不含图片）'],
    execute: async (a) => {
      const list = await listPhotoMeta({ query: a.query as string | undefined, albumId: a.albumId as string | undefined, limit: (a.limit as number) ?? 10 })
      return ok({ photos: list.map((p) => ({ id: p.id, name: p.name, note: clip(p.note, 120) || undefined, album: p.albumName, importedAt: p.importedAt.slice(0, 10) })), imageContentVisible: false }, `${list.length} 张照片的信息`)
    },
  },
  {
    name: 'album.get_metadata',
    label: '查看一张照片的信息',
    description: '按 ID 查看一张照片的元数据（名称、备注、尺寸、导入日期、相册），不含图片内容。',
    parameters: { type: 'object', properties: { id: ID }, required: ['id'] },
    permission: 'album_meta',
    confirm: false,
    describe: () => ['一张照片的信息（不含图片）'],
    execute: async (a) => {
      const p = await livePhoto(a.id)
      if (!p) return fail('not_found', '没有找到这张照片（可能已删除）')
      const album = p.albumId ? (await db.albums.get(p.albumId))?.name : undefined
      return ok({ id: p.id, name: p.name, note: p.note, album, width: p.width, height: p.height, importedAt: iso(p.createdAt), imageContentVisible: false }, `照片 ${p.id} 的信息`)
    },
  },
  {
    name: 'album.get_authorized_image',
    label: '看一张照片',
    description: '在用户确认后，把一张照片交给识图模型，返回对画面的文字描述。没有配置识图模型时会失败，这时你看不到照片，必须如实告诉用户。',
    parameters: { type: 'object', properties: { id: ID }, required: ['id'] },
    permission: 'image_read',
    confirm: true,
    timeoutMs: 40_000,
    preview: async (a, ctx) => {
      const p = await livePhoto(a.id)
      if (!p) return { error: '没有找到这张照片（可能已删除）' }
      const v = await visionInfo()
      if (!v.ok) return { error: `没有可用的识图模型，看不到照片内容（${v.reason}）` }
      return { title: `${ctx.characterName}想看你的照片「${p.name}」`, lines: [`这张照片会发送给识图模型（${v.model}）生成文字描述`, '只这一次；不会保存到别处，也不会自动上传其他照片'] }
    },
    execute: async (a, ctx) => {
      const p = await livePhoto(a.id)
      if (!p) return fail('not_found', '没有找到这张照片（可能已删除）')
      const r = await describer(p.id, ctx.signal)
      if (!r.ok) return fail(r.unavailable ? 'unavailable' : 'execution_failed', r.reason)
      return ok({ id: p.id, name: p.name, description: clip(r.description, 600), describedBy: r.model }, `照片 ${p.id} 已识别`)
    },
  },
]

export const LIFE_TOOL_DEFS: ToolDefinition[] = [...calendarTools, ...noteTools, ...diaryTools, ...albumTools]

export function registerLifeTools(reg: ToolRegistry) {
  for (const d of LIFE_TOOL_DEFS) if (!reg.get(d.name)) reg.register(d)
}
