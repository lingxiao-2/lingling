/**
 * 第七阶段 PR D：AI 通过工具在真实 iPhone 上创建提醒的浏览器测试（本地运行，不在 CI 中）。
 * 【模拟模型 + 浏览器模拟】聊天接口由 page.route 模拟；快捷指令无法真的打开，用测试钩子记录链接，
 * 再像 Safari 一样在新标签页打开回跳地址。**不是真机测试，也不是真实 DeepSeek。**
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 6000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)
const idb = (page, fn) => page.evaluate((src) => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => new Function('db', 'res', src)(r.result, res) }), fn)
const pad = (n) => String(n).padStart(2, '0')
const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  await ctx.addInitScript(() => { window.__LINGLING_TEST_OPEN__ = (u) => localStorage.setItem('__opened', JSON.stringify([...JSON.parse(localStorage.getItem('__opened') || '[]'), u])) })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const opened = () => page.evaluate(() => JSON.parse(localStorage.getItem('__opened') || '[]'))
  const bodies = []
  let plan = []
  await ctx.route('https://api.mock.test/**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}')
    bodies.push(b)
    const obj = (plan.shift() || (() => ({ choices: [{ delta: { content: '<msg>嗯</msg>' } }] })))(b)
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: `data: ${JSON.stringify(obj)}\n\ndata: [DONE]\n\n` })
  })
  const toolCall = (name, args) => () => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'k' + Math.random(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] })
  const fromResult = (b) => { const r = JSON.parse(b.messages.at(-1).content); return { choices: [{ delta: { content: `<msg>${!r.ok ? `没有成功：${r.code}` : r.data.verified ? '提醒已经建好了' : '已经帮你发起了，请在 iPhone 上看一下'}</msg>` } }] } }

  await page.goto(BASE + '#/me')
  await page.waitForTimeout(800)
  await idb(page, `
    const t = db.transaction(['characters','conversations','settings','notes'], 'readwrite'); const now = Date.now()
    t.objectStore('characters').put({ id: 'c1', name: '沈星回', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'world-default', createdAt: 1, updatedAt: 1, permissions: { useStickers: true, postMoments: false } })
    t.objectStore('conversations').put({ id: 'cv1', type: 'single', characterIds: ['c1'], title: '', lastMessageAt: now, lastMessagePreview: '', draft: '', unread: 0, pinned: false, createdAt: now })
    t.objectStore('notes').put({ id: 'n1', title: '旧便签', kind: 'text', text: '保留', items: [], pinned: false, color: 'pearl', createdAt: now, updatedAt: now })
    t.objectStore('settings').put({ key: 'ai-config', value: { service: 'custom', mode: 'direct', baseUrl: 'https://api.mock.test/v1', apiKey: 'sk-mock', proxyUrl: '', proxyToken: '', model: 'mock-model', temperature: 0.7, maxTokens: 200 } })
    t.objectStore('settings').put({ key: 'ios-shortcuts', value: { version: 1, shortcuts: [{ id: 's1', name: '聆聆提醒事项', purpose: 'reminder', description: '', allowAI: true, createdAt: 1 }] } })
    t.oncomplete = () => res(1)
  `)

  // 1. 未授权：不带 iPhone 工具
  await page.goto(BASE + '#/chat/cv1')
  const input = page.locator('textarea').first()
  await input.waitFor()
  await input.fill('你好')
  await page.getByRole('button', { name: '发送' }).click()
  await seen(page.getByText('嗯'))
  check(!('tools' in bodies.at(-1)), '默认未授权：没有任何 iPhone 工具')

  // 2. 权限页：新增 4 项 iPhone 权限，默认关闭；开启提醒事项
  await page.goto(BASE + '#/me/ai-tools/c1')
  await page.waitForSelector('[data-permission]')
  const rows = await page.locator('[data-permission^=ios_]').count()
  const off = await page.locator('[data-permission^=ios_] [aria-checked=true]').allTextContents()
  check(rows === 4 && off.every((t) => t === '关闭'), `4 项 iPhone 权限默认关闭（${rows}）`)
  await page.locator('[data-permission=ios_reminder] [role=radio]', { hasText: '允许·逐次确认' }).click()
  await page.waitForTimeout(300)

  // 3. 帮我创建一个提醒 → 确认并打开 → 回跳成功（在新标签页，像 Safari 一样）
  await page.goto(BASE + '#/chat/cv1')
  await input.waitFor()
  plan = [toolCall('ios__create_reminder', { title: '去买东西', date: day(1), time: '15:00' }), fromResult]
  await input.fill('帮我创建一个提醒，明天下午三点去买东西')
  await page.getByRole('button', { name: '发送' }).click()
  const card = page.getByRole('dialog', { name: '工具确认' })
  check(await seen(card.getByText('沈星回想在 iPhone 上创建提醒事项')), '确认卡片：角色想在 iPhone 上创建提醒事项')
  check(await seen(card.getByText('执行计划')) && (await seen(card.getByText(/提醒时间：.*15:00/))) && (await seen(card.getByText(/不是聆聆/))), '显示执行计划：时间、标题、写入 iPhone 而不是聆聆')
  check(bodies.at(-1).tools.some((t) => t.function.name === 'ios__create_reminder') && !bodies.at(-1).tools.some((t) => t.function.name === 'ios__open_app'), '只提供已授权的 iPhone 工具')
  check((await opened()).length === 0, '确认前没有打开')
  if (shots) await page.screenshot({ path: `${shots}/iphone-agent-confirm.png` })
  await card.getByRole('button', { name: '确认并打开' }).click()
  await page.waitForTimeout(300)
  const urls = await opened()
  check(urls.length === 1 && urls[0].startsWith('shortcuts://x-callback-url/run-shortcut?'), '点确认时打开快捷指令')
  check(await seen(page.locator('.shortcut-run', { hasText: '已发起' })), '聊天中显示运行状态：已发起')
  const u = new URL(urls[0].replace('shortcuts://', 'https://'))
  const cbTab = await ctx.newPage()
  await cbTab.goto(u.searchParams.get('x-success') + '?result=ok')
  check(await seen(cbTab.getByText('已确认完成')), '回跳标签页：已确认完成')
  check(await seen(page.locator('.shortcut-run', { hasText: '已确认完成' }), 8000), '原来的聊天标签页同步为已确认完成')
  check(await seen(page.getByText('提醒已经建好了'), 10000), 'AI 回复基于真实结果')
  if (shots) await page.screenshot({ path: `${shots}/iphone-agent-done.png` })
  await cbTab.close()

  // 4. 同样的提醒再来一次 → 被拦下，不出现卡片
  plan = [toolCall('ios__create_reminder', { title: '去买东西', date: day(1), time: '15:00' }), fromResult]
  await input.fill('再建一次')
  await page.getByRole('button', { name: '发送' }).click()
  check(await seen(page.getByText('没有成功：invalid')), '重复的提醒被拦下，AI 如实说明')
  check((await opened()).length === 1, '没有再次打开')

  // 5. 拒绝 → 不打开
  plan = [toolCall('ios__create_reminder', { title: '交水费', date: day(2), time: '09:00' }), fromResult]
  await input.fill('后天九点提醒我交水费')
  await page.getByRole('button', { name: '发送' }).click()
  await card.getByRole('button', { name: '取消' }).click()
  check(await seen(page.getByText('没有成功：user_rejected')), '拒绝后 AI 如实回复')
  check((await opened()).length === 1, '拒绝后没有打开')

  // 6. 没有回跳 → 只显示已发起 / 无法验证，AI 不说成功
  plan = [toolCall('ios__create_reminder', { title: '取快递', date: day(1), time: '18:00' }), fromResult]
  await input.fill('明天六点提醒我取快递')
  await page.getByRole('button', { name: '发送' }).click()
  await card.getByRole('button', { name: '确认并打开' }).click()
  check(await seen(page.getByText('已经帮你发起了，请在 iPhone 上看一下'), 60000), '没有回跳：AI 只说已发起')
  check(!(await page.locator('.shortcut-run', { hasText: '取快递' }).filter({ hasText: '已确认完成' }).count()), '没有回跳的运行不显示成功')

  // 7. 刷新后：运行状态、消息、旧数据都在
  await page.reload()
  check(await seen(page.locator('.shortcut-run', { hasText: '已确认完成' })), '刷新后运行状态仍在')
  check(await seen(page.getByText('提醒已经建好了')), '刷新后聊天仍在')
  const n = await idb(page, `const r = db.transaction('notes').objectStore('notes').get('n1'); r.onsuccess = () => res(r.result && r.result.text)`)
  check(n === '保留', '原有便签不受影响')
  await page.goto(BASE + '#/me/ai-tools/c1')
  check(await seen(page.locator('.tool-log', { hasText: 'ios.create_reminder' })), '执行记录中有 iPhone 操作')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
