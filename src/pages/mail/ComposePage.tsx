/** 写信：选择角色与信纸，自动保存草稿，寄出后可以请 TA 回信 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../../components/NavBar'
import Avatar from '../../components/Avatar'
import { db } from '../../db/db'
import type { PaperId } from '../../db/schema'
import { LETTER_LIMITS, PAPERS, saveDraft, sendDraft } from '../../db/letterRepo'

export default function ComposePage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const chars = useLiveQuery(() => db.characters.toArray(), [])
  const [draftId, setDraftId] = useState<string | null>(params.get('draft'))
  const [cid, setCid] = useState(params.get('character') ?? '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [paper, setPaper] = useState<PaperId>('snow')
  const [replyTo, setReplyTo] = useState<string | undefined>(params.get('replyTo') ?? undefined)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')
  const loaded = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 打开已有草稿，或回信时带上原信的角色、标题和信纸
  useEffect(() => {
    void (async () => {
      const d = draftId ? await db.letters.get(draftId) : undefined
      if (d && d.status === 'draft') {
        setCid(d.characterId)
        setSubject(d.subject)
        setBody(d.body)
        setPaper(d.paper)
        setReplyTo(d.replyToId)
      } else if (replyTo) {
        const r = await db.letters.get(replyTo)
        if (r) {
          setCid(r.characterId)
          setSubject(`回信：${r.subject}`.slice(0, LETTER_LIMITS.subject))
          setPaper(r.paper)
        }
      }
      loaded.current = true
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pick = cid || chars?.[0]?.id || ''

  // 自动保存草稿（停止输入 0.8 秒后）
  useEffect(() => {
    if (!loaded.current || !pick || (!subject.trim() && !body.trim())) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void saveDraft(draftId, { characterId: pick, subject, body, paper, replyToId: replyTo }).then((id) => { setDraftId(id); setSaved('草稿已保存') }, (e) => setErr(String(e?.message ?? e)))
    }, 800)
    return () => clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, body, paper, pick])

  const send = async () => {
    setErr('')
    clearTimeout(timer.current)
    try {
      const id = await saveDraft(draftId, { characterId: pick, subject, body, paper, replyToId: replyTo })
      const l = await sendDraft(id)
      nav(`/mail/${l.id}?sent=1`, { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={replyTo ? '回信' : '写信'} back="/mail" right={<button className="press h-9 px-3 text-[14px] text-[var(--c-accent-strong)] disabled:opacity-40" disabled={!body.trim() || !pick} onClick={() => void send()}>寄出</button>} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-16">
        {chars?.length === 0 ? <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">还没有角色。</p> : (
          <>
            <div className="mt-1 flex gap-2 overflow-x-auto pb-1" aria-label="收信人">
              {chars?.map((c) => (
                <button key={c.id} aria-pressed={pick === c.id} disabled={!!replyTo && pick !== c.id} className={`press shrink-0 flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 text-[12.5px] disabled:opacity-30 ${pick === c.id ? 'bg-white shadow-[0_2px_8px_rgba(80,110,150,0.15)] text-[var(--c-accent-strong)]' : 'text-[var(--c-text-2)]'}`} onClick={() => setCid(c.id)}>
                  <Avatar name={c.name} src={c.avatar} size={26} />寄给 {c.name}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">{PAPERS.map((p) => <button key={p.id} aria-pressed={paper === p.id} className={`press paper-chip paper-${p.id} h-7 px-3 rounded-full text-[12px] ${paper === p.id ? 'ring-2 ring-[var(--c-accent)]' : ''}`} onClick={() => setPaper(p.id)}>{p.name}</button>)}</div>
            <div className={`letter-paper paper-${paper} mt-3 rounded-[20px] px-5 py-4`}>
              <input aria-label="标题" value={subject} maxLength={LETTER_LIMITS.subject} onChange={(e) => setSubject(e.target.value)} placeholder="标题" className="w-full bg-transparent serif-zh text-[17px] outline-none placeholder:text-[var(--c-text-3)]" />
              <textarea aria-label="正文" value={body} maxLength={LETTER_LIMITS.body} onChange={(e) => setBody(e.target.value)} placeholder="写下你想说的话……" rows={14} className="letter-lines mt-2 w-full resize-none bg-transparent text-[15px] leading-[30px] outline-none placeholder:text-[var(--c-text-3)]" />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-[var(--c-text-3)]"><span>{saved}</span><span>{body.length} / {LETTER_LIMITS.body}</span></div>
            {err && <p role="alert" className="mt-1 text-[12px] text-[var(--c-danger)]">{err}</p>}
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--c-text-3)]">寄出后信保存在本机的发件箱里，不会自动发给 AI。你可以在信里点「请 TA 回信」，那时才会把这封信交给模型。</p>
          </>
        )}
      </div>
    </div>
  )
}
