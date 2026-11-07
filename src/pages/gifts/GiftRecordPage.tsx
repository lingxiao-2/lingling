/** 一份礼物：礼物、留言、TA 的回应（失败可重试）、纪念日、收藏、删除 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { ConfirmDialog } from '../../components/Sheet'
import { db } from '../../db/db'
import { giftById } from '../../gifts/catalog'
import { deleteGiftRecord, requestReply, restoreGiftRecord, toggleGiftStar } from '../../gifts/gifts'
import { GiftTile } from './GiftsPage'

export default function GiftRecordPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const r = useLiveQuery(() => db.giftRecords.get(id).then((x) => x ?? null), [id])
  const ch = useLiveQuery(() => (r ? db.characters.get(r.characterId).then((x) => x ?? null) : null), [r?.characterId])
  const ev = useLiveQuery(() => (r?.eventId ? db.events.get(r.eventId).then((x) => x ?? null) : null), [r?.eventId])
  const [del, setDel] = useState(false)
  const [busy, setBusy] = useState(false)
  if (r === null) return (<div className="h-dvh flex flex-col"><NavBar title="礼物" back="/gifts" /><p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">这条记录不存在。</p></div>)
  if (!r) return <div className="h-dvh" />
  const g = giftById(r.giftId)
  const name = ch?.name ?? '已删除的角色'
  const toChar = r.direction === 'to_character'
  // 请求进行中关闭了聆聆：超过 2 分钟仍在等待，按中断处理，可以重试
  const status = r.replyStatus === 'waiting' && !busy && Date.now() - r.createdAt > 120_000 ? 'failed' : r.replyStatus
  const error = status === 'failed' && r.replyStatus === 'waiting' ? '上次回应被中断了' : r.replyError
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={toChar ? `送给 ${name}` : `${name} 送给你`} back={`/gifts?tab=${toChar ? 'sent' : 'received'}`} sideWidth={84} right={<>
        <NavButton label={r.starred ? '取消收藏' : '收藏'} icon="star" onClick={() => void toggleGiftStar(r.id)} />
        <NavButton label="删除" icon="delete" onClick={() => setDel(true)} />
      </>} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-16">
        {r.deletedAt && <p className="mt-1 rounded-[12px] bg-white/55 px-3 py-2 text-[12.5px] text-[var(--c-text-3)]">已删除。<button className="press text-[var(--c-accent-strong)]" onClick={() => void restoreGiftRecord(r.id)}>恢复</button></p>}
        <div className="gift-hero mt-3 rounded-[24px] px-5 py-6 text-center">
          <div className="flex justify-center"><GiftTile giftId={r.giftId} size={72} /></div>
          <div className="serif-zh mt-3 text-[19px] tracking-[0.06em] text-[#3f5674]">{g?.name ?? '礼物'}</div>
          <div className="mt-0.5 text-[12px] text-[#6d819c]">{g?.desc}</div>
          {r.starred && <div className="mt-1 text-[12px] text-[var(--c-accent)]" aria-label="已收藏">★ 已收藏</div>}
          {ev && <div className="mt-2 inline-block rounded-full bg-white/60 px-3 py-1 text-[11.5px] text-[#4a5f7b]">纪念：{ev.title}（{ev.date}）</div>}
        </div>
        {r.message && (
          <div className="mt-3 rounded-[16px] bg-white/55 px-4 py-3">
            <div className="text-[11.5px] text-[var(--c-text-3)]">{toChar ? '你附上的话' : `${name} 附上的话`}</div>
            <div className="gift-message mt-1 whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--c-text)]">{r.message}</div>
          </div>
        )}
        {toChar && (
          <div className="mt-3 rounded-[16px] bg-white/70 px-4 py-3">
            <div className="text-[11.5px] text-[var(--c-text-3)]">{name} 的回应</div>
            {status === 'done' && <div className="gift-reply mt-1 whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--c-text)]">{r.reply}</div>}
            {status === 'waiting' && <div className="mt-1 text-[13px] text-[var(--c-text-3)]">{name}正在回应…</div>}
            {status === 'failed' && (
              <div className="mt-1">
                <p role="alert" className="text-[12.5px] text-[var(--c-danger)]">回应没有生成：{error}</p>
                <button disabled={busy} className="press mt-2 h-8 px-4 rounded-full bg-[var(--c-accent)] text-white text-[12.5px] disabled:opacity-50" onClick={() => { setBusy(true); void requestReply(r.id).catch(() => {}).finally(() => setBusy(false)) }}>{busy ? '正在重试…' : '重试'}</button>
              </div>
            )}
            {r.model && r.replyStatus === 'done' && <div className="mt-2 text-right text-[10.5px] text-[var(--c-text-3)]">由 {r.model} 以 {name} 的身份回应</div>}
          </div>
        )}
        {!toChar && r.model && <div className="mt-2 text-right text-[10.5px] text-[var(--c-text-3)]">由 {r.model} 以 {name} 的身份挑选</div>}
        <div className="mt-4 flex gap-2">
          {ch && <button className="press h-9 px-4 rounded-full bg-white/70 text-[13px] text-[var(--c-accent-strong)]" onClick={() => nav(`/gifts/send?character=${ch.id}`)}>{toChar ? '再送一份' : '回赠一份'}</button>}
        </div>
      </div>
      {del && <ConfirmDialog title="删除这条礼物记录？" message="删除后可以在记录页面恢复。" confirmText="删除" danger onCancel={() => setDel(false)} onConfirm={() => void deleteGiftRecord(r.id).then(() => nav('/gifts', { replace: true }))} />}
    </div>
  )
}
