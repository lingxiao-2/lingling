/** 桌面编辑与持久化 PR B：移动规则、保存与读取、不覆盖自定义布局、损坏修复、恢复默认只影响桌面：npm test */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { DB_SCHEMA_VERSION } from '../src/db/schema'
import { db } from '../src/db/db'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { defaultLayout, GRID, moveItem, setPage, type DesktopItem, type DesktopLayout } from '../src/desktop/layout'
import { LAYOUT_KEY, loadLayout, resetLayout, saveLayout, savePage } from '../src/desktop/layoutStore'

const ids = (items: DesktopItem[]) => items.map((x) => (x.kind === 'app' ? x.app : x.id))
/** 只有应用的布局（移动规则测试用；与是否有默认小组件无关） */
const appsOnly = (): DesktopLayout => {
  const d = defaultLayout()
  return { ...d, pages: d.pages.map((p) => p.filter((x) => x.kind === 'app')) }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('页内移动：取出后插入目标位置', () => {
  const d = appsOnly()
  const n = moveItem(d, { area: 'page', page: 0, index: 0 }, { area: 'page', page: 0, index: 3 })!
  assert.deepEqual(ids(n.pages[0]).slice(0, 4), ['album', 'diary', 'notes', 'memory'])
  assert.deepEqual(ids(d.pages[0]).slice(0, 4), ['memory', 'album', 'diary', 'notes'], '原布局不被修改')
  assert.equal(moveItem(d, { area: 'page', page: 0, index: 1 }, { area: 'page', page: 0, index: 1 }), d, '原地不动返回同一个布局')
})

test('跨屏移动：放到另一页的指定位置；超出时放到最后', () => {
  const d = appsOnly()
  const n = moveItem(d, { area: 'page', page: 0, index: 0 }, { area: 'page', page: 2, index: 1 })!
  assert.equal(n.pages[0].length, d.pages[0].length - 1)
  assert.deepEqual(ids(n.pages[2]).slice(0, 3), ['worlds', 'memory', 'lorebooks'])
  const m = moveItem(d, { area: 'page', page: 1, index: 0 }, { area: 'page', page: 0, index: 99 })!
  assert.equal(ids(m.pages[0]).at(-1), 'mail')
})

test('目标页满了不移动；不存在的来源返回 null', () => {
  const d = appsOnly()
  const full: DesktopLayout = { ...d, pages: [Array.from({ length: GRID.cols * GRID.rows }, (_, i) => ({ kind: 'widget', id: `w${i}`, widget: 'note', size: 'small' }) as DesktopItem).slice(0, 6), d.pages[1], d.pages[2]] }
  assert.equal(moveItem(full, { area: 'page', page: 1, index: 0 }, { area: 'page', page: 0, index: 0 }), null)
  assert.equal(moveItem(d, { area: 'page', page: 0, index: 50 }, { area: 'page', page: 1, index: 0 }), null)
})

test('Dock：满了时与目标位置互换；Dock 内调整顺序；从 Dock 拖回桌面；小组件不能放进 Dock', () => {
  const d = appsOnly()
  const a = moveItem(d, { area: 'page', page: 0, index: 0 }, { area: 'dock', index: 1 })!
  assert.deepEqual(a.dock, ['messages', 'memory', 'moments', 'me'])
  assert.equal(ids(a.pages[0])[0], 'contacts', '被换下来的应用放回原来的位置')
  const b = moveItem(d, { area: 'dock', index: 0 }, { area: 'dock', index: 3 })!
  assert.deepEqual(b.dock, ['contacts', 'moments', 'me', 'messages'])
  const c = moveItem(d, { area: 'dock', index: 2 }, { area: 'page', page: 1, index: 0 })!
  assert.deepEqual(c.dock, ['messages', 'contacts', 'me'])
  assert.equal(ids(c.pages[1])[0], 'moments')
  const e = moveItem(c, { area: 'page', page: 0, index: 0 }, { area: 'dock', index: 9 })!
  assert.deepEqual(e.dock, ['messages', 'contacts', 'me', 'memory'], 'Dock 有空位时直接放入')
  const w: DesktopLayout = { ...d, pages: [[{ kind: 'widget', id: 'w', widget: 'clock', size: 'small' }, ...d.pages[0]], d.pages[1], d.pages[2]] }
  assert.equal(moveItem(w, { area: 'page', page: 0, index: 0 }, { area: 'dock', index: 0 }), null)
  assert.equal(setPage(d, 7).page, 2)
})

test('第一次进入生成默认布局并保存；之后不会被默认布局覆盖；刷新后布局和页码不变', async () => {
  assert.equal(await db.settings.get(LAYOUT_KEY), undefined)
  const first = await loadLayout()
  assert.deepEqual(first, defaultLayout())
  assert.ok(await db.settings.get(LAYOUT_KEY))
  const custom = setPage(moveItem(first, { area: 'page', page: 0, index: 3 }, { area: 'page', page: 2, index: 0 })!, 2)
  await saveLayout(custom)
  for (let i = 0; i < 3; i++) assert.deepEqual(await loadLayout(), custom, `第 ${i + 1} 次重新进入`)
  // 模拟「刷新」：新的数据库连接读到同样的布局
  db.close()
  await db.open()
  const again = await loadLayout()
  assert.equal(ids(again.pages[2])[0], 'memory')
  assert.equal(again.page, 2)
  assert.equal(again.version, 2)
})

test('保存的数据损坏或来自旧版本：自动修复（补回缺失应用），损坏时退回默认；不影响其他设置', async () => {
  await db.settings.put({ key: 'profile', value: { nickname: '小雪', signature: '' } })
  await db.settings.put({ key: LAYOUT_KEY, value: '{坏掉的数据' })
  assert.deepEqual(await loadLayout(), defaultLayout())
  await db.settings.put({ key: LAYOUT_KEY, value: { version: 2, pages: [[{ kind: 'app', app: 'tarot' }], [], []], dock: ['me'], page: 1 } })
  const fixed = await loadLayout()
  assert.equal(ids(fixed.pages[0])[0], 'tarot')
  assert.deepEqual(fixed.dock, ['me'])
  assert.equal(fixed.page, 1)
  assert.equal(ids(fixed.pages.flat()).length + fixed.dock.length, 21, '缺失的应用都补回来了')
  assert.deepEqual((await db.settings.get(LAYOUT_KEY))!.value, fixed, '修复结果写回')
  assert.deepEqual((await db.settings.get('profile'))!.value, { nickname: '小雪', signature: '' })
})

test('恢复默认只改写桌面布局，角色、聊天、其他设置都不受影响；数据库版本不变', async () => {
  const c = await createCharacter({ name: '沈遥', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  const conv = await getOrCreateSingleConversation(c.id)
  await sendUserMessage(conv, '你好')
  await db.settings.put({ key: 'profile', value: { nickname: '小雪', signature: '' } })
  await saveLayout(setPage(moveItem(defaultLayout(), { area: 'page', page: 0, index: 3 }, { area: 'page', page: 1, index: 0 })!, 1))
  const before = { chars: await db.characters.count(), msgs: await db.messages.count(), convs: await db.conversations.count() }
  assert.deepEqual(await resetLayout(), defaultLayout())
  assert.deepEqual(await loadLayout(), defaultLayout())
  assert.deepEqual({ chars: await db.characters.count(), msgs: await db.messages.count(), convs: await db.conversations.count() }, before)
  assert.deepEqual((await db.settings.get('profile'))!.value, { nickname: '小雪', signature: '' })
  assert.equal(db.verno, DB_SCHEMA_VERSION)
})

test('回归：拖动后紧接着保存页码，不会用旧布局覆盖刚移动的结果', async () => {
  const stale = await loadLayout()
  const moved = moveItem(stale, { area: 'page', page: 0, index: stale.pages[0].findIndex((x) => x.kind === 'app' && x.app === 'weather') }, { area: 'page', page: 1, index: 99 })!
  await saveLayout(moved)
  // 翻页后延迟触发的页码保存（以前会拿着拖动前的 stale 布局写回）
  await savePage(1)
  const now = await loadLayout()
  assert.equal(ids(now.pages[1]).at(-1), 'weather')
  assert.equal(now.page, 1)
})
