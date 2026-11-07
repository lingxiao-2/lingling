/**
 * 时钟：时钟与世界时钟 / 秒表 / 倒计时 / 记录。
 * 计时都按时间点计算，切换页面与刷新后仍然准确；提醒能力如实说明（前台、后台、iPhone 系统提醒）。
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import { ActionSheet } from '../components/Sheet'
import ShortcutRunCard from '../components/ShortcutRunCard'
import { Icon } from '../theme/icons'
import { db } from '../db/db'
import type { ClockTimer } from '../db/schema'
import { clockText } from '../desktop/widgets'
import { CITY_PRESETS, CITIES_KEY, diffLabel, editCities, getCities, zoneTime } from '../clock/world'
import { attachShortcutRun, cancelTimer, clearHistory, createTimer, durationLabel, elapsed, EMPTY_STOPWATCH, formatMs, lapSw, loadStopwatch, pauseSw, pauseTimer, remaining, resumeTimer, saveStopwatch, startSw, type Stopwatch } from '../clock/timers'
import { unlockAudio } from '../clock/chime'
import { planReminder, prepareRun } from '../ios/actions'
import { localDate } from '../life/diary'

type Tab = 'clock' | 'stopwatch' | 'timer' | 'history'

/** 每 interval 毫秒刷新一次 */
function useTick(interval: number, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(id)
  }, [interval, active])
  return now
}

function ClockTab() {
  const now = new Date(useTick(1000))
  const t = clockText(now)
  const cities = useLiveQuery(async () => {
    await db.settings.get(CITIES_KEY)
    return getCities()
  }, [])
  const [adding, setAdding] = useState(false)
  const ids = cities?.map((c) => c.id) ?? []
  return (
    <div>
      <div className="mt-4 text-center">
        <div className="desk-serif clock-big tabular-nums" aria-label={`现在 ${t.time}`}>{t.time}<span className="clock-sec">{String(now.getSeconds()).padStart(2, '0')}</span></div>
        <div className="serif-zh mt-1 text-[14px] tracking-[0.12em] text-[#3f5674]">{t.zh}</div>
        <div className="desk-serif italic text-[13px] text-[#6d819c]">{t.en}</div>
      </div>
      <div className="mx-4 mt-6 flex items-center justify-between">
        <span className="serif-zh text-[15px] text-[var(--c-brand)]">世界时钟</span>
        <button className="press text-[13px] text-[var(--c-accent-strong)]" onClick={() => setAdding(true)}>＋ 添加城市</button>
      </div>
      <div className="mx-4 mt-2 card overflow-hidden">
        {cities?.length === 0 && <p className="px-4 py-3 text-[12.5px] text-[var(--c-text-3)]">还没有城市。</p>}
        {cities?.map((c, i) => {
          const z = zoneTime(c.tz, now)
          return (
            <div key={c.id} className="world-row flex items-center gap-2 px-4 py-2.5 hairline-b last:border-b-0">
              <span className="flex-1 min-w-0">
                <span className="block text-[14.5px] text-[var(--c-text)]">{c.name}</span>
                <span className="block text-[11.5px] text-[var(--c-text-3)]">{diffLabel(z.dayDiff, z.offsetHours)}</span>
              </span>
              <span className="desk-serif text-[26px] tabular-nums text-[#3f5674]">{z.time}</span>
              <span className="flex flex-col">
                <button aria-label={`上移 ${c.name}`} disabled={i === 0} className="press h-5 w-6 flex items-center justify-center text-[var(--c-text-3)] disabled:opacity-25" onClick={() => void editCities((n) => { const j = n.indexOf(c.id); if (j > 0) [n[j - 1], n[j]] = [n[j], n[j - 1]]; return n })}><Icon name="collapse" size="xs" /></button>
                <button aria-label={`移除 ${c.name}`} className="press h-5 w-6 text-[11px] text-[var(--c-text-3)]" onClick={() => void editCities((n) => n.filter((x) => x !== c.id))}>×</button>
              </span>
            </div>
          )
        })}
      </div>
      <p className="mx-6 mt-2 text-[11px] text-[var(--c-text-3)]">时间使用这台设备的时钟与内置时区数据计算，不需要联网。</p>
      {adding && (
        <ActionSheet title="添加城市" actions={CITY_PRESETS.filter((c) => !ids.includes(c.id)).map((c) => ({ label: c.name, onClick: () => { void editCities((n) => [...n, c.id]); setAdding(false) } }))} onClose={() => setAdding(false)} />
      )}
    </div>
  )
}

