/**
 * 桌面编辑与持久化的浏览器交互测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/desktop-edit.cjs [截图目录]
 * Chromium 模拟 iPhone 13 + CDP 真实触摸事件；不能代替 iPhone Safari 真机测试。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failed++
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const cdp = await ctx.newCDPSession(page)
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  const center = async (name) => {
    const b = await page.locator(`button[aria-label="${name}"]`).first().boundingBox()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const longPress = async (name, ms = 700) => {
    const c = await center(name)
    await touch('touchStart', c.x, c.y)
    await page.waitForTimeout(ms)
    await touch('touchEnd')
    await page.waitForTimeout(150)
  }
  const dragTo = async (from, to, holdMs = 0) => {
    await touch('touchStart', from.x, from.y)
    await page.waitForTimeout(60)
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
      await page.waitForTimeout(16)
    }
    if (holdMs) {
      // 在边缘停留时持续发送轻微移动（真实手指也会有抖动）
      const t = Date.now()
      while (Date.now() - t < holdMs) {
        await touch('touchMove', to.x, to.y + ((Date.now() / 50) % 2))
        await page.waitForTimeout(50)
      }
    }
    await touch('touchEnd')
    await page.waitForTimeout(400)
  }
  const order = (pageIndex) => page.evaluate((i) => [...document.querySelectorAll(`section[aria-label="第 ${i + 1} 页"] button[aria-label]`)].map((b) => b.getAttribute('aria-label')), pageIndex)
  const dock = () => page.evaluate(() => [...document.querySelectorAll('[aria-label="Dock"] button[aria-label]')].map((b) => b.getAttribute('aria-label')))
  const editing = () => page.evaluate(() => !!document.querySelector('[data-editing]'))
  const current = () => page.evaluate(() => [...document.querySelectorAll('[role=tab]')].findIndex((t) => t.getAttribute('aria-selected') === 'true'))

  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(500)

  // 1. 短按打开应用；滑动不会进入编辑模式
  await page.locator('button[aria-label="记忆"]').click()
  await page.waitForURL(/#\/memories$/)
  check(true, '短按打开应用')
  await page.goBack()
  await page.waitForSelector('[aria-label="Dock"]')
  const c0 = await center('记忆')
  await touch('touchStart', c0.x, c0.y)
  for (let i = 1; i <= 10; i++) { await touch('touchMove', c0.x - i * 25, c0.y); await page.waitForTimeout(40) }
  await page.waitForTimeout(500)
  await touch('touchEnd')
  await page.waitForTimeout(700)
  check(!(await editing()), '按住图标滑动：是翻页，不会进入编辑模式')
  check((await current()) === 1, '从图标上开始滑动也能翻页')
  await page.locator('[role=tab]').nth(0).click()
  await page.waitForTimeout(600)

  // 2. 长按进入编辑模式，且不会打开应用
  await longPress('日记')
  check(await editing(), '长按进入编辑模式')
  check(page.url().endsWith('#/'), '长按不会误打开应用')
  check((await page.getByRole('button', { name: '完成' }).count()) === 1, '显示「完成」按钮')
  // 编辑模式下点按不打开
  const cd = await center('日历')
  await touch('touchStart', cd.x, cd.y); await page.waitForTimeout(80); await touch('touchEnd')
  await page.waitForTimeout(400)
  check(page.url().endsWith('#/'), '编辑模式下点按图标不会打开应用')

  // 3. 页内拖动
  const before = await order(0)
  await dragTo(await center('记忆'), await center('便签'))
  const after = await order(0)
  check(after.indexOf('记忆') === before.indexOf('便签') && after[0] === '相册', `页内拖动：${before.slice(0, 4).join(' ')} → ${after.slice(0, 4).join(' ')}`)
  if (shots) await page.screenshot({ path: `${shots}/edit-mode.png` })

  // 4. 拖到右边缘停留，翻到第 2 页并放下
  const from = await center('天气')
  await dragTo(from, { x: 388, y: 300 }, 900)
  check((await current()) === 1, '拖到屏幕边缘停留会翻到下一页')
  const p2 = await order(1)
  check(p2.includes('天气') && !(await order(0)).includes('天气'), `跨屏移动：「天气」移到第 2 页（${p2.join(' ')}）`)

  // 5. 拖进 Dock（已满，互换）
  await dragTo(await center('天气'), await center('动态'))
  const d = await dock()
  check(d.includes('天气') && !d.includes('动态') && (await order(1)).includes('动态'), `拖进已满的 Dock 互换：${d.join(' ')}`)

  // 6. 完成 → 刷新后布局和页码保持
  await page.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(800)
  check(!(await editing()), '点「完成」退出编辑模式')
  const snapshot = { p0: await order(0), p1: await order(1), dock: await dock(), page: await current() }
  await page.reload()
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(800)
  const reloaded = { p0: await order(0), p1: await order(1), dock: await dock(), page: await current() }
  check(JSON.stringify(snapshot) === JSON.stringify(reloaded), `刷新后布局、Dock、页码不变（第 ${reloaded.page + 1} 页）`)
  // 打开应用再返回也不变
  await page.locator('[aria-label="Dock"] button[aria-label="天气"]').click()
  await page.waitForURL(/#\/app\/weather$/)
  await page.goBack()
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(500)
  check(JSON.stringify(await dock()) === JSON.stringify(snapshot.dock), '离开再回来，布局不变')

  // 7. 恢复默认
  await longPress('天气')
  await page.getByRole('button', { name: '恢复默认' }).click()
  await page.getByRole('button', { name: '恢复默认' }).last().click()
  await page.waitForTimeout(800)
  check(JSON.stringify(await dock()) === JSON.stringify(['消息', '联系人', '动态', '我的']) && (await order(0))[0] === '记忆', '恢复默认布局')

  check(errors.length === 0, `没有运行时错误${errors.length ? '：' + errors.join(' | ') : ''}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
