/**
 * 天气数据：Open-Meteo（https://open-meteo.com，免费、不需要账号或密钥）。
 *  - 条款：仅限非商业使用，每天约 10,000 次请求以内；数据按 CC BY 4.0 需要署名（页面上显示「数据来源 Open-Meteo」）
 *  - 隐私：只发送你输入的城市名称或所选城市的经纬度；Open-Meteo 的服务器会看到你的 IP 地址。不使用定位
 *  - 第一次联网前需要你同意；请求失败时如实显示错误，不显示虚构的天气
 */
import { db } from '../db/db'

export const SOURCE = { name: 'Open-Meteo', url: 'https://open-meteo.com/', license: 'CC BY 4.0' }
export const CONSENT_KEY = 'weather-consent'
export const CITIES_KEY = 'weather-cities'
export const CACHE_KEY = 'weather-cache'
export const CACHE_MS = 30 * 60_000

export interface WeatherCity { id: string; name: string; admin1?: string; country?: string; lat: number; lon: number; tz?: string }

export interface Forecast {
  fetchedAt: number
  current: { time: string; temp: number; feels: number; humidity: number; precip: number; code: number; wind: number; windDir: number; isDay: boolean }
  daily: { date: string; code: number; max: number; min: number; precipProb: number | null; precipSum: number; windMax: number }[]
  units: { temp: string; wind: string; precip: string }
}

export class WeatherError extends Error {
  constructor(message: string, public kind: 'network' | 'quota' | 'server' | 'invalid' | 'consent') {
    super(message)
  }
}

/** WMO 天气代码 → 中文与图标 */
export function describeCode(code: number, isDay = true): { text: string; icon: 'sun' | 'moon' | 'cloudSun' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm' } {
  if (code === 0) return { text: isDay ? '晴' : '晴夜', icon: isDay ? 'sun' : 'moon' }
  if (code === 1) return { text: '大致晴朗', icon: isDay ? 'cloudSun' : 'moon' }
  if (code === 2) return { text: '多云', icon: 'cloudSun' }
  if (code === 3) return { text: '阴', icon: 'cloud' }
  if (code === 45 || code === 48) return { text: '雾', icon: 'fog' }
  if (code >= 51 && code <= 57) return { text: code >= 56 ? '冻毛毛雨' : '毛毛雨', icon: 'drizzle' }
  if (code >= 61 && code <= 67) return { text: code >= 66 ? '冻雨' : code === 65 ? '大雨' : code === 63 ? '中雨' : '小雨', icon: 'rain' }
  if (code >= 71 && code <= 77) return { text: code === 75 ? '大雪' : code === 73 ? '中雪' : code === 77 ? '米雪' : '小雪', icon: 'snow' }
  if (code >= 80 && code <= 82) return { text: code === 82 ? '强阵雨' : '阵雨', icon: 'rain' }
  if (code === 85 || code === 86) return { text: '阵雪', icon: 'snow' }
  if (code >= 95) return { text: code === 95 ? '雷阵雨' : '雷阵雨伴冰雹', icon: 'storm' }
  return { text: '未知', icon: 'cloud' }
}

export function windDirText(deg: number): string {
  return ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round((((deg % 360) + 360) % 360) / 45) % 8] + '风'
}

let fetcher: typeof fetch = (...a) => fetch(...a)
export function setWeatherFetchForTesting(f: typeof fetch | null) {
  fetcher = f ?? ((...a) => fetch(...a))
}

export async function hasConsent(): Promise<boolean> {
  return (await db.settings.get(CONSENT_KEY))?.value === true
}
export async function setConsent(on: boolean) {
  await db.settings.put({ key: CONSENT_KEY, value: on })
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  if (!(await hasConsent())) throw new WeatherError('还没有同意联网获取天气', 'consent')
  let res: Response
  try {
    res = await fetcher(url, { signal })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw new WeatherError('连不上天气服务，请检查网络后重试', 'network')
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 不是 JSON */
  }
  const reason = (body as { reason?: string } | null)?.reason
  if (res.status === 429 || /limit exceeded/i.test(reason ?? '')) throw new WeatherError('天气服务今天的免费请求次数已用完（Open-Meteo 的限制），请稍后再试', 'quota')
  if (!res.ok || (body as { error?: boolean } | null)?.error) throw new WeatherError(`天气服务返回错误${reason ? `：${reason}` : `（${res.status}）`}`, 'server')
  if (!body || typeof body !== 'object') throw new WeatherError('天气服务返回的数据无法识别', 'invalid')
  return body
}

