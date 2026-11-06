/**
 * 全屏查看照片：双指缩放、拖动查看、双击放大 / 还原；未放大时左右滑动切换上一张 / 下一张。
 * 信息面板：名称与备注（可编辑）、导入日期、尺寸、大小、原始格式、所在相册；移动、删除、恢复。
 */
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as RPE } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ActionSheet } from '../../components/Sheet'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import type { Album } from '../../db/schema'
import { getPhotoBlob, movePhotos, restorePhotos, trashPhotos, updatePhoto } from '../../db/photoRepo'
import { formatBytes, PHOTO_LIMITS } from '../../life/photos'
import { usePhotoList } from './AlbumGridPage'

const MAX_SCALE = 5

const zhTime = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function ZoomImage({ src, onSwipe }: { src: string; onSwipe: (dir: -1 | 1) => void }) {
  const [t, setTState] = useState({ s: 1, x: 0, y: 0 })
  // 始终读到最新的缩放状态（事件处理里不能用渲染时的旧值，否则双击放大后会被立刻还原）
  const cur = useRef(t)
  const setT = (v: { s: number; x: number; y: number } | ((c: { s: number; x: number; y: number }) => { s: number; x: number; y: number })) => {
    const next = typeof v === 'function' ? v(cur.current) : v
    cur.current = next
    setTState(next)
  }
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const start = useRef<{ s: number; x: number; y: number; d: number; cx: number; cy: number; px: number; py: number } | null>(null)
  const lastTap = useRef(0)

  useEffect(() => setT({ s: 1, x: 0, y: 0 }), [src])

  const snapshot = () => {
    const p = [...pts.current.values()]
    const cx = p.reduce((n, a) => n + a.x, 0) / p.length
    const cy = p.reduce((n, a) => n + a.y, 0) / p.length
    const d = p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0
    start.current = { s: cur.current.s, x: cur.current.x, y: cur.current.y, d, cx, cy, px: cx, py: cy }
  }
  const down = (e: RPE) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    snapshot()
  }
  const move = (e: RPE) => {
    if (!pts.current.has(e.pointerId) || !start.current) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = [...pts.current.values()]
    const st = start.current
    const cx = p.reduce((n, a) => n + a.x, 0) / p.length
    const cy = p.reduce((n, a) => n + a.y, 0) / p.length
    if (p.length > 1 && st.d > 0) {
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
      const s = Math.min(MAX_SCALE, Math.max(1, (st.s * d) / st.d))
      setT({ s, x: st.x + (cx - st.cx), y: st.y + (cy - st.cy) })
    } else if (st.s > 1) {
      setT({ s: st.s, x: st.x + (cx - st.cx), y: st.y + (cy - st.cy) })
    }
    st.px = cx
    st.py = cy
  }
  const up = (e: RPE) => {
    const st = start.current
    const had = pts.current.size
    pts.current.delete(e.pointerId)
    if (had === 1 && st) {
      const dx = st.px - st.cx
      const dy = st.py - st.cy
      if (cur.current.s <= 1.01 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1)
      else if (Math.hypot(dx, dy) < 8) {
        const now = Date.now()
        if (now - lastTap.current < 300) {
          setT((c) => (c.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }))
          lastTap.current = 0
        } else lastTap.current = now
      }
    }
    if (cur.current.s < 1.02 && cur.current.s !== 1) setT({ s: 1, x: 0, y: 0 })
    if (pts.current.size) snapshot()
    else start.current = null
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden touch-none select-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <img src={src} alt="" draggable={false} className="max-h-full max-w-full object-contain will-change-transform" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }} />
    </div>
  )
}

