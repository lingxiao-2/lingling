/**
 * 日记浏览器交互测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/diary.cjs [截图目录]
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const rows = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { const q = r.result.transaction('diaries').objectStore('diaries').getAll(); q.onsuccess = () => res(q.result) } }))

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  // 准备一张照片
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { const tx = r.result.transaction(['photos', 'photoBlobs'], 'readwrite'); const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d'); x.fillStyle = '#9ec5e8'; x.fillRect(0, 0, 40, 40); const thumb = c.toDataURL('image/jpeg'); tx.objectStore('photos').put({ id: 'p1', name: '初雪', note: '', width: 40, height: 40, mime: 'image/jpeg', bytes: 10, originalBytes: 10, originalType: 'image/jpeg', thumb, createdAt: Date.now(), updatedAt: Date.now() }); tx.objectStore('photoBlobs').put({ id: 'p1', blob: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }) }); tx.oncomplete = res } }))

  await page.getByRole('button', { name: '日记' }).click()
  await page.waitForURL(/#\/diary$/)
  check(true, '桌面「日记」图标打开日记')
  await page.getByRole('button', { name: '写日记' }).click()
  await page.waitForURL(/#\/diary\/new/)
  await page.waitForTimeout(900)
  check((await rows(page)).length === 0, '打开空白的新日记不会保存')
  await page.fill('input[placeholder="标题"]', '初雪')
  await page.fill('textarea[placeholder="今天……"]', '下班路上第一次看到雪，想起去年冬天。')
  await page.getByRole('radio', { name: '温柔' }).click()
  await page.fill('input[placeholder^="标签"]', '初雪 冬天')
  await page.locator('input[placeholder="标题"]').click()
  await page.waitForTimeout(900)
  check(/#\/diary\/dia/.test(page.url()), '写下内容后自动保存，地址变成这篇日记')
  check((await page.getByText(/已自动保存/).count()) === 1, '显示「已自动保存」')
  let r = await rows(page)
  check(r.length === 1 && r[0].title === '初雪' && r[0].mood === 'tender' && r[0].tags.join() === '初雪,冬天', '标题、心情、标签已保存')
  check(r[0].aiReadable === false, '默认不允许 AI 读取')
  // 关联照片
  await page.getByRole('button', { name: '＋ 关联照片' }).click()
  await page.locator('button[aria-label="初雪"]').last().click()
  await page.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(800)
  r = await rows(page)
  check(r[0].photoIds.join() === 'p1', '关联照片（稳定 ID）')
  if (shots) await page.screenshot({ path: `${shots}/diary-editor.png`, fullPage: true })
  // 打开关联的照片再返回日记
  await page.locator('article button[aria-label="初雪"]').click()
  await page.waitForURL(/#\/album\/photo\/p1/)
  await page.getByRole('button', { name: '返回' }).click()
  await page.waitForURL(/#\/diary\/dia/)
  check(true, '从日记打开照片，关闭后回到日记')
  // 刷新后内容仍在
  await page.reload()
  await page.waitForTimeout(500)
  check((await page.locator('input[placeholder="标题"]').inputValue()) === '初雪', '刷新后内容仍在')

  // 列表、月历小点、搜索
  await page.goto(BASE + '#/diary')
  await page.waitForTimeout(500)
  check((await page.getByText('初雪', { exact: true }).count()) >= 1, '列表中显示日记')
  const today = new Date()
  const dot = await page.locator(`button[aria-label="${today.getMonth() + 1}月${today.getDate()}日"] span`).count()
  check(dot === 1, '月历上今天有小点')
  await page.fill('input[placeholder^="搜索"]', '去年冬天')
  check((await page.getByText('初雪', { exact: true }).count()) >= 1, '全文搜索命中正文')
  await page.fill('input[placeholder^="搜索"]', '不存在的词')
  check((await page.getByText('没有找到匹配的日记').count()) === 1, '搜不到时如实显示')
  await page.fill('input[placeholder^="搜索"]', '')
  await page.locator(`button[aria-label="${today.getMonth() + 1}月${today.getDate()}日"]`).click()
  await page.waitForTimeout(400)
  check((await page.getByText(/\d+月\d+日 的日记/).count()) >= 1 && (await page.getByText('初雪', { exact: true }).count()) >= 1, '点日期按天查看')
  if (shots) await page.screenshot({ path: `${shots}/diary-list.png` })

  // 删除与恢复
  await page.getByText('初雪', { exact: true }).first().click()
  await page.getByRole('button', { name: '删除日记' }).click()
  await page.getByRole('button', { name: '删除' }).last().click()
  await page.waitForURL(/#\/diary$/)
  await page.waitForTimeout(300)
  check((await page.getByText('最近删除 1').count()) === 1, '删除后进入最近删除')
  await page.getByText('最近删除 1').click()
  await page.getByRole('button', { name: '恢复' }).click()
  await page.waitForTimeout(300)
  await page.goto(BASE + '#/diary')
  await page.waitForTimeout(300)
  check((await page.getByText('初雪', { exact: true }).count()) >= 1, '恢复后回到列表')
  check(errors.length === 0, `没有运行时错误${errors.length ? '：' + errors.join(' | ') : ''}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
