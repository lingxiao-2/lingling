/** 日历 PR D：重复规则（含 31 日 / 2 月 29 日跳过）、某段时间的日程、纪念日周年、搜索、校验、导出格式（不声称已同步）、读写与日记关联：npm test */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import type { CalEvent } from '../src/db/schema'
import { eventsForDiary, purgeEvent, restoreEvent, saveEvent, trashEvent, type EventInput } from '../src/db/eventRepo'
import { saveDiary, trashDiary } from '../src/db/diaryRepo'
import { addDays, anniversaryText, occurrences, occursOn, searchEvents, toICS, toShortcutPayload, validateEvent, yearsSince } from '../src/life/calendar'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const ev = (x: Partial<CalEvent>): CalEvent => ({ id: 'e', title: 't', kind: 'event', allDay: true, date: '2026-01-31', location: '', note: '', repeat: 'none', diaryIds: [], source: 'local', createdAt: 1, updatedAt: 1, ...x })
const input = (x: Partial<EventInput>): EventInput => ({ title: '看雪', kind: 'event', allDay: true, date: '2026-11-06', location: '', note: '', repeat: 'none', diaryIds: [], ...x })

test('重复规则：不重复 / 每天 / 每周 / 每月（没有 31 日的月份跳过）/ 每年（非闰年跳过 2 月 29 日）；开始前不发生；删除的不发生', () => {
  assert.ok(occursOn(ev({}), '2026-01-31'))
  assert.ok(!occursOn(ev({}), '2026-02-01'))
  assert.ok(occursOn(ev({ repeat: 'daily' }), '2026-03-15'))
  assert.ok(!occursOn(ev({ repeat: 'daily' }), '2026-01-30'), '开始日期之前不发生')
  assert.ok(occursOn(ev({ repeat: 'weekly' }), '2026-02-07'))
  assert.ok(!occursOn(ev({ repeat: 'weekly' }), '2026-02-08'))
  assert.ok(occursOn(ev({ repeat: 'monthly' }), '2026-03-31'))
  assert.ok(!occursOn(ev({ repeat: 'monthly' }), '2026-02-28'), '2 月没有 31 日，那一次跳过')
  const leap = ev({ date: '2024-02-29', repeat: 'yearly' })
  assert.ok(!occursOn(leap, '2025-02-28') && !occursOn(leap, '2025-03-01'))
  assert.ok(occursOn(leap, '2028-02-29'))
  assert.ok(!occursOn(ev({ repeat: 'daily', deletedAt: 5 }), '2026-02-01'))
})

