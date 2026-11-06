/** 从相册里选择照片（只选择已在本机相册中的照片，不在这里导入） */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Photo } from '../db/schema'

export default function PhotoPicker({ selected, onDone, onClose }: { selected: string[]; onDone: (ids: string[]) => void; onClose: () => void }) {
  const photos = useLiveQuery(() => db.photos.orderBy('createdAt').reverse().toArray(), [], [] as Photo[]).filter((p) => !p.deletedAt)
  const [sel, setSel] = useState(selected)
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 sheet-overlay sheet-fade" />
      <div className="relative w-full max-h-[78dvh] flex flex-col rounded-t-[24px] bg-[rgba(246,249,253,0.98)]" style={{ paddingBottom: 'var(--safe-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <button className="press text-[14px] text-[var(--c-text-2)]" onClick={onClose}>取消</button>
          <span className="serif-zh text-[15px] text-[var(--c-brand)]">选择照片（{sel.length}）</span>
          <button className="press text-[14px] text-[var(--c-accent-strong)]" onClick={() => onDone(sel)}>完成</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-[3px] pb-3">
          {photos.length === 0 && <p className="py-10 text-center text-[13px] text-[var(--c-text-3)]">相册里还没有照片，可以先到「相册」导入。</p>}
          <div className="grid grid-cols-4 gap-[3px]">
            {photos.map((p) => {
              const on = sel.includes(p.id)
              return (
                <button key={p.id} aria-label={p.name} className="relative aspect-square overflow-hidden" onClick={() => setSel((s) => (on ? s.filter((x) => x !== p.id) : [...s, p.id]))}>
                  <img src={p.thumb} alt="" loading="lazy" className={`h-full w-full object-cover ${on ? 'opacity-70' : ''}`} />
                  <span className={`absolute right-1 bottom-1 h-5 w-5 rounded-full border-[1.5px] border-white text-[11px] leading-[17px] text-white text-center ${on ? 'bg-[var(--c-accent)]' : 'bg-black/15'}`}>{on ? '✓' : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 关联照片的缩略图；照片被删除后显示「已删除」，不会报错 */
export function LinkedPhotos({ ids, onOpen, onRemove, size = 64 }: { ids: string[]; onOpen?: (id: string) => void; onRemove?: (id: string) => void; size?: number }) {
  const photos = useLiveQuery(() => db.photos.bulkGet(ids), [ids.join(',')], [] as (Photo | undefined)[])
  if (!ids.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id, i) => {
        const p = photos[i]
        const gone = !p || p.deletedAt
        return (
          <span key={id} className="relative" style={{ width: size, height: size }}>
            {gone ? (
              <span className="h-full w-full rounded-[10px] border border-dashed border-[var(--c-line)] flex items-center justify-center text-[10.5px] text-[var(--c-text-3)] text-center leading-tight">照片<br />已删除</span>
            ) : (
              <button className="h-full w-full rounded-[10px] overflow-hidden press shadow-[0_2px_6px_rgba(70,100,145,0.18)]" onClick={() => onOpen?.(id)} aria-label={p.name}>
                <img src={p.thumb} alt="" className="h-full w-full object-cover" />
              </button>
            )}
            {onRemove && (
              <button aria-label="移除这张照片" className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-black/50 text-white text-[12px] leading-5" onClick={() => onRemove(id)}>×</button>
            )}
          </span>
        )
      })}
    </div>
  )
}
