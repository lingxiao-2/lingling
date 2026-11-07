/** 读取所选城市的天气（页面与桌面小组件共用）：先显示缓存，过期且已同意时联网更新；失败时保留旧数据并给出错误 */
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { CACHE_KEY, CACHE_MS, CITIES_KEY, CONSENT_KEY, getCached, getCities, getSelected, loadForecast, WeatherError, type Forecast, type WeatherCity } from './openMeteo'

export interface WeatherView {
  consent: boolean
  cities: WeatherCity[]
  city?: WeatherCity
  data?: Forecast
  loading: boolean
  error?: string
  refresh: () => void
}

export function useWeather(opts: { autoFetch?: boolean } = {}): WeatherView | undefined {
  const base = useLiveQuery(async () => {
    const [consentRow, cities, selected] = await Promise.all([db.settings.get(CONSENT_KEY), getCities(), getSelected()])
    await db.settings.get(CACHE_KEY)
    const city = cities.find((c) => c.id === selected) ?? cities[0]
    return { consent: consentRow?.value === true, cities, city, data: city ? await getCached(city.id) : undefined }
  }, [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [tick, setTick] = useState(0)
  const cityId = base?.city?.id
  const stale = !base?.data || Date.now() - base.data.fetchedAt >= CACHE_MS
  useEffect(() => {
    if (!base?.consent || !base.city || (!stale && tick === 0) || opts.autoFetch === false) return
    const ctrl = new AbortController()
    setLoading(true)
    setError(undefined)
    loadForecast(base.city, { force: tick > 0, signal: ctrl.signal })
      .catch((e) => {
        if ((e as Error)?.name !== 'AbortError') setError(e instanceof WeatherError ? e.message : String(e))
      })
      .finally(() => setLoading(false))
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, base?.consent, tick])
  if (!base) return undefined
  void CITIES_KEY
  return { ...base, loading, error, refresh: () => setTick((t) => t + 1) }
}