test('一段时间内的日程：全天在前、按开始时间排序；跨年', () => {
  const list = [
    ev({ id: 'b', date: '2026-11-06', allDay: false, startTime: '18:00' }),
    ev({ id: 'a', date: '2026-11-06', allDay: false, startTime: '09:30' }),
    ev({ id: 'c', date: '2026-11-06', allDay: true }),
    ev({ id: 'd', date: '2025-12-31', repeat: 'yearly', kind: 'anniversary' }),
  ]
  assert.deepEqual(occurrences(list, '2026-11-06', '2026-11-06').map((o) => o.event.id), ['c', 'a', 'b'])
  assert.deepEqual(occurrences(list, '2026-12-30', '2027-01-01').map((o) => [o.event.id, o.date]), [['d', '2026-12-31']])
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('纪念日与生日：周年数和文字；日期由用户填写', () => {
  const met = ev({ kind: 'anniversary', date: '2023-11-06', repeat: 'yearly' })
  assert.equal(yearsSince(met, '2026-11-06'), 3)
  assert.equal(anniversaryText(met, '2026-11-06'), '3 周年')
  assert.equal(anniversaryText(met, '2023-11-06'), '这一天')
  assert.equal(anniversaryText(ev({ kind: 'birthday', date: '2000-05-20' }), '2026-05-20'), '26 岁生日')
  assert.equal(anniversaryText(ev({}), '2026-01-31'), '')
})

test('校验与搜索', () => {
  assert.equal(validateEvent({ title: ' ', date: '2026-11-06', allDay: true }), '请填写标题')
  assert.equal(validateEvent({ title: 'a', date: '2026-13-40', allDay: true }), '日期不正确')
  assert.equal(validateEvent({ title: 'a', date: '2026-11-06', allDay: false, startTime: '' }), '请填写开始时间')
  assert.equal(validateEvent({ title: 'a', date: '2026-11-06', allDay: false, startTime: '10:00', endTime: '09:00' }), '结束时间不能早于开始时间')
  assert.equal(validateEvent({ title: 'a', date: '2026-11-06', allDay: false, startTime: '10:00', endTime: '' }), null)
  const list = [ev({ id: 'a', title: '看雪', location: '北海道' }), ev({ id: 'b', title: '写信', note: '给沈遥', deletedAt: 1 })]
  assert.deepEqual(searchEvents(list, '北海道').map((e) => e.id), ['a'])
  assert.deepEqual(searchEvents(list, '沈遥'), [], '删除的不出现')
  assert.deepEqual(searchEvents(list, ''), [])
})

test('导出给 iPhone 日历的格式：标准字段、重复规则、明确标记「未同步到系统日历」', () => {
  const e = ev({ id: 'x1', title: '看雪, 一起', allDay: false, date: '2026-11-06', startTime: '19:30', endTime: '21:00', location: '北海道', note: '带围巾\n热可可', repeat: 'yearly' })
  const p = toShortcutPayload(e)
  assert.deepEqual(p, { format: 'lingling-event', version: 1, linglingId: 'x1', title: '看雪, 一起', isAllDay: false, start: '2026-11-06T19:30:00', end: '2026-11-06T21:00:00', location: '北海道', notes: '带围巾\n热可可', recurrence: { frequency: 'yearly', interval: 1 }, syncedToSystemCalendar: false })
  const ics = toICS(e, new Date('2026-11-06T00:00:00Z'))
  assert.match(ics, /DTSTART:20261106T193000\r\n/)
  assert.match(ics, /DTEND:20261106T210000\r\n/)
  assert.match(ics, /SUMMARY:看雪\\, 一起\r\n/)
  assert.match(ics, /DESCRIPTION:带围巾\\n热可可\r\n/)
  assert.match(ics, /RRULE:FREQ=YEARLY\r\n/)
  const allDay = toICS(ev({ id: 'x2', date: '2026-12-31' }))
  assert.match(allDay, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/)
  assert.equal(toShortcutPayload(ev({ date: '2026-12-31' })).end, '2027-01-01T00:00:00')
})

test('保存：校验不通过时不保存；全天事件不保存时间；纪念日关联角色、默认类型；删除、恢复、彻底删除', async () => {
  await assert.rejects(saveEvent(null, input({ title: '' })), /请填写标题/)
  assert.equal(await db.events.count(), 0)
  const a = await saveEvent(null, input({ startTime: '09:00', location: '  北海道 ' }))
  const row = (await db.events.get(a))!
  assert.equal(row.startTime, undefined)
  assert.equal(row.location, '北海道')
  assert.equal(row.source, 'local')
  const b = await saveEvent(null, input({ title: '初次见面', kind: 'anniversary', repeat: 'yearly', characterId: 'c1' }))
  assert.equal((await db.events.get(b))!.anniversaryType, 'other')
  assert.equal((await db.events.get(b))!.characterId, 'c1')
  const c = await saveEvent(null, input({ title: '普通', characterId: 'c1' }))
  assert.equal((await db.events.get(c))!.characterId, undefined, '普通日程不关联角色')
  assert.equal(await purgeEvent(a), false)
  await trashEvent(a)
  await restoreEvent(a)
  assert.equal((await db.events.get(a))!.deletedAt, undefined)
  await trashEvent(a)
  assert.equal(await purgeEvent(a), true)
})

test('日记关联：日程保存日记的稳定 ID；日记页面能查到关联的日程；日记删除后日程照常读取', async () => {
  const d = (await saveDiary(null, { body: '看到了初雪' }))!
  const e = await saveEvent(null, input({ diaryIds: [d, d] }))
  assert.deepEqual((await db.events.get(e))!.diaryIds, [d])
  assert.deepEqual((await eventsForDiary(d)).map((x) => x.id), [e])
  await trashDiary(d)
  assert.deepEqual((await db.events.get(e))!.diaryIds, [d])
  await trashEvent(e)
  assert.deepEqual(await eventsForDiary(d), [], '删除的日程不再出现在日记页面')
})
