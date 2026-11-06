/**
 * 日历浏览器交互测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/calendar.cjs [截图目录]
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const pad = (n) => String(n).padStart(2, '0')
const seen = (loc) => loc.first().waitFor({ timeout: 4000 }).then(() => true, () => false)

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  // 角色与当天的一篇日记
  await page.evaluate((today) => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { const tx = r.result.transaction(['characters', 'diaries'], 'readwrite'); tx.objectStore('characters').put({ id: 'c1', name: '沈遥', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'default', permissions: { useStickers: true, postMoments: true }, createdAt: 1, updatedAt: 1 }); tx.objectStore('diaries').put({ id: 'd1', date: today, title: '初雪', body: '下雪了', tags: [], photoIds: [], aiReadable: false, createdAt: 1, updatedAt: 1 }); tx.oncomplete = res } }), today)

  await page.getByRole('button', { name: '日历' }).click()
  await page.waitForURL(/#\/calendar$/)
  check(true, '桌面「日历」图标打开日历')
  check(await seen(page.getByText('这一天没有日程')), '今天还没有日程')
  check(await seen(page.getByText('· 初雪')), '当天的日记出现在日历中')
  check(await seen(page.locator(`button[aria-label="${now.getMonth() + 1}月${now.getDate()}日"] [aria-label="有日记"]`)), '月历上标出有日记的日子')

  // 新建一个有时间、地点、每周重复的日程
  await page.getByRole('button', { name: '新建日程' }).click()
  await page.fill('input[placeholder^="例如：一起去看雪"]', '和沈遥视频')
  await page.getByText('全天').click()
  await page.locator('input[type=time]').first().fill('20:30')
  await page.locator('input[type=time]').nth(1).fill('20:00')
  await page.getByRole('button', { name: '保存' }).click()
  check((await page.getByText('结束时间不能早于开始时间').count()) === 1, '时间不合理时提示，不保存')
  await page.locator('input[type=time]').nth(1).fill('21:30')
  await page.locator('select').first().selectOption('weekly')
  await page.locator('input').filter({ hasNot: page.locator('[type]') }).last()
  await page.getByRole('button', { name: '＋ 关联已有日记' }).click()
  await page.getByText(/初雪 ·/).click()
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForURL(/#\/calendar\?date=/)
  check((await seen(page.getByText('和沈遥视频'))) && (await seen(page.getByText(/20:30 – 21:30/))), '保存后当天显示日程和时间')
  // 每周重复：7 天后也有
  const next = new Date(now); next.setDate(now.getDate() + 7)
  await page.getByRole('tab', { name: '日程' }).click()
  check((await page.getByText('和沈遥视频').count()) >= 8, '每周重复：未来 60 天内出现多次')
  await page.getByRole('tab', { name: '月' }).click()

  // 纪念日：关联角色
  await page.getByRole('button', { name: '新建日程' }).click()
  await page.getByRole('radio', { name: '纪念日' }).click()
  await page.fill('input[placeholder^="例如：第一次见面"]', '第一次见面')
  await page.locator('input[type=date]').fill(`${now.getFullYear() - 2}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
  await page.locator('select').nth(1).selectOption('met')
  await page.locator('select').nth(2).selectOption('c1')
  check((await page.getByText(/不会根据人设自动生成/).count()) === 1, '说明纪念日日期由用户填写')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForURL(/#\/calendar\?date=/)
  await page.goto(BASE + `#/calendar?date=${today}`)
  await page.waitForTimeout(500)
  check((await page.getByText(/纪念日 · 2 周年 · 沈遥/).count()) === 1, '今年的这一天显示「2 周年」和关联的角色')
  check((await page.getByText(`${now.getFullYear()}年${now.getMonth() + 1}月`, { exact: true }).count()) === 1, '回归：地址中的日期变化后，月历切换到那一个月')
  if (shots) await page.screenshot({ path: `${shots}/calendar-month.png`, fullPage: true })

  // 日程详情：关联日记入口、导出
  await page.getByText('和沈遥视频').click()
  check((await page.getByText(/· 初雪/).count()) === 1, '日程显示关联的日记')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出 .ics 文件' }).click()])
  const ics = require('fs').readFileSync(await dl.path(), 'utf8')
  check(/BEGIN:VEVENT/.test(ics) && /RRULE:FREQ=WEEKLY/.test(ics) && /SUMMARY:和沈遥视频/.test(ics), '导出标准 .ics（含每周重复）')
  check((await page.getByText(/选择「添加到日历」后才会出现在系统日历里/).count()) === 1, '明确说明没有自动同步到系统日历')
  await page.getByRole('button', { name: '复制快捷指令数据' }).click()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  check(/"syncedToSystemCalendar": false/.test(clip) && /"format": "lingling-event"/.test(clip), '快捷指令数据带「未同步」标记')
  if (shots) await page.screenshot({ path: `${shots}/calendar-event.png`, fullPage: true })
  // 从日程进入日记，日记里能看到关联的日程
  await page.getByRole('button', { name: /· 初雪/ }).click()
  await page.waitForURL(/#\/diary\/d1/)
  check(await seen(page.getByText('· 和沈遥视频')), '日记页面显示关联的日程')

  // 搜索、删除与恢复
  await page.goto(BASE + '#/calendar')
  await page.getByRole('tab', { name: '搜索' }).click()
  await page.fill('input[placeholder^="搜索"]', '视频')
  check((await page.getByText('和沈遥视频').count()) === 1, '搜索日程')
  await page.getByText('和沈遥视频').click()
  await page.getByRole('button', { name: '删除日程' }).click()
  await page.getByRole('button', { name: '删除' }).last().click()
  await page.waitForURL(/#\/calendar$/)
  await page.getByRole('tab', { name: '搜索' }).click()
  check((await page.getByText('最近删除').count()) === 1, '删除的日程进入最近删除')
  await page.getByRole('button', { name: '恢复' }).click()
  await page.getByRole('tab', { name: '月' }).click()
  await page.waitForTimeout(300)
  check((await page.getByText('和沈遥视频').count()) === 1, '恢复后重新出现')
  check(errors.length === 0, `没有运行时错误${errors.length ? '：' + errors.join(' | ') : ''}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
