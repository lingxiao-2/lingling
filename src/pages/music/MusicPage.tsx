/**
 * 音乐：全部歌曲 / 收藏 / 歌单。只播放你自己从「文件」导入的音频，全部保存在本机。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../../components/NavBar'
import { ActionSheet, ConfirmDialog } from '../../components/Sheet'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import type { Playlist, Track } from '../../db/schema'
import { addToPlaylist, createPlaylist, deleteTracks, formatDuration, toggleFavorite } from '../../db/musicRepo'
import { importAudioFiles, type MusicImportResult } from '../../music/importAudio'
import { onTracksDeleted, playQueue, usePlayer } from '../../music/player'
import MiniPlayer, { Cover } from './MiniPlayer'

type Tab = 'all' | 'fav' | 'lists'

export function TrackRow({ t, active, playing, onPlay, onMore }: { t: Track; active: boolean; playing: boolean; onPlay: () => void; onMore: () => void }) {
  return (
    <div className={`track-row flex items-center gap-3 px-4 py-2 ${active ? 'bg-white/40' : ''}`}>
      <button className="press flex flex-1 min-w-0 items-center gap-3 text-left" onClick={onPlay} aria-label={`播放 ${t.title}`}>
        <Cover src={t.cover} size={42} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14.5px] ${active ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-text)]'}`}>{active && playing ? '♪ ' : ''}{t.title}</span>
          <span className="block truncate text-[11.5px] text-[var(--c-text-3)]">{t.artist || '未知歌手'}{t.album ? ` · ${t.album}` : ''}</span>
        </span>
        <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--c-text-3)]">{formatDuration(t.duration)}</span>
      </button>
      {t.favorite && <span className="text-[var(--c-accent)]" aria-label="已收藏"><Icon name="star" size="xs" stroke="thin" /></span>}
      <button aria-label={`更多：${t.title}`} className="press h-9 w-8 flex items-center justify-center text-[var(--c-text-3)]" onClick={onMore}><Icon name="more" size="sm" /></button>
    </div>
  )
}

/** 曲目的更多操作：收藏、加入歌单、删除 */
export function useTrackMenu() {
  const [menu, setMenu] = useState<Track | null>(null)
  const [picking, setPicking] = useState<Track | null>(null)
  const [deleting, setDeleting] = useState<Track | null>(null)
  const lists = useLiveQuery(() => db.playlists.orderBy('createdAt').toArray(), [], [] as Playlist[])
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 1800)
    return () => clearTimeout(t)
  }, [toast])
  const ui = (
    <>
      {menu && (
        <ActionSheet
          title={menu.title}
          actions={[
            { label: menu.favorite ? '取消收藏' : '收藏', onClick: () => { void toggleFavorite(menu.id); setMenu(null) } },
            { label: '加入歌单', onClick: () => { setPicking(menu); setMenu(null) } },
            { label: '删除这首歌', danger: true, onClick: () => { setDeleting(menu); setMenu(null) } },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {picking && (
        <ActionSheet
          title="加入歌单"
          actions={[
            ...lists.map((l) => ({ label: l.name, onClick: () => void addToPlaylist(l.id, [picking.id]).then((n) => { setToast(n ? `已加入「${l.name}」` : '已经在这个歌单里了'); setPicking(null) }) })),
            { label: '＋ 新建歌单', onClick: () => void createPlaylist(`新歌单 ${lists.length + 1}`).then((l) => addToPlaylist(l.id, [picking.id]).then(() => { setToast(`已加入「${l.name}」`); setPicking(null) })) },
          ]}
          onClose={() => setPicking(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`删除「${deleting.title}」？`}
          message="会从本机删除这首歌的音频文件，并从所有歌单中移除。iPhone「文件」中的原文件不受影响。"
          confirmText="删除"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => void deleteTracks([deleting.id]).then(() => onTracksDeleted([deleting.id])).then(() => setDeleting(null))}
        />
      )}
      {toast && <p role="status" className="fixed left-1/2 top-24 z-50 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-[12.5px] text-white">{toast}</p>}
    </>
  )
  return { open: setMenu, ui, toast, clearToast: () => setToast('') }
}

export default function MusicPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'all'
  const tracks = useLiveQuery(() => db.tracks.orderBy('createdAt').reverse().toArray(), [])
  const lists = useLiveQuery(() => db.playlists.orderBy('createdAt').toArray(), [])
  const p = usePlayer()
  const [q, setQ] = useState('')
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [result, setResult] = useState<MusicImportResult | null>(null)
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const menu = useTrackMenu()

  const words = q.trim().toLowerCase()
  const shown = (tracks ?? []).filter((t) => (tab !== 'fav' || t.favorite) && (!words || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(words)))

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="音乐" back="/" right={<NavButton label="导入音乐" icon="import" onClick={() => fileRef.current?.click()} />} />
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : []
          e.target.value = ''
          if (!files.length) return
          void importAudioFiles(files, (i, n) => setProgress([i, n])).then((r) => { setProgress(null); setResult(r) })
        }}
      />
      <div className="shrink-0 px-4 pt-1 pb-2">
        <div className="grid grid-cols-3 gap-1 rounded-full bg-white/50 p-0.5" role="tablist">
          {([['all', '全部歌曲'], ['fav', '收藏'], ['lists', '歌单']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`press h-8 rounded-full text-[13px] ${tab === k ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-2)]'}`} onClick={() => setParams({ tab: k }, { replace: true })}>{l}</button>
          ))}
        </div>
        {tab !== 'lists' && (tracks?.length ?? 0) > 0 && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索歌名、歌手、专辑" className="mt-2 w-full h-9 rounded-full bg-white/55 border border-[var(--c-line)] px-4 text-[15px] outline-none focus:border-[var(--c-accent)]" />
        )}
      </div>
      {progress && <div className="mx-4 mb-2 card px-4 py-2 text-[12.5px] text-[var(--c-text-2)]">正在导入 {Math.min(progress[0] + 1, progress[1])} / {progress[1]}…</div>}
      {result && (
        <div className="mx-4 mb-2 card px-4 py-2.5 text-[12.5px]" role="status">
          <div className="flex justify-between"><span className="text-[var(--c-text)]">导入了 {result.ok} 首</span><button className="press text-[var(--c-text-3)]" onClick={() => setResult(null)}>关闭</button></div>
          {result.failed.map((f) => <div key={f.name} className="text-[var(--c-danger)]">{f.name}：{f.reason}</div>)}
          {result.warning && <div className="text-[#8a7a3c]">{result.warning}</div>}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pb-28">
        {tab !== 'lists' && tracks && tracks.length === 0 && (
          <div className="mt-14 px-8 text-center">
            <div className="mx-auto h-16 w-16 rounded-full border border-dashed border-[#a9bdd5] flex items-center justify-center text-[#8ea3bf]"><Icon name="music" size="lg" stroke="thin" /></div>
            <p className="mt-3 text-[13.5px] text-[var(--c-text-2)]">还没有音乐</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--c-text-3)]">点右上角，从 iPhone「文件」导入你自己的音频（MP3、M4A、WAV 等）。音乐只保存在这台设备上，聆聆不会下载或提供任何音乐。</p>
            <button className="press mt-4 h-9 px-5 rounded-full bg-[var(--c-accent)] text-white text-[13.5px]" onClick={() => fileRef.current?.click()}>导入音乐</button>
          </div>
        )}
        {tab !== 'lists' && tracks && tracks.length > 0 && shown.length === 0 && <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">{q ? '没有找到' : '还没有收藏的歌曲，在歌曲的「更多」里收藏'}</p>}
        {tab !== 'lists' && shown.length > 0 && (
          <>
            <div className="px-4 pb-1 flex gap-2">
              <button className="press h-8 px-4 rounded-full bg-[var(--c-accent)] text-white text-[12.5px] flex items-center gap-1" onClick={() => void playQueue(shown.map((t) => t.id), 0)}><Icon name="play" size="xs" />播放全部</button>
              <span className="self-center text-[11.5px] text-[var(--c-text-3)]">{shown.length} 首</span>
            </div>
            {shown.map((t, i) => (
              <TrackRow key={t.id} t={t} active={p.track?.id === t.id} playing={p.playing} onPlay={() => void playQueue(shown.map((x) => x.id), i)} onMore={() => menu.open(t)} />
            ))}
          </>
        )}
        {tab === 'lists' && (
          <div className="px-4">
            <button className="press w-full flex items-center gap-3 py-2.5 text-[14px] text-[var(--c-accent-strong)]" onClick={() => { setNewName(''); setNaming(true) }}>
              <span className="h-[42px] w-[42px] rounded-[10px] border border-dashed border-[#a9bdd5] flex items-center justify-center"><Icon name="plus" size="sm" /></span>新建歌单
            </button>
            {lists?.map((l) => (
              <button key={l.id} className="playlist-row press w-full flex items-center gap-3 py-2 text-left" onClick={() => nav(`/music/playlist/${l.id}`)}>
                <Cover src={tracks?.find((t) => t.id === l.trackIds[0])?.cover} size={42} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[14.5px] text-[var(--c-text)]">{l.name}</span><span className="block text-[11.5px] text-[var(--c-text-3)]">{l.trackIds.length} 首</span></span>
                <Icon name="forward" size="sm" />
              </button>
            ))}
          </div>
        )}
      </div>
      {naming && (
        <ConfirmDialog
          title="新建歌单"
          message={<input autoFocus aria-label="歌单名称" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} placeholder="例如：下雪天听的歌" className="mt-1 w-full rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none" />}
          confirmText="创建"
          onCancel={() => setNaming(false)}
          onConfirm={() => void createPlaylist(newName).then((l) => { setNaming(false); nav(`/music/playlist/${l.id}`) }, () => undefined)}
        />
      )}
      {menu.ui}
      <MiniPlayer />
    </div>
  )
}
