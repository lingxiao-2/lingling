/**
 * 真实 iPhone 工具（通过你登记的快捷指令执行）。这些是聆聆的工具名称，不是 iOS 原生接口。
 *
 *  - 每一个都要求逐次确认（confirm: true）；确认卡片上的按钮在点按中直接打开快捷指令（iOS 的要求）
 *  - 卡片出现之前就生成执行计划与「等待确认」的运行记录；你拒绝或停止生成时，这次运行被取消，什么都不会打开
 *  - 同样内容 10 分钟内只能发起一次；一次回复最多一个 iPhone 操作
 *  - 结果如实交还模型：只有快捷指令回跳成功时 status 才是 confirmed；否则是 launched / unverifiable，模型不能说已完成
 */
import { db } from '../db/db'
import type { ShortcutRun } from '../db/schema'
import { APP_IDS, planCalendarEvent, planCustom, planOpenApp, planReminder, prepareRun, type PlanResult } from '../ios/actions'
import { cancelRun, STATUS_LABEL } from '../ios/runs'
import { listShortcuts } from '../ios/shortcuts'
import { fail } from './executor'
import type { ToolContext, ToolDefinition, ToolPreview, ToolRegistry, ToolResult } from './registry'

/** 确认卡片出现前准备好的运行：执行时取回 */
const prepared = new Map<string, string>()
const keyOf = (name: string, args: Record<string, unknown>, ctx: ToolContext) => `${ctx.characterId}|${ctx.conversationId ?? ''}|${name}|${JSON.stringify(args)}`

let waitMs = 40_000
/** 仅供测试：等待快捷指令回跳的最长时间 */
export function setRunWaitForTesting(ms: number) {
  waitMs = ms
}

async function preview(name: string, args: Record<string, unknown>, ctx: ToolContext, plan: PlanResult, verb: string): Promise<ToolPreview | { error: string }> {
  if (!plan.ok) return { error: plan.error }
  const r = await prepareRun(plan.plan, { source: 'chat', characterId: ctx.characterId, conversationId: ctx.conversationId })
  if (!r.ok) return { error: r.error }
  prepared.set(keyOf(name, args, ctx), r.run.id)
  return { title: `${ctx.characterName}想${verb}`, lines: [...plan.plan.lines, '点「确认并打开」后会离开聆聆，打开快捷指令'], launch: { runId: r.run.id, url: r.run.url } }
}

/** 等待结果：成功回跳 / 出错 / 取消，或者超时（仍是「已发起」/「无法验证」） */
async function waitForRun(id: string, signal: AbortSignal, ms: number): Promise<ShortcutRun | undefined> {
  const end = Date.now() + ms
  for (;;) {
    const r = await db.shortcutRuns.get(id)
    if (!r || !['launched', 'awaiting_confirmation'].includes(r.status) || Date.now() >= end || signal.aborted) return r
    await new Promise((res) => setTimeout(res, 400))
  }
}

async function execute(name: string, args: Record<string, unknown>, ctx: ToolContext, opts: { wait: boolean }): Promise<ToolResult> {
  const k = keyOf(name, args, ctx)
  const id = prepared.get(k)
  prepared.delete(k)
  if (!id) return fail('execution_failed', '没有找到准备好的执行计划，没有执行')
  const first = await db.shortcutRuns.get(id)
  if (!first) return fail('execution_failed', '执行记录丢失，没有执行')
  if (first.status === 'awaiting_confirmation') {
    await cancelRun(id)
    return fail('execution_failed', '快捷指令没有被打开，没有执行')
  }
  const r = opts.wait ? await waitForRun(id, ctx.signal, waitMs) : first
  if (!r) return fail('execution_failed', '执行记录丢失')
  if (r.status === 'failed') return fail('execution_failed', `快捷指令报告失败：${r.error ?? '未知原因'}`)
  if (r.status === 'cancelled') return fail('user_rejected', '在快捷指令中被取消，没有完成')
  const verified = r.status === 'confirmed'
  return {
    ok: true,
    data: {
      runId: r.id,
      status: r.status,
      statusLabel: STATUS_LABEL[r.status],
      verified,
      message: verified
        ? '快捷指令回报运行成功'
        : name === 'ios.open_app'
          ? '已经请求打开；网页无法确认应用是否真的打开了'
          : '已经发起，但没有收到快捷指令的回报，无法确认是否完成。只能告诉用户「已经发起，请在 iPhone 上看一下」，不要说已经创建',
    },
    summary: `运行 ${r.id}：${STATUS_LABEL[r.status]}`,
  }
}

const S = (maxLength: number, description: string, min?: number) => ({ type: 'string' as const, maxLength, description, ...(min ? { minLength: min } : {}) })
const DATE = { type: 'string' as const, maxLength: 10, format: 'date' as const, description: '日期 YYYY-MM-DD（根据今天的日期换算「明天」「下周五」等）' }
const TIME = (d: string) => ({ type: 'string' as const, maxLength: 5, format: 'time' as const, description: d })
const common = { confirm: true, timeoutMs: 60_000, maxPerReply: 1 } as const

