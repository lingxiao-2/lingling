/** 歌单：播放、调整顺序、移出歌单、重命名、删除歌单 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { ActionSheet, ConfirmDialog } from '../../components/Sheet'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import type { Track } from '../../db/schema'
import { addToPlaylist, deletePlaylist, formatDuration, moveInPlaylist, removeFromPlaylist, renamePlaylist } from '../../db/musicRepo'
import { playQueue, usePlayer } from '../../music/player'
import MiniPlayer, { Cover } from './MiniPlayer'

export default function PlaylistPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const list = useLiveQuery(() => db.playlists.get(id).then((x) => x ?? null), [id])
  const all = useLiveQuery(() => db.tracks.orderBy('createdAt').reverse().toArray(), [], [] as Track[])
  const p = usePlayer()
  const [menu, setMenu] = useState(false)
  const [rename, setRename] = useState<string | null>(null)
  const [del, setDel] = useState(false)
  const [adding, setAdding] = useState(false)
  if (list === null) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="歌单" back="/music?tab=lists" />
        <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">这个歌单已经删除了。</p>
      </div>
    )
  }
  const byId = new Map(all.map((t) => [t.id, t]))
  const tracks = (list?.trackIds ?? []).map((x) => byId.get(x)).filter((t): t is Track => !!t)
  const notIn = all.filter((t) => !list?.trackIds.includes(t.id))
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={list?.name ?? '歌单'} back="/music?tab=lists" right={<NavButton label="歌单设置" icon="more" onClick={() => setMenu(true)} />} />
      <div className="px-4 pb-2 flex items-center gap-2">
        <button disabled={!tracks.length} className="press h-8 px-4 rounded-full bg-[var(--c-accent)] text-white text-[12.5px] flex items-center gap-1 disabled:opacity-40" onClick={() => void playQueue(tracks.map((t) => t.id), 0)}><Icon name="play" size="xs" />播放</button>
        <button className="press h-8 px-4 rounded-full bg-white/60 text-[12.5px] text-[var(--c-accent-strong)]" onClick={() => setAdding(true)}>添加歌曲</button>
        <span className="text-[11.5px] text-[var(--c-text-3)]">{tracks.length} 首</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-28">
        {tracks.length === 0 && <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">歌单是空的，点「添加歌曲」。</p>}
        {tracks.map((t, i) => (
          <div key={t.id} className="track-row flex items-center gap-2 px-4 py-2">
            <button className="press flex flex-1 min-w-0 items-center gap-3 text-left" onClick={() => void playQueue(tracks.map((x) => x.id), i)} aria-label={`播放 ${t.title}`}>
              <Cover src={t.cover} size={40} />
              <span className="min-w-0"><span className={`block truncate text-[14px] ${p.track?.id === t.id ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-text)]'}`}>{t.title}</span><span className="block truncate text-[11.5px] text-[var(--c-text-3)]">{t.artist || '未知歌手'} · {formatDuration(t.duration)}</span></span>
            </button>
            <button aria-label={`上移 ${t.title}`} disabled={i === 0} className="press h-8 w-7 flex items-center justify-center text-[var(--c-text-3)] disabled:opacity-30" onClick={() => void moveInPlaylist(id, i, i - 1)}><Icon name="collapse" size="xs" /></button>
            <button aria-label={`下移 ${t.title}`} disabled={i === tracks.length - 1} className="press h-8 w-7 flex items-center justify-center text-[var(--c-text-3)] disabled:opacity-30" onClick={() => void moveInPlaylist(id, i, i + 1)}><Icon name="expand" size="xs" /></button>
            <button aria-label={`移出 ${t.title}`} className="press h-8 px-1 text-[12px] text-[var(--c-text-3)]" onClick={() => void removeFromPlaylist(id, t.id)}>移出</button>
          </div>
        ))}
      </div>
      {adding && (
        <ActionSheet
          title={notIn.length ? '添加到歌单' : '所有歌曲都已经在这个歌单里'}
          actions={notIn.slice(0, 40).map((t) => ({ label: `${t.title}${t.artist ? ` · ${t.artist}` : ''}`, onClick: () => void addToPlaylist(id, [t.id]) }))}
          onClose={() => setAdding(false)}
        />
      )}
      {menu && list && (
        <ActionSheet title={list.name} actions={[{ label: '重命名', onClick: () => { setMenu(false); setRename(list.name) } }, { label: '删除歌单（歌曲保留）', danger: true, onClick: () => { setMenu(false); setDel(true) } }]} onClose={() => setMenu(false)} />
      )}
      {rename !== null && (
        <ConfirmDialog title="重命名歌单" message={<input autoFocus aria-label="歌单名称" value={rename} maxLength={40} onChange={(e) => setRename(e.target.value)} className="mt-1 w-full rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none" />} confirmText="保存" onCancel={() => setRename(null)} onConfirm={() => void renamePlaylist(id, rename).then(() => setRename(null), () => undefined)} />
      )}
      {del && list && <ConfirmDialog title={`删除歌单「${list.name}」？`} message="歌单里的歌曲不会被删除。" confirmText="删除歌单" danger onCancel={() => setDel(false)} onConfirm={() => void deletePlaylist(id).then(() => nav('/music?tab=lists', { replace: true }))} />}
      <MiniPlayer />
    </div>
  )
}
