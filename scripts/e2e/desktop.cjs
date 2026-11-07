/**
 * 桌面浏览器交互测试（本地运行，不在 npm test / CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/desktop.cjs [截图目录]
 * 使用 Chromium 的 iPhone 13 模拟和真实的触摸事件（CDP），不能代替 iPhone Safari 真机测试。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) failed++
}

async function swipe(page, cdp, fromX, toX, y) {
  const steps = 8
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + ((toX - fromX) * i) / steps, y }] })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(700)
}
const current = (page) => page.evaluate(() => [...document.querySelectorAll('[role=tab]')].findIndex((t) => t.getAttribute('aria-selected') === 'true'))

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const cdp = await ctx.newCDPSession(page)

  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  // 准备一个有未读消息的会话
  await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('lingling-ai')
    r.onsuccess = () => {
      const tx = r.result.transaction(['characters', 'conversations'], 'readwrite')
      tx.objectStore('characters').put({ id: 'c1', name: '沈遥', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'default', permissions: { useStickers: true, postMoments: true }, createdAt: 1, updatedAt: 1 })
      tx.objectStore('conversations').put({ id: 'v1', type: 'single', characterIds: ['c1'], pinned: false, unread: 3, draft: '', lastMessagePreview: '在吗', lastMessageAt: Date.now(), createdAt: 1 })
      tx.oncomplete = res
    }
  }))
  await page.reload()
  await page.waitForSelector('[aria-label="Dock"]')
  check((await page.locator('[role=tab]').count()) === 3, '三个页面指示点')
  check((await current(page)) === 0, '默认停在第 1 页')
  check((await page.locator('[aria-label="Dock"] >> text=3').count()) === 1, 'Dock 上「消息」显示未读角标 3')
  if (shots) await page.screenshot({ path: `${shots}/desktop-1.png` })

  const dockBefore = await page.locator('[aria-label="Dock"]').boundingBox()
  await swipe(page, cdp, 340, 40, 400)
  check((await current(page)) === 1, '向左滑动到第 2 页')
  const dockAfter = await page.locator('[aria-label="Dock"]').boundingBox()
  check(JSON.stringify(dockBefore) === JSON.stringify(dockAfter), 'Dock 固定不动')
  await swipe(page, cdp, 340, 40, 400)
  check((await current(page)) === 2, '继续滑动到第 3 页')
  await swipe(page, cdp, 340, 40, 400)
  check((await current(page)) === 2, '第 3 页是最后一页')
  if (shots) await page.screenshot({ path: `${shots}/desktop-3.png` })
  await swipe(page, cdp, 40, 340, 400)
  check((await current(page)) === 1, '向右滑动回到第 2 页')

  // 打开第 2 页的应用，返回后仍在第 2 页
  await page.getByRole('button', { name: '主题装扮' }).click()
  await page.waitForURL(/#\/me\/theme$/)
  check(true, '打开「主题装扮」进入主题设置')
  await page.goBack()
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(300)
  check((await current(page)) === 1, '浏览器返回回到桌面，仍停在第 2 页')

  // Dock 进入消息；底部导航「桌面」回到桌面
  await page.locator('[aria-label="Dock"]').getByRole('button', { name: '消息' }).click()
  await page.waitForURL(/#\/messages$/)
  const listed = await page.getByText('沈遥').first().waitFor({ timeout: 3000 }).then(() => true, () => false)
  check(listed, 'Dock「消息」打开原来的消息列表')
  await page.getByRole('link', { name: '桌面' }).click()
  await page.waitForSelector('[aria-label="Dock"]')
  check(page.url().endsWith('#/'), '底部导航「桌面」回到桌面')

  // 每个应用都能打开
  const apps = await page.evaluate(() => [...document.querySelectorAll('[aria-label="桌面"] button[aria-label], [aria-label="Dock"] button[aria-label]')].map((b) => b.getAttribute('aria-label')))
  for (const name of apps) {
    await page.goto(BASE + '#/')
    await page.waitForSelector('[aria-label="Dock"]')
    const btn = page.locator(`button[aria-label="${name}"]`).first()
    await btn.evaluate((b) => b.scrollIntoView({ inline: 'start' }))
    await page.waitForTimeout(350)
    await btn.click()
    await page.waitForTimeout(400)
    const left = !page.url().endsWith('#/')
    check(left, `打开「${name}」→ ${page.url().split('#')[1]}`)
  }
  await page.goto(BASE + '#/app/nothing')
  check((await page.getByText('没有这个应用').count()) === 1, '不存在的应用如实说明')
  await page.goto(BASE + '#/app/music')
  await page.waitForTimeout(300)
  check(/#\/music$/.test(page.url()), '已完成应用的旧待开发地址进入真实页面')
  if (shots) await page.screenshot({ path: `${shots}/coming-soon.png` })

  // 深链接与刷新
  for (const [hash, text] of [['#/contacts', '联系人'], ['#/moments', '动态'], ['#/me', '我的'], ['#/memories', '记忆'], ['#/chat/v1', '沈遥']]) {
    await page.goto(BASE + hash)
    await page.reload()
    await page.waitForTimeout(500)
    check(page.url().endsWith(hash) && (await page.getByText(text).count()) > 0, `深链接并刷新：${hash}`)
  }
  await page.goto(BASE + '#/no-such-page')
  await page.waitForSelector('[aria-label="Dock"]')
  check(page.url().endsWith('#/'), '未知地址回到桌面')

  check(errors.length === 0, `没有运行时错误${errors.length ? '：' + errors.join(' | ') : ''}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
