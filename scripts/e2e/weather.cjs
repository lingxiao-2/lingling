/**
 * 第八阶段 PR C：天气 App 的浏览器测试（本地运行，不在 CI 中）。
 * 【模拟服务】Open-Meteo 由 page.route 模拟（包括配额用完的真实错误格式）；不是真机。
 * 设置 REAL=1 时不模拟，直接请求真实的 Open-Meteo（结果取决于当前网络与配额）。
 */
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const REAL = process.env.REAL === '1'
const shots = process.argv[2]
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const seen = (loc, t = 6000) => loc.first().waitFor({ timeout: t }).then(() => true, () => false)
const idb = (page, fn) => page.evaluate((src) => new Promise((res) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => new Function('db', 'res', src)(r.result, res) }), fn)

const cities = { 杭州: { id: 1808926, name: '杭州', latitude: 30.29, longitude: 120.16, admin1: '浙江省', country: '中国' }, 札幌: { id: 2128295, name: '札幌', latitude: 43.06, longitude: 141.35, admin1: '北海道', country: '日本' } }
const forecast = (t, code) => ({ current: { time: '2026-11-07T14:00', temperature_2m: t, apparent_temperature: t - 2, relative_humidity_2m: 66, precipitation: 0, weather_code: code, wind_speed_10m: 9, wind_direction_10m: 90, is_day: 1 }, current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', precipitation: 'mm' }, daily: { time: ['2026-11-07', '2026-11-08', '2026-11-09'], weather_code: [code, 3, 71], temperature_2m_max: [t + 3, 12, 2], temperature_2m_min: [t - 4, 5, -3], precipitation_probability_max: [10, 20, 70], precipitation_sum: [0, 0, 2], wind_speed_10m_max: [15, 12, 20] } })

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  const page = await ctx.newPage()
  const errors = []
  const requests = []
  page.on('pageerror', (e) => errors.push(String(e)))
  let mode = 'ok'
  if (!REAL) {
    await ctx.route('https://geocoding-api.open-meteo.com/**', (r) => { requests.push(r.request().url()); const q = new URL(r.request().url()).searchParams.get('name'); r.fulfill({ json: { results: cities[q] ? [cities[q]] : [] }, headers: { 'access-control-allow-origin': '*' } }) })
    await ctx.route('https://api.open-meteo.com/**', (r) => {
      requests.push(r.request().url())
      if (mode === 'quota') return r.fulfill({ status: 429, json: { error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }, headers: { 'access-control-allow-origin': '*' } })
      const lat = Number(new URL(r.request().url()).searchParams.get('latitude'))
      r.fulfill({ json: lat > 40 ? forecast(-2, 73) : forecast(14, 2), headers: { 'access-control-allow-origin': '*' } })
    })
  }

  // 旧版（v2）桌面布局的用户：升级后多一个天气小组件，其他不变
  await page.goto(BASE + '#/me')
  await page.waitForTimeout(800)
  await idb(page, `const t = db.transaction('settings','readwrite'); t.objectStore('settings').put({ key: 'desktop-layout', value: { version: 2, pages: [[{ kind: 'app', app: 'tarot' }], [{ kind: 'widget', id: 'w-music', widget: 'music', size: 'medium' }, { kind: 'app', app: 'mail' }], []], dock: ['me', 'messages'], page: 1 } }); t.oncomplete = () => res(1)`)
  await page.goto(BASE + '#/')
  await page.waitForSelector('[aria-label="Dock"]')
  await page.waitForTimeout(800)
  const w = page.locator('[role=group][aria-label^="天气"]')
  check(await seen(w), '旧版布局升级后出现天气小组件')
  check(await seen(w.getByText('点按设置城市')), '未设置时小组件说明怎么设置（不显示虚构天气）')
  const layout = await idb(page, `const r = db.transaction('settings').objectStore('settings').get('desktop-layout'); r.onsuccess = () => res(r.result.value)`)
  check(layout.version === 3 && layout.pages[0][0].app === 'tarot' && JSON.stringify(layout.dock) === '["me","messages"]', '用户原来的布局与 Dock 不变')
  check(requests.length === 0, '没有同意前没有任何天气请求')
  await w.click()
  check(/#\/weather/.test(page.url()), '点按小组件进入天气')

  // 同意 → 搜索 → 添加
  check(await seen(page.getByText(/会把你输入的城市名称/)), '说明会发送什么、隐私影响')
  await page.getByRole('button', { name: '同意并继续' }).click()
  await page.getByLabel('城市名称').fill('杭州')
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('.city-result', { hasText: '杭州' }).first().click()
  if (!REAL) {
    check(await seen(page.getByLabel('当前温度').filter({ hasText: '14°' })), '当前温度')
    check(await seen(page.getByText('多云').first()), '天气描述')
    check((await page.locator('.forecast-row').count()) === 3, '未来预报')
    check(await seen(page.getByText(/更新于 \d{2}:\d{2}/)) && (await seen(page.getByRole('link', { name: 'Open-Meteo' }))), '显示更新时间与数据来源')
    const allowed = new Set(['name', 'count', 'language', 'format', 'latitude', 'longitude', 'current', 'daily', 'timezone', 'forecast_days'])
    check(requests.every((u) => [...new URL(u).searchParams.keys()].every((k) => allowed.has(k))), '请求只包含城市名称或所选城市的经纬度，没有设备位置')
    if (shots) await page.screenshot({ path: `${shots}/weather.png` })

    // 第二个城市并切换
    await page.getByRole('button', { name: '添加城市' }).click()
    await page.getByLabel('城市名称').fill('札幌')
    await page.getByRole('button', { name: '搜索' }).click()
    await page.locator('.city-result', { hasText: '札幌' }).click()
    check(await seen(page.getByLabel('当前温度').filter({ hasText: '-2°' })), '添加第二个城市并显示')
    await page.getByRole('tab', { name: '杭州' }).click()
    check(await seen(page.getByLabel('当前温度').filter({ hasText: '14°' })), '手动切换城市')

    // 配额用完：如实报错，旧数据注明时间
    mode = 'quota'
    await page.getByRole('button', { name: '刷新天气' }).click()
    check(await seen(page.getByRole('alert').getByText(/免费请求次数已用完/)), '配额用完时如实报错')
    check(await seen(page.getByRole('alert').getByText(/的旧数据，可能已经过时/)), '保留的旧数据注明更新时间')
    if (shots) await page.screenshot({ path: `${shots}/weather-error.png` })
    // 新城市没有缓存时：不显示任何天气
    await page.getByRole('button', { name: '添加城市' }).click()
    cities['西安'] = { id: 1790630, name: '西安', latitude: 34.26, longitude: 108.93, admin1: '陕西省', country: '中国' }
    await page.getByLabel('城市名称').fill('西安')
    await page.getByRole('button', { name: '搜索' }).click()
    await page.locator('.city-result', { hasText: '西安' }).waitFor()
    await page.waitForTimeout(300)
    await page.locator('.city-result', { hasText: '西安' }).click()
    await page.getByRole('tab', { name: '西安' }).waitFor()
    const noData = (await seen(page.getByRole('alert').getByText(/免费请求次数已用完/))) && (await page.getByLabel('当前温度').count()) === 0
    check(noData, '没有数据时不显示虚构的天气')
    mode = 'ok'
    await page.getByRole('tab', { name: '杭州' }).click()

    // 桌面小组件同步
    await page.goto(BASE + '#/')
    await page.waitForSelector('[aria-label="Dock"]')
    check(await seen(page.locator('[role=group][aria-label="天气：杭州 14°"]')), '桌面小组件显示所选城市的天气')
    if (shots) await page.screenshot({ path: `${shots}/weather-widget.png` })
    await page.reload()
    check(await seen(page.locator('[role=group][aria-label="天气：杭州 14°"]')), '刷新后城市与天气仍在')
  } else {
    const ok = await seen(page.getByLabel('当前温度'), 15000)
    const err = await page.getByRole('alert').allTextContents()
    console.log(ok ? 'REAL: 获取到真实天气' : `REAL: 没有获取到天气，页面如实显示：${err.join(' ')}`)
    check(ok || err.length > 0, '真实服务：要么显示真实天气，要么如实报错')
  }
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await browser.close()
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
