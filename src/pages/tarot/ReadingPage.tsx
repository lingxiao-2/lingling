/** 一次占卜：点按翻牌 → 牌意 → 请角色解读（真实调用模型）→ 你同意后保存到日记 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import Avatar from '../../components/Avatar'
import { ConfirmDialog } from '../../components/Sheet'
import { db } from '../../db/db'
import { cardById, SPREADS, SUIT_INFO } from '../../tarot/deck'
import { deleteReading, DISCLAIMER, interpret, saveReadingToDiary } from '../../tarot/readings'
import TarotCardView from './TarotCardView'

export default function ReadingPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const r = useLiveQuery(() => db.tarotReadings.get(id).then((x) => x ?? null), [id])
  const chars = useLiveQuery(() => db.characters.toArray(), [])
  const interpreter = useLiveQuery(() => (r?.interpreterId ? db.characters.get(r.interpreterId).then((x) => x ?? null) : null), [r?.interpreterId])
  // 刚抽的牌从牌背开始翻；打开以前的记录（超过 1 分钟或已经有解读）直接显示牌面
  const [revealed, setRevealed] = useState<Set<number> | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [askDiary, setAskDiary] = useState(false)
  const [del, setDel] = useState(false)
  if (r === null) return (<div className="h-dvh flex flex-col"><NavBar title="塔罗" back="/tarot" /><p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">这次占卜不存在。</p></div>)
  if (!r) return <div className="h-dvh" />
  const fresh = Date.now() - r.createdAt < 60_000 && !r.interpretation
  const shown = revealed ?? (fresh ? new Set<number>() : new Set(r.cards.map((_, i) => i)))
  const all = shown.size === r.cards.length
  const ask = async (cid: string) => {
    setPicking(false)
    setBusy(true)
    setErr('')
    try {
      await interpret(r.id, cid)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={SPREADS[r.spread].name} back="/tarot" right={<NavButton label="删除记录" icon="delete" onClick={() => setDel(true)} />} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-16">
        {r.question && <p className="mt-1 text-center serif-zh text-[15px] text-[#3f5674]">「{r.question}」</p>}
        <div className="tarot-stage mt-3 rounded-[24px] px-3 py-5">
          <div className="flex justify-center gap-3">
            {r.cards.map((d, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <TarotCardView drawn={d} revealed={shown.has(i)} theme={r.theme} size={r.cards.length > 1 ? 'sm' : 'md'} onReveal={() => setRevealed(new Set([...shown, i]))} />
                <span className="text-[11.5px] tracking-[0.15em] text-[#6d819c]">{d.position}</span>
              </div>
            ))}
          </div>
          {!all && <p className="mt-3 text-center text-[12px] text-[var(--c-text-3)]">点按牌背，一张一张翻开</p>}
        </div>
        {all && (
          <>
            <div className="mt-3 flex flex-col gap-2">
              {r.cards.map((d, i) => {
                const c = cardById(d.cardId)!
                return (
                  <div key={i} className="card-meaning rounded-[16px] bg-white/60 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="serif-zh text-[15px] text-[var(--c-text)]">{d.position} · {c.name}</span>
                      <span className={`shrink-0 text-[12px] ${d.reversed ? 'text-[#a07a4a]' : 'text-[var(--c-accent-strong)]'}`}>{d.reversed ? '逆位' : '正位'}</span>
                    </div>
                    <div className="desk-serif italic text-[11.5px] text-[var(--c-text-3)]">{c.en}{c.suit !== 'major' ? ` · ${SUIT_INFO[c.suit].domain}` : ''}</div>
                    <div className="mt-1 text-[13.5px] text-[var(--c-text-2)]">{d.reversed ? c.reversed : c.upright}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 rounded-[16px] bg-white/75 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[var(--c-text-3)]">{r.interpretation ? `${interpreter?.name ?? '角色'}的解读` : '想听听 TA 怎么说？'}</span>
                {!busy && <button className="press text-[12.5px] text-[var(--c-accent-strong)]" onClick={() => setPicking(true)}>{r.interpretation ? '换一位解读' : '请角色解读'}</button>}
              </div>
              {busy && <p className="mt-1 text-[13px] text-[var(--c-text-3)]">正在解读…</p>}
              {r.interpretation && !busy && <div className="tarot-interpretation mt-1 whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--c-text)]">{r.interpretation}</div>}
              {r.model && r.interpretation && !busy && <div className="mt-2 text-right text-[10.5px] text-[var(--c-text-3)]">由 {r.model} 以 {interpreter?.name ?? '角色'} 的身份解读</div>}
              {err && <p role="alert" className="mt-1 text-[12px] text-[var(--c-danger)]">解读没有生成：{err}</p>}
            </div>
            <div className="mt-3 flex gap-2">
              {r.diaryId ? (
                <button className="press h-9 px-4 rounded-full bg-white/70 text-[13px] text-[var(--c-accent-strong)]" onClick={() => nav(`/diary/${r.diaryId}`)}>已保存到日记 · 查看</button>
              ) : (
                <button className="press h-9 px-4 rounded-full bg-white/70 text-[13px] text-[var(--c-accent-strong)]" onClick={() => setAskDiary(true)}>保存到日记</button>
              )}
              <button className="press h-9 px-4 rounded-full bg-[var(--c-accent)] text-white text-[13px]" onClick={() => nav('/tarot')}>再抽一次</button>
            </div>
          </>
        )}
        <p className="mt-4 text-center text-[10.5px] leading-relaxed text-[var(--c-text-3)]">{DISCLAIMER}</p>
      </div>
      {picking && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/20" onClick={() => setPicking(false)}>
          <div role="dialog" aria-label="请谁解读" className="w-full rounded-t-[24px] bg-[rgba(246,249,253,0.98)] px-5 pt-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="serif-zh text-[16px] text-[var(--c-brand)]">请谁陪你看这些牌？</div>
            <p className="mt-1 text-[11.5px] text-[var(--c-text-3)]">会把抽到的牌和你的问题交给你设置的模型，以这个角色的语气解读。</p>
            {chars?.length === 0 && <p className="mt-3 text-[13px] text-[var(--c-text-3)]">还没有角色。</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {chars?.map((c) => <button key={c.id} className="press flex flex-col items-center gap-1 w-16" onClick={() => void ask(c.id)}><Avatar name={c.name} src={c.avatar} size={44} /><span className="max-w-full truncate text-[12px]">{c.name}</span></button>)}
            </div>
          </div>
        </div>
      )}
      {askDiary && (
        <ConfirmDialog
          title="保存到日记？"
          message="会新建一篇今天的日记，包含问题、牌面、牌意和解读，带「塔罗」标签。这篇日记默认不允许 AI 读取。"
          confirmText="保存"
          onCancel={() => setAskDiary(false)}
          onConfirm={() => void saveReadingToDiary(r.id).then(() => setAskDiary(false), (e) => { setErr(String(e?.message ?? e)); setAskDiary(false) })}
        />
      )}
      {del && <ConfirmDialog title="删除这次占卜记录？" message="已经保存到日记的那篇不会被删除。" confirmText="删除" danger onCancel={() => setDel(false)} onConfirm={() => void deleteReading(r.id).then(() => nav('/tarot', { replace: true }))} />}
    </div>
  )
}
