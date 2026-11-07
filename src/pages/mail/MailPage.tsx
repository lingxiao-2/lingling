/**
 * 信箱：收件箱 / 发件箱 / 草稿 / 收藏 / 最近删除；按角色筛选、搜索；写信；邀请角色写信（真实调用模型）。
 */
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import Avatar from '../../components/Avatar'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import type { Letter, PaperId } from '../../db/schema'
import { inFolder, PAPERS, searchLetters, type Folder } from '../../db/letterRepo'
import { cancelLetter, dismissJob, inviteLetter, useLetterJobs } from '../../mail/generate'

const FOLDERS: [Folder, string][] = [['inbox', '收件箱'], ['sent', '发件箱'], ['drafts', '草稿'], ['starred', '收藏'], ['trash', '最近删除']]
export const dateText = (ts?: number) => {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  return d.toDateString() === now.toDateString() ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 邀请写信：选择角色、主题（可不填）、信纸 */
function InviteSheet({ onClose, defaultCharacter }: { onClose: () => void; defaultCharacter?: string }) {
  const chars = useLiveQuery(() => db.characters.toArray(), [])
  const [cid, setCid] = useState(defaultCharacter ?? '')
  const [topic, setTopic] = useState('')
  const [paper, setPaper] = useState<PaperId>('snow')
  const pick = cid || chars?.[0]?.id || ''
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/20" onClick={onClose}>
      <div className="w-full rounded-t-[24px] bg-[rgba(246,249,253,0.98)] px-5 pt-4 shadow-[0_-10px_30px_rgba(0,0,0,0.15)]" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="邀请写信">
        <div className="serif-zh text-[16px] text-[var(--c-brand)]">邀请 TA 给你写一封信</div>
        <p className="mt-1 text-[11.5px] text-[var(--c-text-3)]">会用你在「AI 服务」中设置的模型，按 TA 的人设、你们的关系和已确认的记忆来写。信只保存在这台设备上。</p>
        {chars?.length === 0 ? <p className="mt-3 text-[13px] text-[var(--c-text-3)]">还没有角色。</p> : (
          <>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {chars?.map((c) => (
                <button key={c.id} aria-pressed={pick === c.id} className={`press shrink-0 flex flex-col items-center gap-1 rounded-[14px] px-2 py-1.5 ${pick === c.id ? 'bg-white shadow-[0_2px_8px_rgba(80,110,150,0.15)]' : ''}`} onClick={() => setCid(c.id)}>
                  <Avatar name={c.name} src={c.avatar} size={40} /><span className="max-w-[64px] truncate text-[12px]">{c.name}</span>
                </button>
              ))}
            </div>
            <input aria-label="信的主题" value={topic} maxLength={100} onChange={(e) => setTopic(e.target.value)} placeholder="想让 TA 写什么？（可不填，例如：初雪那天）" className="mt-2 w-full h-10 rounded-[12px] bg-white/80 border border-[var(--c-line)] px-3 text-[15px] outline-none" />
            <div className="mt-2 flex gap-1.5">{PAPERS.map((p) => <button key={p.id} aria-pressed={paper === p.id} className={`press paper-chip paper-${p.id} h-8 px-3 rounded-full text-[12px] ${paper === p.id ? 'ring-2 ring-[var(--c-accent)]' : ''}`} onClick={() => setPaper(p.id)}>{p.name}</button>)}</div>
            <button disabled={!pick} className="press mt-3 h-10 w-full rounded-full bg-[var(--c-accent)] text-white text-[14px] disabled:opacity-50" onClick={() => { void inviteLetter(pick, { topic, paper }).catch(() => {}); onClose() }}>请 TA 写信</button>
          </>
        )}
      </div>
    </div>
  )
}

/** 正在写信 / 写信失败的提示（离开页面后也会继续） */
export function LetterJobs() {
  const jobs = useLetterJobs()
  const names = useLiveQuery(async () => new Map((await db.characters.toArray()).map((c) => [c.id, c.name])), [])
  const nav = useNavigate()
  if (!jobs.length) return null
  return (
    <div className="mx-4 mb-2 flex flex-col gap-1.5">
      {jobs.map((j) => (
        <div key={j.characterId} role="status" className="letter-job rounded-[14px] bg-white/60 px-4 py-2 text-[12.5px] flex items-center justify-between gap-2">
          <span className={j.error ? 'text-[var(--c-danger)]' : 'text-[var(--c-text-2)]'}>
            {j.doneId ? `${names?.get(j.characterId) ?? '角色'}的信到了` : j.error ? `${names?.get(j.characterId) ?? '角色'}的信没有写成：${j.error}` : `${names?.get(j.characterId) ?? '角色'}正在写信…`}
          </span>
          {j.doneId ? <button className="press text-[var(--c-accent-strong)]" onClick={() => { dismissJob(j.characterId); nav(`/mail/${j.doneId}`) }}>拆开</button>
            : j.error ? <button className="press text-[var(--c-text-3)]" onClick={() => dismissJob(j.characterId)}>关闭</button>
            : <button className="press text-[var(--c-text-3)]" onClick={() => cancelLetter(j.characterId)}>取消</button>}
        </div>
      ))}
    </div>
  )
}

