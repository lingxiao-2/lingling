/**
 * 第八阶段 PR D：信箱的浏览器测试（本地运行，不在 CI 中）。
 * 【模拟模型】聊天接口由 page.route 模拟（按请求里的人设返回不同的信）；不是真实 DeepSeek，也不是真机。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 6000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)
const idb = (page, fn) => page.evaluate((src) => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => new Function('db', 'res', src)(r.result, res) }), fn)

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const bodies = []
  let failNext = false
  await ctx.route('https://api.mock.test/**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}')
    bodies.push(b)
    if (failNext) { failNext = false; return route.fulfill({ status: 500, body: '{"error":{"message":"server busy"}}', headers: { 'access-control-allow-origin': '*' } }) }
    const sys = b.messages[0].content
    const isReply = /寄来了一封信/.test(b.messages[1].content)
    const text = /冷静内敛/.test(sys)
      ? (isReply ? '标题：收到你的信\n\n小雪：\n信我读了两遍。你说的路灯，我也记得。今晚观测结束得早，我会早点回去。\n——沈星回' : '标题：雪落之前\n\n小雪：\n今天的星空很干净。我不太会说漂亮话，只是想到你说过喜欢冬天的夜色，就想写几句。\n——沈星回')
      : '标题：嘿！\n\n小雪呀～今天店里来了好多客人，我一边拉花一边想着要给你写信，哈哈，是不是很突然！\n——小满'
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: text } }] }) })
  })

  await page.goto(BASE + '#/me')
  await page.waitForTimeout(800)
  await idb(page, `
    const t = db.transaction(['characters','settings','memories'], 'readwrite')
    const ch = (id, name, personality, speakingStyle, at) => ({ id, name, avatar: '', bio: '', personality, speakingStyle, backstory: '', relationToUser: '', worldId: 'world-default', createdAt: at, updatedAt: at, permissions: { useStickers: true, postMoments: false } })
    t.objectStore('characters').put(ch('c1', '沈星回', '冷静内敛，话少', '克制简短', 1))
    t.objectStore('characters').put(ch('c2', '林小满', '活泼外向', '爱用语气词', 2))
    t.objectStore('settings').put({ key: 'ai-config', value: { service: 'custom', mode: 'direct', baseUrl: 'https://api.mock.test/v1', apiKey: 'sk-mock', proxyUrl: '', proxyToken: '', model: 'mock-model', temperature: 0.7, maxTokens: 300 } })
    t.objectStore('settings').put({ key: 'profile', value: { nickname: '小雪', signature: '' } })
    t.objectStore('memories').put({ id: 'm1', characterId: 'c1', kind: 'preference', content: '小雪喜欢冬天的夜色', sourceMessageIds: [], status: 'active', createdAt: 1 })
    t.oncomplete = () => res(1)
  `)

  // 桌面进入信箱
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.locator('[role=tab]').nth(1).click()
  await page.getByRole('button', { name: '信箱', exact: true }).click()
  check(/#\/mail/.test(page.url()), '桌面「信箱」进入信箱')
  check(await seen(page.getByText(/还没有来信/)), '空状态')

  // 邀请沈星回写信
  await page.getByRole('button', { name: '邀请写信' }).click()
  await page.getByRole('dialog', { name: '邀请写信' }).getByRole('button', { name: /沈星回/ }).click()
  await page.getByLabel('信的主题').fill('初雪那天')
  await page.getByRole('button', { name: '夜空' }).click()
  await page.getByRole('button', { name: '请 TA 写信' }).click()
  check(await seen(page.locator('.letter-job', { hasText: '沈星回的信到了' }), 8000), '真实请求模型后来信到达')
  check(/冷静内敛/.test(bodies[0].messages[0].content) && /小雪喜欢冬天的夜色/.test(bodies[0].messages[0].content) && /初雪那天/.test(bodies[0].messages[1].content), '请求包含这个角色的人设、记忆与主题')
  check(await seen(page.locator('.letter-row', { hasText: '雪落之前' }).getByLabel('未读')), '收件箱显示未读')
  check(await seen(page.getByRole('tab', { name: '收件箱 1' })), '收件箱未读数')

  // 林小满的信风格不同
  await page.getByRole('button', { name: '邀请写信' }).click()
  await page.getByRole('dialog', { name: '邀请写信' }).getByRole('button', { name: /林小满/ }).click()
  await page.getByRole('button', { name: '请 TA 写信' }).click()
  check(await seen(page.locator('.letter-row', { hasText: '嘿！' }), 8000), '另一个角色的来信')
  check(/活泼外向/.test(bodies[1].messages[0].content) && !/冷静内敛/.test(bodies[1].messages[0].content), '不同角色使用各自的人设（不共用模板）')

  // 读信
  await page.locator('.letter-row', { hasText: '雪落之前' }).click()
  check(await seen(page.locator('.letter-body', { hasText: '冬天的夜色' })), '读信')
  check(await seen(page.locator('article.paper-night')), '使用所选信纸')
  check(await seen(page.getByText('由 mock-model 以 沈星回 的身份写下')), '标注由哪个模型写下')
  if (shots) await page.screenshot({ path: `${shots}/mail-letter.png` })
  await page.getByRole('button', { name: '收藏' }).click()
  check(await seen(page.getByLabel('已收藏')), '收藏')

  // 提议共同记忆：只进入待确认
  await page.getByRole('button', { name: '提议保存为共同记忆' }).click()
  check(await seen(page.getByText(/信里的情节可能是角色想象或虚构的/)), '提醒信里可能有虚构情节')
  await page.getByLabel('要记住的事').fill('我们约好下次一起看初雪')
  await page.getByLabel('记忆类型').selectOption('promise')
  await page.getByRole('button', { name: '放进待确认' }).click()
  check(await seen(page.getByText(/已放进「待确认」/)), '提议成功')
  const mems = await idb(page, `const r = db.transaction('memories').objectStore('memories').getAll(); r.onsuccess = () => res(r.result.map((m) => [m.characterId, m.content, m.status]))`)
  check(mems.some(([c, t, s]) => c === 'c1' && t === '我们约好下次一起看初雪' && s === 'pending'), '只进入待确认，没有直接生效')
  await page.getByRole('button', { name: '好', exact: true }).click()

  // 回信 → 寄出 → 请 TA 回信
  await page.getByRole('button', { name: '回信', exact: true }).click()
  check((await page.getByLabel('标题').inputValue()) === '回信：雪落之前', '回信自动带上标题')
  await page.getByLabel('正文').fill('我也记得那天的雪，和你站在路灯下。')
  await page.waitForTimeout(1200)
  check(await seen(page.getByText('草稿已保存')), '自动保存草稿')
  await page.getByRole('button', { name: '寄出' }).click()
  check(await seen(page.getByText('信已寄出，保存在发件箱。')), '寄出')
  const n0 = bodies.length
  await page.getByRole('button', { name: '请 沈星回 回信' }).click()
  check(await seen(page.getByRole('button', { name: /沈星回的回信：收到你的信/ }), 10000) && bodies.length === n0 + 1, '请 TA 回信：回信到达')
  const replyReq = bodies[bodies.length - 1]
  check(/我也记得那天的雪/.test(replyReq.messages[1].content) && !/拉花/.test(JSON.stringify(replyReq)), '回信请求包含你的信，不包含其他角色的信')

  // 失败时不保存
  const before = await idb(page, `const r = db.transaction('letters').objectStore('letters').count(); r.onsuccess = () => res(r.result)`)
  failNext = true
  await page.goto(BASE + '#/mail')
  await page.getByRole('button', { name: '邀请写信' }).click()
  await page.getByRole('dialog', { name: '邀请写信' }).getByRole('button', { name: /林小满/ }).click()
  await page.getByRole('button', { name: '请 TA 写信' }).click()
  check(await seen(page.locator('.letter-job', { hasText: '没有写成' }), 8000), '模型出错时如实提示')
  const after = await idb(page, `const r = db.transaction('letters').objectStore('letters').count(); r.onsuccess = () => res(r.result)`)
  check(after === before, '模型出错时没有保存任何信件')

  // 草稿箱
  await page.goto(BASE + '#/mail/new?character=c2')
  await page.getByLabel('标题').fill('还没写完')
  await page.getByLabel('正文').fill('今天想说的话太多了')
  await page.waitForTimeout(1200)
  await page.goto(BASE + '#/mail?f=drafts')
  await page.locator('.letter-row', { hasText: '还没写完' }).click()
  check((await page.getByLabel('正文').inputValue()) === '今天想说的话太多了', '草稿箱中打开草稿继续写')

  // 搜索、按角色筛选、删除恢复
  await page.goto(BASE + '#/mail')
  await page.getByPlaceholder('搜索信件').fill('拉花')
  check((await page.locator('.letter-row').count()) === 1, '搜索信件')
  await page.getByPlaceholder('搜索信件').fill('')
  await page.getByRole('button', { name: '沈星回', exact: true }).click()
  await page.waitForTimeout(300)
  check((await page.locator('.letter-row', { hasText: '嘿！' }).count()) === 0, '按角色筛选：只看这个角色的信')
  await page.locator('.letter-row', { hasText: '雪落之前' }).click()
  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('button', { name: '删除（移到最近删除）' }).click()
  await page.goto(BASE + '#/mail?f=trash')
  check(await seen(page.locator('.letter-row', { hasText: '雪落之前' })), '删除后在最近删除中')
  await page.locator('.letter-row', { hasText: '雪落之前' }).click()
  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('button', { name: '恢复' }).click()
  await page.goto(BASE + '#/mail?f=starred')
  check(await seen(page.locator('.letter-row', { hasText: '雪落之前' })), '恢复后仍在收藏中')
  if (shots) await page.screenshot({ path: `${shots}/mail-list.png` })

  // 角色资料页入口
  await page.goto(BASE + '#/character/c1')
  check(await seen(page.getByText(/往来信件 \d+ 封/)), '角色资料页显示往来信件')
  await page.getByText(/往来信件/).click()
  check(/#\/mail\?character=c1/.test(page.url()), '从角色资料页进入这个角色的信件')
  await page.reload()
  check(await seen(page.locator('.letter-row', { hasText: '收到你的信' })), '刷新后信件仍在')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
