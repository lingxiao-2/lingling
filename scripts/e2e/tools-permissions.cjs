/**
 * AI 工具权限页的浏览器测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/tools-permissions.cjs [截图目录]
 * 覆盖：从「我的」进入；默认全部关闭；逐个角色设置互不影响；刷新后仍在；全部关闭；执行记录可清空。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc) => loc.first().waitFor({ timeout: 4000 }).then(() => true, () => false)
const idb = (page, fn, arg) => page.evaluate(([src, a]) => new Promise((res, rej) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { try { new Function('db', 'a', 'res', src)(r.result, a, res) } catch (e) { rej(e) } } }), [fn, arg])
const modes = (page) => page.locator('[data-permission]').evaluateAll((els) => els.map((e) => [e.dataset.permission, e.querySelector('[aria-checked=true]')?.textContent]))

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '#/me')
  await page.waitForTimeout(1000)
  await idb(page, `
    const t = db.transaction(['characters','toolLogs'], 'readwrite'); const now = Date.now()
    for (const [id, name, at] of [['c1','沈星回',1],['c2','阿玲',2]]) t.objectStore('characters').put({ id, name, avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'world-default', createdAt: at, updatedAt: at, permissions: { useStickers: true, postMoments: false } })
    t.objectStore('toolLogs').put({ id: 'l1', at: now, characterId: 'c1', tool: 'calendar.list_events', confirmation: 'once', status: 'ok', summary: '3 个日程', durationMs: 5 })
    t.oncomplete = () => res(1)
  `)
  await page.reload()
  await page.getByText('AI 工具权限').click()
  check(await seen(page.getByText('沈星回')), '从「我的」进入 AI 工具权限，列出角色')
  check(await seen(page.getByText('全部关闭').nth(1)), '每个角色显示「全部关闭」')
  check(await seen(page.locator('.tool-log')), '显示执行记录')
  if (shots) await page.screenshot({ path: `${shots}/ai-tools.png` })

  await page.getByText('沈星回', { exact: true }).click()
  await page.waitForSelector('[data-permission]')
  const m0 = await modes(page)
  check(m0.length === 8 && m0.every(([, m]) => m === '关闭'), `8 项权限默认全部关闭（${m0.length}）`)
  await page.locator('[data-permission=diary_read] [role=radio]', { hasText: '每次询问' }).click()
  await page.locator('[data-permission=calendar_read] [role=radio]', { hasText: '始终允许' }).click()
  check(await seen(page.locator('[data-permission=calendar_write] [role=radio]', { hasText: '允许·逐次确认' })), '写入权限明确写着逐次确认')
  await page.waitForTimeout(300)
  if (shots) await page.screenshot({ path: `${shots}/ai-tools-character.png`, fullPage: true })
  await page.reload()
  await page.waitForSelector('[data-permission]')
  await page.waitForTimeout(300)
  const m1 = Object.fromEntries(await modes(page))
  check(m1.diary_read === '每次询问' && m1.calendar_read === '始终允许' && m1.notes_read === '关闭', '刷新后设置仍在')

  await page.goto(BASE + '#/me/ai-tools/c2')
  await page.waitForSelector('[data-permission]')
  await page.waitForTimeout(300)
  check((await modes(page)).every(([, m]) => m === '关闭'), '另一个角色不受影响')

  await page.goto(BASE + '#/me/ai-tools/c1')
  await page.waitForSelector('[data-permission]')
  await page.getByRole('button', { name: '全部关闭' }).click()
  await page.waitForTimeout(300)
  check((await modes(page)).every(([, m]) => m === '关闭'), '「全部关闭」立即生效')

  await page.getByRole('button', { name: '清空' }).click()
  await page.getByRole('button', { name: '清空' }).last().click()
  await page.waitForTimeout(300)
  check((await page.locator('.tool-log').count()) === 0 && (await seen(page.getByText('还没有记录'))), '执行记录可以清空')
  const chars = await idb(page, `const r = db.transaction('characters').objectStore('characters').count(); r.onsuccess = () => res(r.result)`)
  check(chars === 2, '清空记录不影响其他数据')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
