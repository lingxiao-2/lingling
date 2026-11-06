/** 日记：月历（有日记的日子有小点）、搜索、标签筛选、按日期查看；最近删除入口。日记默认只有自己可见。 */
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { LinkedPhotos } from '../../components/PhotoPicker'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import type { Diary } from '../../db/schema'
import { dateParts, daysWithEntries, filterDiaries, isDateString, localDate, monthGrid, moodOf, snippet, topTags } from '../../life/diary'

export default function DiaryListPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const all = useLiveQuery(() => db.diaries.toArray(), [], undefined as Diary[] | undefined)
  const today = localDate()
  const dateParam = params.get('date')
  const date = isDateString(dateParam) ? dateParam : null
  const [month, setMonth] = useState(() => (date ?? today).slice(0, 7))
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const list = useMemo(() => filterDiaries(all ?? [], { query: q, date: date ?? undefined, tag: tag ?? undefined }), [all, q, date, tag])
  const trashCount = (all ?? []).filter((d) => d.deletedAt).length
  const [y, m] = month.split('-').map(Number)
  const marks = daysWithEntries(all ?? [], month)
  const tags = topTags(all ?? [])
  const shiftMonth = (k: number) => {
    const d = new Date(y, m - 1 + k, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const pick = (day: number) => {
    const ds = `${month}-${String(day).padStart(2, '0')}`
    setParams(date === ds ? {} : { date: ds }, { replace: true })
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="日记" back="/" right={<NavButton label="写日记" icon="edit" onClick={() => nav(`/diary/new${date ? `?date=${date}` : ''}`)} />} />
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        <section className="mx-4 mt-2 diary-paper rounded-[18px] px-4 pt-3 pb-2">
          <div className="flex items-center justify-between">
            <button aria-label="上个月" className="press h-8 w-8 flex items-center justify-center text-[var(--c-text-3)]" onClick={() => shiftMonth(-1)}><Icon name="back" size="sm" /></button>
            <div className="text-center">
              <div className="desk-serif italic text-[17px] text-[#3f5674]">{new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' })} {y}</div>
              <div className="text-[10.5px] tracking-[0.2em] text-[#93a5bc]">{y}年{m}月</div>
            </div>
            <button aria-label="下个月" className="press h-8 w-8 flex items-center justify-center text-[var(--c-text-3)]" onClick={() => shiftMonth(1)}><Icon name="forward" size="sm" /></button>
          </div>
          <div className="mt-2 grid grid-cols-7 text-center text-[10.5px] text-[#93a5bc]">
            {['日', '一', '二', '三', '四', '五', '六'].map((w) => <span key={w}>{w}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-y-0.5 text-center">
            {monthGrid(y, m - 1).map((d, i) => {
              if (!d) return <span key={i} />
              const ds = `${month}-${String(d).padStart(2, '0')}`
              const on = date === ds
              return (
                <button key={i} aria-label={`${m}月${d}日`} aria-pressed={on} onClick={() => pick(d)} className={`press relative mx-auto h-8 w-8 rounded-full text-[13px] ${on ? 'bg-[#6f90b8] text-white' : ds === today ? 'text-[#34506f] font-medium shadow-[inset_0_0_0_1px_#a9bfd9]' : 'text-[#4a5f7b]'}`}>
                  {d}
                  {marks.has(d) && <span className={`absolute left-1/2 -translate-x-1/2 bottom-[3px] h-[3.5px] w-[3.5px] rounded-full ${on ? 'bg-white' : 'bg-[#8aa2c1]'}`} />}
                </button>
              )
            })}
          </div>
        </section>

        <div className="mx-4 mt-3 flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题、正文、标签" className="flex-1 min-w-0 h-9 rounded-full bg-white/55 border border-[var(--c-line)] px-4 text-[15px] outline-none focus:border-[var(--c-accent)]" />
        </div>
        {tags.length > 0 && (
          <div className="mx-4 mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button key={t} onClick={() => setTag(tag === t ? null : t)} className={`press h-7 px-2.5 rounded-full text-[12px] border ${tag === t ? 'border-[#6f90b8] text-[#34506f] bg-white/70' : 'border-[var(--c-line)] text-[var(--c-text-2)] bg-white/40'}`}>#{t}</button>
            ))}
          </div>
        )}
        {date && (
          <div className="mx-5 mt-3 flex items-center justify-between text-[12.5px] text-[var(--c-text-2)]">
            <span>{dateParts(date).zh} 的日记</span>
            <span className="flex gap-3">
              <button className="press text-[var(--c-accent-strong)]" onClick={() => nav(`/diary/new?date=${date}`)}>写这一天</button>
              <button className="press text-[var(--c-text-3)]" onClick={() => setParams({}, { replace: true })}>看全部</button>
            </span>
          </div>
        )}

        <div className="mx-4 mt-3 space-y-3">
          {all && list.length === 0 && (
            <div className="py-10 text-center">
              <div className="desk-serif italic text-[17px] text-[var(--c-brand)]">Dear diary,</div>
              <p className="mt-1 text-[12.5px] text-[var(--c-text-3)]">{q || tag || date ? '没有找到匹配的日记' : '还没有日记。点右上角的笔，写下今天。'}</p>
            </div>
          )}
          {list.map((d) => {
            const p = dateParts(d.date)
            const mood = moodOf(d.mood)
            return (
              <button key={d.id} onClick={() => nav(`/diary/${d.id}`)} className="press block w-full text-left diary-paper rounded-[18px] px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-11 text-center">
                    <div className="desk-serif text-[26px] leading-none text-[#34506f]">{p.day}</div>
                    <div className="mt-0.5 text-[9.5px] tracking-[0.18em] text-[#93a5bc]">{p.monEn}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] text-[var(--c-text)]">{d.title || '无标题'}</span>
                      {mood && <span className="shrink-0 h-[18px] px-1.5 rounded-full text-[10.5px] leading-[18px] text-[#3f5674]" style={{ background: `${mood.color}55` }}>{mood.label}</span>}
                      {d.aiReadable && <span className="shrink-0 text-[10px] text-[#8496ae]">AI 可读</span>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--c-text-3)]">{p.week}{d.tags.length ? ` · ${d.tags.map((t) => `#${t}`).join(' ')}` : ''}</div>
                    {d.body && <div className="mt-1 text-[13px] leading-relaxed text-[var(--c-text-2)] line-clamp-2">{snippet(d.body, 90)}</div>}
                    {d.photoIds.length > 0 && <div className="mt-2"><LinkedPhotos ids={d.photoIds.slice(0, 4)} size={46} /></div>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        <div className="mt-6 text-center">
          <button className="press text-[12.5px] text-[var(--c-text-3)]" onClick={() => nav('/diary/trash')}>最近删除 {trashCount}</button>
        </div>
      </div>
    </div>
  )
}
