/**
 * 第八阶段 PR F：塔罗的浏览器测试（本地运行，不在 CI 中）。【模拟模型】不是真实 DeepSeek，也不是真机。
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
  await ctx.route('https://api.mock.test/**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}')
    bodies.push(b)
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: '这三张牌像一段慢慢展开的路。别把它当成答案，就当是让你停下来，看看自己现在真正在意的是什么。' } }] }) })
  })
  await page.goto(BASE + '#/me')
  await page.waitForTimeout(800)
  await idb(page, `const t = db.transaction(['characters','settings'], 'readwrite'); t.objectStore('characters').put({ id: 'c1', name: '沈星回', avatar: '', bio: '', personality: '冷静内敛', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'world-default', createdAt: 1, updatedAt: 1, permissions: { useStickers: true, postMoments: false } }); t.objectStore('settings').put({ key: 'ai-config', value: { service: 'custom', mode: 'direct', baseUrl: 'https://api.mock.test/v1', apiKey: 'sk-mock', proxyUrl: '', proxyToken: '', model: 'mock-model', temperature: 0.7, maxTokens: 300 } }); t.oncomplete = () => res(1)`)

  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.locator('[role=tab]').nth(1).click()
  await page.getByRole('button', { name: '塔罗', exact: true }).click()
  check(/#\/tarot/.test(page.url()), '桌面「塔罗」进入塔罗')
  check(await seen(page.getByText(/仅供娱乐与自我反思/)), '明确标注娱乐与自我反思')
  if (shots) await page.screenshot({ path: `${shots}/tarot-home.png` })

  // 三张牌阵
  await page.getByLabel('你的问题').fill('最近该怎么调整心情')
  await page.getByRole('radio', { name: '三张牌阵' }).click()
  await page.getByRole('radio', { name: '夜空' }).click()
  await page.getByRole('button', { name: '洗牌并抽牌' }).click()
  await page.waitForURL(/#\/tarot\/tarot_/)
  check(await seen(page.getByRole('button', { name: '过去：点按翻开' })), '牌背朝上，等待翻开')
  for (const p of ['过去', '现在', '未来']) await page.getByRole('button', { name: `${p}：点按翻开` }).click()
  await page.waitForTimeout(1000)
  const labels = await page.locator('.tarot-card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  check(labels.length === 3 && labels.every((l) => /（[正逆]位）$/.test(l)), `翻开后显示牌名与正逆位：${labels.join(' / ')}`)
  check((await page.locator('.card-meaning').count()) === 3, '每张牌的牌意')
  if (shots) await page.screenshot({ path: `${shots}/tarot-reading.png` })
  const saved = await idb(page, `const r = db.transaction('tarotReadings').objectStore('tarotReadings').getAll(); r.onsuccess = () => res(r.result)`)
  check(saved.length === 1 && saved[0].cards.length === 3 && saved[0].question === '最近该怎么调整心情', '占卜记录已保存')

  // AI 解读
  await page.getByRole('button', { name: '请角色解读' }).click()
  await page.getByRole('dialog', { name: '请谁解读' }).getByRole('button', { name: /沈星回/ }).click()
  check(await seen(page.locator('.tarot-interpretation', { hasText: '慢慢展开的路' }), 8000), '角色解读（真实请求）')
  const task = bodies[0].messages[1].content
  const names = labels.map((l) => l.split('：')[1].replace(/（.+$/, ''))
  check(names.every((n) => task.includes(n)) && task.includes('最近该怎么调整心情'), '解读请求包含真实抽到的牌和问题')
  check(/不要预测确定的未来/.test(bodies[0].messages[0].content), '解读要求不预测、不做重大决定建议')

  // 保存到日记（需要确认）
  await page.getByRole('button', { name: '保存到日记' }).click()
  check(await seen(page.getByText(/默认不允许 AI 读取/)), '保存前说明内容与隐私')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  check(await seen(page.getByRole('button', { name: /已保存到日记/ })), '保存到日记')
  const diary = await idb(page, `const r = db.transaction('diaries').objectStore('diaries').getAll(); r.onsuccess = () => res(r.result.map((d) => [d.title, d.aiReadable, d.tags]))`)
  check(diary.length === 1 && diary[0][1] === false && diary[0][2][0] === '塔罗', '日记不允许 AI 读取，带塔罗标签')
  await page.getByRole('button', { name: /已保存到日记/ }).click()
  check(await seen(page.getByText(/最近该怎么调整心情/)), '日记中能看到这次占卜')

  // 单张牌与记录
  await page.goto(BASE + '#/tarot')
  await page.getByRole('radio', { name: '单张牌' }).click()
  await page.getByRole('radio', { name: '银白星光' }).click()
  await page.getByRole('button', { name: '洗牌并抽牌' }).click()
  await page.waitForURL(/#\/tarot\/tarot_/)
  await page.getByRole('button', { name: '指引：点按翻开' }).click()
  await page.waitForTimeout(1000)
  check((await page.locator('.tarot-silver.is-revealed').count()) === 1, '单张牌、银白星光主题')
  await page.goto(BASE + '#/tarot')
  await seen(page.locator('.reading-row'))
  await page.waitForTimeout(300)
  check((await page.locator('.reading-row').count()) === 2, '占卜记录列表')
  await page.reload()
  await page.locator('.reading-row').last().click()
  check(await seen(page.locator('.tarot-interpretation')), '刷新后打开以前的记录，牌面与解读都在')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
