/**
 * 生活应用整合的浏览器交互测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/life-integration.cjs [截图目录]
 * 覆盖：四个应用从桌面打开并返回原页；包含照片的备份导出 → 清空 → 恢复后数据和照片原图完全一致；旧权限地址转到 AI 工具权限。
 */
const { chromium, devices } = require('playwright')
const fs = require('fs')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc) => loc.first().waitFor({ timeout: 4000 }).then(() => true, () => false)
const idb = (page, fn, arg) => page.evaluate(([src, a]) => new Promise((res, rej) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { try { new Function('db', 'a', 'res', src)(r.result, a, res) } catch (e) { rej(e) } } }), [fn, arg])

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')

  // 1. 四个应用都从桌面打开，返回后仍在原来的页
  for (const name of ['相册', '日记', '便签', '日历']) {
    await page.goto(BASE + '#/')
    await page.waitForSelector('[aria-label="Dock"]')
    await page.waitForTimeout(400)
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(500)
    const url = page.url()
    check(!/#\/$/.test(url) && !/\/app\//.test(url), `桌面「${name}」打开真实页面（${url.split('#')[1]}）`)
    await page.goBack()
    await page.waitForSelector('[aria-label="Dock"]')
  }
  // 翻到第 2 页，打开主题装扮再返回
  await page.locator('[role=tab]').nth(1).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '主题装扮' }).click()
  await page.goBack()
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(600)
  const pageIdx = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].findIndex((t) => t.getAttribute('aria-selected') === 'true'))
  check(pageIdx === 1, '返回桌面后保留当前页码')

  // 2. 准备数据：通过界面导入一张真实照片，写一篇关联照片的日记、一张便签、一个日程
  const jpg = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#9ec5e8'; x.fillRect(0, 0, 800, 600); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); return Array.from(new Uint8Array(await b.arrayBuffer())) })
  await page.goto(BASE + '#/album')
  await page.setInputFiles('input[type=file]', [{ name: '初雪.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg) }])
  await page.getByText(/导入完成/).waitFor()
  const before = await idb(page, `const tx = db.transaction(['photos','photoBlobs']); const p = tx.objectStore('photos').getAll(); const b = tx.objectStore('photoBlobs').getAll(); tx.oncomplete = async () => res({ id: p.result[0].id, bytes: Array.from(new Uint8Array(await b.result[0].blob.arrayBuffer())).slice(0, 64), size: b.result[0].blob.size })`)
  await idb(page, `const tx = db.transaction(['diaries','notes','events'], 'readwrite'); tx.objectStore('diaries').put({ id: 'd1', date: '2026-11-06', title: '初雪', body: '下雪了', tags: ['冬天'], photoIds: [a], aiReadable: false, createdAt: 1, updatedAt: 1 }); tx.objectStore('notes').put({ id: 'n1', title: '', kind: 'text', text: '买花', items: [], color: 'ice', pinned: true, createdAt: 1, updatedAt: 1 }); tx.objectStore('events').put({ id: 'e1', title: '看雪', kind: 'event', allDay: true, date: '2026-11-06', location: '', note: '', repeat: 'none', diaryIds: ['d1'], source: 'local', createdAt: 1, updatedAt: 1 }); tx.oncomplete = () => res(1)`, before.id)

  // 3. 导出全部数据（含照片）
  await page.goto(BASE + '#/me/backup')
  check(await seen(page.getByText(/包含相册照片（1 张/)), '备份页显示照片数量和体积')
  await page.getByRole('button', { name: '生成全部数据备份' }).click()
  await page.getByText('备份已生成').waitFor({ timeout: 10000 })
  check(await seen(page.getByText(/含 1 张照片原图/)), '备份包含照片原图')
  if (shots) await page.screenshot({ path: `${shots}/backup-ready.png` })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '保存文件' }).click()])
  const file = await dl.path()
  const head = fs.readFileSync(file).subarray(0, 4)
  check(head[0] === 0x50 && head[1] === 0x4b, '导出的备份是 ZIP（图片是独立文件，不是巨大的 JSON）')

  // 4. 清空浏览器数据（模拟换手机），再恢复
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('lingling-ai'); r.onsuccess = r.onerror = r.onblocked = () => res(1) }))
  await page.goto(BASE + '#/me/backup')
  await page.reload()
  await page.waitForTimeout(800)
  await page.setInputFiles('input[type=file]', file)
  check(await seen(page.getByText(/含 1 张照片原图/)), '读取备份并预览（含照片）')
  await page.getByText('完全替换').click()
  await page.getByRole('button', { name: '恢复' }).last().click()
  await page.getByRole('button', { name: '清空并恢复' }).click()
  check(await seen(page.getByText(/恢复完成/)), '恢复完成')
  const after = await idb(page, `const tx = db.transaction(['photos','photoBlobs','diaries','notes','events']); const p = tx.objectStore('photos').getAll(); const b = tx.objectStore('photoBlobs').getAll(); const d = tx.objectStore('diaries').get('d1'); const n = tx.objectStore('notes').get('n1'); const e = tx.objectStore('events').get('e1'); tx.oncomplete = async () => res({ id: p.result[0]?.id, bytes: b.result[0] ? Array.from(new Uint8Array(await b.result[0].blob.arrayBuffer())).slice(0, 64) : [], size: b.result[0]?.blob.size, diaryPhotos: d.result?.photoIds, note: n.result?.text, eventDiaries: e.result?.diaryIds })`)
  check(after.id === before.id && after.size === before.size && JSON.stringify(after.bytes) === JSON.stringify(before.bytes), `照片原图逐字节一致（${after.size} 字节）`)
  check(JSON.stringify(after.diaryPhotos) === JSON.stringify([before.id]) && after.note === '买花' && JSON.stringify(after.eventDiaries) === '["d1"]', '日记的照片关联、便签、日程与日记的关联都恢复了')
  await page.goto(BASE + `#/album/photo/${before.id}?from=all`)
  check(await seen(page.locator('.will-change-transform')), '恢复后能打开照片原图')

  // 5. 旧的「生活应用的 AI 权限」地址转到逐个角色的「AI 工具权限」
  await page.goto(BASE + '#/me/life-access')
  await page.waitForTimeout(500)
  check(/#\/me\/ai-tools$/.test(page.url()), '旧权限地址转到 AI 工具权限')
  check(await seen(page.getByText(/默认全部关闭/)), '说明默认全部关闭')
  if (shots) await page.screenshot({ path: `${shots}/life-access.png` })
  check(errors.length === 0, `没有运行时错误${errors.length ? '：' + errors.join(' | ') : ''}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
