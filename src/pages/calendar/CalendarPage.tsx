/**
 * 日历：月视图（日程与日记分别用小点 / 小横线标记）、选中某天的日程与当天的日记、未来 60 天日程、搜索、最近删除。
 * 这里的日程只保存在聆聆，不会同步到 iPhone 系统日历。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import type { CalEvent, Character, Diary } from '../../db/schema'
import { restoreEvent } from '../../db/eventRepo'
import { addDays, anniversaryText, KIND_LABEL, occurrences, searchEvents, type Occurrence } from '../../life/calendar'
import { dateParts, isDateString, localDate, monthGrid } from '../../life/diary'

export function EventRow({ o, chars, onClick }: { o: Occurrence; chars: Map<string, Character>; onClick: () => void }) {
  const e = o.event
  const who = e.characterId ? chars.get(e.characterId)?.name ?? '已删除的角色' : ''
  const anniv = anniversaryText(e, o.date)
  return (
    <button onClick={onClick} className="press w-full flex items-start gap-3 px-4 py-2.5 text-left hairline-b last:border-b-0">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.kind === 'event' ? 'bg-[#8aa2c1]' : e.kind === 'birthday' ? 'bg-[#e8b4c4]' : 'bg-[#c3b4e3]'}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] text-[var(--c-text)]">{e.title}</span>
        <span className="block text-[11.5px] text-[var(--c-text-3)]">
          {e.allDay ? '全天' : `${e.startTime}${e.endTime ? ` – ${e.endTime}` : ''}`}
          {e.kind !== 'event' ? ` · ${KIND_LABEL[e.kind]}${anniv ? ` · ${anniv}` : ''}` : ''}
          {who ? ` · ${who}` : ''}
          {e.location ? ` · ${e.location}` : ''}
          {e.repeat !== 'none' && e.kind === 'event' ? ' · 重复' : ''}
        </span>
      </span>
      {e.diaryIds.length > 0 && <Icon name="diary" size="xs" className="mt-1 text-[var(--c-text-3)]" />}
    </button>
  )
}

export default function CalendarPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const today = localDate()
  const sel = isDateString(params.get('date')) ? params.get('date')! : today
  const [month, setMonth] = useState(sel.slice(0, 7))
  // 地址里的日期变化时（例如从日程保存后返回、或从日记跳转），月份跟着切换到那一天所在的月
  useEffect(() => setMonth(sel.slice(0, 7)), [sel])
  const [tab, setTab] = useState<'month' | 'agenda' | 'search'>('month')
  const [q, setQ] = useState('')
  const events = useLiveQuery(() => db.events.toArray(), [], [] as CalEvent[])
  const diaries = useLiveQuery(() => db.diaries.toArray(), [], [] as Diary[])
  const chars = useLiveQuery(async () => new Map((await db.characters.toArray()).map((c) => [c.id, c])), [], new Map<string, Character>())
  const live = events.filter((e) => !e.deletedAt)
  const [y, m] = month.split('-').map(Number)
  const monthEnd = localDate(new Date(y, m, 0))
  const inMonth = useMemo(() => occurrences(live, `${month}-01`, monthEnd), [live, month, monthEnd])
  const marks = new Set(inMonth.map((o) => Number(o.date.slice(8))))
  const diaryDays = new Set(diaries.filter((d) => !d.deletedAt && d.date.startsWith(month)).map((d) => Number(d.date.slice(8))))
  const dayList = occurrences(live, sel, sel)
  const dayDiaries = diaries.filter((d) => !d.deletedAt && d.date === sel)
  const agenda = occurrences(live, today, addDays(today, 60))
  const found = searchEvents(events, q)
  const trash = events.filter((e) => e.deletedAt)
  const go = (e: CalEvent) => nav(`/calendar/event/${e.id}`)
  const shift = (k: number) => {
    const d = new Date(y, m - 1 + k, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const p = dateParts(sel)

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="日历" back="/" right={<NavButton label="新建日程" icon="plus" onClick={() => nav(`/calendar/event/new?date=${sel}`)} />} />
      <div className="shrink-0 mx-4 mt-1 flex rounded-full bg-white/45 p-0.5 text-[12.5px]" role="tablist">
        {([['month', '月'], ['agenda', '日程'], ['search', '搜索']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`press flex-1 h-8 rounded-full ${tab === k ? 'bg-white text-[var(--c-accent-strong)] shadow-sm' : 'text-[var(--c-text-3)]'}`}>{l}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        {tab === 'month' && (
          <>
            <section className="mx-4 mt-3 diary-paper rounded-[18px] px-3 pt-3 pb-2">
              <div className="flex items-center justify-between px-1">
                <button aria-label="上个月" className="press h-8 w-8 flex items-center justify-center text-[var(--c-text-3)]" onClick={() => shift(-1)}><Icon name="back" size="sm" /></button>
                <div className="text-center">
                  <div className="desk-serif italic text-[18px] text-[#3f5674]">{new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' })} {y}</div>
                  <div className="text-[10.5px] tracking-[0.2em] text-[#93a5bc]">{y}年{m}月</div>
                </div>
                <button aria-label="下个月" className="press h-8 w-8 flex items-center justify-center text-[var(--c-text-3)]" onClick={() => shift(1)}><Icon name="forward" size="sm" /></button>
              </div>
              <div className="mt-2 grid grid-cols-7 text-center text-[10.5px] text-[#93a5bc]">{['日', '一', '二', '三', '四', '五', '六'].map((w) => <span key={w}>{w}</span>)}</div>
              <div className="mt-1 grid grid-cols-7 gap-y-1 text-center">
                {monthGrid(y, m - 1).map((d, i) => {
                  if (!d) return <span key={i} />
                  const ds = `${month}-${String(d).padStart(2, '0')}`
                  const on = ds === sel
                  return (
                    <button key={i} aria-label={`${m}月${d}日`} aria-pressed={on} onClick={() => setParams({ date: ds }, { replace: true })} className={`press relative mx-auto h-9 w-9 rounded-full text-[13.5px] ${on ? 'bg-[#6f90b8] text-white' : ds === today ? 'text-[#34506f] font-medium shadow-[inset_0_0_0_1px_#a9bfd9]' : 'text-[#4a5f7b]'}`}>
                      {d}
                      <span className="absolute left-1/2 -translate-x-1/2 bottom-[3px] flex gap-[3px]">
                        {marks.has(d) && <span className={`h-1 w-1 rounded-full ${on ? 'bg-white' : 'bg-[#6f90b8]'}`} aria-label="有日程" />}
                        {diaryDays.has(d) && <span className={`h-1 w-2 rounded-full ${on ? 'bg-white/80' : 'bg-[#c3b4e3]'}`} aria-label="有日记" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
            <div className="mx-5 mt-3 flex items-baseline justify-between">
              <span className="serif-zh text-[15px] text-[var(--c-brand)]">{p.zh} <span className="text-[12px] text-[var(--c-text-3)]">{p.week}</span></span>
              <button className="press text-[12.5px] text-[var(--c-accent-strong)]" onClick={() => nav(`/calendar/event/new?date=${sel}`)}>＋ 日程</button>
            </div>
            <section className="mx-4 mt-2 card overflow-hidden">
              {dayList.length === 0 && <div className="px-4 py-3 text-[13px] text-[var(--c-text-3)]">这一天没有日程</div>}
              {dayList.map((o) => <EventRow key={o.event.id} o={o} chars={chars} onClick={() => go(o.event)} />)}
            </section>
            <section className="mx-4 mt-2 card px-4 py-2.5">
              <div className="text-[12px] text-[var(--c-text-3)]">这一天的日记</div>
              {dayDiaries.map((d) => (
                <button key={d.id} onClick={() => nav(`/diary/${d.id}`)} className="press mt-1 block w-full truncate text-left text-[14px] text-[var(--c-text)]">· {d.title || '无标题'}</button>
              ))}
              <button className="press mt-1 text-[12.5px] text-[var(--c-accent-strong)]" onClick={() => nav(`/diary/new?date=${sel}`)}>{dayDiaries.length ? '再写一篇' : '写这一天的日记'}</button>
            </section>
          </>
        )}
        {tab === 'agenda' && (
          <section className="mx-4 mt-3 card overflow-hidden">
            {agenda.length === 0 && <div className="px-4 py-4 text-[13px] text-[var(--c-text-3)]">未来 60 天没有日程</div>}
            {agenda.map((o, i) => (
              <div key={`${o.event.id}-${o.date}`}>
                {(i === 0 || agenda[i - 1].date !== o.date) && <div className="px-4 pt-2.5 pb-1 text-[11.5px] text-[var(--c-text-3)] bg-white/30">{o.date === today ? '今天' : `${dateParts(o.date).zh} ${dateParts(o.date).week}`}</div>}
                <EventRow o={o} chars={chars} onClick={() => go(o.event)} />
              </div>
            ))}
          </section>
        )}
        {tab === 'search' && (
          <>
            <div className="mx-4 mt-3"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题、地点、备注" className="w-full h-9 rounded-full bg-white/55 border border-[var(--c-line)] px-4 text-[15px] outline-none focus:border-[var(--c-accent)]" /></div>
            <section className="mx-4 mt-3 card overflow-hidden">
              {q && found.length === 0 && <div className="px-4 py-3 text-[13px] text-[var(--c-text-3)]">没有找到匹配的日程</div>}
              {found.map((e) => <EventRow key={e.id} o={{ event: e, date: e.date }} chars={chars} onClick={() => go(e)} />)}
            </section>
            {trash.length > 0 && (
              <section className="mx-4 mt-4 card px-4 py-2.5">
                <div className="text-[12px] text-[var(--c-text-3)]">最近删除</div>
                {trash.map((e) => (
                  <div key={e.id} className="mt-1 flex items-center justify-between text-[13.5px]">
                    <span className="truncate text-[var(--c-text-2)]">{e.title}</span>
                    <button className="press text-[12.5px] text-[var(--c-accent-strong)]" onClick={() => void restoreEvent(e.id)}>恢复</button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
        <p className="mx-6 mt-4 text-[11px] leading-relaxed text-[var(--c-text-3)]">这里的日程只保存在聆聆中，不会自动同步到 iPhone 的「日历」。需要时可以在日程详情里导出，自己添加到系统日历。</p>
      </div>
    </div>
  )
}
