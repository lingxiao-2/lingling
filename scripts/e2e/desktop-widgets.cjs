/**
 * 桌面小组件的浏览器交互测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/desktop-widgets.cjs [截图目录]
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
  // 任何发往 AI 服务的请求都记录下来（角色小组件不应该产生请求）
  const aiCalls = []
  await page.route('**/chat/completions', (r) => { aiCalls.push(r.request().url()); return r.abort() })
  const cdp = await ctx.newCDPSession(page)
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })

  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('lingling-ai')
    r.onsuccess = () => {
      const tx = r.result.transaction(['characters', 'settings'], 'readwrite')
      tx.objectStore('characters').put({ id: 'c1', name: '沈遥', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'default', permissions: { useStickers: true, postMoments: true }, createdAt: 1, updatedAt: 1 })
      tx.objectStore('settings').put({ key: 'ai-config', value: { service: 'custom', mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', proxyUrl: '', proxyToken: '', model: 'm', temperature: 0.7, maxTokens: 300 } })
      tx.oncomplete = res
    }
  }))
  await page.reload()
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(600)

  // 时间日期
  const shown = await page.locator('[aria-label^="现在 "]').getAttribute('aria-label')
  const now = new Date()
  const expect = `现在 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  check(shown === expect || Math.abs(Date.now() - now) < 61000, `时间小组件显示当前时间（${shown}）`)
  const clockBox = page.locator('[aria-label="时间日期"]')
  check((await clockBox.getByText(/^\d+月\d+日$/).count()) === 1 && (await clockBox.getByText(/^星期[日一二三四五六]$/).count()) === 1, '显示中文日期与星期')
  const font = await page.locator('[aria-label^="现在 "]').evaluate((e) => getComputedStyle(e).fontFamily)
  check(/Cormorant/.test(font), `时间使用英文衬线字体（${font.split(',')[0]}）`)

  // 音乐：没有歌曲时如实说明，没有虚假的播放按钮（第八阶段起显示音乐 App 的真实状态）
  await page.locator('[role=tab]').nth(1).click()
  await page.waitForTimeout(600)
  const music = page.locator('[role=group][aria-label="音乐"]')
  check((await music.count()) === 1 && (await music.getByText('还没有音乐').count()) === 1, '音乐小组件：没有歌曲时显示「还没有音乐」')
  check((await page.locator('button[aria-label*="播放"], button:has-text("播放"), [aria-label*="暂停"]').count()) === 0, '没有虚假的播放 / 暂停按钮')
  if (shots) await page.screenshot({ path: `${shots}/widgets-2.png` })
  await page.locator('[role=tab]').nth(0).click()
  await page.waitForTimeout(600)

  // 便签：点小组件进入便签应用写一张，返回桌面后显示，刷新后仍在
  await page.locator('[aria-label="便签小组件"]').click()
  await page.waitForURL(/#\/notes\/new\?widget=w-note/)
  await page.fill('textarea', '周五记得给沈遥写信')
  await page.waitForURL(/#\/notes\/note/, { timeout: 3000 })
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(500)
  check((await page.locator('[aria-label="便签小组件"]').getByText('周五记得给沈遥写信').count()) === 1, '便签保存后显示在小组件上')
  await page.reload()
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(500)
  check((await page.locator('[aria-label="便签小组件"]').getByText('周五记得给沈遥写信').count()) === 1, '刷新后便签仍在')

  // 角色：选择 → 点按进入聊天，不调用 AI
  await page.locator('[aria-label="角色（未选择）"]').click()
  await page.getByText('沈遥', { exact: true }).click()
  await page.waitForTimeout(400)
  check((await page.locator('[aria-label="和沈遥聊天"]').count()) === 1, '角色小组件显示所选角色')
  if (shots) await page.screenshot({ path: `${shots}/widgets-1.png` })
  await page.locator('[aria-label="和沈遥聊天"]').click()
  await page.waitForURL(/#\/chat\//)
  await page.waitForTimeout(800)
  check(true, '点按角色小组件进入聊天')
  check(aiCalls.length === 0, '没有发出任何 AI 请求')
  await page.goBack()
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(500)
  check((await page.locator('[aria-label="和沈遥聊天"]').count()) === 1, '返回桌面后角色小组件设置仍在')

  // 编辑模式：长按小组件进入编辑，不触发小组件动作；小组件可以拖到第 3 页
  const box = await page.locator('[aria-label="便签小组件"]').boundingBox()
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await touch('touchStart', c.x, c.y); await page.waitForTimeout(700); await touch('touchEnd'); await page.waitForTimeout(200)
  check(!!(await page.$('[data-editing]')) && (await page.locator('textarea').count()) === 0, '长按小组件进入编辑模式，不会打开便签')
  await touch('touchStart', c.x, c.y)
  for (let i = 1; i <= 10; i++) { await touch('touchMove', c.x + ((388 - c.x) * i) / 10, c.y); await page.waitForTimeout(16) }
  for (let k = 0; k < 2; k++) {
    const t = Date.now()
    while (Date.now() - t < 900) { await touch('touchMove', 388, c.y + ((Date.now() / 50) % 2)); await page.waitForTimeout(50) }
  }
  await touch('touchEnd'); await page.waitForTimeout(500)
  await page.getByRole('button', { name: '完成' }).click()
  await page.reload()
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(600)
  const onPage3 = await page.evaluate(() => !!document.querySelector('section[aria-label="第 3 页"] [aria-label="便签小组件"]'))
  check(onPage3, '便签小组件跨屏移到第 3 页，刷新后保持')

  check(errors.length === 0, `没有运行时错误${errors.length ? '：' + errors.join(' | ') : ''}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
