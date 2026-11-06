/** 虚拟手机桌面 PR A：应用清单、默认布局、布局修复、每个已完成应用的路由真实存在、旧路由保留：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { APP_IDS, APPS, appHref } from '../src/desktop/apps'
import { cellsOf, defaultLayout, DEFAULT_DOCK, fits, GRID, normalizeLayout, type DesktopItem } from '../src/desktop/layout'

const appTsx = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const routes = [...appTsx.matchAll(/<Route\s+(?:index|path="([^"]*)")/g)].map((m) => (m[1] === undefined ? '' : m[1]))

/** 简单的路由匹配：支持 :param */
function routeExists(href: string): boolean {
  const path = href.split('?')[0].replace(/^\//, '')
  return routes.some((r) => {
    if (r === '*') return false
    const a = r.split('/')
    const b = path.split('/')
    return a.length === b.length && a.every((seg, i) => seg.startsWith(':') || seg === b[i])
  })
}

test('应用清单：包含指令要求的全部入口；已完成的应用都有真实路由，未完成的进入待开发页', () => {
  for (const name of ['消息', '联系人', '动态', '我的', '相册', '日记', '便签', '日历', '记忆', '音乐', '时钟', '天气', '信箱', '礼物', '塔罗', '主题装扮']) {
    assert.ok(APP_IDS.some((id) => APPS[id].name === name), `缺少应用：${name}`)
  }
  for (const id of APP_IDS) {
    const href = appHref(id)
    assert.ok(routeExists(href), `「${APPS[id].name}」的地址 ${href} 没有对应的页面`)
    if (!APPS[id].route) {
      assert.equal(href, `/app/${id}`)
      assert.ok(APPS[id].plan, `待开发应用「${APPS[id].name}」需要说明计划`)
    }
  }
  // 尚未开发的应用（第五阶段起相册、日记、便签、日历陆续上线）
  for (const id of ['music', 'clock', 'weather', 'mail', 'gift', 'tarot'] as const) assert.equal(APPS[id].route, null)
})

test('旧路由保留：联系人、动态、我的、聊天、角色、记忆、世界、世界书、设置、备份；消息改为 /messages，首页是桌面', () => {
  for (const p of ['/contacts', '/moments', '/me', '/moments/new', '/chat/x', '/character/x', '/character/x/memories', '/character/x/context', '/world/x', '/lorebook/x', '/me/api', '/me/theme', '/me/stickers', '/me/backup', '/import', '/lorebooks', '/messages', '/memories', '/app/music']) {
    assert.ok(routeExists(p), `路由缺失：${p}`)
  }
  assert.ok(routes.includes(''), '首页（桌面）')
  assert.match(appTsx, /<Route index element={<DesktopPage \/>} \/>/)
  assert.match(appTsx, /path="\*" element={<Navigate to="\/" replace \/>}/)
})

test('默认布局：三页、Dock 为消息 / 联系人 / 动态 / 我的；每个应用恰好出现一次；每页放得下', () => {
  const d = defaultLayout()
  assert.equal(d.pages.length, GRID.pages)
  assert.deepEqual(d.dock, DEFAULT_DOCK)
  const all = [...d.dock, ...d.pages.flat().flatMap((x) => (x.kind === 'app' ? [x.app] : []))]
  assert.deepEqual([...all].sort(), [...APP_IDS].sort())
  assert.ok(d.pages.every(fits))
  assert.equal(d.page, 0)
})

test('布局修复：损坏数据退回默认；去掉未知和重复的应用；缺失的应用补回；页码限制在范围内；Dock 最多 4 个', () => {
  assert.deepEqual(normalizeLayout(null), defaultLayout())
  assert.deepEqual(normalizeLayout('乱码'), defaultLayout())
  assert.deepEqual(normalizeLayout({ pages: 'x' }), defaultLayout())
  const n = normalizeLayout({
    pages: [[{ kind: 'app', app: 'diary' }, { kind: 'app', app: 'diary' }, { kind: 'app', app: 'nope' }], [{ kind: 'weird' }]],
    dock: ['messages', 'messages', 'me', 'moments', 'contacts', 'memory'],
    page: 9,
  })
  assert.deepEqual(n.dock, ['messages', 'me', 'moments', 'contacts'])
  assert.equal(n.pages.length, 3)
  assert.equal(n.page, 2)
  const apps = [...n.dock, ...n.pages.flat().flatMap((x) => (x.kind === 'app' ? [x.app] : []))]
  assert.equal(apps.length, APP_IDS.length, '每个应用恰好一次')
  assert.deepEqual(n.pages[0].find((x) => x.kind === 'app'), { kind: 'app', app: 'diary' })
  // 小组件：保留合法的，按占用格数限制每页容量
  const w = (id: string): DesktopItem => ({ kind: 'widget', id, widget: 'clock', size: 'medium' })
  const many = normalizeLayout({ version: 2, pages: [[w('a'), w('b'), w('c'), w('d'), w('a')]], dock: [] })
  assert.equal(many.pages[0].filter((x) => x.kind === 'widget').length, 3, '4×6 一页最多放 3 个 4×2 小组件')
  assert.equal(cellsOf(w('x')), 8)
})
