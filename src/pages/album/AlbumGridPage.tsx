/**
 * 照片网格：全部照片 / 某个相册 / 最近删除。搜索名称与备注；选择多张后移动、删除、恢复、彻底删除；相册重命名与删除。
 */
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { ActionSheet, ConfirmDialog } from '../../components/Sheet'
import { db } from '../../db/db'
import type { Album, Photo } from '../../db/schema'
import { deleteAlbum, movePhotos, purgePhotos, renameAlbum, restorePhotos, trashPhotos } from '../../db/photoRepo'
import { searchPhotos } from '../../life/photos'
import { ImportReport, importFiles, type ImportResult } from './AlbumHomePage'

export function usePhotoList(albumId: string): Photo[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.photos.orderBy('createdAt').reverse().toArray()
    if (albumId === 'trash') return all.filter((p) => p.deletedAt)
    const live = all.filter((p) => !p.deletedAt)
    return albumId === 'all' ? live : live.filter((p) => p.albumId === albumId)
  }, [albumId])
}

export default function AlbumGridPage() {
  const { albumId = 'all' } = useParams()
  const nav = useNavigate()
  const album = useLiveQuery(() => (albumId === 'all' || albumId === 'trash' ? null : db.albums.get(albumId).then((a) => a ?? null)), [albumId])
  const albums = useLiveQuery(() => db.albums.orderBy('createdAt').toArray(), [], [] as Album[])
  const list = usePhotoList(albumId)
  const [q, setQ] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const [sheet, setSheet] = useState<'move' | 'menu' | null>(null)
  const [confirm, setConfirm] = useState<'purge' | 'deleteAlbum' | 'rename' | null>(null)
  const [newName, setNewName] = useState('')
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const isTrash = albumId === 'trash'
  const title = isTrash ? '最近删除' : albumId === 'all' ? '全部照片' : album?.name ?? '相册'
  const shown = searchPhotos(list ?? [], q)
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const done = () => {
    setSelecting(false)
    setSel([])
  }

  if (album === null && albumId !== 'all' && albumId !== 'trash') {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="相册" back="/album" />
        <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">这个相册已经删除了。</p>
      </div>
    )
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title={title}
        back="/album"
        sideWidth={84}
        right={
          <>
            {!isTrash && !selecting && <NavButton label="导入照片" icon="image" onClick={() => fileRef.current?.click()} />}
            {album && !selecting && <NavButton label="相册设置" icon="more" onClick={() => setSheet('menu')} />}
          </>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : []
          e.target.value = ''
          if (!files.length) return
          void importFiles(files, album?.id, (d, t) => setProgress([d, t])).then((r) => { setProgress(null); setResult(r) })
        }}
      />
      <div className="shrink-0 px-4 pt-1 pb-2 flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索名称或备注" className="flex-1 min-w-0 h-9 rounded-full bg-white/55 border border-[var(--c-line)] px-4 text-[15px] outline-none focus:border-[var(--c-accent)]" />
        {(list?.length ?? 0) > 0 && (
          <button className="press h-9 px-3 rounded-full text-[13px] text-[var(--c-accent-strong)]" onClick={() => (selecting ? done() : setSelecting(true))}>
            {selecting ? '取消' : '选择'}
          </button>
        )}
      </div>
      {progress && <div className="mx-4 mb-2 card px-4 py-2 text-[12.5px] text-[var(--c-text-2)]">正在导入 {Math.min(progress[0] + 1, progress[1])} / {progress[1]}…</div>}
      {result && <ImportReport result={result} onClose={() => setResult(null)} />}
      {isTrash && <p className="px-5 pb-2 text-[11.5px] text-[var(--c-text-3)]">这里的照片可以恢复；彻底删除后无法找回。</p>}

      <div className="flex-1 min-h-0 overflow-y-auto pb-28">
        {list && shown.length === 0 && (
          <p className="mt-12 text-center text-[13px] text-[var(--c-text-3)]">{q ? '没有找到匹配的照片' : isTrash ? '没有最近删除的照片' : '还没有照片，点右上角导入'}</p>
        )}
        <div className="grid grid-cols-3 gap-[3px] px-[3px]">
          {shown.map((p) => {
            const on = sel.includes(p.id)
            return (
              <button
                key={p.id}
                aria-label={p.name}
                className="relative aspect-square overflow-hidden bg-white/30"
                onClick={() => (selecting ? toggle(p.id) : nav(`/album/photo/${p.id}?from=${albumId}`))}
              >
                <img src={p.thumb} alt="" loading="lazy" decoding="async" className={`h-full w-full object-cover ${on ? 'opacity-70' : ''}`} />
                {selecting && (
                  <span className={`absolute right-1.5 bottom-1.5 h-[22px] w-[22px] rounded-full border-[1.5px] border-white flex items-center justify-center text-[12px] text-white ${on ? 'bg-[var(--c-accent)]' : 'bg-black/15'}`}>
                    {on ? '✓' : ''}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4" style={{ paddingBottom: 'calc(var(--safe-bottom) + 10px)' }}>
          <div className="glass-3 rounded-[20px] h-14 flex items-center justify-between px-4 text-[14px] shadow-[var(--shadow-soft)]">
            <span className="text-[var(--c-text-2)]">已选 {sel.length} 张</span>
            <span className="flex gap-4">
              {isTrash ? (
                <>
                  <button disabled={!sel.length} className="press text-[var(--c-accent-strong)] disabled:opacity-40" onClick={() => void restorePhotos(sel).then(done)}>恢复</button>
                  <button disabled={!sel.length} className="press text-[var(--c-danger)] disabled:opacity-40" onClick={() => setConfirm('purge')}>彻底删除</button>
                </>
              ) : (
                <>
                  <button disabled={!sel.length} className="press text-[var(--c-accent-strong)] disabled:opacity-40" onClick={() => setSheet('move')}>移动到</button>
                  <button disabled={!sel.length} className="press text-[var(--c-danger)] disabled:opacity-40" onClick={() => void trashPhotos(sel).then(done)}>删除</button>
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {sheet === 'move' && (
        <ActionSheet
          title="移动到"
          actions={[
            { label: '只放在「全部照片」', onClick: () => void movePhotos(sel, undefined).then(() => { setSheet(null); done() }) },
            ...albums.map((a) => ({ label: a.name, onClick: () => void movePhotos(sel, a.id).then(() => { setSheet(null); done() }) })),
          ]}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'menu' && album && (
        <ActionSheet
          title={album.name}
          actions={[
            { label: '重命名', onClick: () => { setSheet(null); setNewName(album.name); setConfirm('rename') } },
            { label: '删除相册（照片保留在全部照片中）', danger: true, onClick: () => { setSheet(null); setConfirm('deleteAlbum') } },
          ]}
          onClose={() => setSheet(null)}
        />
      )}
      {confirm === 'purge' && (
        <ConfirmDialog
          title={`彻底删除 ${sel.length} 张照片？`}
          message="彻底删除后无法恢复。"
          confirmText="彻底删除"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => void purgePhotos(sel).then(() => { setConfirm(null); done() })}
        />
      )}
      {confirm === 'deleteAlbum' && album && (
        <ConfirmDialog
          title={`删除相册「${album.name}」？`}
          message="相册里的照片不会被删除，仍然在「全部照片」中。"
          confirmText="删除相册"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => void deleteAlbum(album.id).then(() => nav('/album', { replace: true }))}
        />
      )}
      {confirm === 'rename' && album && (
        <ConfirmDialog
          title="重命名相册"
          message={<input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={30} className="mt-1 w-full rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none" />}
          confirmText="保存"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void renameAlbum(album.id, newName).then(() => setConfirm(null), () => undefined)}
        />
      )}
    </div>
  )
}