export default function MailPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const folder = (params.get('f') as Folder) || 'inbox'
  const charFilter = params.get('character') ?? ''
  const [q, setQ] = useState('')
  const [inviting, setInviting] = useState(false)
  const letters = useLiveQuery(() => db.letters.orderBy('createdAt').reverse().toArray(), [], [] as Letter[])
  const chars = useLiveQuery(() => db.characters.toArray(), [])
  const names = new Map((chars ?? []).map((c) => [c.id, c.name]))
  const mine = letters.filter((l) => !charFilter || l.characterId === charFilter)
  const shown = searchLetters(mine.filter((l) => inFolder(l, folder)), q, names)
  const unread = mine.filter((l) => inFolder(l, 'inbox') && !l.read).length
  const setP = (patch: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...patch }, { replace: true })

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="信箱" back="/" sideWidth={84} right={<><NavButton label="邀请写信" icon="sparkle" onClick={() => setInviting(true)} /><NavButton label="写信" icon="edit" onClick={() => nav(`/mail/new${charFilter ? `?character=${charFilter}` : ''}`)} /></>} />
      <div className="shrink-0 px-4 pt-1 pb-2">
        <div className="flex gap-1 overflow-x-auto" role="tablist">
          {FOLDERS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={folder === k} className={`press shrink-0 h-8 px-3.5 rounded-full text-[13px] ${folder === k ? 'bg-[var(--c-accent)] text-white' : 'bg-white/50 text-[var(--c-text-2)]'}`} onClick={() => setP({ f: k })}>
              {l}{k === 'inbox' && unread ? ` ${unread}` : ''}
            </button>
          ))}
        </div>
        {(chars?.length ?? 0) > 1 && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto" aria-label="按角色筛选">
            <button className={`press shrink-0 h-7 px-3 rounded-full text-[12px] ${!charFilter ? 'bg-white text-[var(--c-accent-strong)]' : 'text-[var(--c-text-3)]'}`} onClick={() => setP({ character: '' })}>全部角色</button>
            {chars?.map((c) => <button key={c.id} className={`press shrink-0 h-7 px-3 rounded-full text-[12px] ${charFilter === c.id ? 'bg-white text-[var(--c-accent-strong)]' : 'text-[var(--c-text-3)]'}`} onClick={() => setP({ character: c.id })}>{c.name}</button>)}
          </div>
        )}
        {letters.length > 0 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索信件" className="mt-2 w-full h-9 rounded-full bg-white/55 border border-[var(--c-line)] px-4 text-[15px] outline-none focus:border-[var(--c-accent)]" />}
      </div>
      <LetterJobs />
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        {shown.length === 0 && (
          <div className="mt-12 px-10 text-center">
            <div className="mx-auto h-14 w-14 rounded-full border border-dashed border-[#a9bdd5] flex items-center justify-center text-[#8ea3bf]"><Icon name="mail" size="lg" stroke="thin" /></div>
            <p className="mt-3 text-[13px] text-[var(--c-text-3)]">{q ? '没有找到信件' : folder === 'inbox' ? '还没有来信。点右上角「邀请写信」，请 TA 给你写一封。' : folder === 'drafts' ? '没有草稿' : folder === 'trash' ? '没有最近删除的信件' : folder === 'starred' ? '还没有收藏的信件' : '还没有寄出过信'}</p>
          </div>
        )}
        {shown.map((l) => (
          <button key={l.id} className={`letter-row press w-full flex gap-3 px-4 py-3 text-left hairline-b ${!l.read ? 'bg-white/35' : ''}`} onClick={() => nav(l.status === 'draft' && !l.deletedAt ? `/mail/new?draft=${l.id}` : `/mail/${l.id}`)}>
            <span className={`paper-strip paper-${l.paper} mt-0.5 h-10 w-1.5 shrink-0 rounded-full`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={`truncate text-[14.5px] ${!l.read ? 'font-medium text-[var(--c-text)]' : 'text-[var(--c-text)]'}`}>{!l.read && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--c-accent)]" aria-label="未读" />}{l.subject || '（无标题）'}</span>
                <span className="shrink-0 text-[11.5px] text-[var(--c-text-3)]">{dateText(l.sentAt ?? l.updatedAt)}</span>
              </span>
              <span className="block truncate text-[12px] text-[var(--c-text-3)]">{l.direction === 'from_character' ? `来自 ${names.get(l.characterId) ?? '已删除的角色'}` : `寄给 ${names.get(l.characterId) ?? '已删除的角色'}`}{l.status === 'draft' ? ' · 草稿' : ''}{l.starred ? ' · ★' : ''}</span>
              <span className="block truncate text-[12.5px] text-[var(--c-text-2)]">{l.body.replace(/\s+/g, ' ').slice(0, 60)}</span>
            </span>
          </button>
        ))}
      </div>
      {inviting && <InviteSheet onClose={() => setInviting(false)} defaultCharacter={charFilter || undefined} />}
    </div>
  )
}
