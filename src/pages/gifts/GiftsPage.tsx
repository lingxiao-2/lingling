/**
 * 礼物：送出的 / 收到的 / 收藏；按角色筛选；送礼物；请 TA 选一份礼物送给你。
 * 全部是虚拟礼物，没有金钱、订单或物流。
 */
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import Avatar from '../../components/Avatar'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import type { GiftRecord } from '../../db/schema'
import { giftById } from '../../gifts/catalog'
import { askCharacterGift } from '../../gifts/gifts'

type Tab = 'sent' | 'received' | 'starred'

export function GiftTile({ giftId, size = 46 }: { giftId: string; size?: number }) {
  const g = giftById(giftId)
  return (
    <span className="gift-tile shrink-0 flex items-center justify-center text-[#5d7392]" style={{ width: size, height: size }} aria-hidden>
      {g ? <Icon name={g.icon} size={size > 50 ? 'lg' : 'md'} stroke="thin" /> : <Icon name="gift" stroke="thin" />}
    </span>
  )
}

export default function GiftsPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'sent'
  const charFilter = params.get('character') ?? ''
  const records = useLiveQuery(() => db.giftRecords.orderBy('createdAt').reverse().toArray(), [], [] as GiftRecord[])
  const chars = useLiveQuery(() => db.characters.toArray(), [])
  const names = new Map((chars ?? []).map((c) => [c.id, c.name]))
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const shown = records.filter((r) => !r.deletedAt && (!charFilter || r.characterId === charFilter) && (tab === 'starred' ? r.starred : tab === 'sent' ? r.direction === 'to_character' : r.direction === 'from_character'))
  const setP = (patch: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...patch }, { replace: true })
  const ask = async (cid: string) => {
    setAsking(false)
    setBusy(cid)
    setErr('')
    try {
      const r = await askCharacterGift(cid)
      nav(`/gifts/${r.id}`)
    } catch (e) {
      setErr(`${names.get(cid) ?? '角色'}没有选好礼物：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="礼物" back="/" right={<NavButton label="送礼物" icon="gift" onClick={() => nav(`/gifts/send${charFilter ? `?character=${charFilter}` : ''}`)} />} />
      <div className="shrink-0 px-4 pt-1 pb-2">
        <div className="grid grid-cols-3 gap-1 rounded-full bg-white/50 p-0.5" role="tablist">
          {([['sent', '送出的'], ['received', '收到的'], ['starred', '收藏']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`press h-8 rounded-full text-[13px] ${tab === k ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-2)]'}`} onClick={() => setP({ tab: k })}>{l}</button>
          ))}
        </div>
        {(chars?.length ?? 0) > 1 && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto" aria-label="按角色筛选">
            <button className={`press shrink-0 h-7 px-3 rounded-full text-[12px] ${!charFilter ? 'bg-white text-[var(--c-accent-strong)]' : 'text-[var(--c-text-3)]'}`} onClick={() => setP({ character: '' })}>全部角色</button>
            {chars?.map((c) => <button key={c.id} className={`press shrink-0 h-7 px-3 rounded-full text-[12px] ${charFilter === c.id ? 'bg-white text-[var(--c-accent-strong)]' : 'text-[var(--c-text-3)]'}`} onClick={() => setP({ character: c.id })}>{c.name}</button>)}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <button className="press flex-1 h-9 rounded-full bg-[var(--c-accent)] text-white text-[13px]" onClick={() => nav(`/gifts/send${charFilter ? `?character=${charFilter}` : ''}`)}>送一份礼物</button>
          <button disabled={!!busy || !chars?.length} className="press flex-1 h-9 rounded-full bg-white/70 text-[13px] text-[var(--c-accent-strong)] disabled:opacity-50" onClick={() => (charFilter ? void ask(charFilter) : setAsking(true))}>{busy ? `${names.get(busy)}正在挑选…` : '请 TA 送我一份'}</button>
        </div>
        {err && <p role="alert" className="mt-2 text-[12px] text-[var(--c-danger)]">{err}</p>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        {shown.length === 0 && (
          <div className="mt-12 px-10 text-center">
            <div className="mx-auto h-14 w-14 rounded-full border border-dashed border-[#a9bdd5] flex items-center justify-center text-[#8ea3bf]"><Icon name="gift" size="lg" stroke="thin" /></div>
            <p className="mt-3 text-[13px] text-[var(--c-text-3)]">{tab === 'sent' ? '还没有送过礼物。' : tab === 'received' ? '还没有收到礼物。点「请 TA 送我一份」。' : '还没有收藏的礼物。'}</p>
            <p className="mt-1 text-[11px] text-[var(--c-text-3)]">这里都是虚拟礼物，不涉及真实的钱和物品。</p>
          </div>
        )}
        {shown.map((r) => {
          const g = giftById(r.giftId)
          return (
            <button key={r.id} className="gift-row press w-full flex items-center gap-3 px-4 py-2.5 text-left hairline-b" onClick={() => nav(`/gifts/${r.id}`)}>
              <GiftTile giftId={r.giftId} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] text-[var(--c-text)]">{g?.name ?? '礼物'}{r.starred ? ' ★' : ''}</span>
                <span className="block truncate text-[12px] text-[var(--c-text-3)]">{r.direction === 'to_character' ? `送给 ${names.get(r.characterId) ?? '已删除的角色'}` : `${names.get(r.characterId) ?? '已删除的角色'} 送给你`} · {new Date(r.createdAt).getMonth() + 1}月{new Date(r.createdAt).getDate()}日</span>
                <span className="block truncate text-[12.5px] text-[var(--c-text-2)]">{r.direction === 'to_character' ? (r.replyStatus === 'done' ? `「${r.reply}」` : r.replyStatus === 'failed' ? '回应没有生成，点开重试' : 'TA 正在回应…') : `「${r.message}」`}</span>
              </span>
            </button>
          )
        })}
      </div>
      {asking && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/20" onClick={() => setAsking(false)}>
          <div role="dialog" aria-label="请谁送礼物" className="w-full rounded-t-[24px] bg-[rgba(246,249,253,0.98)] px-5 pt-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="serif-zh text-[16px] text-[var(--c-brand)]">请谁送你一份礼物？</div>
            <p className="mt-1 text-[11.5px] text-[var(--c-text-3)]">TA 会根据性格、你们的关系和了解的你，在礼物清单里挑一份（会调用你设置的模型）。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {chars?.map((c) => <button key={c.id} className="press flex flex-col items-center gap-1 w-16" onClick={() => void ask(c.id)}><Avatar name={c.name} src={c.avatar} size={44} /><span className="max-w-full truncate text-[12px]">{c.name}</span></button>)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
