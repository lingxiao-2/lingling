/** 世界时钟：城市列表、时区换算（使用浏览器内置的时区数据，不联网） */
import { db } from '../db/db'

export interface WorldCity { id: string; name: string; tz: string }

export const CITY_PRESETS: WorldCity[] = [
  { id: 'shanghai', name: '北京 / 上海', tz: 'Asia/Shanghai' },
  { id: 'hongkong', name: '香港', tz: 'Asia/Hong_Kong' },
  { id: 'taipei', name: '台北', tz: 'Asia/Taipei' },
  { id: 'tokyo', name: '东京', tz: 'Asia/Tokyo' },
  { id: 'seoul', name: '首尔', tz: 'Asia/Seoul' },
  { id: 'singapore', name: '新加坡', tz: 'Asia/Singapore' },
  { id: 'bangkok', name: '曼谷', tz: 'Asia/Bangkok' },
  { id: 'dubai', name: '迪拜', tz: 'Asia/Dubai' },
  { id: 'moscow', name: '莫斯科', tz: 'Europe/Moscow' },
  { id: 'london', name: '伦敦', tz: 'Europe/London' },
  { id: 'paris', name: '巴黎', tz: 'Europe/Paris' },
  { id: 'berlin', name: '柏林', tz: 'Europe/Berlin' },
  { id: 'reykjavik', name: '雷克雅未克', tz: 'Atlantic/Reykjavik' },
  { id: 'newyork', name: '纽约', tz: 'America/New_York' },
  { id: 'chicago', name: '芝加哥', tz: 'America/Chicago' },
  { id: 'losangeles', name: '洛杉矶', tz: 'America/Los_Angeles' },
  { id: 'vancouver', name: '温哥华', tz: 'America/Vancouver' },
  { id: 'saopaulo', name: '圣保罗', tz: 'America/Sao_Paulo' },
  { id: 'sydney', name: '悉尼', tz: 'Australia/Sydney' },
  { id: 'auckland', name: '奥克兰', tz: 'Pacific/Auckland' },
  { id: 'honolulu', name: '檀香山', tz: 'Pacific/Honolulu' },
]

export const CITIES_KEY = 'clock-cities'
export const DEFAULT_CITIES = ['tokyo', 'london', 'newyork']

export async function getCities(): Promise<WorldCity[]> {
  const v = (await db.settings.get(CITIES_KEY))?.value
  const ids = Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : DEFAULT_CITIES
  return ids.map((id) => CITY_PRESETS.find((c) => c.id === id)).filter((c): c is WorldCity => !!c)
}

export async function setCities(ids: string[]): Promise<void> {
  const valid = [...new Set(ids)].filter((id) => CITY_PRESETS.some((c) => c.id === id)).slice(0, 12)
  await db.settings.put({ key: CITIES_KEY, value: valid })
}

/** 某个时区在某一时刻的时间、与本地的日期差、时差（小时） */
export function zoneTime(tz: string, now: Date): { time: string; dayDiff: number; offsetHours: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]))
  const zoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())
  const offsetHours = Math.round(((zoned - local) / 3_600_000) * 2) / 2
  const dayDiff = Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000)
  return { time: `${parts.hour}:${parts.minute}`, dayDiff, offsetHours }
}

export function diffLabel(dayDiff: number, offsetHours: number): string {
  const day = dayDiff === 0 ? '今天' : dayDiff > 0 ? '明天' : '昨天'
  const h = offsetHours === 0 ? '时间相同' : `${offsetHours > 0 ? '快' : '慢'} ${Math.abs(offsetHours)} 小时`
  return `${day} · ${h}`
}

/** 基于最新保存的列表修改（避免连续快速操作时用到旧列表而丢掉刚加的城市） */
export async function editCities(fn: (ids: string[]) => string[]): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    await setCities(fn((await getCities()).map((c) => c.id)))
  })
}
