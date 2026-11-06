/**
 * 相册首页：全部照片、我的相册、最近删除；导入照片（可多选）；存储空间提醒。
 * 照片只保存在本机，不会自动上传。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { ConfirmDialog } from '../../components/Sheet'
import { db } from '../../db/db'
import type { Album, Photo } from '../../db/schema'
import { addPhoto, createAlbum } from '../../db/photoRepo'
import { formatBytes, PHOTO_LIMITS, preparePhoto, storageWarning } from '../../life/photos'
import { storageEstimate } from '../../services/stickerImport'

export interface ImportResult {
  ok: number
  failed: { name: string; reason: string }[]
}

/** 逐张导入（不并发，避免 iPhone 内存紧张）；失败的如实记录原因 */
export async function importFiles(files: File[], albumId: string | undefined, onProgress: (done: number, total: number) => void): Promise<ImportResult> {
  const list = files.slice(0, PHOTO_LIMITS.batch)
  const r: ImportResult = { ok: 0, failed: [] }
  if (files.length > list.length) r.failed.push({ name: `另外 ${files.length - list.length} 张`, reason: `一次最多导入 ${PHOTO_LIMITS.batch} 张，请分批导入` })
  for (const [i, f] of list.entries()) {
    onProgress(i, list.length)
    try {
      await addPhoto(await preparePhoto(f), albumId)
      r.ok++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      r.failed.push({ name: f.name, reason: /quota|QuotaExceeded/i.test(msg) ? '本机存储空间不足' : msg })
    }
  }
  onProgress(list.length, list.length)
  return r
}

export function ImportReport({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  return (
    <div className="mx-4 mt-3 card px-4 py-3 text-[13px]">
      <div className="flex justify-between items-center">
        <span className="text-[var(--c-text)]">导入完成：成功 {result.ok} 张{result.failed.length ? `，未导入 ${result.failed.length} 项` : ''}</span>
        <button className="press text-[12px] text-[var(--c-accent-strong)]" onClick={onClose}>知道了</button>
      </div>
      {result.failed.map((f, i) => (
        <div key={i} className="mt-1 text-[12px] text-[var(--c-danger)]">· {f.name}：{f.reason}</div>
      ))}
    </div>
  )
}

function Cover({ photo, label, count, onClick, faded }: { photo?: Photo; label: string; count: number; onClick: () => void; faded?: boolean }) {
  return (
    <button onClick={onClick} className="press text-left">
      <span className={`block aspect-square rounded-[16px] overflow-hidden album-cover ${faded ? 'opacity-70' : ''}`}>
        {photo ? <img src={photo.thumb} alt="" className="h-full w-full object-cover" /> : <span className="h-full w-full flex items-center justify-center text-[11px] text-[var(--c-text-3)]">空</span>}
      </span>
      <span className="mt-1.5 block truncate text-[13.5px] text-[var(--c-text)]">{label}</span>
      <span className="block text-[11.5px] text-[var(--c-text-3)]">{count} 张</span>
    </button>
  )
}

export default function AlbumHomePage() {
  const nav = useNavigate()
  const photos = useLiveQuery(() => db.photos.orderBy('createdAt').reverse().toArray(), [], [] as Photo[])
  const albums = useLiveQuery(() => db.albums.orderBy('createdAt').toArray(), [], [] as Album[])
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void storageEstimate().then(setStorage)
  }, [photos.length])

  const live = photos.filter((p) => !p.deletedAt)
  const trash = photos.filter((p) => p.deletedAt)
  const bytes = live.reduce((n, p) => n + p.bytes, 0) + trash.reduce((n, p) => n + p.bytes, 0)
  const warning = storageWarning(storage?.usage ?? null, storage?.quota ?? null, bytes)

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setResult(null)
    const r = await importFiles([...files], undefined, (d, t) => setProgress([d, t]))
    setProgress(null)
    setResult(r)
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title="相册"
        back="/"
        sideWidth={84}
        right={
          <>
            <NavButton label="新建相册" icon="add" onClick={() => setCreating(true)} />
            <NavButton label="导入照片" icon="image" onClick={() => fileRef.current?.click()} />
          </>
        }
      />
      <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = '' }} />
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        {progress && (
          <div className="mx-4 mt-3 card px-4 py-3 text-[13px] text-[var(--c-text-2)]">
            正在导入 {Math.min(progress[0] + 1, progress[1])} / {progress[1]}…（在本机处理，不会上传）
          </div>
        )}
        {result && <ImportReport result={result} onClose={() => setResult(null)} />}

        <section className="mx-4 mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
          <Cover photo={live[0]} label="全部照片" count={live.length} onClick={() => nav('/album/all')} />
          {albums.map((a) => {
            const inAlbum = live.filter((p) => p.albumId === a.id)
            return <Cover key={a.id} photo={inAlbum[0]} label={a.name} count={inAlbum.length} onClick={() => nav(`/album/${a.id}`)} />
          })}
          <Cover photo={trash[0]} label="最近删除" count={trash.length} onClick={() => nav('/album/trash')} faded />
        </section>

        {live.length === 0 && !progress && (
          <div className="mx-6 mt-6 text-center">
            <div className="desk-serif italic text-[18px] text-[var(--c-brand)]">Your winter album</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--c-text-3)]">点右上角的图片按钮，从 iPhone 相册或「文件」导入照片，可以一次选多张。</p>
          </div>
        )}

        <section className="mx-4 mt-6 card px-4 py-3 text-[12px] leading-relaxed text-[var(--c-text-3)]">
          <div className="text-[13px] text-[var(--c-text-2)]">
            照片 {live.length} 张 · 约 {formatBytes(bytes)}
            {storage && <span>（聆聆已用 {formatBytes(storage.usage)} / 浏览器允许约 {formatBytes(storage.quota)}）</span>}
          </div>
          {warning && <div className="mt-1 text-[var(--c-danger)]">{warning}</div>}
          <div className="mt-1">照片只保存在这台设备上，不会自动上传。导入时会压缩到最长边 2048 px。</div>
          <div className="mt-0.5">注意：当前版本的「备份与恢复」暂不包含照片，下一个版本会加入。</div>
        </section>
      </div>

      {creating && (
        <ConfirmDialog
          title="新建相册"
          message={<input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="相册名称" className="mt-1 w-full rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none" />}
          confirmText="创建"
          onCancel={() => { setCreating(false); setName('') }}
          onConfirm={() => void createAlbum(name).then((a) => { setCreating(false); setName(''); nav(`/album/${a.id}`) }, () => undefined)}
        />
      )}
    </div>
  )
}
