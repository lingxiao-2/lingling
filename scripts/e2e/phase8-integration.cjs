/**
 * 第八阶段 PR G：整体整合的浏览器测试（本地运行，不在 CI 中）。【浏览器模拟】Playwright 模拟 iPhone 13；不是真机。
 * 覆盖：六个应用都从桌面打开真实页面；含音乐、信件、礼物、塔罗、计时的全部备份 → 清空 → 恢复后完全一致；
 *       角色资料页的信件与礼物入口；存储占用；两种 iPhone 尺寸下的截图。
 */
const { chromium, devices } = require('playwright')
const fs = require('fs')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 6000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)
const idb = (page, fn, arg) => page.evaluate(([src, a]) => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => new Function('db', 'a', 'res', src)(r.result, a, res) }), [fn, arg])
function wav(seconds) {
  const rate = 8000, n = rate * seconds, b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 3) * 6000), 44 + i * 2)
  return b
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // 1. 六个应用都从桌面打开真实页面
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  for (const [name, path, p] of [['音乐', '/music', 0], ['时钟', '/clock', 0], ['天气', '/weather', 0], ['信箱', '/mail', 1], ['礼物', '/gifts', 1], ['塔罗', '/tarot', 1]]) {
    await page.goto(BASE + '#/')
    await page.waitForSelector('[aria-label="Dock"]')
    await page.locator('[role=tab]').nth(p).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(500)
    check(page.url().endsWith(`#${path}`) && !(await page.getByText('还在开发中').count()), `桌面「${name}」打开 ${path}`)
  }

  // 2. 准备数据：导入一首音乐，加入歌单；信件、礼物、塔罗、计时
  await page.goto(BASE + '#/music')
  await page.locator('input[type=file]').setInputFiles([{ name: '冬夜 - 雪.wav', mimeType: 'audio/wav', buffer: wav(2) }])
  await seen(page.getByRole('status').getByText('导入了 1 首'), 10000)
  await idb(page, `
    const tx = db.transaction(['characters','tracks','playlists','letters','giftRecords','tarotReadings','timers'], 'readwrite')
    tx.objectStore('characters').put({ id: 'c1', name: '沈星回', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'world-default', createdAt: 1, updatedAt: 1, permissions: { useStickers: true, postMoments: false } })
    const t = tx.objectStore('tracks').getAll()
    t.onsuccess = () => tx.objectStore('playlists').put({ id: 'pl1', name: '冬天', trackIds: [t.result[0].id], createdAt: 1, updatedAt: 1 })
    tx.objectStore('letters').put({ id: 'l1', characterId: 'c1', direction: 'from_character', status: 'received', subject: '雪落之前', body: '今天的星空很干净。', paper: 'night', read: false, starred: true, model: 'm', createdAt: 1, updatedAt: 1, sentAt: 1 })
    tx.objectStore('giftRecords').put({ id: 'g1', characterId: 'c1', direction: 'to_character', giftId: 'telescope', message: '一起看星星', reply: '谢谢。', replyStatus: 'done', starred: false, createdAt: 1 })
    tx.objectStore('tarotReadings').put({ id: 't1', spread: 'single', question: '今天', cards: [{ cardId: 'major-17', reversed: false, position: '指引' }], theme: 'ice', createdAt: 1 })
    tx.objectStore('timers').put({ id: 'tm1', name: '泡茶', durationMs: 60000, status: 'done', remainingMs: 0, alerted: true, createdAt: 1, finishedAt: 2 })
    tx.oncomplete = () => res(1)
  `)
  const before = await idb(page, `const tx = db.transaction(['tracks','trackBlobs']); const t = tx.objectStore('tracks').getAll(); const b = tx.objectStore('trackBlobs').getAll(); tx.oncomplete = async () => res({ id: t.result[0].id, size: b.result[0].blob.size, head: Array.from(new Uint8Array(await b.result[0].blob.arrayBuffer())).slice(40, 80) })`)

  // 3. 存储占用与导出（含音乐）
  await page.goto(BASE + '#/me/backup')
  check(await seen(page.locator('.storage-card').getByText('音乐文件')), '备份页显示存储占用')
  check(await seen(page.getByText(/包含音乐文件（1 首/)), '备份页可以选择包含音乐文件')
  await page.getByRole('button', { name: '生成全部数据备份' }).click()
  await page.getByText('备份已生成').waitFor({ timeout: 10000 })
  check(await seen(page.getByText(/含 1 首音乐文件/)), '备份包含音乐文件')
  check(await seen(page.getByText(/信件 1/)) && (await seen(page.getByText(/礼物记录 1/))) && (await seen(page.getByText(/塔罗记录 1/))) && (await seen(page.getByText(/歌单 1/))), '备份包含信件、礼物、塔罗、歌单')
  if (shots) await page.screenshot({ path: `${shots}/backup-phase8.png`, fullPage: true })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '保存文件' }).click()])
  const file = await dl.path()
  check(fs.readFileSync(file).subarray(0, 2).toString() === 'PK', '备份是 ZIP（音乐是独立文件）')

  // 4. 清空 → 恢复
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('lingling-ai'); r.onsuccess = r.onerror = r.onblocked = () => res(1) }))
  await page.goto(BASE + '#/me/backup')
  await page.reload()
  await page.waitForTimeout(800)
  await page.locator('input[type=file]').last().setInputFiles(file)
  check(await seen(page.getByText(/含 1 首音乐文件/)), '读取备份并预览（含音乐）')
  await page.getByText('完全替换').click()
  await page.getByRole('button', { name: '恢复' }).last().click()
  await page.getByRole('button', { name: '清空并恢复' }).click()
  check(await seen(page.getByText(/恢复完成/)), '恢复完成')
  const after = await idb(page, `const tx = db.transaction(['tracks','trackBlobs','playlists','letters','giftRecords','tarotReadings','timers']); const t = tx.objectStore('tracks').getAll(); const b = tx.objectStore('trackBlobs').getAll(); const p = tx.objectStore('playlists').get('pl1'); const l = tx.objectStore('letters').get('l1'); const g = tx.objectStore('giftRecords').get('g1'); const r = tx.objectStore('tarotReadings').get('t1'); const m = tx.objectStore('timers').get('tm1'); tx.oncomplete = async () => res({ id: t.result[0]?.id, size: b.result[0]?.blob.size, head: b.result[0] ? Array.from(new Uint8Array(await b.result[0].blob.arrayBuffer())).slice(40, 80) : [], pl: p.result?.trackIds, letter: l.result?.subject, gift: g.result?.reply, tarot: r.result?.question, timer: m.result?.name })`)
  check(after.id === before.id && after.size === before.size && JSON.stringify(after.head) === JSON.stringify(before.head), `音乐文件逐字节一致（${after.size} 字节）`)
  check(JSON.stringify(after.pl) === JSON.stringify([before.id]) && after.letter === '雪落之前' && after.gift === '谢谢。' && after.tarot === '今天' && after.timer === '泡茶', '歌单、信件、礼物、塔罗、计时都恢复了')
  await page.goto(BASE + '#/music')
  await page.getByRole('button', { name: '播放 雪' }).click()
  check(await seen(page.locator('.mini-player', { hasText: '雪' })), '恢复后的音乐可以播放')

  // 5. 角色资料页入口
  await page.goto(BASE + '#/character/c1')
  check(await seen(page.getByText('往来信件 1 封')) && (await seen(page.getByText('1 封未读'))), '角色资料页：信件')
  check(await seen(page.getByText('礼物 · 送出 1 · 收到 0')), '角色资料页：礼物')
  await page.getByText('礼物 · 送出 1').click()
  check(/#\/gifts\?character=c1/.test(page.url()), '从角色资料页进入这个角色的礼物')

  // 6. 两种 iPhone 尺寸的截图与横向溢出检查
  for (const [w, h] of [[390, 844], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h })
    for (const [path, name] of [['/music', 'music'], ['/clock', 'clock'], ['/weather', 'weather'], ['/mail', 'mail'], ['/gifts/send?character=c1', 'gift'], ['/tarot', 'tarot'], ['/', 'desktop']]) {
      await page.goto(BASE + '#' + path)
      await page.waitForTimeout(700)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      check(overflow <= 1, `${w}×${h} ${path} 没有横向溢出（${overflow}）`)
      if (shots) await page.screenshot({ path: `${shots}/${name}-${w}.png` })
    }
  }
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
