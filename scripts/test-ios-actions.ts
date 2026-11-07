/**
 * 第七阶段 PR B：提醒事项、系统日历、打开应用、自定义快捷指令的执行计划与防重复：npm test
 * Node 自动测试，**不是真机测试**；真实创建提醒 / 日历事件需要在 iPhone 上验收。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { registerShortcut } from '../src/ios/shortcuts'
import { planCalendarEvent, planCustom, planOpenApp, planReminder, prepareRun, zhDateTime } from '../src/ios/actions'
import { launchRun, setOpenerForTesting } from '../src/ios/runs'
import { addDays } from '../src/life/calendar'
import { localDate } from '../src/life/diary'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size } }
const BASE = 'https://lingxiao-2.github.io/lingling/'
const tomorrow = addDays(localDate(), 1)
let opened: string[] = []

beforeEach(async () => {
  await db.delete()
  await db.open()
  opened = []
  setOpenerForTesting((u) => opened.push(u))
})

test('提醒事项：未登记快捷指令时如实说明；计划显示具体日期时间标题，并明确保存到 iPhone 而不是聆聆', async () => {
  const none = await planReminder({ title: '去买东西', date: tomorrow, time: '15:00' })
  assert.deepEqual(none, { ok: false, code: 'not_configured', error: '还没有登记「提醒事项」快捷指令（我的 → 连接真实 iPhone）' })
  await registerShortcut({ name: '聆聆提醒事项', purpose: 'reminder' })
  const r = await planReminder({ title: '去买东西', date: tomorrow, time: '15:00' })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.plan.shortcut!.name, '聆聆提醒事项')
  assert.deepEqual(JSON.parse(r.plan.input!), { v: 1, type: 'reminder', title: '去买东西', due: `${tomorrow} 15:00`, notes: '' })
  assert.equal(r.plan.lines[0], '标题：去买东西')
  assert.equal(r.plan.lines[1], `提醒时间：${zhDateTime(tomorrow, '15:00')}`)
  assert.ok(r.plan.lines.some((l) => /iPhone 的「提醒事项」App，不是聆聆/.test(l)))
  const noTime = await planReminder({ title: '交作业', date: tomorrow })
  assert.ok(noTime.ok && noTime.plan.lines[1].includes('默认 09:00'))
})

test('提醒事项：标题为空、日期不存在、时间格式错、已经过去的时间都拒绝；JSON 里的特殊字符被正确转义', async () => {
  await registerShortcut({ name: '聆聆提醒事项', purpose: 'reminder' })
  assert.match((await planReminder({ title: ' ', date: tomorrow }) as { error: string }).error, /标题/)
  assert.match((await planReminder({ title: 'x', date: '2026-02-30' }) as { error: string }).error, /日期/)
  assert.match((await planReminder({ title: 'x', date: tomorrow, time: '25:00' }) as { error: string }).error, /时间/)
  assert.match((await planReminder({ title: 'x', date: '2020-01-01', time: '10:00' }) as { error: string }).error, /已经过去/)
  const r = await planReminder({ title: '买"牛奶"},"type":"calendar', date: tomorrow, time: '10:00' })
  assert.ok(r.ok)
  if (r.ok) assert.equal(JSON.parse(r.plan.input!).type, 'reminder', '注入的引号不能改变 JSON 结构')
})

test('系统日历：默认 1 小时；跨午夜；结束等于开始拒绝；明确是 iPhone 系统日历而不是聆聆的日历；不会写入聆聆日历', async () => {
  await registerShortcut({ name: '聆聆日历', purpose: 'calendar' })
  const r = await planCalendarEvent({ title: '面试', date: tomorrow, startTime: '10:00', location: '星光大厦', notes: '带简历' })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(JSON.parse(r.plan.input!), { v: 1, type: 'calendar', title: '面试', start: `${tomorrow} 10:00`, end: `${tomorrow} 11:00`, location: '星光大厦', notes: '带简历' })
  assert.ok(r.plan.lines.some((l) => /iPhone 的系统「日历」App，不是聆聆的日历/.test(l)))
  const night = await planCalendarEvent({ title: '夜班', date: tomorrow, startTime: '22:00', endTime: '02:00' })
  assert.ok(night.ok && JSON.parse(night.plan.input!).end === `${addDays(tomorrow, 1)} 02:00`)
  assert.equal((await planCalendarEvent({ title: 'x', date: tomorrow, startTime: '10:00', endTime: '10:00' })).ok, false)
  assert.equal((await planCalendarEvent({ title: 'x', date: tomorrow, startTime: '' })).ok, false)
  assert.equal(await db.events.count(), 0, '聆聆自己的日历没有任何变化')
})

test('打开应用：只支持列表里的应用；Safari 只能打开 https 网址；不支持的应用如实说明', () => {
  const r = planOpenApp({ app: 'calendar' })
  assert.ok(r.ok && r.plan.url === 'calshow://')
  assert.equal(planOpenApp({ app: 'wechat' }).ok, false)
  assert.equal(planOpenApp({ app: 'safari', url: 'javascript:alert(1)' }).ok, false)
  assert.equal(planOpenApp({ app: 'safari', url: 'http://example.com' }).ok, false)
  assert.equal(planOpenApp({ app: 'safari', url: 'https://user:pw@example.com' }).ok, false)
  const s = planOpenApp({ app: 'safari', url: 'https://example.com/a?b=1' })
  assert.ok(s.ok && s.plan.url === 'https://example.com/a?b=1')
})

test('自定义快捷指令：只能运行白名单里的；传入文字经过清理', async () => {
  const sc = await registerShortcut({ name: '打开健身记录', purpose: 'custom', description: '记录运动' })
  const r = planCustom(sc, '跑步\u0000 5 公里')
  assert.ok(r.ok && r.plan.input === '跑步 5 公里')
  const t = await registerShortcut({ name: '聆聆测试', purpose: 'test' })
  assert.equal(planCustom(t).ok, false)
})

test('防止重复：同样的提醒 10 分钟内只能发起一次，除非你明确选择再执行一次；内容不同不受影响', async () => {
  await registerShortcut({ name: '聆聆提醒事项', purpose: 'reminder' })
  const plan = await planReminder({ title: '去买东西', date: tomorrow, time: '15:00' })
  assert.ok(plan.ok)
  if (!plan.ok) return
  const a = await prepareRun(plan.plan, { source: 'settings', base: BASE })
  assert.ok(a.ok)
  if (!a.ok) return
  await launchRun(a.run)
  const b = await prepareRun(plan.plan, { source: 'settings', base: BASE })
  assert.equal(b.ok, false)
  assert.match((b as { error: string }).error, /10 分钟内已经发起过同样的操作/)
  const c = await prepareRun(plan.plan, { source: 'settings', base: BASE, allowRepeat: true })
  assert.ok(c.ok)
  const other = await planReminder({ title: '去买菜', date: tomorrow, time: '15:00' })
  assert.ok(other.ok && (await prepareRun(other.plan, { source: 'settings', base: BASE })).ok)
  assert.equal(opened.length, 1, '只有点了「打开」的那一次真正打开')
  const u = new URL(opened[0].replace('shortcuts://', 'https://'))
  assert.equal(u.searchParams.get('name'), '聆聆提醒事项')
  assert.equal(JSON.parse(u.searchParams.get('text')!).title, '去买东西')
})
