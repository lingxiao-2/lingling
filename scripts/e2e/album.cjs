/**
 * 相册浏览器交互测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/album.cjs [截图目录]
 * Chromium 模拟 iPhone 13。Chromium 不能解码 HEIC，正好用来验证「无法解码时明确提示」；iPhone Safari 的 HEIC 支持需要真机验证。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const uploads = []
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !/fonts\.(googleapis|gstatic)/.test(r.url()) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) uploads.push(r.url()) })

  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  // 用浏览器画几张真实的图片
  const imgs = await page.evaluate(async () => {
    const make = async (w, h, color, type) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.beginPath(); x.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, 7); x.fill()
      const b = await new Promise((r) => c.toBlob(r, type, 0.9))
      return Array.from(new Uint8Array(await b.arrayBuffer()))
    }
    return { big: await make(4000, 3000, '#9ec5e8', 'image/jpeg'), small: await make(600, 800, '#c9b8e8', 'image/png'), third: await make(1200, 900, '#e8d0b8', 'image/jpeg') }
  })
  // 页面切到第 1 页的「相册」
  await page.getByRole('button', { name: '相册' }).click()
  await page.waitForURL(/#\/album$/)
  check(true, '桌面「相册」图标打开相册')
  await page.setInputFiles('input[type=file]', [
    { name: '初雪.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(imgs.big) },
    { name: '窗边.png', mimeType: 'image/png', buffer: Buffer.from(imgs.small) },
    { name: '咖啡店.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(imgs.third) },
    { name: 'IMG_0420.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not really heic data') },
    { name: '坏掉的.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 1, 2, 3]) },
  ])
  await page.getByText(/导入完成/).waitFor({ timeout: 15000 })
  const report = await page.locator('text=导入完成').locator('..').locator('..').innerText()
  check(/成功 3 张/.test(report) && /未导入 2 项/.test(report), '3 张成功，2 张未导入')
  check(/IMG_0420\.HEIC：这个浏览器无法解码 HEIC/.test(report), 'HEIC 解码失败时明确提示，不假装成功')
  check(/坏掉的\.jpg：图片无法解码/.test(report), '损坏的图片明确提示')
  const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { const tx = r.result.transaction(['photos', 'photoBlobs']); const a = tx.objectStore('photos').getAll(); const b = tx.objectStore('photoBlobs').getAll(); tx.oncomplete = () => res({ photos: a.result.map((p) => ({ name: p.name, w: p.width, h: p.height, mime: p.mime, thumbLen: p.thumb.length })), blobs: b.result.length }) } }))
  check(stored.photos.length === 3 && stored.blobs === 3, '数据库中有 3 张照片和 3 个原图')
  const big = stored.photos.find((p) => p.name === '初雪')
  check(big && big.w === 2048 && big.h === 1536 && big.mime === 'image/jpeg', `大图压缩到最长边 2048（${big?.w}×${big?.h}）`)
  check(stored.photos.every((p) => p.thumbLen < 40000), '缩略图很小（只用于网格）')
  if (shots) await page.screenshot({ path: `${shots}/album-home.png` })

  // 新建相册
  await page.getByRole('button', { name: '新建相册' }).click()
  await page.fill('input[placeholder="相册名称"]', '冬天')
  await page.getByRole('button', { name: '创建' }).click()
  await page.waitForURL(/#\/album\/alb/)
  check(await page.getByText(/还没有照片/).waitFor({ timeout: 3000 }).then(() => true, () => false), '新建相册并进入')
  await page.goBack()
  await page.getByText('全部照片').click()
  await page.waitForURL(/#\/album\/all$/)
  await page.locator('.grid button[aria-label]').nth(2).waitFor({ timeout: 3000 }).catch(() => {})
  check((await page.locator('.grid button[aria-label]').count()) === 3, '全部照片网格显示 3 张')
  await page.fill('input[placeholder="搜索名称或备注"]', '咖啡')
  check((await page.locator('.grid button[aria-label]').count()) === 1, '按名称搜索')
  await page.fill('input[placeholder="搜索名称或备注"]', '')

  // 选择两张移动到相册
  await page.getByRole('button', { name: '选择' }).click()
  await page.locator('button[aria-label="初雪"]').click()
  await page.locator('button[aria-label="窗边"]').click()
  await page.getByRole('button', { name: '移动到' }).click()
  await page.getByText('冬天', { exact: true }).click()
  await page.waitForTimeout(300)
  if (shots) await page.screenshot({ path: `${shots}/album-grid.png` })

  // 打开查看器：缩放、滑动、备注
  await page.locator('button[aria-label="咖啡店"]').click()
  await page.waitForURL(/#\/album\/photo\//)
  await page.waitForSelector('.will-change-transform')
  const img = page.locator('.will-change-transform')
  const box = await img.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(200)
  check(/scale\(2\.5\)/.test(await img.getAttribute('style')), '双击放大')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(200)
  check(/scale\(1\)/.test(await img.getAttribute('style')), '再双击还原')
  const firstUrl = page.url()
  await page.mouse.move(330, 420); await page.mouse.down(); await page.mouse.move(200, 425, { steps: 6 }); await page.mouse.move(60, 425, { steps: 6 }); await page.mouse.up()
  await page.waitForTimeout(400)
  check(page.url() !== firstUrl, '左滑切换到下一张')
  if (shots) await page.screenshot({ path: `${shots}/album-viewer.png` })
  await page.getByRole('button', { name: '信息' }).click()
  await page.fill('textarea', '和沈遥一起看的雪')
  await page.getByRole('button', { name: '完成' }).click()
  await page.waitForTimeout(300)
  await page.reload()
  await page.getByRole('button', { name: '信息' }).click()
  check((await page.locator('textarea').inputValue()) === '和沈遥一起看的雪', '备注保存，刷新后仍在')
  check((await page.getByText('导入时间').count()) === 1 && (await page.getByText(/× /).count()) >= 1, '显示导入时间与尺寸')
  if (shots) await page.screenshot({ path: `${shots}/album-info.png` })
  await page.getByRole('button', { name: '完成' }).click()

  // 删除 → 最近删除 → 恢复
  await page.getByRole('button', { name: '删除' }).click()
  await page.waitForTimeout(300)
  await page.goto(BASE + '#/album/trash')
  await page.waitForTimeout(400)
  check((await page.locator('.grid button[aria-label]').count()) === 1, '删除的照片进入最近删除')
  await page.getByRole('button', { name: '选择' }).click()
  await page.locator('.grid button[aria-label]').first().click()
  await page.getByRole('button', { name: '恢复' }).click()
  await page.waitForTimeout(300)
  check((await page.locator('.grid button[aria-label]').count()) === 0, '恢复后离开最近删除')
  await page.goto(BASE + '#/album/all')
  await page.fill('input[placeholder="搜索名称或备注"]', '沈遥')
  check((await page.locator('.grid button[aria-label]').count()) === 1, '按备注搜索')

  // 返回桌面后仍在原页
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  check(uploads.length === 0, `没有任何上传或外部请求${uploads.length ? '：' + uploads.join(',') : ''}`)
  check(errors.length === 0, `没有运行时错误${errors.length ? '：' + errors.join(' | ') : ''}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
