/**
 * AI 工具调用（生活应用）的浏览器测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/life-tools.cjs [截图目录]
 * 【模拟模型】聊天接口由 page.route 模拟成 OpenAI 兼容服务（返回 tool_calls）；不是真实 DeepSeek，也不是真机。
 * 覆盖：未授权时请求不带工具；每次询问卡片「允许本次 / 拒绝」；允许后回复基于真实日程；
 *       创建日程的草稿预览与确认；取消则不保存；刷新后日程与权限仍在；执行记录。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 5000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)
const idb = (page, fn, arg) => page.evaluate(([src, a]) => new Promise((res, rej) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { try { new Function('db', 'a', 'res', src)(r.result, a, res) } catch (e) { rej(e) } } }), [fn, arg])
const pad = (n) => String(n).padStart(2, '0')
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const bodies = []
  let plan = []
  await page.route('https://api.mock.test/**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}')
    bodies.push(b)
    const step = plan.shift() || ((x) => ({ choices: [{ delta: { content: '<msg>嗯</msg>' } }] }))
    const obj = step(b)
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: `data: ${JSON.stringify(obj)}\n\ndata: [DONE]\n\n` })
  })
  const toolCall = (name, args) => () => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'k' + Math.random(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] })
  const reply = (fn) => (b) => ({ choices: [{ delta: { content: `<msg>${fn(JSON.parse(b.messages.at(-1).content))}</msg>` } }] })

  await page.goto(BASE + '#/me')
  await page.waitForTimeout(1000)
  const tomorrow = day(1)
  await idb(page, `
    const t = db.transaction(['characters','conversations','events','settings'], 'readwrite'); const now = Date.now()
    t.objectStore('characters').put({ id: 'c1', name: '沈星回', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'world-default', createdAt: 1, updatedAt: 1, permissions: { useStickers: true, postMoments: false } })
    t.objectStore('conversations').put({ id: 'cv1', type: 'single', characterIds: ['c1'], title: '', lastMessageAt: now, lastMessagePreview: '', draft: '', unread: 0, pinned: false, createdAt: now })
    t.objectStore('events').put({ id: 'e1', title: '牙医复诊', kind: 'event', allDay: false, date: a, startTime: '15:00', location: '', note: '', repeat: 'none', diaryIds: [], source: 'local', createdAt: now, updatedAt: now })
    t.objectStore('settings').put({ key: 'ai-config', value: { service: 'custom', mode: 'direct', baseUrl: 'https://api.mock.test/v1', apiKey: 'sk-mock', proxyUrl: '', proxyToken: '', model: 'mock-model', temperature: 0.7, maxTokens: 200 } })
    t.oncomplete = () => res(1)
  `, tomorrow)

  // 1. 未授权：请求不带工具
  await page.goto(BASE + '#/chat/cv1')
  const input = page.locator('textarea').first()
  await input.waitFor()
  await input.fill('在吗')
  await page.getByRole('button', { name: '发送' }).click()
  await seen(page.getByText('嗯'))
  check(bodies.length === 1 && !('tools' in bodies[0]), '默认未授权：请求不带任何工具')

  // 2. 在权限页开启「日历读取：每次询问」「日历写入：允许·逐次确认」
  await page.goto(BASE + '#/me/ai-tools/c1')
  await page.waitForSelector('[data-permission]')
  await page.locator('[data-permission=calendar_read] [role=radio]', { hasText: '每次询问' }).click()
  await page.locator('[data-permission=calendar_write] [role=radio]', { hasText: '允许·逐次确认' }).click()
  await page.waitForTimeout(300)

  // 3. 查询明天的日程：出现卡片 → 允许本次 → 回复基于真实数据
  await page.goto(BASE + '#/chat/cv1')
  await input.waitFor()
  plan = [toolCall('calendar__list_events', { from: tomorrow, to: tomorrow }), reply((r) => (r.ok ? `明天${r.data.events[0].startTime}有${r.data.events[0].title}` : '没查到'))]
  bodies.length = 0
  await input.fill('我明天有什么安排')
  await page.getByRole('button', { name: '发送' }).click()
  const card = page.getByRole('dialog', { name: '工具确认' })
  check(await seen(card.getByText('沈星回想查看你的日程')), '出现「沈星回想查看你的日程」')
  check(await seen(card.getByRole('button', { name: '允许本次' })) && (await seen(card.getByRole('button', { name: '拒绝' }))), '卡片有「允许本次 / 拒绝」')
  check(bodies[0]?.tools?.some((t) => t.function.name === 'calendar__list_events') && !bodies[0].tools.some((t) => /diary|album|notes/.test(t.function.name)), '只提供已授权的日历工具')
  if (shots) await page.screenshot({ path: `${shots}/tool-ask.png` })
  await card.getByRole('button', { name: '允许本次' }).click()
  check(await seen(page.getByText('明天15:00有牙医复诊')), '允许后回复基于真实日程')

  // 4. 再问一次，拒绝：模型收到拒绝，如实回复
  plan = [toolCall('calendar__list_events', { from: day(2), to: day(2) }), reply((r) => (r.code === 'user_rejected' ? '好，我不看' : '??'))]
  await input.fill('后天呢')
  await page.getByRole('button', { name: '发送' }).click()
  await card.getByRole('button', { name: '拒绝' }).click()
  check(await seen(page.getByText('好，我不看')), '拒绝后如实回复，不编造')

  // 5. 创建日程：草稿预览，取消则不保存；确认后保存
  plan = [toolCall('calendar__create_draft', { title: '看初雪', date: day(3), startTime: '20:00' }), reply((r) => (r.ok ? '已经帮你记下了' : r.code === 'user_rejected' ? '那就不记了' : '保存失败'))]
  await input.fill('帮我记一下大后天晚上八点看初雪')
  await page.getByRole('button', { name: '发送' }).click()
  check(await seen(card.getByText('草稿预览')) && (await seen(card.getByText(/看初雪/))), '写入卡片显示草稿预览')
  check(await seen(card.getByText(/不会同步到 iPhone 系统日历/)), '明确不会同步到 iPhone 系统日历')
  if (shots) await page.screenshot({ path: `${shots}/tool-draft.png` })
  await card.getByRole('button', { name: '取消' }).click()
  check(await seen(page.getByText('那就不记了')), '取消后如实回复')
  const n1 = await idb(page, `const r = db.transaction('events').objectStore('events').count(); r.onsuccess = () => res(r.result)`)
  check(n1 === 1, '取消后没有新建日程')
  plan = [toolCall('calendar__create_draft', { title: '看初雪', date: day(3), startTime: '20:00' }), reply((r) => (r.ok ? '已经帮你记下了' : '保存失败'))]
  await input.fill('还是记一下吧')
  await page.getByRole('button', { name: '发送' }).click()
  await card.getByRole('button', { name: '确认' }).click()
  check(await seen(page.getByText('已经帮你记下了')), '确认后保存并回复')

  // 6. 刷新后：日程与权限都在；日历里能看到；执行记录
  await page.reload()
  await page.goto(BASE + `#/calendar?date=${day(3)}`)
  check(await seen(page.getByText('看初雪')), '日历应用里能看到新日程（刷新后）')
  await page.goto(BASE + '#/me/ai-tools/c1')
  await page.waitForSelector('[data-permission]')
  await page.waitForTimeout(300)
  const mode = await page.locator('[data-permission=calendar_read] [aria-checked=true]').textContent()
  check(mode === '每次询问', '刷新后权限仍在')
  const logs = await page.locator('.tool-log').count()
  check(logs === 4, `执行记录 4 条（${logs}）`)
  if (shots) await page.screenshot({ path: `${shots}/tool-logs.png`, fullPage: true })
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
