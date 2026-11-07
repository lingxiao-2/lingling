/**
 * 第七阶段 PR B：提醒事项 / 系统日历 / 打开应用的浏览器测试（本地运行，不在 CI 中）。
 * 【浏览器模拟】Playwright 模拟 iPhone 13，用测试钩子记录要打开的链接并模拟回跳；**不是真机测试**。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 5000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)
const idb = (page, fn) => page.evaluate((src) => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => new Function('db', 'res', src)(r.result, res) }), fn)

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  await ctx.addInitScript(() => { window.__LINGLING_TEST_OPEN__ = (u) => localStorage.setItem('__opened', JSON.stringify([...JSON.parse(localStorage.getItem('__opened') || '[]'), u])) })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const opened = () => page.evaluate(() => JSON.parse(localStorage.getItem('__opened') || '[]'))
  const reg = async (name, purpose) => {
    await page.getByLabel('快捷指令名称').fill(name)
    await page.getByLabel('用途').selectOption(purpose)
    await page.getByRole('button', { name: '登记', exact: true }).click()
    await seen(page.locator('.registered-shortcut', { hasText: name }))
  }
  await page.goto(BASE + '#/me/iphone')
  await page.waitForSelector('.iphone-actions')
  const box = page.locator('.iphone-actions')

  // 未登记
  await box.getByLabel('标题').fill('去买东西')
  await box.getByRole('button', { name: '生成执行计划' }).click()
  check(await seen(box.getByRole('alert').filter({ hasText: '还没有登记「提醒事项」快捷指令' })), '未登记提醒事项快捷指令时如实提示')
  check(await seen(page.getByText('「聆聆提醒事项」· 创建 iPhone 提醒事项')), '提供创建提醒事项快捷指令的步骤')

  // 提醒事项
  await reg('聆聆提醒事项', 'reminder')
  await reg('聆聆日历', 'calendar')
  await box.getByLabel('提醒时间').fill('15:00')
  await box.getByRole('button', { name: '生成执行计划' }).click()
  const card = box.locator('.shortcut-run')
  check(await seen(card.getByText('标题：去买东西')) && (await seen(card.getByText(/提醒时间：.*15:00/))), '计划显示标题与具体日期时间')
  check(await seen(card.getByText(/iPhone 的「提醒事项」App，不是聆聆/)), '明确写入 iPhone 提醒事项而不是聆聆')
  if (shots) await page.screenshot({ path: `${shots}/iphone-reminder-plan.png` })
  await card.getByRole('button', { name: '打开快捷指令' }).dblclick()
  await page.waitForTimeout(300)
  let urls = await opened()
  check(urls.length === 1, `双击只打开一次（${urls.length}）`)
  const u = new URL(urls[0].replace('shortcuts://', 'https://'))
  const payload = JSON.parse(u.searchParams.get('text'))
  check(u.searchParams.get('name') === '聆聆提醒事项' && payload.type === 'reminder' && payload.title === '去买东西' && / 15:00$/.test(payload.due), '传给快捷指令的内容正确')
  check(await seen(card.getByText('已发起')), '打开后：已发起（不是成功）')

  // 重复
  await box.getByRole('button', { name: '生成执行计划' }).click()
  check(await seen(box.getByRole('alert').filter({ hasText: '10 分钟内已经发起过同样的操作' })), '重复的提醒被拦下')
  check(await seen(box.getByText('我确定要再执行一次')), '可以明确选择再执行一次')

  // 回跳成功
  await page.goto(u.searchParams.get('x-success') + '?result=ok')
  check(await seen(page.getByText('已确认完成')), '快捷指令回跳后：已确认完成')

  // 系统日历：失败回跳不显示成功
  await page.goto(BASE + '#/me/iphone')
  await page.waitForSelector('.iphone-actions')
  await box.getByRole('tab', { name: '系统日历' }).click()
  await box.getByLabel('标题').fill('面试')
  await box.getByLabel('开始时间').fill('10:00')
  await box.getByLabel('地点').fill('星光大厦')
  await box.getByRole('button', { name: '生成执行计划' }).click()
  check(await seen(card.getByText(/iPhone 的系统「日历」App，不是聆聆的日历/)), '明确是 iPhone 系统日历')
  check(await seen(card.getByText(/默认 1 小时/)), '没有结束时间时说明默认 1 小时')
  await card.getByRole('button', { name: '打开快捷指令' }).click()
  await page.waitForTimeout(300)
  urls = await opened()
  const c = new URL(urls[1].replace('shortcuts://', 'https://'))
  check(JSON.parse(c.searchParams.get('text')).location === '星光大厦', '日历事件内容正确')
  await page.goto(c.searchParams.get('x-error') + '?errorMessage=' + encodeURIComponent('没有访问日历的权限'))
  check(await seen(page.getByText('执行失败')) && !(await page.getByText('已确认完成').count()), '失败回跳：执行失败，不显示成功')
  const ev = await idb(page, `const r = db.transaction('events').objectStore('events').count(); r.onsuccess = () => res(r.result)`)
  check(ev === 0, '聆聆自己的日历没有被写入')

  // 打开应用
  await page.goto(BASE + '#/me/iphone')
  await page.waitForSelector('.iphone-actions')
  await box.getByRole('tab', { name: '打开应用' }).click()
  await box.getByLabel('应用').selectOption('calendar')
  await box.getByRole('button', { name: '生成执行计划' }).click()
  await card.getByRole('button', { name: '打开', exact: true }).click()
  await page.waitForTimeout(300)
  check((await opened())[2] === 'calshow://', '打开日历：calshow://')
  await box.getByLabel('应用').selectOption('safari')
  await box.getByLabel('网址').fill('javascript:alert(1)')
  await box.getByRole('button', { name: '生成执行计划' }).click()
  check(await seen(box.getByRole('alert').filter({ hasText: '网址不正确' })) || (await seen(box.getByRole('alert').filter({ hasText: '只能打开 https' }))), '拒绝非 https 网址')

  // 页面切换后状态一致
  await page.goto(BASE + '#/me')
  await page.goto(BASE + '#/me/iphone')
  check(await seen(page.locator('.run-row', { hasText: '已确认完成' })) && (await seen(page.locator('.run-row', { hasText: '执行失败' }))), '切换页面后运行状态一致')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