export default function PhotoViewerPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const from = params.get('from') ?? 'all'
  // 从日记等其他应用打开时，关闭后回到原来的页面
  const ret = params.get('return') === '1'
  const nav = useNavigate()
  const photo = useLiveQuery(() => db.photos.get(id).then((p) => p ?? null), [id])
  const list = usePhotoList(from)
  const albums = useLiveQuery(() => db.albums.orderBy('createdAt').toArray(), [], [] as Album[])
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const [info, setInfo] = useState(false)
  const [moving, setMoving] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let u = ''
    let alive = true
    setFailed(false)
    void getPhotoBlob(id).then((b) => {
      if (!alive) return
      if (!b) return setFailed(true)
      u = URL.createObjectURL(b)
      setUrl(u)
    })
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [id])
  useEffect(() => {
    setName(null)
    setNote(null)
  }, [id])

  const idx = list?.findIndex((p) => p.id === id) ?? -1
  const go = (dir: -1 | 1) => {
    const next = list?.[idx + dir]
    if (next) nav(`/album/photo/${next.id}?from=${from}${ret ? '&return=1' : ''}`, { replace: true })
  }
  const close = () => (ret ? nav(-1) : nav(`/album/${from}`, { replace: true }))

  if (photo === null) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-black text-white/80 text-[14px]">
        这张照片已经不存在了
        <button className="mt-4 press text-[13px] text-white underline" onClick={close}>返回</button>
      </div>
    )
  }
  const date = photo ? new Date(photo.createdAt) : null
  const albumName = albums.find((a) => a.id === photo?.albumId)?.name

  return (
    <div className="fixed inset-0 z-40 bg-[#0d1420] text-white">
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center text-white/70 text-[13px]">原图读取失败</div>
      ) : url ? (
        <ZoomImage src={url} onSwipe={go} />
      ) : photo ? (
        <img src={photo.thumb} alt="" className="absolute inset-0 m-auto max-h-full max-w-full object-contain blur-[2px]" />
      ) : null}

      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 bg-gradient-to-b from-black/45 to-transparent" style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingBottom: 18 }}>
        <button aria-label="返回" className="press h-10 w-10 flex items-center justify-center" onClick={close}>
          <Icon name="back" size="lg" />
        </button>
        <div className="text-center min-w-0">
          <div className="truncate text-[14px]">{photo?.name}</div>
          {date && <div className="text-[11px] text-white/70">{date.getFullYear()}年{date.getMonth() + 1}月{date.getDate()}日 导入</div>}
        </div>
        <span className="text-[12px] text-white/70 w-10 text-right">{idx >= 0 && list ? `${idx + 1}/${list.length}` : ''}</span>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex justify-around bg-gradient-to-t from-black/50 to-transparent pt-8 text-[13px]" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
        <button className="press px-3 py-2" onClick={() => setInfo(true)}>信息</button>
        {photo?.deletedAt ? (
          <button className="press px-3 py-2" onClick={() => void restorePhotos([id])}>恢复</button>
        ) : (
          <>
            <button className="press px-3 py-2" onClick={() => setMoving(true)}>移动到</button>
            <button className="press px-3 py-2 text-[#ffb4b4]" onClick={() => void trashPhotos([id]).then(() => (list && list.length > 1 ? go(idx < list.length - 1 ? 1 : -1) : close()))}>删除</button>
          </>
        )}
      </div>

      {info && photo && (
        <div className="absolute inset-0 z-10 flex items-end" onClick={() => setInfo(false)}>
          <div className="w-full rounded-t-[24px] px-5 pt-4 text-[var(--c-text)] bg-[rgba(246,249,253,0.97)] shadow-[0_-10px_30px_rgba(0,0,0,0.25)]" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="serif-zh text-[16px] text-[var(--c-brand)]">照片信息</div>
            <label className="mt-3 block text-[12px] text-[var(--c-text-3)]">名称</label>
            <input
              value={name ?? photo.name}
              maxLength={PHOTO_LIMITS.name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name !== null && void updatePhoto(id, { name })}
              className="mt-1 w-full rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none"
            />
            <label className="mt-3 block text-[12px] text-[var(--c-text-3)]">备注</label>
            <textarea
              value={note ?? photo.note}
              maxLength={PHOTO_LIMITS.note}
              rows={3}
              placeholder="写点什么，方便以后搜索"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== null && void updatePhoto(id, { note })}
              className="mt-1 w-full resize-none rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none"
            />
            <div className="mt-3 grid grid-cols-2 gap-y-1 text-[12.5px] text-[var(--c-text-2)]">
              <span>导入时间</span><span>{zhTime(photo.createdAt)}</span>
              <span>尺寸</span><span>{photo.width} × {photo.height}</span>
              <span>保存大小</span><span>{formatBytes(photo.bytes)}（{photo.mime.replace('image/', '').toUpperCase()}）</span>
              <span>原始文件</span><span>{formatBytes(photo.originalBytes)} {photo.originalType}</span>
              <span>相册</span><span>{albumName ?? '只在全部照片中'}</span>
              {photo.deletedAt && (<><span>删除时间</span><span>{zhTime(photo.deletedAt)}</span></>)}
            </div>
            <button className="mt-4 press w-full h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px]" onClick={() => {
              if (name !== null) void updatePhoto(id, { name })
              if (note !== null) void updatePhoto(id, { note })
              setInfo(false)
            }}>完成</button>
          </div>
        </div>
      )}
      {moving && (
        <ActionSheet
          title="移动到"
          actions={[
            { label: '只放在「全部照片」', onClick: () => void movePhotos([id], undefined).then(() => setMoving(false)) },
            ...albums.map((a) => ({ label: a.name, onClick: () => void movePhotos([id], a.id).then(() => setMoving(false)) })),
          ]}
          onClose={() => setMoving(false)}
        />
      )}
    </div>
  )
}
