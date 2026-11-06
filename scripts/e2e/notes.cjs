/**
 * 便签浏览器交互测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/notes.cjs [截图目录]
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const widget = (page) => page.locator('[aria-label="便签小组件"]')

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // 先打开一个不会触发迁移的页面，写入旧版桌面便签（模拟第四阶段的用户数据），再第一次进入桌面
  await page.goto(BASE + '#/me')
  await page.waitForTimeout(800)
  // 旧版桌面便签（第四阶段保存的）
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { const tx = r.result.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'desktop-note', value: { text: '旧版的桌面便签', updatedAt: Date.now() } }); tx.oncomplete = res } }))
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(800)
  check((await widget(page).getByText('旧版的桌面便签').count()) === 1, '旧版桌面便签迁移后仍显示在小组件上')

  await page.getByRole('button', { name: '便签', exact: true }).click()
  await page.waitForURL(/#\/notes$/)
  check((await page.getByText('旧版的桌面便签').count()) === 1, '旧版便签出现在便签应用中')
  // 新建一张清单
  await page.getByRole('button', { name: '新建便签' }).click()
  await page.fill('input[placeholder="标题（可不填）"]', '周末')
  await page.getByRole('radio', { name: '清单' }).click()
  await page.getByRole('button', { name: '＋ 添加一项' }).click()
  await page.locator('input[placeholder="新的一项"]').last().fill('买洋桔梗')
  await page.keyboard.press('Enter')
  await page.locator('input[placeholder="新的一项"]').last().fill('去看雪')
  await page.getByRole('checkbox', { name: /完成：买洋桔梗/ }).check()
  await page.getByRole('radio', { name: '冰蓝' }).click()
  await page.getByText('置顶').click()
  await page.waitForTimeout(700)
  check(/#\/notes\/note/.test(page.url()), '清单便签自动保存')
  await page.getByRole('button', { name: '显示在桌面' }).click()
  await page.waitForTimeout(300)
  check((await page.getByText('这张便签正显示在桌面上').count()) === 1, '设为桌面便签')
  if (shots) await page.screenshot({ path: `${shots}/note-editor.png` })
  // 列表：置顶在前、搜索
  await page.goto(BASE + '#/notes')
  await page.waitForTimeout(400)
  const first = await page.locator('.note-card').first().innerText()
  check(/周末/.test(first) && /置顶/.test(first), '置顶的便签排在最前')
  check(/完成 1 \/ 2/.test(first), '显示清单完成进度')
  await page.fill('input[placeholder="搜索便签"]', '洋桔梗')
  check((await page.locator('.note-card').count()) === 1, '搜索清单项')
  await page.fill('input[placeholder="搜索便签"]', '')
  if (shots) await page.screenshot({ path: `${shots}/notes-list.png` })

  // 桌面同步
  await page.goto(BASE + '#/')
  await page.waitForTimeout(600)
  check((await widget(page).getByText('买洋桔梗').count()) === 1 && (await widget(page).getByText('☑ 买洋桔梗').count()) === 1, '桌面小组件显示这张清单（已完成项打勾）')
  if (shots) await page.screenshot({ path: `${shots}/desktop-note-widget.png` })
  await widget(page).click()
  await page.waitForURL(/#\/notes\/note/)
  check((await page.locator('input[placeholder="标题（可不填）"]').inputValue()) === '周末', '点小组件进入对应便签')
  await page.locator('input[placeholder="新的一项"]').last().fill('去看初雪')
  await page.waitForTimeout(700)
  await page.goto(BASE + '#/')
  await page.waitForTimeout(600)
  check((await widget(page).getByText('去看初雪').count()) === 1, '编辑后桌面小组件同步更新')

  // 删除 → 小组件空状态 → 点按选择另一张
  await widget(page).click()
  await page.waitForURL(/#\/notes\/note/)
  await page.getByRole('button', { name: '删除便签' }).click()
  await page.getByRole('button', { name: '删除' }).last().click()
  await page.waitForURL(/#\/notes$/)
  await page.goto(BASE + '#/')
  await page.waitForTimeout(600)
  check((await widget(page).getByText(/已删除/).count()) === 1, '删除后小组件显示「已删除」')
  await widget(page).click()
  await page.waitForURL(/pickFor=w-note/)
  await page.getByText('旧版的桌面便签').click()
  await page.waitForURL(/#\/$/)
  await page.waitForTimeout(500)
  check((await widget(page).getByText('旧版的桌面便签').count()) === 1, '从便签列表重新选择一张显示在桌面')
  // 恢复
  await page.goto(BASE + '#/notes/trash')
  await page.getByRole('button', { name: '恢复' }).click()
  await page.goto(BASE + '#/notes')
  await page.waitForTimeout(400)
  check((await page.locator('.note-card').count()) === 2, '从最近删除恢复')
  // 桌面布局其他部分未受影响
  const dock = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { const q = r.result.transaction('settings').objectStore('settings').get('desktop-layout'); q.onsuccess = () => res(q.result.value.dock) } }))
  check(JSON.stringify(dock) === JSON.stringify(['messages', 'contacts', 'moments', 'me']), '桌面布局的其他部分不受影响')
  check(errors.length === 0, `没有运行时错误${errors.length ? '：' + errors.join(' | ') : ''}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
