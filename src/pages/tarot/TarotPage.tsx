/**
 * 塔罗：写下问题（可不写）→ 选择牌阵与牌面主题 → 洗牌抽牌（真实随机）→ 进入这次占卜；下面是占卜记录。
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../../components/NavBar'
import { db } from '../../db/db'
import type { TarotReading } from '../../db/schema'
import { cardById, SPREADS, type SpreadId } from '../../tarot/deck'
import { DISCLAIMER, newReading, QUESTION_MAX } from '../../tarot/readings'
import TarotCardView from './TarotCardView'

export const THEMES: { id: TarotReading['theme']; name: string }[] = [
  { id: 'ice', name: '冰蓝' },
  { id: 'silver', name: '银白星光' },
  { id: 'night', name: '夜空' },
]

export default function TarotPage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [spread, setSpread] = useState<SpreadId>('three')
  const [theme, setTheme] = useState<TarotReading['theme']>('ice')
  const [shuffling, setShuffling] = useState(false)
  const history = useLiveQuery(() => db.tarotReadings.orderBy('createdAt').reverse().filter((r) => !r.deletedAt).limit(30).toArray(), [])
  const start = async () => {
    setShuffling(true)
    const r = await newReading(spread, q, theme)
    setTimeout(() => nav(`/tarot/${r.id}`), 900)
  }
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="塔罗" back="/" />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-16">
        <div className="tarot-stage mt-2 rounded-[24px] px-4 py-5">
          <div className={`flex justify-center ${shuffling ? 'tarot-shuffle' : ''}`} aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ marginLeft: i ? -56 : 0, transform: `rotate(${(i - 1) * 7}deg) translateY(${i === 1 ? -4 : 0}px)` }}>
                <TarotCardView drawn={{ cardId: 'major-17', reversed: false, position: '' }} revealed={false} theme={theme} size="sm" />
              </span>
            ))}
          </div>
          <p className="mt-4 text-center desk-serif italic text-[13px] tracking-[0.12em] text-[#6f88a8]">Ask the stars quietly</p>
          <textarea aria-label="你的问题" value={q} maxLength={QUESTION_MAX} onChange={(e) => setQ(e.target.value)} rows={2} placeholder="在心里想一个问题，也可以写下来（可不写）" className="mt-3 w-full resize-none rounded-[14px] bg-white/70 border border-[var(--c-line)] px-3 py-2 text-[15px] outline-none" />
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-white/50 p-0.5" role="radiogroup" aria-label="牌阵">
            {(Object.keys(SPREADS) as SpreadId[]).map((s) => <button key={s} role="radio" aria-checked={spread === s} className={`press h-8 rounded-full text-[13px] ${spread === s ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-2)]'}`} onClick={() => setSpread(s)}>{SPREADS[s].name}</button>)}
          </div>
          <div className="mt-2 flex justify-center gap-1.5" role="radiogroup" aria-label="牌面主题">
            {THEMES.map((t) => <button key={t.id} role="radio" aria-checked={theme === t.id} className={`press h-7 px-3 rounded-full text-[12px] ${theme === t.id ? 'bg-white text-[var(--c-accent-strong)] shadow-[0_2px_8px_rgba(80,110,150,0.15)]' : 'text-[var(--c-text-3)]'}`} onClick={() => setTheme(t.id)}>{t.name}</button>)}
          </div>
          <button disabled={shuffling} className="press mt-4 h-11 w-full rounded-full bg-[var(--c-accent)] text-white text-[14.5px] disabled:opacity-60" onClick={() => void start()}>{shuffling ? '正在洗牌…' : '洗牌并抽牌'}</button>
          <p className="mt-3 text-center text-[10.5px] leading-relaxed text-[var(--c-text-3)]">{DISCLAIMER}</p>
        </div>
        <div className="mt-5 serif-zh text-[15px] text-[var(--c-brand)] px-1">占卜记录</div>
        {history?.length === 0 && <p className="mt-2 px-1 text-[12.5px] text-[var(--c-text-3)]">还没有记录。</p>}
        <div className="mt-2 flex flex-col gap-1.5">
          {history?.map((r) => (
            <button key={r.id} className="reading-row press rounded-[14px] bg-white/50 px-4 py-2.5 text-left" onClick={() => nav(`/tarot/${r.id}`)}>
              <div className="flex justify-between text-[13.5px]"><span className="truncate text-[var(--c-text)]">{r.question || SPREADS[r.spread].name}</span><span className="shrink-0 text-[11.5px] text-[var(--c-text-3)]">{new Date(r.createdAt).getMonth() + 1}月{new Date(r.createdAt).getDate()}日</span></div>
              <div className="truncate text-[12px] text-[var(--c-text-3)]">{r.cards.map((d) => `${cardById(d.cardId)?.name}${d.reversed ? '（逆）' : ''}`).join(' · ')}{r.interpretation ? ' · 有解读' : ''}{r.diaryId ? ' · 已存日记' : ''}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
