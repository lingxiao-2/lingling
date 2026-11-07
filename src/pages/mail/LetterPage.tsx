/** 读信：信纸、收藏、回信 / 请 TA 回信、删除与恢复、提议保存为共同记忆（由你确认） */
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { ActionSheet, ConfirmDialog } from '../../components/Sheet'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import { markRead, purgeLetter, restoreLetter, toggleStar, trashLetter } from '../../db/letterRepo'
import { addProposals } from '../../db/memoryRepo'
import { MEMORY_BUDGET, memoryCheck } from '../../services/ai/memory'
import { dismissJob, replyToLetter, useLetterJobs } from '../../mail/generate'
import { LetterJobs } from './MailPage'
import type { MemoryKind } from '../../db/schema'

const fullDate = (ts?: number) => (ts ? `${new Date(ts).getFullYear()}年${new Date(ts).getMonth() + 1}月${new Date(ts).getDate()}日` : '')

/** 把信里的一段提议为共同记忆：只进入「待确认」，并提醒信里的情节可能是虚构的 */
function MemoryDialog({ characterId, characterName, excerpt, onClose }: { characterId: string; characterName: string; excerpt: string; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [kind, setKind] = useState<MemoryKind>('user-fact')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const nav = useNavigate()
  const save = async () => {
    const c = content.trim()
    if (c.length < 2) return setErr('请写一句要记住的事')
    const check = memoryCheck(c)
    if (!check.ok) return setErr(check.reason ?? '这类信息不能保存为记忆')
    await addProposals(characterId, [{ kind, content: c.slice(0, MEMORY_BUDGET.itemChars), sourceMessageIds: [], quote: excerpt.slice(0, 120), origin: 'suggested', sensitive: check.sensitive }])
    setDone(true)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/20" onClick={onClose}>
      <div role="dialog" aria-label="提议共同记忆" className="w-full rounded-t-[24px] bg-[rgba(246,249,253,0.98)] px-5 pt-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }} onClick={(e) => e.stopPropagation()}>
        <div className="serif-zh text-[16px] text-[var(--c-brand)]">提议保存为和{characterName}的共同记忆</div>
        {done ? (
          <>
            <p className="mt-2 text-[13px] text-[var(--c-text-2)]">已放进「待确认」。在{characterName}的记忆页确认后，才会成为 TA 记得的事。</p>
            <div className="mt-3 flex gap-2">
              <button className="press flex-1 h-10 rounded-full bg-white/80 text-[14px]" onClick={onClose}>好</button>
              <button className="press flex-1 h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px]" onClick={() => nav(`/character/${characterId}/memories`)}>去确认</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 rounded-[12px] bg-[#fff6e6] px-3 py-2 text-[11.5px] leading-relaxed text-[#8a6a2c]">信里的情节可能是角色想象或虚构的。请只记下<b>真实发生过</b>或<b>你确认的</b>事，不要把虚构的剧情当成共同经历。</p>
            <textarea aria-label="要记住的事" value={content} maxLength={MEMORY_BUDGET.itemChars} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="用一句话写下要记住的事，例如：我们约好明年一起看初雪" className="mt-2 w-full resize-none rounded-[12px] bg-white/80 border border-[var(--c-line)] px-3 py-2 text-[15px] outline-none" />
            <select aria-label="记忆类型" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)} className="mt-2 h-9 w-full rounded-[10px] bg-white/80 border border-[var(--c-line)] px-2 text-[14px]">
              <option value="user-fact">关于我</option><option value="preference">我的喜好</option><option value="promise">我们的约定</option><option value="event">真实发生的共同经历</option>
            </select>
            {err && <p role="alert" className="mt-1 text-[12px] text-[var(--c-danger)]">{err}</p>}
            <button className="press mt-3 h-10 w-full rounded-full bg-[var(--c-accent)] text-white text-[14px]" onClick={() => void save()}>放进待确认</button>
          </>
        )}
      </div>
    </div>
  )
}

