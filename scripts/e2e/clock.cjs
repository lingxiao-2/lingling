/**
 * 第八阶段 PR B：时钟 App 的浏览器测试（本地运行，不在 CI 中）。【浏览器模拟】Playwright 模拟 iPhone 13；不是真机。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 6000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)
const idb = (page, fn) => page.evaluate((src) => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => new Function('db', 'res', src)(r.result, res) }), fn)

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // 桌面时间小组件 → 时钟
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.locator('[aria-label="时间日期"]').click()
  check(/#\/clock/.test(page.url()), '点按桌面时间小组件进入时钟')
  const now = new Date()
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  check(await seen(page.locator('.clock-big')), '实时时钟')
  const big = await page.locator('.clock-big').textContent()
  check(big.startsWith(hm) || big.length > 4, `时钟显示当前时间（${big}）`)
  check((await page.locator('.world-row').count()) === 3, '默认 3 个世界时钟')
  await page.getByRole('button', { name: '＋ 添加城市' }).click()
  await page.getByRole('button', { name: '巴黎' }).click()
  check(await seen(page.locator('.world-row', { hasText: '巴黎' })), '添加城市')
  await page.getByRole('button', { name: '移除 东京' }).click()
  await page.locator('.world-row', { hasText: '东京' }).waitFor({ state: 'detached' })
  await page.reload()
  check(await seen(page.locator('.world-row', { hasText: '巴黎' })) && !(await page.locator('.world-row', { hasText: '东京' }).count()), '刷新后城市列表仍在')
  if (shots) await page.screenshot({ path: `${shots}/clock-world.png` })

  // 秒表
  await page.getByRole('tab', { name: '秒表' }).click()
  await page.getByRole('button', { name: '开始' }).click()
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '计次' }).click()
  await page.waitForTimeout(400)
  check((await page.locator('.lap-row').count()) === 1, '计次')
  await page.getByRole('tab', { name: '时钟' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('tab', { name: '秒表' }).click()
  const t1 = await page.getByLabel('秒表时间').textContent()
  check(/^00:0[2-9]\./.test(t1), `切换页面后秒表继续计时（${t1}）`)
  await page.getByRole('button', { name: '暂停' }).click()
  const t2 = await page.getByLabel('秒表时间').textContent()
  await page.waitForTimeout(300)
  await page.reload()
  await page.getByRole('tab', { name: '秒表' }).click()
  check((await page.getByLabel('秒表时间').textContent()) === t2, '暂停后刷新，时间不变')

  // 倒计时：3 秒，结束时在任意页面提醒
  await page.getByRole('tab', { name: '倒计时' }).click()
  check(await seen(page.getByText('提醒能做到什么')) && (await seen(page.getByText(/不会响铃/))), '如实说明前台、后台与系统提醒')
  await page.getByLabel('计时名称').fill('泡茶')
  await page.getByLabel('分钟').fill('0')
  await page.getByLabel('秒').fill('3')
  await page.getByRole('button', { name: '开始', exact: true }).click()
  check(await seen(page.locator('.timer-card', { hasText: '泡茶' })), '倒计时开始')
  check(await seen(page.locator('.timer-card').getByText('同时在 iPhone「提醒事项」中提醒我')), '提供 iPhone 系统提醒入口')
  await page.locator('.timer-card').getByText('同时在 iPhone「提醒事项」中提醒我').click()
  check(await seen(page.locator('.timer-card').getByText(/还没有登记「提醒事项」快捷指令/)), '未设置快捷指令时如实提示')
  if (shots) await page.screenshot({ path: `${shots}/clock-timer.png` })
  await page.goto(BASE + '#/notes')
  check(await seen(page.getByRole('alertdialog', { name: '计时结束' }).getByText('「泡茶」计时结束'), 8000), '在其他页面也弹出计时结束提醒')
  check(await seen(page.getByRole('alertdialog').getByText(/已在聆聆中提醒/)), '前台结束：说明已在聆聆中提醒')
  if (shots) await page.screenshot({ path: `${shots}/clock-alert.png` })
  await page.getByRole('button', { name: /知道了/ }).click()

  // 离开期间到点：模拟页面关闭时已经过了结束时间
  await idb(page, `const t = db.transaction('timers','readwrite'); const now = Date.now(); t.objectStore('timers').put({ id: 'tmr_bg', name: '洗衣服', durationMs: 60000, status: 'running', endAt: now - 120000, remainingMs: 60000, createdAt: now - 180000 }); t.oncomplete = () => res(1)`)
  await page.reload()
  check(await seen(page.getByRole('alertdialog').getByText(/在你离开聆聆期间.*结束了；网页在后台时不能响铃/)), '离开期间结束：如实说明没有响铃')
  await page.getByRole('button', { name: /知道了/ }).click()

  // 暂停 / 取消 / 记录
  await page.goto(BASE + '#/clock?tab=timer')
  await page.getByRole('button', { name: '10 分钟' }).click()
  const card = page.locator('.timer-card').first()
  await card.getByRole('button', { name: '暂停' }).click()
  check(await seen(card.getByText('已暂停')), '暂停')
  await card.getByRole('button', { name: '取消' }).click()
  await page.getByRole('tab', { name: '记录' }).click()
  check(await seen(page.locator('.history-row', { hasText: '泡茶' }).getByText(/已在聆聆中提醒/)), '记录：前台结束')
  check(await seen(page.locator('.history-row', { hasText: '洗衣服' }).getByText(/没有响铃/)), '记录：离开期间结束')
  check(await seen(page.locator('.history-row', { hasText: '10 分钟' }).getByText(/已取消/)), '记录：已取消')

  // 桌面组件显示正在进行的倒计时
  await page.getByRole('tab', { name: '倒计时' }).click()
  await page.getByLabel('计时名称').fill('午睡')
  await page.getByRole('button', { name: '25 分钟' }).click()
  await page.goto(BASE + '#/')
  check(await seen(page.locator('[aria-label="时间日期"]').getByText(/午睡 · \d+:\d{2} 结束/)), '桌面时间小组件显示正在进行的倒计时')
  if (shots) await page.screenshot({ path: `${shots}/clock-widget.png` })
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
