/**
 * 第七阶段 PR A：iOS 快捷指令桥接（环境检测、白名单、参数清理、链接构造、回跳解析、运行状态）：npm test
 * 这里是 Node 中的自动测试，**不是真机测试**；快捷指令 App 的真实行为需要在 iPhone 上验收（docs/iphone-shortcuts.md）。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { detectEnvironment } from '../src/ios/env'
import { buildRunUrl, cleanText, listShortcuts, parseCallback, registerShortcut, removeShortcut, SHORTCUTS_KEY, updateShortcut, validName } from '../src/ios/shortcuts'
import { applyCallback, cancelRun, createRun, launchRun, markUnverifiable, recentDuplicate, setOpenerForTesting, STALE_MS, sweepRuns, userReport, watchAfterLaunch } from '../src/ios/runs'
import { handleIncoming } from '../src/ios/incoming'

// Node 没有 localStorage：用一个内存版本
const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size },
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const BASE = 'https://lingxiao-2.github.io/lingling/'
let opened: string[] = []

beforeEach(async () => {
  await db.delete()
  await db.open()
  opened = []
  mem.clear()
  setOpenerForTesting((u) => opened.push(u))
})

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
test('环境检测：iPhone Safari、主屏幕 App、伪装成 Mac 的 iPad、其他 App 内置浏览器、电脑', () => {
  const a = detectEnvironment({ userAgent: IPHONE })
  assert.deepEqual([a.isIOS, a.iosVersion, a.safari, a.canTryShortcuts, a.standalone], [true, 17, true, true, false])
  const pwa = detectEnvironment({ userAgent: IPHONE, standalone: true })
  assert.ok(pwa.standalone && pwa.notes.some((n) => /无法验证/.test(n)))
  const ipad = detectEnvironment({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', maxTouchPoints: 5 })
  assert.equal(ipad.isIOS, true)
  const wx = detectEnvironment({ userAgent: IPHONE + ' MicroMessenger/8.0' })
  assert.equal(wx.canTryShortcuts, false)
  const pc = detectEnvironment({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' })
  assert.deepEqual([pc.isIOS, pc.canTryShortcuts], [false, false])
})

test('参数清理：去掉控制字符与隐藏的方向字符，限制长度；名称不能换行', () => {
  assert.deepEqual(cleanText('买\u0000东西‮西', 10), { ok: true, text: '买东西西' })
  assert.deepEqual(cleanText('  ', 10), { ok: false, error: '内容为空' })
  assert.equal(cleanText('x'.repeat(11), 10).ok, false)
  assert.equal(cleanText(42, 10).ok, false)
  assert.match(validName('a\nb')!, /换行/)
  assert.equal(validName('聆聆测试'), null)
})

test('链接：名称和文字里的 & ? = # 以及伪造的回跳参数都只是普通文字，不能改变链接结构', () => {
  const evil = '买菜&x-success=https://evil.example/&name=删除全部#x'
  const url = buildRunUrl({ name: '聆聆测试&x-error=https://evil.example', input: evil, runId: 'run_1', nonce: 'abcdef123456', base: BASE })
  assert.ok(url.startsWith('shortcuts://x-callback-url/run-shortcut?'))
  const q = new URLSearchParams(url.split('?').slice(1).join('?'))
  assert.equal(q.get('name'), '聆聆测试&x-error=https://evil.example')
  assert.equal(q.get('text'), evil)
  assert.equal(q.get('input'), 'text')
  assert.equal(q.getAll('x-success').length, 1)
  assert.equal(q.getAll('x-error').length, 1)
  assert.ok(q.get('x-success')!.startsWith(BASE + '?lingling_cb=ok&run=run_1&k=abcdef123456'))
  assert.ok(!url.includes('evil.example/&'), '没有未编码的恶意片段')
})

test('回跳解析：兼容快捷指令用「?」追加 result；格式不对的忽略', () => {
  assert.deepEqual(parseCallback('?lingling_cb=ok&run=run_1&k=abcdef123456&result=%E5%A5%BD'), { status: 'ok', runId: 'run_1', nonce: 'abcdef123456', result: '好', error: undefined })
  assert.deepEqual(parseCallback('?lingling_cb=ok&run=run_1&k=abcdef123456?result=ok'), { status: 'ok', runId: 'run_1', nonce: 'abcdef123456', result: 'ok', error: undefined })
  assert.equal(parseCallback('?lingling_cb=error&run=r&k=abcdef123456&errorMessage=%E6%B2%A1%E6%9C%89%E6%9D%83%E9%99%90')!.error, '没有权限')
  assert.equal(parseCallback('?foo=1'), null)
  assert.equal(parseCallback('?lingling_cb=done&run=r&k=abcdef123456'), null)
  assert.equal(parseCallback('?lingling_cb=ok&run=../x&k=abcdef123456'), null)
  assert.equal(parseCallback('?lingling_cb=ok&run=r&k=short'), null)
})

test('白名单：登记、重复拒绝、同一用途只保留一个、自定义默认不允许 AI、移除；损坏的数据被忽略', async () => {
  await registerShortcut({ name: '聆聆测试', purpose: 'test' })
  await assert.rejects(registerShortcut({ name: '聆聆测试', purpose: 'custom' }), /已经登记/)
  await registerShortcut({ name: '我的测试 2', purpose: 'test' })
  const c = await registerShortcut({ name: '打开健身记录', purpose: 'custom', description: '记录今天的运动' })
  let list = await listShortcuts()
  assert.deepEqual(list.map((s) => [s.name, s.purpose]), [['我的测试 2', 'test'], ['打开健身记录', 'custom']])
  assert.equal(c.allowAI, false)
  await updateShortcut(c.id, { allowAI: true })
  assert.equal((await listShortcuts()).find((s) => s.id === c.id)!.allowAI, true)
  await assert.rejects(registerShortcut({ name: 'a\nb', purpose: 'custom' }), /换行/)
  await removeShortcut(c.id)
  assert.equal((await listShortcuts()).length, 1)
  await setSetting(SHORTCUTS_KEY, { shortcuts: [{ id: 'x', name: '好的', purpose: 'test' }, { id: 'y', name: 123, purpose: 'test' }, { id: 'z', name: '坏用途', purpose: 'rm' }, 'junk'] })
  list = await listShortcuts()
  assert.deepEqual(list.map((s) => s.id), ['x'])
})

test('运行：等待确认 → 点按时同步打开链接 → 成功回跳且校验码正确才算「已确认完成」；回跳只处理一次', async () => {
  const r = await createRun({ kind: 'test', shortcutName: '聆聆测试', title: '测试', lines: [], input: '聆聆测试 abc', source: 'settings', base: BASE })
  assert.equal(r.status, 'awaiting_confirmation')
  assert.equal(opened.length, 0, '确认前不会打开')
  const p = launchRun(r)
  assert.deepEqual(opened, [r.url], '打开链接是同步的（在点按事件内）')
  assert.ok(mem.has(`ll-run-launched:${r.id}`) || (await db.shortcutRuns.get(r.id))!.status === 'launched')
  await p
  assert.equal((await db.shortcutRuns.get(r.id))!.status, 'launched')
  assert.equal(mem.size, 0)
  const bad = await applyCallback({ status: 'ok', runId: r.id, nonce: 'wrongwrongwrong' })
  assert.equal(bad.ok, false)
  assert.equal((await db.shortcutRuns.get(r.id))!.status, 'launched', '校验码不对不改变状态')
  const good = await applyCallback({ status: 'ok', runId: r.id, nonce: r.nonce, result: '聆聆测试 abc' })
  assert.equal(good.run!.status, 'confirmed')
  assert.equal(good.run!.result, '聆聆测试 abc')
  const replay = await applyCallback({ status: 'error', runId: r.id, nonce: r.nonce })
  assert.equal(replay.ok, false)
  assert.equal((await db.shortcutRuns.get(r.id))!.status, 'confirmed', '重放的回跳不改变结果')
  assert.equal(await launchRun({ ...r, status: 'launched' }), null)
  assert.equal(opened.length, 1, '已发起的不会再打开')
})

test('取消与失败：确认前取消不会打开；取消回跳 → 已取消；出错回跳 → 执行失败（不会显示成功）', async () => {
  const a = await createRun({ kind: 'test', shortcutName: 'x', title: 't', lines: [], input: 'i', source: 'settings', base: BASE })
  await cancelRun(a.id)
  assert.equal((await db.shortcutRuns.get(a.id))!.status, 'cancelled')
  assert.equal(await launchRun((await db.shortcutRuns.get(a.id))!), null)
  assert.equal(opened.length, 0)
  const b = await createRun({ kind: 'test', shortcutName: 'x', title: 't', lines: [], input: 'i2', source: 'settings', base: BASE })
  await launchRun(b)
  await applyCallback({ status: 'cancel', runId: b.id, nonce: b.nonce })
  assert.equal((await db.shortcutRuns.get(b.id))!.status, 'cancelled')
  const c = await createRun({ kind: 'test', shortcutName: 'x', title: 't', lines: [], input: 'i3', source: 'settings', base: BASE })
  await launchRun(c)
  await applyCallback({ status: 'error', runId: c.id, nonce: c.nonce, error: '没有提醒事项权限' })
  const cr = (await db.shortcutRuns.get(c.id))!
  assert.deepEqual([cr.status, cr.error], ['failed', '没有提醒事项权限'])
})

test('没有回跳：回到聆聆一段时间后标记「无法验证」；页面没离开也算；迟到的回跳仍可确认；你可以手动标记', async () => {
  const listeners: (() => void)[] = []
  const doc = { visibilityState: 'visible', addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener: () => {} } as unknown as Document
  const r = await createRun({ kind: 'test', shortcutName: 'x', title: 't', lines: [], input: 'a', source: 'settings', base: BASE })
  await launchRun(r)
  watchAfterLaunch(r.id, { doc, windowMs: 20 })
  ;(doc as { visibilityState: string }).visibilityState = 'hidden'
  listeners.forEach((f) => f())
  await wait(50)
  assert.equal((await db.shortcutRuns.get(r.id))!.status, 'launched', '离开期间不会判定')
  ;(doc as { visibilityState: string }).visibilityState = 'visible'
  listeners.forEach((f) => f())
  await wait(60)
  const u = (await db.shortcutRuns.get(r.id))!
  assert.equal(u.status, 'unverifiable')
  const late = await applyCallback({ status: 'ok', runId: r.id, nonce: r.nonce })
  assert.equal(late.run!.status, 'confirmed', '迟到的回跳仍然有效')

  const s = await createRun({ kind: 'test', shortcutName: 'x', title: 't', lines: [], input: 'b', source: 'settings', base: BASE })
  await launchRun(s)
  watchAfterLaunch(s.id, { doc: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } as unknown as Document, windowMs: 10 })
  await wait(50)
  assert.match((await db.shortcutRuns.get(s.id))!.error!, /页面没有切换/)
  await userReport(s.id, true)
  assert.equal((await db.shortcutRuns.get(s.id))!.status, 'user_reported')
})

test('重新打开聆聆：补写被挂起前没写完的「已发起」；发起很久没有回跳的标记为无法验证', async () => {
  const r = await createRun({ kind: 'test', shortcutName: 'x', title: 't', lines: [], input: 'a', source: 'settings', base: BASE })
  mem.set(`ll-run-launched:${r.id}`, String(Date.now()))
  await sweepRuns()
  assert.equal((await db.shortcutRuns.get(r.id))!.status, 'launched')
  await sweepRuns(Date.now() + STALE_MS + 1000)
  assert.equal((await db.shortcutRuns.get(r.id))!.status, 'unverifiable')
  assert.equal(await markUnverifiable(r.id, 'x'), null, '已经是无法验证')
})

test('防止重复：同样内容 10 分钟内已经发起过会被发现；取消的不算', async () => {
  const a = await createRun({ kind: 'reminder', shortcutName: 'x', title: 't', lines: [], input: '{"title":"买东西"}', source: 'chat', base: BASE })
  assert.equal(await recentDuplicate(a.dedupeKey), undefined, '还没发起')
  await launchRun(a)
  assert.equal((await recentDuplicate(a.dedupeKey))!.id, a.id)
  assert.equal(await recentDuplicate(a.dedupeKey, Date.now() + 11 * 60_000), undefined)
  const b = await createRun({ kind: 'reminder', shortcutName: 'x', title: 't', lines: [], input: '{"title":"别的"}', source: 'chat', base: BASE })
  await cancelRun(b.id)
  assert.equal(await recentDuplicate(b.dedupeKey), undefined)
})

test('打开聆聆时处理回跳：更新状态、去掉地址参数、跳到结果页；找不到的运行如实说明', async () => {
  const r = await createRun({ kind: 'test', shortcutName: 'x', title: 't', lines: [], input: 'a', source: 'settings', base: BASE })
  await launchRun(r)
  const urls: string[] = []
  const hist = { replaceState: (_: unknown, __: string, u: string) => urls.push(u) } as unknown as History
  await handleIncoming({ search: `?lingling_cb=ok&run=${r.id}&k=${r.nonce}&result=a`, pathname: '/lingling/', hash: '' } as Location, hist)
  assert.deepEqual(urls, ['/lingling/', `/lingling/#/me/iphone/run/${r.id}`])
  assert.equal((await db.shortcutRuns.get(r.id))!.status, 'confirmed')
  urls.length = 0
  await handleIncoming({ search: '?lingling_cb=ok&run=run_missing&k=abcdef123456', pathname: '/lingling/', hash: '' } as Location, hist)
  assert.equal(urls[1], '/lingling/#/me/iphone?callback=unknown')
  urls.length = 0
  const r2 = await createRun({ kind: 'test', shortcutName: 'x', title: 't', lines: [], input: 'b', source: 'settings', base: BASE })
  await launchRun(r2)
  await handleIncoming({ search: `?lingling_cb=ok&run=${r2.id}&k=forgedforgedforged`, pathname: '/lingling/', hash: '' } as Location, hist)
  assert.equal(urls[1], '/lingling/#/me/iphone?callback=invalid')
  assert.equal((await db.shortcutRuns.get(r2.id))!.status, 'launched')
})
