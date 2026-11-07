/** 送礼物：选角色 → 选礼物（按类别）→ 留言 → 可选关联纪念日 → 送出（TA 会回应） */
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../../components/NavBar'
import Avatar from '../../components/Avatar'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import { CATEGORIES, GIFTS, type GiftCategory } from '../../gifts/catalog'
import { anniversariesOf, MESSAGE_MAX, sendGift } from '../../gifts/gifts'

export default function SendGiftPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const chars = useLiveQuery(() => db.characters.toArray(), [])
  const [cid, setCid] = useState(params.get('character') ?? '')
  const pick = cid || chars?.[0]?.id || ''
  const [cat, setCat] = useState<GiftCategory>('flowers')
  const [giftId, setGiftId] = useState('')
  const [message, setMessage] = useState('')
  const [eventId, setEventId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const events = useLiveQuery(() => (pick ? anniversariesOf(pick) : []), [pick], [])
  const send = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await sendGift({ characterId: pick, giftId, message, eventId: eventId || undefined })
      nav(`/gifts/${r.id}`, { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="送礼物" back="/gifts" />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-28">
        {chars?.length === 0 ? <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">还没有角色。</p> : (
          <>
            <div className="mt-1 flex gap-2 overflow-x-auto pb-1" aria-label="送给谁">
              {chars?.map((c) => (
                <button key={c.id} aria-pressed={pick === c.id} className={`press shrink-0 flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 text-[12.5px] ${pick === c.id ? 'bg-white shadow-[0_2px_8px_rgba(80,110,150,0.15)] text-[var(--c-accent-strong)]' : 'text-[var(--c-text-2)]'}`} onClick={() => { setCid(c.id); setEventId('') }}>
                  <Avatar name={c.name} src={c.avatar} size={26} />送给 {c.name}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto" role="tablist">
              {CATEGORIES.map((c) => <button key={c.id} role="tab" aria-selected={cat === c.id} className={`press shrink-0 h-8 px-3.5 rounded-full text-[12.5px] ${cat === c.id ? 'bg-[var(--c-accent)] text-white' : 'bg-white/50 text-[var(--c-text-2)]'}`} onClick={() => setCat(c.id)}>{c.name}</button>)}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {GIFTS.filter((g) => g.category === cat).map((g) => (
                <button key={g.id} aria-pressed={giftId === g.id} aria-label={g.name} className={`gift-card press flex flex-col items-center rounded-[16px] px-1.5 py-2.5 text-center ${giftId === g.id ? 'gift-card-on' : ''}`} onClick={() => setGiftId(g.id)}>
                  <span className="gift-tile flex h-10 w-10 items-center justify-center text-[#5d7392]"><Icon name={g.icon} stroke="thin" /></span>
                  <span className="mt-1.5 text-[12.5px] leading-tight text-[var(--c-text)]">{g.name}</span>
                  <span className="mt-0.5 text-[10.5px] leading-tight text-[var(--c-text-3)]">{g.desc}</span>
                </button>
              ))}
            </div>
            <textarea aria-label="留言" value={message} maxLength={MESSAGE_MAX} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="附上一句话（可不写）" className="mt-3 w-full resize-none rounded-[14px] bg-white/70 border border-[var(--c-line)] px-3 py-2 text-[15px] outline-none" />
            <label className="mt-2 block text-[12px] text-[var(--c-text-3)]">关联纪念日（可选）</label>
            <select aria-label="关联纪念日" value={eventId} onChange={(e) => setEventId(e.target.value)} className="mt-1 h-9 w-full rounded-[10px] bg-white/70 border border-[var(--c-line)] px-2 text-[14px]">
              <option value="">不关联</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.title}（{e.date}）</option>)}
            </select>
            {events.length === 0 && <p className="mt-1 text-[11px] text-[var(--c-text-3)]">在日历里给这个角色设置纪念日或生日后，可以在这里关联。</p>}
            {err && <p role="alert" className="mt-2 text-[12px] text-[var(--c-danger)]">{err}</p>}
            <p className="mt-3 text-[11px] text-[var(--c-text-3)]">虚拟礼物，不涉及真实的钱、订单或物流。送出后 TA 会用你设置的模型回应。</p>
          </>
        )}
      </div>
      {pick && (
        <div className="fixed inset-x-0 bottom-0 px-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 10px)' }}>
          <button disabled={!giftId || busy} className="press h-11 w-full rounded-full bg-[var(--c-accent)] text-white text-[14.5px] shadow-[var(--shadow-soft)] disabled:opacity-50" onClick={() => void send()}>{busy ? '送出中，TA 正在回应…' : giftId ? `送出「${GIFTS.find((g) => g.id === giftId)?.name}」` : '选一份礼物'}</button>
        </div>
      )}
    </div>
  )
}
