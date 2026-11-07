/**
 * 天气：按城市名称搜索（不使用定位）、收藏多个城市并切换、当前天气与 7 天预报、更新时间与数据来源。
 * 第一次联网前需要你同意；请求失败时如实显示错误（有旧数据时注明「上次更新」时间），不显示虚构的天气。
 */
import { useState } from 'react'
import NavBar, { NavButton } from '../components/NavBar'
import { ConfirmDialog } from '../components/Sheet'
import { Icon } from '../theme/icons'
import { wxIcon } from '../weather/wxIcon'
import { addCity, CACHE_MS, describeCode, removeCity, searchCities, selectCity, setConsent, SOURCE, WeatherError, windDirText, type WeatherCity } from '../weather/openMeteo'
import { useWeather } from '../weather/useWeather'

const hm = (ts: number) => `${String(new Date(ts).getHours()).padStart(2, '0')}:${String(new Date(ts).getMinutes()).padStart(2, '0')}`
const r = (n: number) => (Number.isFinite(n) ? Math.round(n) : '–')
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const dayName = (date: string, i: number) => (i === 0 ? '今天' : i === 1 ? '明天' : WEEK[new Date(`${date}T12:00:00`).getDay()])
export const cityLabel = (c: WeatherCity) => [c.name, c.admin1 && c.admin1 !== c.name ? c.admin1 : '', c.country].filter(Boolean).join(' · ')

