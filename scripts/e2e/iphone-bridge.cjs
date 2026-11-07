/**
 * 第七阶段 PR A：「连接真实 iPhone」的浏览器测试（本地运行，不在 CI 中）。
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/iphone-bridge.cjs [截图目录]
 * 【浏览器模拟】Playwright 模拟 iPhone 13；无法真的打开快捷指令 App，所以用测试钩子记录要打开的链接，
 * 再模拟快捷指令的回跳地址。这不是真机测试，真机步骤见 docs/iphone-shortcuts.md。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 5000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  await ctx.addInitScript(() => { window.__LINGLING_TEST_OPEN__ = (u) => { localStorage.setItem('__opened', JSON.stringify([...(JSON.parse(localStorage.getItem('__opened') || '[]')), u])) } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const opened = () => page.evaluate(() => JSON.parse(localStorage.getItem('__opened') || '[]'))

  await page.goto(BASE + '#/me')
  await page.getByText('连接真实 iPhone').click()
  check(await seen(page.getByText(/iPhone \/ iPad · iOS/)), '识别为 iPhone')
  check(await seen(page.getByText('可以尝试（需要测试）')), '快捷指令链接：可以尝试（需要测试），不声称一定可用')
  check(await seen(page.getByText('请先创建并登记用途为「测试连接」的快捷指令。')), '未登记时不能测试')
  check((await page.getByRole('button', { name: /安装/ }).count()) === 0, '没有无法使用的「安装」按钮')

  // 登记
  await page.getByLabel('快捷指令名称').fill('聆聆测试')
  await page.getByRole('button', { name: '登记', exact: true }).click()
  check(await seen(page.locator('.registered-shortcut', { hasText: '聆聆测试' })), '登记到白名单')
  await page.reload()
  check(await seen(page.locator('.registered-shortcut', { hasText: '聆聆测试' })), '刷新后白名单仍在')

  // 测试连接：准备 → 等待确认 → 打开
  await page.getByRole('button', { name: '准备测试' }).click()
  const card = page.locator('.shortcut-run').first()
  check(await seen(card.getByText('等待确认')), '状态：等待确认')
  check((await opened()).length === 0, '确认前没有打开任何链接')
  if (shots) await page.screenshot({ path: `${shots}/iphone-test-await.png` })
  await card.getByRole('button', { name: '打开快捷指令' }).click()
  await card.getByRole('button', { name: '打开快捷指令' }).click({ timeout: 500 }).catch(() => {})
  await page.waitForTimeout(300)
  const urls = await opened()
  check(urls.length === 1, `连点只打开一次（${urls.length}）`)
  check(await seen(card.getByText('已发起')), '状态：已发起（不是成功）')
  const u = new URL(urls[0].replace('shortcuts://', 'https://'))
  check(urls[0].startsWith('shortcuts://x-callback-url/run-shortcut?') && u.searchParams.get('name') === '聆聆测试' && u.searchParams.get('input') === 'text', '链接格式：x-callback-url / run-shortcut / name / input=text')
  const text = u.searchParams.get('text')
  const success = new URL(u.searchParams.get('x-success'))
  check(success.origin + success.pathname === new URL(BASE).origin + new URL(BASE).pathname && success.searchParams.get('lingling_cb') === 'ok', '回跳地址指向聆聆')

  // 模拟快捷指令成功回跳（用「?」追加 result）
  await page.goto(`${success.toString()}?result=${encodeURIComponent(text)}`)
  check(await seen(page.getByText('已确认完成')), '成功回跳后：已确认完成')
  check(await seen(page.locator('.test-verdict', { hasText: '传入参数' })), '参数原样交回：显示接收正确')
  check(!page.url().includes('lingling_cb'), '地址栏中的回跳参数已去掉')
  if (shots) await page.screenshot({ path: `${shots}/iphone-test-done.png` })
  // 重放同一个回跳不会改变结果
  await page.goto(`${success.toString().replace('lingling_cb=ok', 'lingling_cb=error')}`)
  check(await seen(page.getByText('已确认完成')), '重放的回跳不改变结果')

  // 伪造校验码
  await page.goto(BASE + '#/me/iphone')
  await page.getByRole('button', { name: '准备测试' }).click()
  await page.locator('.shortcut-run').first().getByRole('button', { name: '打开快捷指令' }).click()
  await page.waitForTimeout(300)
  const u2 = new URL((await opened())[1].replace('shortcuts://', 'https://'))
  const ok2 = new URL(u2.searchParams.get('x-success'))
  ok2.searchParams.set('k', 'forgedforgedforged')
  await page.goto(ok2.toString())
  check(await seen(page.getByText(/校验失败的回跳，已忽略/)), '校验码不对：提示已忽略')
  check(await seen(page.locator('.run-row', { hasText: '已发起' })), '校验码不对的回跳不改变状态（仍为已发起）')
  // 出错回跳
  await page.goto(u2.searchParams.get('x-error') + '?errorMessage=' + encodeURIComponent('找不到快捷指令'))
  check(await seen(page.getByText('执行失败')) && (await seen(page.getByText(/找不到快捷指令/))), '出错回跳：执行失败并显示原因')

  // 来自其他环境（找不到的运行）
  await page.goto(BASE + '?lingling_cb=ok&run=run_from_pwa&k=abcdef1234567890')
  check(await seen(page.getByText(/找不到对应的运行/)), '找不到的运行：如实说明，不显示成功')

  // 取消
  await page.goto(BASE + '#/me/iphone')
  await page.getByRole('button', { name: '准备测试' }).click()
  await page.locator('.shortcut-run').first().getByRole('button', { name: '取消' }).click()
  check(await seen(page.locator('.shortcut-run').getByText('已取消')), '确认前取消：已取消')
  check((await opened()).length === 2, '取消后没有打开链接')
  await page.reload()
  check(await seen(page.locator('.run-row', { hasText: '执行失败' })) && (await seen(page.locator('.run-row', { hasText: '已确认完成' }))) && (await seen(page.locator('.run-row', { hasText: '已取消' }))), '刷新后运行记录与状态一致')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