export default function LetterPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const l = useLiveQuery(() => db.letters.get(id).then((x) => x ?? null), [id])
  const ch = useLiveQuery(() => (l ? db.characters.get(l.characterId).then((x) => x ?? null) : null), [l?.characterId])
  const replyOf = useLiveQuery(() => (l?.replyToId ? db.letters.get(l.replyToId).then((x) => x ?? null) : null), [l?.replyToId])
  const replies = useLiveQuery(() => db.letters.filter((x) => x.replyToId === id && !x.deletedAt).toArray(), [id])
  const jobs = useLetterJobs()
  const [menu, setMenu] = useState(false)
  const [purging, setPurging] = useState(false)
  const [memory, setMemory] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (l && !l.read) void markRead(l.id)
  }, [l])
  // 打开了刚到的信：收起「信到了」的提示
  useEffect(() => {
    for (const j of jobs) if (j.doneId === id) dismissJob(j.characterId)
  }, [jobs, id])
  if (l === null) return (<div className="h-dvh flex flex-col"><NavBar title="信件" back="/mail" /><p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">这封信已经不存在了。</p></div>)
  if (!l) return <div className="h-dvh" />
  const name = ch?.name ?? '已删除的角色'
  const fromChar = l.direction === 'from_character'
  const writing = jobs.some((j) => j.characterId === l.characterId && !j.error && !j.doneId)
  const askReply = () => {
    setErr('')
    void replyToLetter(l.id).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={fromChar ? `来自 ${name}` : `寄给 ${name}`} back="/mail" sideWidth={84} right={<>
        <NavButton label={l.starred ? '取消收藏' : '收藏'} icon="star" onClick={() => void toggleStar(l.id)} />
        <NavButton label="更多" icon="more" onClick={() => setMenu(true)} />
      </>} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-16">
        {params.get('sent') && !l.deletedAt && <p className="mt-1 rounded-[12px] bg-white/55 px-3 py-2 text-[12.5px] text-[var(--c-text-2)]">信已寄出，保存在发件箱。</p>}
        <LetterJobs />
        {l.deletedAt && <p className="mt-1 rounded-[12px] bg-white/55 px-3 py-2 text-[12.5px] text-[var(--c-text-3)]">这封信在「最近删除」中。</p>}
        <article className={`letter-paper paper-${l.paper} mt-2 rounded-[22px] px-6 py-5`}>
          <div className="flex items-start justify-between gap-2">
            <h1 className="serif-zh text-[19px] leading-snug tracking-[0.04em]">{l.subject}</h1>
            {l.starred && <span className="text-[var(--c-accent)]" aria-label="已收藏"><Icon name="star" size="sm" /></span>}
          </div>
          <div className="mt-1 text-[11.5px] opacity-70">{fromChar ? `${name} 寄给你` : `你寄给 ${name}`} · {fullDate(l.sentAt ?? l.createdAt)}</div>
          {replyOf && <button className="press mt-1 text-[11.5px] underline opacity-70" onClick={() => nav(`/mail/${replyOf.id}`)}>回复的是：{replyOf.subject}</button>}
          <div className="letter-body mt-4 whitespace-pre-wrap break-words text-[15px] leading-[30px]">{l.body}</div>
          {fromChar && l.model && <div className="mt-4 text-right text-[10.5px] opacity-50">由 {l.model} 以 {name} 的身份写下</div>}
        </article>
        {err && <p role="alert" className="mt-2 text-[12px] text-[var(--c-danger)]">{err}</p>}
        {!l.deletedAt && ch && (
          <div className="mt-3 flex flex-wrap gap-2">
            {fromChar && <button className="press h-9 px-4 rounded-full bg-[var(--c-accent)] text-white text-[13px]" onClick={() => nav(`/mail/new?replyTo=${l.id}`)}>回信</button>}
            {!fromChar && l.status === 'sent' && !replies?.some((x) => x.direction === 'from_character') && (
              <button disabled={writing} className="press h-9 px-4 rounded-full bg-[var(--c-accent)] text-white text-[13px] disabled:opacity-50" onClick={askReply}>{writing ? `${name}正在写回信…` : `请 ${name} 回信`}</button>
            )}
            <button className="press h-9 px-4 rounded-full bg-white/70 text-[13px] text-[var(--c-accent-strong)]" onClick={() => setMemory(true)}>提议保存为共同记忆</button>
          </div>
        )}
        {replies?.length ? (
          <div className="mt-3">
            {replies.map((r) => <button key={r.id} className="press block text-[12.5px] text-[var(--c-accent-strong)]" onClick={() => nav(`/mail/${r.id}`)}>{r.direction === 'from_character' ? `${name}的回信：` : '你的回信：'}{r.subject}</button>)}
          </div>
        ) : null}
      </div>
      {menu && (
        <ActionSheet
          title={l.subject}
          actions={l.deletedAt
            ? [{ label: '恢复', onClick: () => { void restoreLetter(l.id); setMenu(false) } }, { label: '彻底删除', danger: true, onClick: () => { setMenu(false); setPurging(true) } }]
            : [{ label: '删除（移到最近删除）', danger: true, onClick: () => { void trashLetter(l.id); setMenu(false) } }]}
          onClose={() => setMenu(false)}
        />
      )}
      {purging && <ConfirmDialog title="彻底删除这封信？" message="彻底删除后无法恢复。" confirmText="彻底删除" danger onCancel={() => setPurging(false)} onConfirm={() => void purgeLetter(l.id).then(() => nav('/mail?f=trash', { replace: true }))} />}
      {memory && ch && <MemoryDialog characterId={ch.id} characterName={ch.name} excerpt={l.body.slice(0, 120)} onClose={() => setMemory(false)} />}
    </div>
  )
}