/** 按城市名称搜索（不使用定位） */
export async function searchCities(name: string, signal?: AbortSignal): Promise<WeatherCity[]> {
  const q = name.trim().slice(0, 60)
  if (!q) return []
  const j = (await getJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '8', language: 'zh', format: 'json' })}`, signal)) as { results?: unknown[] }
  return (j.results ?? []).flatMap((r) => {
    const x = r as Record<string, unknown>
    const lat = Number(x.latitude)
    const lon = Number(x.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof x.name !== 'string') return []
    return [{ id: String(x.id ?? `${lat},${lon}`), name: x.name, admin1: typeof x.admin1 === 'string' ? x.admin1 : undefined, country: typeof x.country === 'string' ? x.country : undefined, lat, lon, tz: typeof x.timezone === 'string' ? x.timezone : undefined }]
  })
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

/** 解析预报；缺少关键字段时报错（不补造数据） */
export function parseForecast(j: unknown, now = Date.now()): Forecast {
  const o = j as { current?: Record<string, unknown>; daily?: Record<string, unknown[]>; current_units?: Record<string, string>; daily_units?: Record<string, string> }
  const c = o.current
  const temp = num(c?.temperature_2m)
  const code = num(c?.weather_code)
  if (!c || Number.isNaN(temp) || Number.isNaN(code)) throw new WeatherError('天气服务返回的数据不完整', 'invalid')
  const d = o.daily ?? {}
  const dates = Array.isArray(d.time) ? (d.time as string[]) : []
  return {
    fetchedAt: now,
    current: { time: String(c.time ?? ''), temp, feels: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m), precip: num(c.precipitation), code, wind: num(c.wind_speed_10m), windDir: num(c.wind_direction_10m), isDay: c.is_day !== 0 },
    daily: dates.map((date, i) => ({ date, code: num(d.weather_code?.[i]), max: num(d.temperature_2m_max?.[i]), min: num(d.temperature_2m_min?.[i]), precipProb: d.precipitation_probability_max?.[i] == null ? null : num(d.precipitation_probability_max[i]), precipSum: num(d.precipitation_sum?.[i]), windMax: num(d.wind_speed_10m_max?.[i]) })).filter((x) => !Number.isNaN(x.max) && !Number.isNaN(x.min)),
    units: { temp: o.current_units?.temperature_2m ?? '°C', wind: o.current_units?.wind_speed_10m ?? 'km/h', precip: o.current_units?.precipitation ?? 'mm' },
  }
}

export async function fetchForecast(city: WeatherCity, signal?: AbortSignal, now = Date.now()): Promise<Forecast> {
  const q = new URLSearchParams({
    latitude: city.lat.toFixed(4),
    longitude: city.lon.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
    timezone: 'auto',
    forecast_days: '7',
  })
  return parseForecast(await getJson(`https://api.open-meteo.com/v1/forecast?${q}`, signal), now)
}

/* ---------------- 城市与缓存 ---------------- */

export async function getCities(): Promise<WeatherCity[]> {
  const v = (await db.settings.get(CITIES_KEY))?.value as { cities?: unknown[] } | undefined
  return (Array.isArray(v?.cities) ? v!.cities : []).flatMap((x) => {
    const c = x as WeatherCity
    return typeof c?.id === 'string' && typeof c.name === 'string' && Number.isFinite(c.lat) && Number.isFinite(c.lon) ? [c] : []
  })
}

export async function getSelected(): Promise<string | undefined> {
  return ((await db.settings.get(CITIES_KEY))?.value as { selected?: string } | undefined)?.selected
}

async function writeCities(cities: WeatherCity[], selected?: string) {
  await db.settings.put({ key: CITIES_KEY, value: { cities: cities.slice(0, 12), selected: selected && cities.some((c) => c.id === selected) ? selected : cities[0]?.id } })
}

export async function addCity(c: WeatherCity): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const list = await getCities()
    await writeCities(list.some((x) => x.id === c.id) ? list : [...list, c], c.id)
  })
}
export async function removeCity(id: string): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const sel = await getSelected()
    await writeCities((await getCities()).filter((c) => c.id !== id), sel === id ? undefined : sel)
  })
}
export async function selectCity(id: string): Promise<void> {
  await db.transaction('rw', db.settings, async () => writeCities(await getCities(), id))
}

export async function getCached(id: string): Promise<Forecast | undefined> {
  const v = (await db.settings.get(CACHE_KEY))?.value as Record<string, Forecast> | undefined
  return v?.[id]
}
async function putCached(id: string, f: Forecast) {
  await db.transaction('rw', db.settings, async () => {
    const v = ((await db.settings.get(CACHE_KEY))?.value as Record<string, Forecast> | undefined) ?? {}
    const keep = new Set((await getCities()).map((c) => c.id))
    const next = Object.fromEntries(Object.entries({ ...v, [id]: f }).filter(([k]) => keep.has(k) || k === id))
    await db.settings.put({ key: CACHE_KEY, value: next })
  })
}

/** 取天气：缓存 30 分钟内直接用；否则联网，成功后更新缓存。失败时抛出错误（调用方可显示「上次更新」的旧数据并注明时间） */
export async function loadForecast(city: WeatherCity, opts: { force?: boolean; signal?: AbortSignal; now?: number } = {}): Promise<Forecast> {
  const now = opts.now ?? Date.now()
  const cached = await getCached(city.id)
  if (cached && !opts.force && now - cached.fetchedAt < CACHE_MS) return cached
  const f = await fetchForecast(city, opts.signal, now)
  await putCached(city.id, f)
  return f
}
