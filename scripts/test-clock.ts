/**
 * 第八阶段 PR B：时钟（世界时钟、秒表、倒计时、前台 / 后台结束的区分）：npm test
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { diffLabel, editCities, getCities, setCities, zoneTime, DEFAULT_CITIES } from '../src/clock/world'
import { cancelTimer, createTimer, durationLabel, elapsed, EMPTY_STOPWATCH, formatMs, lapSw, loadStopwatch, pauseSw, pauseTimer, remaining, resumeTimer, saveStopwatch, settleTimers, startSw, clearHistory } from '../src/clock/timers'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('世界时钟：时区换算、日期差与时差说明；城市列表校验（未知城市、重复被去掉）', async () => {
  const now = new Date()
  const same = zoneTime(Intl.DateTimeFormat().resolvedOptions().timeZone, now)
  assert.equal(same.offsetHours, 0)
  assert.equal(same.dayDiff, 0)
  assert.match(same.time, /^\d{2}:\d{2}$/)
  const tokyo = zoneTime('Asia/Tokyo', new Date(Date.UTC(2026, 0, 1, 20, 0)))
  assert.equal(tokyo.time, '05:00', 'UTC 20:00 = 东京次日 05:00')
  assert.equal(diffLabel(1, 9), '明天 · 快 9 小时')
  assert.equal(diffLabel(0, -3.5), '今天 · 慢 3.5 小时')
  assert.deepEqual((await getCities()).map((c) => c.id), DEFAULT_CITIES)
  await setCities(['paris', 'paris', 'nowhere', 'tokyo'])
  assert.deepEqual((await getCities()).map((c) => c.id), ['paris', 'tokyo'])
  // 连续快速修改：每次都基于最新列表
  await Promise.all([editCities((n) => [...n, 'london']), editCities((n) => n.filter((x) => x !== 'paris'))])
  assert.deepEqual((await getCities()).map((c) => c.id).sort(), ['london', 'tokyo'])
})

test('秒表：按时间点计算；暂停、继续、计次；保存后恢复', async () => {
  let s = startSw(EMPTY_STOPWATCH, 1000)
  assert.equal(elapsed(s, 3500), 2500)
  s = lapSw(s, 4000)
  s = pauseSw(s, 5000)
  assert.equal(elapsed(s, 99999), 4000, '暂停后不再增加')
  s = startSw(s, 10_000)
  assert.equal(elapsed(s, 11_000), 5000)
  assert.deepEqual(s.laps, [3000])
  await saveStopwatch(s)
  assert.deepEqual(await loadStopwatch(), s)
  assert.equal(formatMs(3_723_450), '1:02:03.45')
  assert.equal(formatMs(65_000, false), '01:05')
})

test('倒计时：创建（名称、时长校验）、暂停保留剩余时间、继续、取消', async () => {
  await assert.rejects(createTimer('x', 500), /至少 1 秒/)
  await assert.rejects(createTimer('x', 25 * 3600_000), /24 小时/)
  const t = await createTimer('  泡茶  ', 180_000, 0)
  assert.equal(t.name, '泡茶')
  assert.equal(remaining(t, 60_000), 120_000)
  await pauseTimer(t.id, 60_000)
  const p = (await db.timers.get(t.id))!
  assert.deepEqual([p.status, p.remainingMs, remaining(p, 999_999)], ['paused', 120_000, 120_000])
  await resumeTimer(t.id, 500_000)
  assert.equal((await db.timers.get(t.id))!.endAt, 620_000)
  await cancelTimer(t.id, 560_000)
  const c = (await db.timers.get(t.id))!
  assert.deepEqual([c.status, c.remainingMs], ['cancelled', 60_000])
  assert.equal((await createTimer('', 1000)).name, '计时')
  assert.equal(durationLabel(5_400_000), '1 小时 30 分钟')
})

test('结束：前台准时结束记为已提醒；离开期间到点的记为「没有响铃」；每个计时只结束一次', async () => {
  const a = await createTimer('前台', 10_000, 0)
  const b = await createTimer('后台', 10_000, 0)
  const c = await createTimer('还没到', 60_000, 0)
  // a 在前台准时检查到
  const first = await settleTimers(11_000, true)
  assert.deepEqual(first.map((t) => [t.name, t.alerted]).sort(), [['前台', true], ['后台', true]])
  void a; void b
  // 再检查一次不会重复
  assert.equal((await settleTimers(12_000, true)).length, 0)
  // c 在页面不在前台时（回来后才检查）到点：迟了很久
  const late = await settleTimers(300_000, true)
  assert.deepEqual(late.map((t) => [t.name, t.alerted]), [['还没到', false]])
  const row = (await db.timers.get(c.id))!
  assert.deepEqual([row.status, row.finishedAt, row.alerted], ['done', 60_000, false], '结束时间记为真正到点的时间')
  await clearHistory()
  assert.equal(await db.timers.count(), 0)
})
