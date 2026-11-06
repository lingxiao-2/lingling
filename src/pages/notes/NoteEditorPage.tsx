/**
 * 便签编辑：标题、文字 / 清单两种模式、颜色、置顶、显示在桌面；自动保存（空白的新便签不保存）；删除进入最近删除。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { ConfirmDialog } from '../../components/Sheet'
import { db } from '../../db/db'
import type { Note, NoteItem } from '../../db/schema'
import { restoreNote, saveNote, trashNote, type NotePatch } from '../../db/noteRepo'
import { firstNoteWidget, saveWidgetNote, useDesktopLayout } from '../../desktop/layoutStore'
import { uid } from '../../lib/util'
import { colorOf, NOTE_COLORS, NOTE_LIMITS, toChecklist, toText } from '../../life/notes'

type Draft = Pick<Note, 'title' | 'kind' | 'text' | 'items' | 'color' | 'pinned'>

export default function NoteEditorPage() {
  const { id: routeId = 'new' } = useParams()
  const [params] = useSearchParams()
  const widget = params.get('widget')
  const nav = useNavigate()
  const isNew = routeId === 'new'
  const existing = useLiveQuery(() => (isNew ? null : db.notes.get(routeId).then((n) => n ?? null)), [routeId])
  const layout = useDesktopLayout()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [status, setStatus] = useState('')
  const [askDelete, setAskDelete] = useState(false)
  const [msg, setMsg] = useState('')
  const idRef = useRef<string | null>(isNew ? null : routeId)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<NotePatch>({})

  useEffect(() => {
    if (draft) return
    if (isNew) setDraft({ title: '', kind: 'text', text: '', items: [], color: 'pearl', pinned: false })
    else if (existing) setDraft({ title: existing.title, kind: existing.kind, text: existing.text, items: existing.items, color: existing.color, pinned: existing.pinned })
  }, [existing, isNew, draft])

  const flush = async () => {
    clearTimeout(timer.current)
    const patch = pending.current
    pending.current = {}
    if (!Object.keys(patch).length || !draft) return
    const wasNew = !idRef.current
    const id = await saveNote(idRef.current, wasNew ? { ...draft, ...patch } : patch)
    if (id && wasNew) {
      idRef.current = id
      // 从桌面小组件新建的便签：自动显示在那个小组件上
      if (widget) await saveWidgetNote(widget, id)
      nav(`/notes/${id}`, { replace: true })
    }
    if (id) setStatus(`已自动保存 ${new Date().toTimeString().slice(0, 5)}`)
  }
  useEffect(() => () => void flush(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch: NotePatch) => {
    setDraft((d) => (d ? ({ ...d, ...patch } as Draft) : d))
    pending.current = { ...pending.current, ...patch }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 400)
  }

  if (!isNew && existing === null) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="便签" back="/notes" />
        <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">这张便签不存在了。</p>
      </div>
    )
  }
  if (!draft) return <div className="h-dvh" />
  const c = colorOf(draft.color)
  const deleted = !!existing?.deletedAt
  const onDesktop = !!idRef.current && !!layout?.pages.some((p) => p.some((it) => it.kind === 'widget' && it.widget === 'note' && it.noteId === idRef.current))
  const setItems = (items: NoteItem[]) => change({ items })

  const showOnDesktop = async () => {
    await flush()
    if (!idRef.current) return setMsg('先写点内容再显示到桌面')
    const w = await firstNoteWidget()
    if (!w) return setMsg('桌面上没有便签小组件。可以在「主题装扮 → 恢复默认桌面布局」后重新出现。')
    await saveWidgetNote(w, idRef.current)
    setMsg('已显示在桌面便签小组件上')
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title={idRef.current ? '便签' : '新便签'}
        back="/notes"
        subtitle={status || (isNew ? '写下内容后自动保存' : undefined)}
        right={idRef.current && !deleted ? <NavButton label="删除便签" icon="delete" onClick={() => setAskDelete(true)} /> : undefined}
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        {deleted && (
          <div className="mx-4 mt-2 card px-4 py-2.5 text-[13px] flex justify-between items-center">
            <span className="text-[var(--c-text-2)]">这张便签在最近删除中</span>
            <button className="press text-[var(--c-accent-strong)]" onClick={() => void restoreNote(routeId)}>恢复</button>
          </div>
        )}
        <div className="mx-4 mt-2 flex items-center justify-between">
          <div className="flex rounded-full bg-white/50 p-0.5 text-[12.5px]" role="radiogroup" aria-label="便签模式">
            {(['text', 'checklist'] as const).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={draft.kind === k}
                className={`press h-7 px-3 rounded-full ${draft.kind === k ? 'bg-white text-[var(--c-accent-strong)] shadow-sm' : 'text-[var(--c-text-3)]'}`}
                onClick={() => {
                  if (draft.kind === k) return
                  change(k === 'checklist' ? { kind: k, items: draft.items.length ? draft.items : toChecklist(draft.text, () => uid('it')) } : { kind: k, text: draft.text.trim() ? draft.text : toText(draft.items) })
                }}
              >
                {k === 'text' ? '文字' : '清单'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--c-text-2)]">
            <input type="checkbox" checked={draft.pinned} onChange={(e) => change({ pinned: e.target.checked })} /> 置顶
          </label>
        </div>

        <article className="mx-4 mt-3 rounded-[20px] px-4 pt-4 pb-5 note-card min-h-[300px]" style={{ background: c.bg, color: c.ink }}>
          <input value={draft.title} maxLength={NOTE_LIMITS.title} onChange={(e) => change({ title: e.target.value })} placeholder="标题（可不填）" className="w-full bg-transparent text-[17px] font-medium outline-none placeholder:opacity-40" style={{ color: c.ink }} />
          {draft.kind === 'text' ? (
            <textarea value={draft.text} maxLength={NOTE_LIMITS.text} onChange={(e) => change({ text: e.target.value })} placeholder="写点什么…" rows={10} className="mt-2 w-full resize-none bg-transparent text-[16px] leading-[26px] outline-none placeholder:opacity-40" style={{ color: c.ink }} />
          ) : (
            <div className="mt-2 space-y-1.5">
              {draft.items.map((it, i) => (
                <div key={it.id} className="flex items-center gap-2">
                  <input type="checkbox" aria-label={`完成：${it.text || '新的一项'}`} checked={it.done} onChange={(e) => setItems(draft.items.map((x) => (x.id === it.id ? { ...x, done: e.target.checked } : x)))} />
                  <input
                    value={it.text}
                    maxLength={NOTE_LIMITS.item}
                    autoFocus={!it.text && i === draft.items.length - 1}
                    onChange={(e) => setItems(draft.items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        if (draft.items.length < NOTE_LIMITS.items) setItems([...draft.items.slice(0, i + 1), { id: uid('it'), text: '', done: false }, ...draft.items.slice(i + 1)])
                      }
                    }}
                    placeholder="新的一项"
                    className={`flex-1 min-w-0 bg-transparent text-[16px] leading-[28px] outline-none placeholder:opacity-40 ${it.done ? 'line-through opacity-50' : ''}`}
                    style={{ color: c.ink }}
                  />
                  <button aria-label="删除这一项" className="press h-7 w-7 opacity-40" onClick={() => setItems(draft.items.filter((x) => x.id !== it.id))}>×</button>
                </div>
              ))}
              {draft.items.length < NOTE_LIMITS.items && (
                <button className="press mt-1 text-[13.5px] opacity-60" onClick={() => setItems([...draft.items, { id: uid('it'), text: '', done: false }])}>＋ 添加一项</button>
              )}
            </div>
          )}
        </article>

        <section className="mx-4 mt-3 card px-4 py-3">
          <div className="text-[12px] text-[var(--c-text-3)]">颜色</div>
          <div className="mt-2 flex gap-2.5" role="radiogroup" aria-label="颜色">
            {NOTE_COLORS.map((x) => (
              <button key={x.id} role="radio" aria-checked={draft.color === x.id} aria-label={x.label} onClick={() => change({ color: x.id })} className="press h-8 w-8 rounded-full" style={{ background: x.bg, boxShadow: draft.color === x.id ? '0 0 0 2px #fff, 0 0 0 3.5px #6f90b8' : 'inset 0 0 0 0.5px rgba(120,150,190,0.4)' }} />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[13px] text-[var(--c-text-2)]">{onDesktop ? '这张便签正显示在桌面上' : '显示在桌面便签小组件上'}</span>
            {!onDesktop && <button className="press h-8 px-3 rounded-full border border-[var(--c-line)] text-[12.5px] text-[var(--c-accent-strong)]" onClick={() => void showOnDesktop()}>显示在桌面</button>}
          </div>
          {msg && <p className="mt-1.5 text-[12px] text-[var(--c-accent-strong)]">{msg}</p>}
        </section>
      </div>
      {askDelete && (
        <ConfirmDialog
          title="删除这张便签？"
          message={onDesktop ? '会移到「最近删除」，可以恢复。桌面小组件会显示「已删除」。' : '会移到「最近删除」，可以恢复。'}
          confirmText="删除"
          danger
          onCancel={() => setAskDelete(false)}
          onConfirm={() => void flush().then(() => trashNote(idRef.current!)).then(() => nav('/notes', { replace: true }))}
        />
      )}
    </div>
  )
}
