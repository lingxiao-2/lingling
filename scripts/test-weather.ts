/**
 * 第八阶段 PR C：天气（同意前不联网、城市搜索、数据解析、错误如实、缓存、城市管理）：npm test
 * 【模拟服务】Open-Meteo 的响应由本地模拟；真实服务另行在浏览器 / 真机中验证。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { addCity, describeCode, fetchForecast, getCached, getCities, getSelected, loadForecast, parseForecast, removeCity, searchCities, selectCity, setConsent, setWeatherFetchForTesting, windDirText, WeatherError } from '../src/weather/openMeteo'

let calls: string[] = []
let reply: () => Response
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const FORECAST = {
  current: { time: '2026-11-07T14:00', temperature_2m: 3.4, apparent_temperature: -0.6, relative_humidity_2m: 71, precipitation: 0.2, weather_code: 73, wind_speed_10m: 12.5, wind_direction_10m: 315, is_day: 1 },
  current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h', precipitation: 'mm' },
  daily: { time: ['2026-11-07', '2026-11-08'], weather_code: [73, 3], temperature_2m_max: [4.1, 6], temperature_2m_min: [-1.2, 0.5], precipitation_probability_max: [80, null], precipitation_sum: [3.1, 0], wind_speed_10m_max: [20, 10] },
}
const city = { id: '1816670', name: '北京', admin1: '北京市', country: '中国', lat: 39.9075, lon: 116.39723 }

beforeEach(async () => {
  await db.delete()
  await db.open()
  calls = []
  reply = () => json(FORECAST)
  setWeatherFetchForTesting((async (u: string) => { calls.push(String(u)); return reply() }) as unknown as typeof fetch)
})

test('没有同意之前不会发出任何网络请求', async () => {
  await assert.rejects(searchCities('北京'), (e: WeatherError) => e.kind === 'consent')
  await assert.rejects(fetchForecast(city), (e: WeatherError) => e.kind === 'consent')
  assert.equal(calls.length, 0)
})

test('搜索城市：只发送城市名称（中文结果）；不合法的结果被丢弃', async () => {
  await setConsent(true)
  reply = () => json({ results: [{ id: 1816670, name: '北京', latitude: 39.9, longitude: 116.4, admin1: '北京市', country: '中国', timezone: 'Asia/Shanghai' }, { id: 2, name: '坏数据' }] })
  const list = await searchCities('  北京 ')
  assert.deepEqual(list.map((c) => c.name), ['北京'])
  const u = new URL(calls[0])
  assert.equal(u.hostname, 'geocoding-api.open-meteo.com')
  assert.equal(u.searchParams.get('name'), '北京')
  assert.equal(u.searchParams.get('language'), 'zh')
  assert.ok(![...u.searchParams.keys()].some((k) => /lat|lon|ip|loc/i.test(k)), '没有发送位置')
  assert.deepEqual(await searchCities('   '), [])
})

test('解析预报：当前天气、7 天预报、单位；缺少关键字段时报错而不补造', () => {
  const f = parseForecast(FORECAST, 1000)
  assert.deepEqual([f.current.temp, f.current.code, f.current.isDay, f.fetchedAt], [3.4, 73, true, 1000])
  assert.equal(f.daily.length, 2)
  assert.equal(f.daily[1].precipProb, null)
  assert.equal(describeCode(73).text, '中雪')
  assert.equal(describeCode(0, false).text, '晴夜')
  assert.equal(windDirText(315), '西北风')
  assert.throws(() => parseForecast({ current: { weather_code: 1 } }), /不完整/)
  assert.throws(() => parseForecast({}), /不完整/)
})

test('错误如实：配额用完、服务器错误、网络断开都抛出可读的错误，不返回任何天气', async () => {
  await setConsent(true)
  reply = () => json({ error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }, 429)
  await assert.rejects(fetchForecast(city), (e: WeatherError) => e.kind === 'quota' && /次数已用完/.test(e.message))
  reply = () => json({ error: true, reason: 'Parameter latitude must be in range' }, 400)
  await assert.rejects(fetchForecast(city), (e: WeatherError) => e.kind === 'server' && /latitude/.test(e.message))
  setWeatherFetchForTesting((async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch)
  await assert.rejects(fetchForecast(city), (e: WeatherError) => e.kind === 'network')
  assert.equal(await getCached(city.id), undefined, '失败时不写入缓存')
})

test('缓存：30 分钟内不重复请求；刷新时强制更新；失败时保留上次成功的数据', async () => {
  await setConsent(true)
  await addCity(city)
  const a = await loadForecast(city, { now: 0 })
  await loadForecast(city, { now: 10 * 60_000 })
  assert.equal(calls.length, 1)
  await loadForecast(city, { now: 10 * 60_000, force: true })
  assert.equal(calls.length, 2)
  const u = new URL(calls[0])
  assert.deepEqual([u.searchParams.get('latitude'), u.searchParams.get('longitude')], ['39.9075', '116.3972'])
  reply = () => json({ error: true, reason: 'server down' }, 500)
  await assert.rejects(loadForecast(city, { now: 99 * 60_000 }))
  assert.equal((await getCached(city.id))!.current.temp, a.current.temp, '旧数据还在（页面会注明更新时间）')
})

test('城市管理：添加（不重复）、切换、移除后自动选中剩下的', async () => {
  await addCity(city)
  await addCity({ ...city })
  await addCity({ id: 'sh', name: '上海', lat: 31.2, lon: 121.5 })
  assert.deepEqual((await getCities()).map((c) => c.name), ['北京', '上海'])
  assert.equal(await getSelected(), 'sh')
  await selectCity(city.id)
  assert.equal(await getSelected(), city.id)
  await removeCity(city.id)
  assert.equal(await getSelected(), 'sh')
})
