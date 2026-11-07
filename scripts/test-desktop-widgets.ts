/** 桌面小组件 PR C：布局 v1→v2 迁移（保留用户自定义、只在放得下的地方加入小组件）、角色小组件设置、时钟文字、便签保存：npm test */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { defaultLayout, DEFAULT_WIDGETS, fits, migrateToV2, normalizeLayout, setWidgetCharacter, type DesktopItem, type DesktopLayout, LAYOUT_VERSION } from '../src/desktop/layout'
import { LAYOUT_KEY, loadLayout, NOTE_KEY, NOTE_MAX, saveNote, saveWidgetCharacter } from '../src/desktop/layoutStore'
import { clockText } from '../src/desktop/widgets'

const ids = (items: DesktopItem[]) => items.map((x) => (x.kind === 'app' ? x.app : x.id))

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('默认布局：第 1 页时间、便签、角色小组件 + 8 个应用，第 2 页音乐、天气小组件；每页放得下', () => {
  const d = defaultLayout()
  assert.equal(d.version, LAYOUT_VERSION)
  assert.deepEqual(ids(d.pages[0]).slice(0, 3), ['w-clock', 'w-note', 'w-character'])
  assert.deepEqual(ids(d.pages[1]).slice(0, 2), ['w-music', 'w-weather'])
  assert.ok(d.pages.every(fits))
})

test('迁移 v1 → v2：用户排好的应用顺序和 Dock 不变；小组件加在原来所在页的最前面；放不下就换页或不加；只迁移一次', () => {
  // 用户在 PR B 版本里自定义过的布局（没有小组件）
  const v1 = { version: 1, pages: [[{ kind: 'app', app: 'tarot' }, { kind: 'app', app: 'diary' }], [{ kind: 'app', app: 'mail' }], []], dock: ['me', 'messages'], page: 2 }
  const m = normalizeLayout(v1)
  assert.equal(m.version, LAYOUT_VERSION)
  assert.deepEqual(m.dock, ['me', 'messages'])
  assert.equal(m.page, 2)
  assert.deepEqual(ids(m.pages[0]).slice(0, 5), ['w-clock', 'w-note', 'w-character', 'tarot', 'diary'])
  assert.deepEqual(ids(m.pages[1]).slice(0, 3), ['w-music', 'w-weather', 'mail'])
  // 已经迁移过的布局（用户删除或移动过小组件）不再迁移
  const v2 = { ...m, version: LAYOUT_VERSION, pages: [m.pages[0].filter((x) => x.kind === 'app'), m.pages[1], m.pages[2]] }
  assert.deepEqual(ids(normalizeLayout(v2).pages[0]).filter((x) => x.startsWith('w-')), [])
  // 第 1 页放不下时，小组件放到后面有空位的页
  const fullApps = (n: number): DesktopItem[] => Array.from({ length: n }, (_, i) => ({ kind: 'widget', id: `u${i}`, widget: 'note', size: 'small' }))
  const crowded: DesktopLayout = { version: 1, pages: [fullApps(6), [], []], dock: [], page: 0 }
  const c = migrateToV2(crowded)
  assert.equal(ids(c.pages[0]).filter((x) => x.startsWith('w-')).length, 0)
  assert.ok([...ids(c.pages[1]), ...ids(c.pages[2])].includes('w-clock'), '放到后面有空位的页')
  assert.ok(c.pages.every(fits))
  // 迁移后的数据写回，下次读取结果相同
  assert.deepEqual(normalizeLayout(m), m)
  assert.equal(DEFAULT_WIDGETS.length, 5)
})

test('从数据库读取旧版布局：迁移后写回；角色小组件设置只改那一个小组件', async () => {
  await db.settings.put({ key: LAYOUT_KEY, value: { version: 1, pages: [[{ kind: 'app', app: 'tarot' }], [], []], dock: ['messages'], page: 0 } })
  const l = await loadLayout()
  assert.equal(l.version, LAYOUT_VERSION)
  assert.equal(((await db.settings.get(LAYOUT_KEY))!.value as DesktopLayout).version, LAYOUT_VERSION)
  await saveWidgetCharacter('w-character', 'c1')
  const after = await loadLayout()
  const w = after.pages[0].find((x) => x.kind === 'widget' && x.id === 'w-character')
  assert.deepEqual(w, { kind: 'widget', id: 'w-character', widget: 'character', size: 'small', characterId: 'c1' })
  assert.deepEqual(after.dock, ['messages'])
  const cleared = setWidgetCharacter(after, 'w-character', undefined)
  assert.equal((cleared.pages[0].find((x) => x.kind === 'widget' && x.id === 'w-character') as { characterId?: string }).characterId, undefined)
})

test('时间日期文字', () => {
  const t = clockText(new Date(2026, 10, 6, 9, 5))
  assert.equal(t.time, '09:05')
  assert.equal(t.zh, '11月6日 星期五')
  assert.equal(t.en, 'Friday, November 6')
})

test('便签：去掉首尾空白，最多 200 字，保存在 settings 的独立一项', async () => {
  const n = await saveNote('  记得买牛奶\r\n还有面包  ')
  assert.equal(n.text, '记得买牛奶\n还有面包')
  assert.equal(((await db.settings.get(NOTE_KEY))!.value as { text: string }).text, '记得买牛奶\n还有面包')
  assert.equal((await saveNote('长'.repeat(300))).text.length, NOTE_MAX)
})

test('迁移 v2 → v3：只加入天气小组件，用户的其他布局、小组件、Dock 不变；删掉天气小组件后不会再加回来', () => {
  const v2 = { version: 2, pages: [[{ kind: 'widget', id: 'w-clock', widget: 'clock', size: 'medium' }, { kind: 'app', app: 'tarot' }], [{ kind: 'app', app: 'mail' }], []], dock: ['me'], page: 1 }
  const m = normalizeLayout(v2)
  assert.equal(m.version, LAYOUT_VERSION)
  assert.deepEqual(ids(m.pages[0]).slice(0, 2), ['w-clock', 'tarot'])
  assert.deepEqual(ids(m.pages[1]).slice(0, 2), ['w-weather', 'mail'])
  assert.deepEqual(m.dock, ['me'])
  assert.equal(m.page, 1)
  assert.ok(!ids(m.pages.flat()).includes('w-note'), '用户以前删掉的便签小组件不会被加回来')
  const removed = { ...m, pages: m.pages.map((p) => p.filter((x) => !(x.kind === 'widget' && x.id === 'w-weather'))) }
  assert.ok(!ids(normalizeLayout(removed).pages.flat()).includes('w-weather'))
})
