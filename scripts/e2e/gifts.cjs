/**
 * 第八阶段 PR E：礼物的浏览器测试（本地运行，不在 CI 中）。【模拟模型】不是真实 DeepSeek，也不是真机。
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
  let mode = 'ok'
  await ctx.route('https://api.mock.test/**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}')
    bodies.push(b)
    if (mode === 'fail') return route.fulfill({ status: 503, body: '{"error":{"message":"busy"}}', headers: { 'access-control-allow-origin': '*' } })
    const choose = /只输出一行 JSON/.test(b.messages[0].content)
    const text = choose ? '{"giftId":"lamp","message":"晚上看书别太暗。"}' : (/冷静内敛/.test(b.messages[0].content) ? '……我会好好用的。谢谢。' : '哇！！好喜欢！')
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: text } }] }) })
  })
  await page.goto(BASE + '#/me')
  await page.waitForTimeout(800)
  await idb(page, `
    const t = db.transaction(['characters','settings','events'], 'readwrite')
    const ch = (id, name, personality, at) => ({ id, name, avatar: '', bio: '', personality, speakingStyle: '', backstory: '', relationToUser: '', worldId: 'world-default', createdAt: at, updatedAt: at, permissions: { useStickers: true, postMoments: false } })
    t.objectStore('characters').put(ch('c1', '沈星回', '冷静内敛', 1))
    t.objectStore('characters').put(ch('c2', '林小满', '活泼外向', 2))
    t.objectStore('settings').put({ key: 'ai-config', value: { service: 'custom', mode: 'direct', baseUrl: 'https://api.mock.test/v1', apiKey: 'sk-mock', proxyUrl: '', proxyToken: '', model: 'mock-model', temperature: 0.7, maxTokens: 300 } })
    t.objectStore('events').put({ id: 'e1', title: '初次认识', kind: 'anniversary', allDay: true, date: '2026-01-05', location: '', note: '', repeat: 'yearly', diaryIds: [], characterId: 'c1', anniversaryType: 'met', source: 'local', createdAt: 1, updatedAt: 1 })
    t.oncomplete = () => res(1)
  `)
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.locator('[role=tab]').nth(1).click()
  await page.getByRole('button', { name: '礼物', exact: true }).click()
  check(/#\/gifts/.test(page.url()), '桌面「礼物」进入礼物')
  check(await seen(page.getByText('还没有送过礼物。')) && (await seen(page.getByText(/虚拟礼物，不涉及真实的钱/))), '空状态，说明是虚拟礼物')

  // 送礼物给沈星回，关联纪念日
  await page.getByRole('button', { name: '送一份礼物' }).click()
  await page.getByRole('button', { name: /送给 沈星回/ }).click()
  await page.getByRole('tab', { name: '书与音乐' }).click()
  await page.getByRole('button', { name: '星空望远镜' }).click()
  await page.getByLabel('留言').fill('一起看星星吧')
  await page.getByLabel('关联纪念日').selectOption('e1')
  check((await page.getByText(/价格|支付|订单号|快递/).count()) === 0, '没有价格、支付、订单或物流')
  if (shots) await page.screenshot({ path: `${shots}/gift-send.png` })
  await page.getByRole('button', { name: '送出「星空望远镜」' }).click()
  check(await seen(page.locator('.gift-reply', { hasText: '我会好好用的' }), 8000), 'TA 根据人设回应（真实请求）')
  check(await seen(page.getByText('纪念：初次认识（2026-01-05）')), '关联纪念日')
  check(/星空望远镜/.test(bodies[0].messages[1].content) && /初次认识/.test(bodies[0].messages[1].content) && /冷静内敛/.test(bodies[0].messages[0].content), '请求包含礼物、纪念日与人设')
  if (shots) await page.screenshot({ path: `${shots}/gift-reply.png` })
  await page.getByRole('button', { name: '收藏' }).click()
  check(await seen(page.getByLabel('已收藏')), '收藏')

  // 失败 → 重试
  mode = 'fail'
  await page.goto(BASE + '#/gifts/send?character=c2')
  await page.getByRole('tab', { name: '甜点与饮品' }).click()
  await page.getByRole('button', { name: '一杯热可可' }).click()
  await page.getByRole('button', { name: '送出「一杯热可可」' }).click()
  check(await seen(page.getByRole('alert').getByText(/回应没有生成/), 8000), '回应失败时如实提示，不显示虚构回应')
  mode = 'ok'
  await page.getByRole('button', { name: '重试' }).click()
  check(await seen(page.locator('.gift-reply', { hasText: '好喜欢' }), 8000), '重试后得到真实回应（另一个角色的语气）')

  // 请 TA 送礼
  await page.goto(BASE + '#/gifts')
  await page.getByRole('button', { name: '请 TA 送我一份' }).click()
  await page.getByRole('dialog', { name: '请谁送礼物' }).getByRole('button', { name: /沈星回/ }).click()
  check(await seen(page.locator('.gift-message', { hasText: '晚上看书别太暗' }), 8000), '角色从清单中挑选礼物并留言')
  check(await seen(page.getByText('小夜灯')), '显示 TA 挑选的礼物')

  // 记录与筛选
  await page.goto(BASE + '#/gifts?tab=received')
  await seen(page.locator('.gift-row'))
  check((await page.locator('.gift-row').count()) === 1, '收到的礼物')
  await page.goto(BASE + '#/gifts?tab=sent')
  await seen(page.locator('.gift-row'))
  await page.waitForTimeout(200)
  check((await page.locator('.gift-row').count()) === 2, '送出的礼物')
  await page.getByRole('button', { name: '林小满', exact: true }).click()
  await page.waitForTimeout(300)
  check((await page.locator('.gift-row').count()) === 1 && (await seen(page.locator('.gift-row', { hasText: '热可可' }))), '按角色筛选（隔离）')
  await page.goto(BASE + '#/gifts?tab=starred')
  check(await seen(page.locator('.gift-row', { hasText: '星空望远镜' })), '收藏列表')
  if (shots) await page.screenshot({ path: `${shots}/gift-list.png` })
  await page.reload()
  check(await seen(page.locator('.gift-row', { hasText: '星空望远镜' })), '刷新后记录仍在')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