function StopwatchTab() {
  const [sw, setSw] = useState<Stopwatch | null>(null)
  useEffect(() => void loadStopwatch().then(setSw), [])
  const now = useTick(40, !!sw?.startedAt)
  if (!sw) return null
  const update = (s: Stopwatch) => {
    setSw(s)
    void saveStopwatch(s)
  }
  const total = elapsed(sw, now)
  const laps = sw.laps.map((v, i) => ({ n: i + 1, split: v - (sw.laps[i - 1] ?? 0), total: v })).reverse()
  return (
    <div className="px-4">
      <div className="mt-8 text-center desk-serif stopwatch-time tabular-nums" aria-label="秒表时间">{formatMs(total)}</div>
      <div className="mt-6 flex justify-center gap-6">
        <button className="press h-16 w-16 rounded-full bg-white/70 text-[14px] text-[var(--c-text-2)] disabled:opacity-40" disabled={!sw.startedAt && !total} onClick={() => update(sw.startedAt ? lapSw(sw) : EMPTY_STOPWATCH)}>{sw.startedAt ? '计次' : '复位'}</button>
        <button className={`press h-16 w-16 rounded-full text-[14px] text-white ${sw.startedAt ? 'bg-[#c98a8a]' : 'bg-[var(--c-accent)]'}`} onClick={() => update(sw.startedAt ? pauseSw(sw) : startSw(sw))}>{sw.startedAt ? '暂停' : total ? '继续' : '开始'}</button>
      </div>
      {laps.length > 0 && (
        <div className="mt-6 card overflow-hidden">
          {laps.map((l) => (
            <div key={l.n} className="lap-row flex justify-between px-4 py-2 text-[13.5px] tabular-nums hairline-b last:border-b-0">
              <span className="text-[var(--c-text-2)]">计次 {l.n}</span><span>{formatMs(l.split)}</span><span className="text-[var(--c-text-3)]">{formatMs(l.total)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-center text-[11px] text-[var(--c-text-3)]">按时间点计算：切换页面或刷新后继续准确计时。</p>
    </div>
  )
}

const PRESETS: [string, number][] = [['1 分钟', 60], ['3 分钟', 180], ['5 分钟', 300], ['10 分钟', 600], ['25 分钟', 1500], ['1 小时', 3600]]

function TimerCard({ t, now }: { t: ClockTimer; now: number }) {
  const [err, setErr] = useState('')
  const left = remaining(t, now)
  const pct = t.durationMs ? Math.min(100, Math.max(0, 100 - (left / t.durationMs) * 100)) : 0
  const remind = async () => {
    setErr('')
    if (!t.endAt) return
    const end = new Date(t.endAt + 59_000)
    const r = await planReminder({ title: `计时结束：${t.name}`, date: localDate(end), time: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}` })
    if (!r.ok) return setErr(r.error)
    const p = await prepareRun(r.plan, { source: 'settings' })
    if (!p.ok) return setErr(p.error)
    await attachShortcutRun(t.id, p.run.id)
  }
  return (
    <div className="timer-card card px-4 py-3" data-status={t.status}>
      <div className="flex items-center justify-between">
        <span className="text-[14px] text-[var(--c-text)]">{t.name}</span>
        <span className="text-[11.5px] text-[var(--c-text-3)]">{durationLabel(t.durationMs)}</span>
      </div>
      <div className="mt-1 desk-serif text-[34px] tabular-nums text-[#3f5674]" aria-label={`${t.name} 剩余`}>{formatMs(left, false)}</div>
      <div className="h-[3px] rounded-full bg-[rgba(150,175,205,0.3)]"><div className="h-full rounded-full bg-[#7f9cc4]" style={{ width: `${pct}%` }} /></div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11.5px] text-[var(--c-text-3)]">{t.status === 'running' && t.endAt ? `${String(new Date(t.endAt).getHours()).padStart(2, '0')}:${String(new Date(t.endAt).getMinutes()).padStart(2, '0')} 结束` : '已暂停'}</span>
        <span className="flex gap-2">
          <button className="press h-8 px-3 rounded-full text-[12.5px] text-[var(--c-danger)]" onClick={() => void cancelTimer(t.id)}>取消</button>
          <button className="press h-8 px-4 rounded-full bg-[var(--c-accent)] text-white text-[12.5px]" onClick={() => { unlockAudio(); void (t.status === 'running' ? pauseTimer(t.id) : resumeTimer(t.id)) }}>{t.status === 'running' ? '暂停' : '继续'}</button>
        </span>
      </div>
      {t.status === 'running' && !t.shortcutRunId && <button className="press mt-1.5 text-[12px] text-[var(--c-accent-strong)]" onClick={() => void remind()}>同时在 iPhone「提醒事项」中提醒我</button>}
      {err && <p className="mt-1 text-[11.5px] text-[var(--c-danger)]">{err}</p>}
      {t.shortcutRunId && <div className="mt-2"><ShortcutRunCard runId={t.shortcutRunId} compact={false} /></div>}
    </div>
  )
}

function TimerTab() {
  const nav = useNavigate()
  const active = useLiveQuery(() => db.timers.where('status').anyOf(['running', 'paused']).sortBy('createdAt'), [])
  const now = useTick(500, !!active?.length)
  const [name, setName] = useState('')
  const [min, setMin] = useState(5)
  const [sec, setSec] = useState(0)
  const [err, setErr] = useState('')
  const start = async (seconds: number, label?: string) => {
    setErr('')
    unlockAudio()
    try {
      await createTimer(label ?? (name || '计时'), seconds * 1000)
      setName('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="px-4">
      <div className="mt-3 card px-4 py-3">
        <input aria-label="计时名称" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="名称（例如：泡茶）" className="w-full h-9 rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 text-[15px] outline-none" />
        <div className="mt-2 flex items-center gap-2 text-[14px]">
          <input aria-label="分钟" type="number" min={0} max={1440} value={min} onChange={(e) => setMin(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))} className="w-20 h-9 rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 text-[15px] outline-none" />分
          <input aria-label="秒" type="number" min={0} max={59} value={sec} onChange={(e) => setSec(Math.max(0, Math.min(59, Number(e.target.value) || 0)))} className="w-16 h-9 rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 text-[15px] outline-none" />秒
          <button className="press ml-auto h-9 px-5 rounded-full bg-[var(--c-accent)] text-white text-[13.5px]" onClick={() => void start(min * 60 + sec)}>开始</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESETS.map(([l, s]) => <button key={l} className="press h-7 px-3 rounded-full bg-white/60 text-[12px] text-[var(--c-text-2)]" onClick={() => void start(s, name || l)}>{l}</button>)}
        </div>
        {err && <p role="alert" className="mt-1.5 text-[12px] text-[var(--c-danger)]">{err}</p>}
      </div>
      <div className="mt-3 flex flex-col gap-2">{active?.map((t) => <TimerCard key={t.id} t={t} now={now} />)}</div>
      <div className="mt-4 rounded-[16px] bg-white/45 px-4 py-3 text-[11.5px] leading-relaxed text-[var(--c-text-2)]">
        <div className="serif-zh text-[13px] text-[var(--c-brand)]">提醒能做到什么</div>
        <p className="mt-1"><b>聆聆在屏幕上时</b>：计时结束会在任何页面弹出提醒并响铃（需要你先点过一次开始，iPhone 才允许网页出声；iPhone 不支持网页震动）。</p>
        <p className="mt-1"><b>锁屏或切到其他 App 时</b>：Safari 会暂停网页，<b>不会响铃</b>；回到聆聆后会告诉你它在什么时候结束了。关闭网页后也不会提醒。</p>
        <p className="mt-1"><b>需要可靠的提醒</b>：点计时下面的「同时在 iPhone 提醒事项中提醒我」，通过快捷指令创建真正的系统提醒（需要先在<button className="press text-[var(--c-accent-strong)] underline" onClick={() => nav('/me/iphone')}>连接真实 iPhone</button>中设置）。</p>
      </div>
    </div>
  )
}

function HistoryTab() {
  const list = useLiveQuery(() => db.timers.where('status').anyOf(['done', 'cancelled']).reverse().sortBy('createdAt'), [])
  const hm = (ts?: number) => (ts ? `${new Date(ts).getMonth() + 1}月${new Date(ts).getDate()}日 ${String(new Date(ts).getHours()).padStart(2, '0')}:${String(new Date(ts).getMinutes()).padStart(2, '0')}` : '')
  return (
    <div className="px-4">
      {list?.length === 0 && <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">还没有计时记录。</p>}
      <div className="mt-3 flex flex-col gap-1.5">
        {list?.map((t) => (
          <div key={t.id} className="history-row rounded-[14px] bg-white/50 px-4 py-2.5">
            <div className="flex justify-between text-[14px]"><span className="text-[var(--c-text)]">{t.name}</span><span className="text-[12px] text-[var(--c-text-3)]">{durationLabel(t.durationMs)}</span></div>
            <div className="text-[11.5px] text-[var(--c-text-3)]">{hm(t.finishedAt)} · {t.status === 'cancelled' ? `已取消（剩 ${formatMs(t.remainingMs, false)}）` : t.alerted ? '已结束，已在聆聆中提醒' : '在你离开期间结束（没有响铃）'}</div>
          </div>
        ))}
      </div>
      {!!list?.length && <button className="press mt-3 w-full text-center text-[12.5px] text-[var(--c-text-3)]" onClick={() => void clearHistory()}>清空记录</button>}
    </div>
  )
}

export default function ClockPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'clock'
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="时钟" back="/" />
      <div className="shrink-0 px-4 pt-1 pb-1">
        <div className="grid grid-cols-4 gap-1 rounded-full bg-white/50 p-0.5" role="tablist">
          {([['clock', '时钟'], ['stopwatch', '秒表'], ['timer', '倒计时'], ['history', '记录']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`press h-8 rounded-full text-[13px] ${tab === k ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-2)]'}`} onClick={() => setParams({ tab: k }, { replace: true })}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        {tab === 'clock' && <ClockTab />}
        {tab === 'stopwatch' && <StopwatchTab />}
        {tab === 'timer' && <TimerTab />}
        {tab === 'history' && <HistoryTab />}
      </div>
    </div>
  )
}
