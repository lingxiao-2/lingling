/**
 * 第七阶段 PR C：分享菜单导入的浏览器测试（本地运行，不在 CI 中）。
 * 【浏览器模拟】直接打开「分享到聆聆」快捷指令会打开的地址；剪贴板粘贴在无界面浏览器中无法模拟，用「从照片中选择」测试图片导入。**不是真机测试**。
 */
const { chromium, devices } = require('playwright')
const path = require('path')
const zlib = require('zlib')
const fs = require('fs')
const os = require('os')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 5000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)
const idb = (page, fn) => page.evaluate((src) => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => new Function('db', 'res', src)(r.result, res) }), fn)
const count = (page, store) => idb(page, `const r = db.transaction('${store}').objectStore('${store}').count(); r.onsuccess = () => res(r.result)`)
const share = (o) => BASE + '#' + new URLSearchParams({ lingling_share: '1', ...o }).toString()
const shareQuery = (o) => BASE + '?' + new URLSearchParams({ lingling_share: '1', ...o }).toString()

/** 生成一张 8×8 的 PNG */
function png() {
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((8 * 3 + 1) * 8, 0x88)
  for (let y = 0; y < 8; y++) raw[y * 25] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  const requests = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url()) })
  await page.goto(BASE + '#/me')
  await page.waitForTimeout(800)
  await idb(page, `const t = db.transaction(['characters'], 'readwrite'); t.objectStore('characters').put({ id: 'c1', name: '沈星回', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'world-default', createdAt: 1, updatedAt: 1, permissions: { useStickers: true, postMoments: false } }); t.oncomplete = () => res(1)`)

  // 1. 文字：预览 → 保存为便签
  await page.goto(share({ t: '下周三交论文初稿' }))
  check(await seen(page.locator('.share-preview', { hasText: '下周三交论文初稿' })), '文字：显示预览')
  check(/#\/share$/.test(page.url()) && !page.url().includes('lingling_share'), '地址中的分享内容已去掉，进入预览页')
  check(await seen(page.getByText(/不会发给 AI/)), '说明不会自动发给 AI')
  check((await count(page, 'notes')) === 0, '预览时没有保存任何内容')
  await page.getByRole('button', { name: '保存为便签' }).click()
  check(await seen(page.getByRole('status').filter({ hasText: '已保存为便签' })) && (await count(page, 'notes')) === 1, '确认后保存为便签')

  // 2. 敏感内容 → 放进角色输入框：不自动发送、不请求模型
  await page.goto(share({ t: '我的身份证号是 110101199003077777' }))
  check(await seen(page.locator('.share-warning', { hasText: '证件号' })), '敏感内容有提醒')
  if (shots) await page.screenshot({ path: `${shots}/share-sensitive.png` })
  await page.getByRole('button', { name: /放进和角色的输入框/ }).click()
  await page.getByRole('button', { name: '沈星回' }).click()
  const box = page.locator('textarea').first()
  await box.waitFor()
  await page.waitForTimeout(400)
  check((await box.inputValue()).includes('110101199003077777'), '内容放进了输入框')
  check((await count(page, 'messages')) === 0, '没有自动发送')
  check(!requests.some((u) => u.includes('110101199003077777') || u.includes('%E8%BA%AB%E4%BB%BD')), '分享的内容没有出现在任何网络请求中')

  // 3. 链接（旧的 ? 形式也支持）
  await page.goto(shareQuery({ t: 'https://example.com/article?id=7' }))
  check(await seen(page.locator('a.share-preview[href="https://example.com/article?id=7"]')), '链接：识别为网页链接')
  await page.getByRole('button', { name: '丢弃' }).click()
  check(await seen(page.getByRole('status').filter({ hasText: '已丢弃' })), '丢弃')
  await page.reload()
  check(await seen(page.getByText('没有待处理的分享。')), '丢弃后刷新不会再出现')

  // 4. 超长文字
  await page.goto(share({ t: '雪'.repeat(4100) }))
  check(await seen(page.getByText(/只收到了前 4000 字/)), '超过 4000 字截断并说明')

  // 5. 图片：不在链接中；从照片选择 → 保存到相册
  await page.goto(share({ kind: 'image' }))
  check(await seen(page.getByRole('button', { name: '粘贴图片' })), '图片：提供粘贴图片')
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'll-')), 'snow.png')
  fs.writeFileSync(file, png())
  await page.locator('input[type=file]').setInputFiles(file)
  check(await seen(page.locator('img.share-image')), '图片预览')
  check((await count(page, 'photos')) === 0, '预览时没有保存')
  await page.getByRole('button', { name: /保存 1 张到相册/ }).click()
  check(await seen(page.getByRole('status').filter({ hasText: '已保存 1 张图片到相册' }), 10000), '确认后保存到相册')
  check((await count(page, 'photos')) === 1, '相册中有这张照片')

  // 6. 空分享
  await page.goto(BASE + '?lingling_share=1&t=')
  check(await seen(page.getByText(/没有收到内容/)), '空分享如实提示')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
