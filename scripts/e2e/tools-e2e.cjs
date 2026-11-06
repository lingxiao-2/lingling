/**
 * AI 工具调用端到端浏览器测试（本地运行，不在 CI 中）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/tools-e2e.cjs [截图目录]
 * 【模拟模型】聊天接口由 page.route 模拟；不是真实 DeepSeek，也不是真机。
 * 覆盖：停止生成时确认卡片消失、不再请求、不执行；日记只读且只限允许 AI 读取的；记忆提议只进入待确认；
 *       使用工具后的提示；其他角色看不到授权；刷新后数据都在。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 5000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)
const idb = (page, fn, arg) => page.evaluate(([src, a]) => new Promise((res, rej) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { try { new Function('db', 'a', 'res', src)(r.result, a, res) } catch (e) { rej(e) } } }), [fn, arg])

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
    const obj = (plan.shift() || (() => ({ choices: [{ delta: { content: '<msg>嗯</msg>' } }] })))(b)
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: `data: ${JSON.stringify(obj)}\n\ndata: [DONE]\n\n` })
  })
  const toolCall = (name, args) => () => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'k' + Math.random(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] })
  const reply = (fn) => (b) => ({ choices: [{ delta: { content: `<msg>${fn(JSON.parse(b.messages.at(-1).content))}</msg>` } }] })

  await page.goto(BASE + '#/me')
  await page.waitForTimeout(1000)
  await idb(page, `
    const t = db.transaction(['characters','conversations','diaries','settings'], 'readwrite'); const now = Date.now()
    for (const [id, name] of [['c1','沈星回'],['c2','阿玲']]) t.objectStore('characters').put({ id, name, avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'world-default', createdAt: 1, updatedAt: 1, permissions: { useStickers: true, postMoments: false } })
    for (const [id, c] of [['cv1','c1'],['cv2','c2']]) t.objectStore('conversations').put({ id, type: 'single', characterIds: [c], title: '', lastMessageAt: now, lastMessagePreview: '', draft: '', unread: 0, pinned: false, createdAt: now })
    t.objectStore('diaries').put({ id: 'd1', date: '2026-11-01', title: '初雪', body: '今天看到了初雪，很开心。', tags: [], photoIds: [], aiReadable: true, createdAt: now, updatedAt: now })
    t.objectStore('diaries').put({ id: 'd2', date: '2026-11-02', title: '秘密', body: '初雪那天我其实哭了。', tags: [], photoIds: [], aiReadable: false, createdAt: now, updatedAt: now })
    t.objectStore('settings').put({ key: 'ai-config', value: { service: 'custom', mode: 'direct', baseUrl: 'https://api.mock.test/v1', apiKey: 'sk-mock', proxyUrl: '', proxyToken: '', model: 'mock-model', temperature: 0.7, maxTokens: 200 } })
    t.objectStore('settings').put({ key: 'tool-permissions', value: { version: 1, characters: { c1: { diary_read: 'ask', notes_write: 'always', memory_propose: 'always' } } } })
    t.oncomplete = () => res(1)
  `)

  const input = page.locator('textarea').first()
  const card = page.getByRole('dialog', { name: '工具确认' })
  await page.goto(BASE + '#/chat/cv1')
  await input.waitFor()

  // 1. 停止生成：卡片消失，便签没有创建，不再请求模型
  plan = [toolCall('notes__create_draft', { text: '买牛奶' }), reply(() => '不该出现')]
  await input.fill('帮我记个便签：买牛奶')
  await page.getByRole('button', { name: '发送' }).click()
  check(await seen(card.getByText('草稿预览')), '写便签出现草稿预览')
  const before = bodies.length
  await page.getByRole('button', { name: '停止生成' }).click()
  await page.waitForTimeout(600)
  check((await card.count()) === 0, '停止生成后卡片消失')
  check(bodies.length === before, '停止后不再请求模型')
  const notes = await idb(page, `const r = db.transaction('notes').objectStore('notes').count(); r.onsuccess = () => res(r.result)`)
  check(notes === 0, '停止后便签没有创建')
  check(!(await page.getByText('不该出现').count()), '没有编造的回复')

  // 2. 日记：允许后只读到允许 AI 读取的那一篇
  plan = [toolCall('diary__search', { query: '初雪' }), reply((r) => (r.ok ? `找到${r.data.diaries.length}篇：${r.data.diaries.map((d) => d.title).join('')}` : '没权限'))]
  await input.fill('你记得初雪那天吗')
  await page.getByRole('button', { name: '发送' }).click()
  check(await seen(card.getByText('沈星回想在你的日记里找找')), '读日记前询问')
  if (shots) await page.screenshot({ path: `${shots}/tool-diary-ask.png` })
  await card.getByRole('button', { name: '允许本次' }).click()
  check(await seen(page.getByText('找到1篇：初雪')), '只读到允许 AI 读取的日记')
  check(await seen(page.getByText(/刚才使用了：在你的日记里找找/)), '回复后提示刚才使用了什么工具')
  const sent = JSON.stringify(bodies.at(-1))
  check(!/我其实哭了/.test(sent) && /很开心/.test(sent), '未允许 AI 读取的日记内容没有发给模型')

  // 3. 记忆提议：只进入待确认
  plan = [toolCall('memory__propose', { kind: 'preference', content: '用户不吃香菜', quote: '我不吃香菜' }), reply((r) => (r.ok && r.data.status === 'pending' ? '我放进待确认了' : '没成功'))]
  await input.fill('对了，我不吃香菜')
  await page.getByRole('button', { name: '发送' }).click()
  check(await seen(page.getByText('我放进待确认了')), '记忆提议后如实回复')
  await page.goto(BASE + '#/character/c1/memories')
  check(await seen(page.getByText('用户不吃香菜')), '记忆页出现提议')
  const mem = await idb(page, `const r = db.transaction('memories').objectStore('memories').getAll(); r.onsuccess = () => res(r.result.map((m) => [m.content, m.status, m.characterId]))`)
  check(mem.some(([c, s, ch]) => c === '用户不吃香菜' && s === 'pending' && ch === 'c1') && !mem.some(([, s]) => s === 'active'), '只进入「待确认」，没有直接生效')

  // 4. 另一个角色：没有授权，请求不带工具
  await page.goto(BASE + '#/chat/cv2')
  await input.waitFor()
  plan = []
  await input.fill('你好')
  await page.getByRole('button', { name: '发送' }).click()
  await seen(page.getByText('嗯'))
  check(!('tools' in bodies.at(-1)), '另一个角色没有任何工具')

  // 5. 撤销后立即生效
  await page.goto(BASE + '#/me/ai-tools/c1')
  await page.waitForSelector('[data-permission]')
  await page.getByRole('button', { name: '全部关闭' }).click()
  await page.waitForTimeout(300)
  await page.goto(BASE + '#/chat/cv1')
  await input.waitFor()
  await input.fill('再看看日记')
  await page.getByRole('button', { name: '发送' }).click()
  await page.waitForTimeout(1500)
  check(!('tools' in bodies.at(-1)), '撤销后请求不再带工具')

  // 6. 刷新后：消息、记忆、执行记录都在
  await page.reload()
  check(await seen(page.getByText('找到1篇：初雪')), '刷新后聊天记录仍在')
  const logs = await idb(page, `const r = db.transaction('toolLogs').objectStore('toolLogs').getAll(); r.onsuccess = () => res(r.result)`)
  check(logs.length >= 3 && !JSON.stringify(logs).includes('很开心') && !JSON.stringify(logs).includes('sk-mock'), `执行记录 ${logs.length} 条，不含日记正文和密钥`)
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