function Search({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<WeatherCity[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    if (!q.trim()) return
    setBusy(true)
    setErr('')
    try {
      setList(await searchCities(q))
    } catch (e) {
      setErr(e instanceof WeatherError ? e.message : String(e))
      setList(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-4 mt-2 card px-4 py-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void go() }}>
        <input aria-label="城市名称" value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入城市名称，例如：杭州" maxLength={60} className="flex-1 min-w-0 h-9 rounded-full bg-white/70 border border-[var(--c-line)] px-4 text-[15px] outline-none" />
        <button disabled={busy || !q.trim()} className="press h-9 px-4 rounded-full bg-[var(--c-accent)] text-white text-[13.5px] disabled:opacity-50">{busy ? '搜索中…' : '搜索'}</button>
      </form>
      <p className="mt-1.5 text-[11px] text-[var(--c-text-3)]">只用城市名称查询，不会获取你的位置。</p>
      {err && <p role="alert" className="mt-1.5 text-[12px] text-[var(--c-danger)]">{err}</p>}
      {list && list.length === 0 && <p className="mt-2 text-[12.5px] text-[var(--c-text-3)]">没有找到这个城市，换个写法试试。</p>}
      {list?.map((c) => (
        <button key={c.id} className="city-result press mt-1 w-full rounded-[10px] px-2 py-2 text-left text-[13.5px] hover:bg-white/50" onClick={() => void addCity(c).then(onDone)}>{cityLabel(c)}</button>
      ))}
    </div>
  )
}

export default function WeatherPage() {
  const w = useWeather()
  const [searching, setSearching] = useState(false)
  const [removing, setRemoving] = useState<WeatherCity | null>(null)
  if (!w) return <div className="h-dvh" />
  const d = w.data
  const stale = d && Date.now() - d.fetchedAt >= CACHE_MS
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="天气" back="/" right={w.consent && w.cities.length ? <NavButton label="添加城市" icon="plus" onClick={() => setSearching((x) => !x)} /> : undefined} />
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        {!w.consent ? (
          <div className="mx-4 mt-3 card px-4 py-4 text-[13px] leading-relaxed text-[var(--c-text-2)]">
            <div className="serif-zh text-[16px] text-[var(--c-brand)]">使用天气前</div>
            <p className="mt-2">天气数据来自 <b>Open-Meteo</b>（免费、不需要账号）。查询时会把你输入的<b>城市名称</b>或所选城市的<b>经纬度</b>发送给 Open-Meteo，它的服务器会看到你的 IP 地址。</p>
            <p className="mt-1">聆聆不会获取你的位置，也不会发送聊天、日记等任何其他内容。Open-Meteo 仅供非商业使用，每天约 1 万次请求以内。</p>
            <button className="press mt-3 h-10 w-full rounded-full bg-[var(--c-accent)] text-white text-[14px]" onClick={() => void setConsent(true)}>同意并继续</button>
            <p className="mt-2 text-[11px] text-[var(--c-text-3)]">不同意也不影响聆聆的其他功能。之后可以在本页底部撤回。</p>
          </div>
        ) : (
          <>
            {(searching || w.cities.length === 0) && <Search onDone={() => setSearching(false)} />}
            {w.cities.length > 0 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1" role="tablist" aria-label="收藏的城市">
                {w.cities.map((c) => (
                  <button key={c.id} role="tab" aria-selected={c.id === w.city?.id} className={`press shrink-0 h-8 px-3.5 rounded-full text-[13px] ${c.id === w.city?.id ? 'bg-[var(--c-accent)] text-white' : 'bg-white/55 text-[var(--c-text-2)]'}`} onClick={() => void selectCity(c.id)} onContextMenu={(e) => { e.preventDefault(); setRemoving(c) }}>{c.name}</button>
                ))}
              </div>
            )}
            {w.city && (
              <>
                {w.error && (
                  <p role="alert" className="mx-4 mt-2 rounded-[14px] bg-white/60 px-4 py-2.5 text-[12.5px] text-[var(--c-danger)]">
                    {w.error}{d ? `。下面是 ${hm(d.fetchedAt)} 的旧数据，可能已经过时。` : ''}
                  </p>
                )}
                {!d && w.loading && <p className="mt-12 text-center text-[13px] text-[var(--c-text-3)]">正在获取天气…</p>}
                {!d && !w.loading && !w.error && <p className="mt-12 text-center text-[13px] text-[var(--c-text-3)]">还没有天气数据</p>}
                {d && (
                  <div className="weather-now mx-4 mt-3 rounded-[24px] px-5 py-5 text-center">
                    <div className="text-[14px] tracking-[0.1em] text-[#4a5f7b]">{cityLabel(w.city)}</div>
                    <div className="mt-2 flex items-center justify-center gap-3 text-[#4f6a8f]">
                      <Icon name={wxIcon(d.current.code, d.current.isDay)} size="lg" stroke="thin" />
                      <span className="desk-serif weather-temp tabular-nums" aria-label="当前温度">{r(d.current.temp)}°</span>
                    </div>
                    <div className="serif-zh text-[16px] text-[#3f5674]">{describeCode(d.current.code, d.current.isDay).text}</div>
                    <div className="mt-1 text-[12.5px] text-[#6d819c]">体感 {r(d.current.feels)}° · 湿度 {r(d.current.humidity)}%</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px] text-[#4a5f7b]">
                      <span className="flex items-center justify-center gap-1 rounded-[12px] bg-white/45 py-1.5"><Icon name="wind" size="xs" stroke="thin" />{windDirText(d.current.windDir)} {r(d.current.wind)} {d.units.wind}</span>
                      <span className="flex items-center justify-center gap-1 rounded-[12px] bg-white/45 py-1.5"><Icon name="droplets" size="xs" stroke="thin" />降水 {Number.isFinite(d.current.precip) ? d.current.precip : '–'} {d.units.precip}</span>
                    </div>
                  </div>
                )}
                {d && d.daily.length > 0 && (
                  <div className="mx-4 mt-3 card overflow-hidden">
                    {d.daily.map((x, i) => (
                      <div key={x.date} className="forecast-row flex items-center gap-3 px-4 py-2 hairline-b last:border-b-0 text-[13.5px]">
                        <span className="w-10 text-[var(--c-text-2)]">{dayName(x.date, i)}</span>
                        <span className="text-[#5d7392]"><Icon name={wxIcon(x.code)} size="sm" stroke="thin" /></span>
                        <span className="flex-1 truncate text-[12.5px] text-[var(--c-text-3)]">{describeCode(x.code).text}{x.precipProb !== null && Number.isFinite(x.precipProb) ? ` · 降水 ${x.precipProb}%` : ''}</span>
                        <span className="tabular-nums text-[var(--c-text-3)]">{r(x.min)}°</span>
                        <span className="tabular-nums text-[var(--c-text)]">{r(x.max)}°</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mx-6 mt-3 flex items-center justify-between text-[11px] text-[var(--c-text-3)]">
                  <span>{d ? `更新于 ${hm(d.fetchedAt)}${stale ? '（已超过 30 分钟）' : ''}` : ''} · 数据来源 <a href={SOURCE.url} target="_blank" rel="noopener noreferrer" className="underline">{SOURCE.name}</a>（{SOURCE.license}）</span>
                  <button aria-label="刷新天气" disabled={w.loading} className="press flex items-center gap-1 text-[var(--c-accent-strong)] disabled:opacity-40" onClick={w.refresh}><Icon name="refresh" size="xs" />{w.loading ? '更新中' : '刷新'}</button>
                </div>
                <div className="mx-6 mt-3 flex justify-between text-[11.5px]">
                  <button className="press text-[var(--c-text-3)]" onClick={() => setRemoving(w.city!)}>移除「{w.city.name}」</button>
                  <button className="press text-[var(--c-text-3)]" onClick={() => void setConsent(false)}>撤回联网同意</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
      {removing && <ConfirmDialog title={`移除「${removing.name}」？`} message="只是从收藏中移除。" confirmText="移除" onCancel={() => setRemoving(null)} onConfirm={() => void removeCity(removing.id).then(() => setRemoving(null))} />}
    </div>
  )
}
