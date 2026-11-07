/**
 * 在设置页里手动运行真实 iPhone 操作（不经过 AI）：填写 → 生成执行计划 → 看清日期时间标题 → 打开快捷指令。
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import ShortcutRunCard from '../../components/ShortcutRunCard'
import { db } from '../../db/db'
import { localDate } from '../../life/diary'
import { addDays } from '../../life/calendar'
import { APP_IDS, APP_LINKS, planCalendarEvent, planCustom, planOpenApp, planReminder, prepareRun, type PlanResult } from '../../ios/actions'
import { listShortcuts, SHORTCUTS_KEY } from '../../ios/shortcuts'

const field = 'h-9 w-full rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 text-[15px] outline-none'
type Tab = 'reminder' | 'calendar' | 'app' | 'custom'

export default function IphoneActions() {
  const [tab, setTab] = useState<Tab>('reminder')
  const [runId, setRunId] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [repeat, setRepeat] = useState(false)
  const [dupe, setDupe] = useState(false)
  const tomorrow = addDays(localDate(), 1)
  const [f, setF] = useState({ title: '', date: tomorrow, time: '15:00', end: '', location: '', notes: '', app: 'reminders', url: 'https://', custom: '', text: '' })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const customs = useLiveQuery(async () => {
    await db.settings.get(SHORTCUTS_KEY)
    return (await listShortcuts()).filter((s) => s.purpose === 'custom')
  }, [])

  const make = async () => {
    setErr('')
    setRunId(null)
    let r: PlanResult
    if (tab === 'reminder') r = await planReminder({ title: f.title, date: f.date, time: f.time || undefined, notes: f.notes })
    else if (tab === 'calendar') r = await planCalendarEvent({ title: f.title, date: f.date, startTime: f.time, endTime: f.end || undefined, location: f.location, notes: f.notes })
    else if (tab === 'app') r = planOpenApp({ app: f.app, url: f.url })
    else {
      const sc = customs?.find((s) => s.id === f.custom)
      r = sc ? planCustom(sc, f.text) : { ok: false, code: 'invalid', error: '请选择一个自定义快捷指令' }
    }
    if (!r.ok) return setErr(r.error)
    const p = await prepareRun(r.plan, { source: 'settings', allowRepeat: repeat })
    if (!p.ok) {
      setDupe(!!p.duplicateOf)
      return setErr(p.error)
    }
    setDupe(false)
    setRepeat(false)
    setRunId(p.run.id)
  }

  return (
    <div className="iphone-actions">
      <div className="grid grid-cols-4 gap-1 rounded-full bg-white/50 p-0.5" role="tablist">
        {([['reminder', '提醒事项'], ['calendar', '系统日历'], ['app', '打开应用'], ['custom', '自定义']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`press h-7 rounded-full text-[12px] ${tab === k ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-2)]'}`} onClick={() => { setTab(k); setRunId(null); setErr('') }}>{l}</button>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {(tab === 'reminder' || tab === 'calendar') && (
          <>
            <input aria-label="标题" className={field} value={f.title} onChange={set('title')} placeholder={tab === 'reminder' ? '去买东西' : '面试'} maxLength={100} />
            <div className="flex gap-2">
              <input aria-label="日期" type="date" className={field} value={f.date} onChange={set('date')} />
              <input aria-label={tab === 'reminder' ? '提醒时间' : '开始时间'} type="time" className={field} value={f.time} onChange={set('time')} />
              {tab === 'calendar' && <input aria-label="结束时间" type="time" className={field} value={f.end} onChange={set('end')} />}
            </div>
            {tab === 'calendar' && <input aria-label="地点" className={field} value={f.location} onChange={set('location')} placeholder="地点（可不填）" maxLength={100} />}
            <input aria-label="备注" className={field} value={f.notes} onChange={set('notes')} placeholder="备注（可不填）" maxLength={500} />
          </>
        )}
        {tab === 'app' && (
          <>
            <select aria-label="应用" className={field} value={f.app} onChange={set('app')}>
              {APP_IDS.map((id) => <option key={id} value={id}>{id === 'safari' ? 'Safari（打开网址）' : APP_LINKS[id as keyof typeof APP_LINKS].name}</option>)}
            </select>
            {f.app === 'safari' && <input aria-label="网址" className={field} value={f.url} onChange={set('url')} inputMode="url" />}
            <p className="text-[11px] text-[var(--c-text-3)]">这些是 Apple 自带应用的公开链接，是否能在你的 iOS 版本上打开需要实际试一下。其他 App 请在快捷指令中创建「打开 App」后登记为自定义快捷指令。</p>
          </>
        )}
        {tab === 'custom' && (
          customs?.length ? (
            <>
              <select aria-label="自定义快捷指令" className={field} value={f.custom} onChange={set('custom')}>
                <option value="">选择快捷指令</option>
                {customs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input aria-label="传入的文字" className={field} value={f.text} onChange={set('text')} placeholder="传入的文字（可不填）" maxLength={500} />
            </>
          ) : <p className="text-[12px] text-[var(--c-text-3)]">还没有登记自定义快捷指令。</p>
        )}
        {dupe && (
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--c-text-2)]"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />我确定要再执行一次</label>
        )}
        <button className="press h-9 rounded-full bg-[var(--c-accent)] text-white text-[13.5px]" onClick={() => void make()}>生成执行计划</button>
        {err && <p role="alert" className="text-[12px] text-[var(--c-danger)]">{err}</p>}
        {runId && <ShortcutRunCard runId={runId} />}
      </div>
    </div>
  )
}
