/**
 * 第八阶段 PR A：音乐 App 的浏览器测试（本地运行，不在 CI 中）。
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/music.cjs [截图目录]
 * 【浏览器模拟】Playwright 模拟 iPhone 13（Chromium 无界面，静音播放）；锁屏后台播放等需要 iPhone 真机验证。
 */
const { chromium, devices } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 6000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)

/** 生成一段 WAV（正弦波） */
function wav(seconds, freq) {
  const rate = 8000, n = rate * seconds
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000), 44 + i * 2)
  return b
}

;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-music-'))
  // 注意：Playwright 一次设置多个「中文路径」文件时会丢掉前面的文件，所以用内存中的文件（文件名仍是中文）
  const files = [['银河乐队 - 初雪.wav', 6, 440], ['晚风.wav', 4, 520], ['notes.txt', 0, 0]].map(([name, s, f]) => ({ name, mimeType: s ? 'audio/wav' : 'text/plain', buffer: s ? wav(s, f) : Buffer.from('not audio') }))
  void dir
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.locator('[role=tab]').nth(0).click()
  await page.getByRole('button', { name: '音乐', exact: true }).click()
  check(/#\/music/.test(page.url()), '桌面「音乐」进入音乐 App')
  check(await seen(page.getByText('还没有音乐')), '空状态')
  check(await seen(page.getByText(/不会下载或提供任何音乐/)), '说明只播放自己导入的音乐')

  // 导入
  await page.locator('input[type=file]').setInputFiles(files)
  check(await seen(page.getByRole('status').getByText('导入了 2 首'), 15000), '导入 2 首音频')
  check(await seen(page.getByText(/notes\.txt：不是音频文件/)), '非音频文件被拒绝并说明原因')
  check(await seen(page.locator('.track-row', { hasText: '初雪' }).getByText('银河乐队')), '从文件名识别歌手与标题')
  check(await seen(page.locator('.track-row', { hasText: '初雪' }).getByText('0:06')), '读取时长')
  if (shots) await page.screenshot({ path: `${shots}/music-library.png` })

  // 播放
  await page.getByRole('button', { name: '播放 初雪' }).click()
  check(await seen(page.locator('.mini-player', { hasText: '初雪' })), '迷你播放条显示当前歌曲')
  await page.waitForTimeout(1500)
  check(await seen(page.getByRole('button', { name: '暂停' })), '正在播放（显示暂停按钮）')
  // 打开正在播放
  await page.getByRole('button', { name: '打开正在播放' }).click()
  check(await seen(page.locator('.now-playing').getByText('初雪')), '正在播放页')
  const pos1 = await page.getByLabel('播放进度').inputValue()
  check(Number(pos1) > 0, `进度在走（${pos1} 秒）`)
  await page.getByRole('button', { name: '收藏' }).click()
  check(await seen(page.getByRole('button', { name: '取消收藏' })), '收藏')
  await page.getByRole('button', { name: '下一首' }).click()
  check(await seen(page.locator('.now-playing').getByText('晚风')), '下一首')
  await page.getByRole('button', { name: /循环：关闭/ }).click()
  check(await seen(page.getByRole('button', { name: /循环：列表循环/ })), '切换循环模式')
  await page.getByRole('button', { name: '睡眠定时' }).click()
  await page.getByRole('button', { name: '15 分钟后停止' }).click()
  check(await seen(page.getByText(/\d+:\d{2} 停止/)), '睡眠定时')
  if (shots) await page.screenshot({ path: `${shots}/music-now.png` })
  await page.getByRole('button', { name: '暂停' }).click()
  check(await seen(page.getByRole('button', { name: '播放', exact: true })), '暂停')

  // 离开页面后状态保持，桌面组件同步
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.locator('[role=tab]').nth(1).click()
  await page.waitForTimeout(800)
  check(await seen(page.locator('[aria-label="音乐：晚风（正在播放）"]')), '离开音乐页后仍在播放，桌面音乐组件同步显示')
  if (shots) await page.screenshot({ path: `${shots}/music-widget.png` })

  // 歌单
  await page.goto(BASE + '#/music?tab=lists')
  await page.getByRole('button', { name: '新建歌单' }).click()
  await page.getByLabel('歌单名称').fill('下雪天')
  await page.getByRole('button', { name: '创建' }).click()
  check(await seen(page.getByText('歌单是空的')), '新建歌单并进入')
  await page.getByRole('button', { name: '添加歌曲' }).click()
  await page.getByRole('button', { name: /晚风/ }).click()
  await page.getByRole('button', { name: '添加歌曲' }).click()
  await page.getByRole('button', { name: /初雪/ }).click()
  await page.keyboard.press('Escape').catch(() => {})
  await page.goto(page.url())
  await page.waitForTimeout(500)
  const order1 = await page.locator('.track-row').allTextContents()
  check(order1.length === 2 && /晚风/.test(order1[0]), '歌单中加入 2 首')
  await page.getByRole('button', { name: '上移 初雪' }).click()
  await page.waitForTimeout(300)
  const order2 = await page.locator('.track-row').allTextContents()
  check(/初雪/.test(order2[0]), '调整歌单顺序')

  // 刷新后：歌曲、收藏、歌单、播放队列都在
  await page.goto(BASE + '#/music?tab=fav')
  await page.reload()
  check(await seen(page.locator('.track-row', { hasText: '初雪' })), '刷新后收藏仍在')
  check(await seen(page.locator('.mini-player')), '刷新后恢复上次的播放队列（暂停状态）')
  check(await seen(page.locator('.mini-player').getByRole('button', { name: '播放' })), '刷新后不会自动播放')

  // 删除
  await page.goto(BASE + '#/music')
  await page.getByRole('button', { name: '更多：晚风' }).click()
  await page.getByRole('button', { name: '删除这首歌' }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(500)
  check((await page.locator('.track-row', { hasText: '晚风' }).count()) === 0, '删除歌曲')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
