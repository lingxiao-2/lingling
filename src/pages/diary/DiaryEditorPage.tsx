/**
 * 写日记 / 编辑日记：自动保存（停顿约半秒后保存；空白的新日记不保存）。
 * 日期、心情、标题、正文、标签、关联照片；「允许 AI 读取」默认关闭。删除后进入最近删除，可以恢复。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import PhotoPicker, { LinkedPhotos } from '../../components/PhotoPicker'
import { ConfirmDialog } from '../../components/Sheet'
import { db } from '../../db/db'
import type { Diary } from '../../db/schema'
import { restoreDiary, saveDiary, trashDiary, type DiaryPatch } from '../../db/diaryRepo'
import { DIARY_LIMITS, dateParts, isDateString, localDate, MOODS, normalizeTags } from '../../life/diary'

type Draft = Pick<Diary, 'date' | 'title' | 'body' | 'mood' | 'tags' | 'photoIds' | 'aiReadable'>

export default function DiaryEditorPage() {
  const { id: routeId = 'new' } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const isNew = routeId === 'new'
  const existing = useLiveQuery(() => (isNew ? null : db.diaries.get(routeId).then((d) => d ?? null)), [routeId])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tagText, setTagText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [savedAt, setSavedAt] = useState(0)
  const [picking, setPicking] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const idRef = useRef<string | null>(isNew ? null : routeId)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<DiaryPatch>({})
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // 初始化草稿（只做一次）
  useEffect(() => {
    if (draft) return
    if (isNew) {
      const d = params.get('date')
      setDraft({ date: isDateString(d) ? d : localDate(), title: '', body: '', mood: undefined, tags: [], photoIds: [], aiReadable: false })
    } else if (existing) {
      setDraft({ date: existing.date, title: existing.title, body: existing.body, mood: existing.mood, tags: existing.tags, photoIds: existing.photoIds, aiReadable: existing.aiReadable })
      setTagText(existing.tags.join(' '))
    }
  }, [existing, isNew, draft, params])

  // 正文自动长高
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(220, el.scrollHeight)}px`
  }, [draft?.body])

  const flush = async () => {
    clearTimeout(timer.current)
    const patch = pending.current
    pending.current = {}
    if (!Object.keys(patch).length || !draft) return
    setStatus('saving')
    const wasNew = !idRef.current
    // 新日记第一次保存时带上完整草稿
    const id = await saveDiary(idRef.current, wasNew ? { ...draft, ...patch } : patch)
    if (id && wasNew) {
      idRef.current = id
      nav(`/diary/${id}`, { replace: true })
    }
    setStatus(id ? 'saved' : 'idle')
    if (id) setSavedAt(Date.now())
  }
  // 离开页面时立即保存
  useEffect(() => () => void flush(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch: DiaryPatch) => {
    setDraft((d) => (d ? { ...d, ...patch } as Draft : d))
    pending.current = { ...pending.current, ...patch }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 500)
  }

  if (!isNew && existing === null) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="日记" back="/diary" />
        <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">这篇日记不存在了。</p>
      </div>
    )
  }
  if (!draft) return <div className="h-dvh" />
  const p = dateParts(draft.date)
  const deleted = !!existing?.deletedAt

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title={isNew && !idRef.current ? '写日记' : '日记'}
        back="/diary"
        subtitle={status === 'saving' ? '正在保存…' : status === 'saved' ? `已自动保存 ${new Date(savedAt).toTimeString().slice(0, 5)}` : isNew ? '写下第一个字后自动保存' : undefined}
        right={idRef.current && !deleted ? <NavButton label="删除日记" icon="delete" onClick={() => setAskDelete(true)} /> : undefined}
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        {deleted && (
          <div className="mx-4 mt-2 card px-4 py-2.5 text-[13px] flex justify-between items-center">
            <span className="text-[var(--c-text-2)]">这篇日记在最近删除中</span>
            <button className="press text-[var(--c-accent-strong)]" onClick={() => void restoreDiary(routeId)}>恢复</button>
          </div>
        )}
        <article className="mx-3 mt-2 diary-paper diary-sheet rounded-[20px] px-5 pt-4 pb-6">
          <div className="flex items-end justify-between">
            <label className="relative">
              <span className="desk-serif text-[38px] leading-none text-[#34506f]">{p.day}</span>
              <span className="ml-2 desk-serif italic text-[14px] text-[#6f88a8]">{p.monEn} {p.year}</span>
              <span className="block text-[11px] tracking-[0.18em] text-[#93a5bc]">{p.week} · 点按更改日期</span>
              <input type="date" aria-label="日期" value={draft.date} onChange={(e) => isDateString(e.target.value) && change({ date: e.target.value })} className="absolute inset-0 opacity-0" />
            </label>
            <span className="text-[#b8c9de] text-[22px]" aria-hidden>❄</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="心情">
            {MOODS.map((m) => (
              <button key={m.id} role="radio" aria-checked={draft.mood === m.id} onClick={() => change({ mood: draft.mood === m.id ? undefined : m.id })} className={`press h-7 px-2.5 rounded-full text-[12px] border ${draft.mood === m.id ? 'border-transparent text-[#2d4361]' : 'border-[rgba(150,175,205,0.35)] text-[#6d819c]'}`} style={draft.mood === m.id ? { background: `${m.color}88` } : undefined}>
                {m.label}
              </button>
            ))}
          </div>

          <input value={draft.title} maxLength={DIARY_LIMITS.title} onChange={(e) => change({ title: e.target.value })} placeholder="标题" className="mt-4 w-full bg-transparent serif-zh text-[19px] tracking-[0.04em] text-[#2d4361] placeholder:text-[#b3c2d4] outline-none" />
          <textarea ref={bodyRef} value={draft.body} maxLength={DIARY_LIMITS.body} onChange={(e) => change({ body: e.target.value })} placeholder="今天……" className="diary-lines mt-2 w-full resize-none bg-transparent text-[16px] leading-[30px] text-[#34465e] placeholder:text-[#b3c2d4] outline-none" />

          <div className="mt-4">
            <LinkedPhotos ids={draft.photoIds} onOpen={(pid) => nav(`/album/photo/${pid}?from=all&return=1`)} onRemove={(pid) => change({ photoIds: draft.photoIds.filter((x) => x !== pid) })} />
            <button className="press mt-2 h-8 px-3 rounded-full border border-dashed border-[#a9bdd5] text-[12.5px] text-[#6f88a8]" onClick={() => setPicking(true)}>＋ 关联照片</button>
          </div>

          <input
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onBlur={() => change({ tags: normalizeTags(tagText) })}
            placeholder="标签，用空格分开，例如：初雪 沈遥"
            className="mt-4 w-full h-9 rounded-[10px] bg-white/50 border border-[rgba(150,175,205,0.3)] px-3 text-[14px] outline-none focus:border-[var(--c-accent)]"
          />
          {draft.tags.length > 0 && <div className="mt-1.5 text-[12px] text-[#6f88a8]">{draft.tags.map((t) => `#${t}`).join('  ')}</div>}
        </article>

        <section className="mx-4 mt-3 card px-4 py-3">
          <label className="flex items-start justify-between gap-3">
            <span className="text-[13.5px] text-[var(--c-text)]">
              允许 AI 读取这篇日记
              <span className="block text-[11.5px] leading-relaxed text-[var(--c-text-3)]">默认关闭：日记只有你自己能看到。开启后，以后的 AI 功能在你授权时才可以读到这一篇；不会自动变成角色的记忆。目前还没有任何 AI 读取日记。</span>
            </span>
            <input type="checkbox" className="mt-1" checked={draft.aiReadable} onChange={(e) => change({ aiReadable: e.target.checked })} />
          </label>
        </section>
      </div>

      {picking && <PhotoPicker selected={draft.photoIds} onClose={() => setPicking(false)} onDone={(ids) => { setPicking(false); change({ photoIds: ids }) }} />}
      {askDelete && (
        <ConfirmDialog
          title="删除这篇日记？"
          message="会移到「最近删除」，可以恢复。"
          confirmText="删除"
          danger
          onCancel={() => setAskDelete(false)}
          onConfirm={() => void flush().then(() => trashDiary(idRef.current!)).then(() => nav('/diary', { replace: true }))}
        />
      )}
    </div>
  )
}
