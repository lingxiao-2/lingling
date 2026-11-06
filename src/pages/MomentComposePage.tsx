/**
 * 发动态：正文、最多 9 张配图（本机压缩，不上传）、可见范围（所有角色 / 部分角色 / 仅自己）。
 * 离开页面前未发布的正文保存为草稿（只在本机）。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { Icon } from '../theme/icons'
import { db } from '../db/db'
import type { Character, Moment } from '../db/schema'
import { createMoment } from '../db/momentRepo'
import { imageToMomentPhoto } from '../lib/util'
import { MOMENT_LIMITS } from '../services/moments'
import { ImageViewer } from './MomentsPage'

const DRAFT_KEY = 'lingling-moment-draft'
const chip = 'press h-8 px-3 rounded-full border border-[var(--c-line)] bg-white/45 text-[12.5px]'

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}
function writeDraft(t: string) {
  try {
    if (t) localStorage.setItem(DRAFT_KEY, t)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* 隐私模式等：草稿只是便利功能 */
  }
}

export default function MomentComposePage() {
  const nav = useNavigate()
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const [text, setText] = useState(readDraft)
  const [images, setImages] = useState<string[]>([])
  const [visibility, setVisibility] = useState<Moment['visibility']>('all')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [viewer, setViewer] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => writeDraft(text), [text])

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setErr('')
    const room = MOMENT_LIMITS.images - images.length
    const list = [...files].slice(0, room)
    if (files.length > room) setErr(`最多 ${MOMENT_LIMITS.images} 张，多出的 ${files.length - room} 张没有添加`)
    setBusy(true)
    const out: string[] = []
    for (const f of list) {
      try {
        out.push(await imageToMomentPhoto(f, MOMENT_LIMITS.imageSide, MOMENT_LIMITS.imageBytes))
      } catch (e) {
        setErr(`「${f.name}」没有添加：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setImages((x) => [...x, ...out].slice(0, MOMENT_LIMITS.images))
    setBusy(false)
  }

  const publish = async () => {
    setErr('')
    setBusy(true)
    try {
      await createMoment({ content: text, images, visibility, visibleTo: picked })
      writeDraft('')
      nav('/moments', { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const canPublish = !busy && (text.trim() || images.length) && (visibility !== 'some' || picked.length)

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title="发动态"
        back
        sideWidth={72}
        right={
          <button onClick={() => void publish()} disabled={!canPublish} className="press mr-1 h-8 px-3.5 rounded-full bg-[var(--c-accent)] text-white text-[13px] disabled:opacity-45">
            发表
          </button>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14 px-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={MOMENT_LIMITS.text}
          placeholder="这一刻的想法…"
          className="mt-3 w-full resize-none rounded-[var(--radius-card)] glass px-4 py-3 text-[16px] leading-relaxed outline-none"
        />
        <div className="mt-1 text-right text-[11px] text-[var(--c-text-3)]">{text.trim().length} / {MOMENT_LIMITS.text}</div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          {images.map((src, i) => (
            <div key={i} className="relative aspect-square">
              <button className="h-full w-full overflow-hidden rounded-[10px] press" onClick={() => setViewer(i)} aria-label={`查看第 ${i + 1} 张`}>
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
              <button aria-label="移除这张图片" onClick={() => setImages((x) => x.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-black/55 text-white text-[13px] leading-6">
                ×
              </button>
            </div>
          ))}
          {images.length < MOMENT_LIMITS.images && (
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="aspect-square rounded-[10px] border border-dashed border-[var(--c-line)] bg-white/35 flex flex-col items-center justify-center gap-1 text-[12px] text-[var(--c-text-3)] press disabled:opacity-45">
              <Icon name="image" size="lg" />
              {busy ? '处理中…' : '添加图片'}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
        <p className="mt-1.5 text-[11px] text-[var(--c-text-3)]">图片会在本机压缩后保存，不会上传到任何服务器。</p>

        <section className="mt-4 glass rounded-[var(--radius-card)] px-4 py-3">
          <div className="serif-zh text-[15px] text-[var(--c-brand)]">谁可以看</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {([['all', '所有角色'], ['some', '部分角色'], ['private', '仅自己']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setVisibility(v)} className={`${chip} ${visibility === v ? 'border-[var(--c-accent)] text-[var(--c-accent-strong)]' : ''}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-[var(--c-text-3)]">
            {visibility === 'private' ? '只有你自己能看到，角色看不到这条动态。' : visibility === 'some' ? '只有选中的角色能看到这条动态。' : '你的所有角色都能看到这条动态。'}
          </p>
          {visibility === 'some' && (
            <div className="mt-2 space-y-1">
              {chars.length === 0 && <div className="text-[12px] text-[var(--c-text-3)]">还没有角色。</div>}
              {chars.map((c) => (
                <label key={c.id} className="flex items-center gap-2.5 py-1 text-[14px]">
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} />
                  <Avatar name={c.name} src={c.avatar} size={28} />
                  {c.name}
                </label>
              ))}
            </div>
          )}
        </section>
        {err && <p className="mt-3 text-[12.5px] text-[var(--c-danger)]">{err}</p>}
      </div>
      {viewer !== null && <ImageViewer images={images} index={viewer} onClose={() => setViewer(null)} />}
    </div>
  )
}