export const IOS_TOOL_DEFS: ToolDefinition[] = [
  {
    ...common,
    name: 'ios.create_reminder',
    label: '在 iPhone 上创建提醒事项',
    description: '通过用户登记的快捷指令，在用户真实 iPhone 的「提醒事项」App 中创建一条带提醒时间的提醒事项。需要用户确认并打开快捷指令；不是聆聆的便签或日历。',
    parameters: { type: 'object', properties: { title: S(100, '提醒的内容', 1), date: DATE, time: TIME('提醒时间 HH:MM（用户没说具体时间时先问清楚，不要自己猜）'), notes: S(500, '备注') }, required: ['title', 'date'] },
    permission: 'ios_reminder',
    preview: async (a, ctx) => preview('ios.create_reminder', a, ctx, await planReminder({ title: String(a.title), date: String(a.date), time: a.time as string | undefined, notes: a.notes as string | undefined }), '在 iPhone 上创建提醒事项'),
    execute: (a, ctx) => execute('ios.create_reminder', a, ctx, { wait: true }),
  },
  {
    ...common,
    name: 'ios.create_calendar_event',
    label: '在 iPhone 系统日历中添加事件',
    description: '通过用户登记的快捷指令，在用户真实 iPhone 的系统「日历」App 中创建事件（不是聆聆自己的日历；聆聆日历请用 calendar.create_draft）。需要用户确认并打开快捷指令。',
    parameters: { type: 'object', properties: { title: S(100, '标题', 1), date: DATE, startTime: TIME('开始时间 HH:MM'), endTime: TIME('结束时间 HH:MM（可不填，默认 1 小时）'), location: S(100, '地点'), notes: S(500, '备注') }, required: ['title', 'date', 'startTime'] },
    permission: 'ios_calendar',
    preview: async (a, ctx) => preview('ios.create_calendar_event', a, ctx, await planCalendarEvent({ title: String(a.title), date: String(a.date), startTime: String(a.startTime), endTime: a.endTime as string | undefined, location: a.location as string | undefined, notes: a.notes as string | undefined }), '在 iPhone 系统日历中添加事件'),
    execute: (a, ctx) => execute('ios.create_calendar_event', a, ctx, { wait: true }),
  },
  {
    ...common,
    name: 'ios.open_app',
    label: '打开 iPhone 应用',
    description: `打开用户 iPhone 上的 Apple 自带应用（${APP_IDS.join(' / ')}），或用 safari 打开一个 https 网址。只是打开，不能读取或操作应用里的内容；其他应用不支持。`,
    parameters: { type: 'object', properties: { app: { type: 'string', maxLength: 12, enum: APP_IDS, description: '应用' }, url: S(500, 'app 为 safari 时要打开的 https 网址') }, required: ['app'] },
    permission: 'ios_open_app',
    preview: async (a, ctx) => preview('ios.open_app', a, ctx, planOpenApp({ app: String(a.app), url: a.url as string | undefined }), String(a.app) === 'safari' ? '在 Safari 中打开网页' : '打开 iPhone 上的应用'),
    execute: (a, ctx) => execute('ios.open_app', a, ctx, { wait: false }),
  },
  {
    name: 'ios.list_shortcuts',
    label: '看看可以运行哪些快捷指令',
    description: '列出用户登记并允许 AI 使用的自定义快捷指令（名称与用途）。',
    parameters: { type: 'object', properties: {} },
    permission: 'ios_shortcut',
    confirm: false,
    describe: () => ['你允许 AI 使用的快捷指令名称与用途'],
    execute: async () => {
      const list = (await listShortcuts()).filter((s) => s.purpose === 'custom' && s.allowAI)
      return { ok: true, data: { shortcuts: list.map((s) => ({ name: s.name, description: s.description })) }, summary: `${list.length} 个` }
    },
  },
  {
    ...common,
    name: 'ios.run_shortcut',
    label: '运行一个快捷指令',
    description: '运行用户登记并允许 AI 使用的自定义快捷指令（先用 ios.list_shortcuts 查看名称）。不能运行其他快捷指令，也不能打开任意链接。需要用户确认。',
    parameters: { type: 'object', properties: { name: S(60, '快捷指令名称（必须与列表中的完全一致）', 1), text: S(500, '传入的文字（可不填）') }, required: ['name'] },
    permission: 'ios_shortcut',
    preview: async (a, ctx) => {
      const sc = (await listShortcuts()).find((s) => s.name === a.name && s.purpose === 'custom' && s.allowAI)
      if (!sc) return { error: '没有找到这个快捷指令，或用户没有允许 AI 使用它' }
      return preview('ios.run_shortcut', a, ctx, planCustom(sc, a.text as string | undefined), `运行快捷指令「${sc.name}」`)
    },
    execute: (a, ctx) => execute('ios.run_shortcut', a, ctx, { wait: true }),
  },
]

export function registerIosTools(reg: ToolRegistry) {
  for (const d of IOS_TOOL_DEFS) if (!reg.get(d.name)) reg.register(d)
}
