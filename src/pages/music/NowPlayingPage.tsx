/** 正在播放：封面、进度、上一首 / 播放 / 下一首、音量、循环、随机、睡眠定时、收藏 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ActionSheet } from '../../components/Sheet'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import { formatDuration, toggleFavorite } from '../../db/musicRepo'
import { next, prev, seek, setRepeat, setShuffle, setSleep, setVolume, toggle, usePlayer } from '../../music/player'
import { detectEnvironment } from '../../ios/env'
import { Cover } from './MiniPlayer'

export default function NowPlayingPage() {
  const nav = useNavigate()
  const p = usePlayer()
  const fav = useLiveQuery(() => (p.track ? db.tracks.get(p.track.id).then((t) => !!t?.favorite) : false), [p.track?.id])
  const [sleepMenu, setSleepMenu] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const ios = detectEnvironment(navigator as never).isIOS
  const pos = drag ?? p.position
  const sleepText = p.sleep ? ('at' in p.sleep ? `${new Date(p.sleep.at).getHours()}:${String(new Date(p.sleep.at).getMinutes()).padStart(2, '0')} 停止` : '播完这首停止') : '睡眠定时'

  return (
    <div className="now-playing fixed inset-0 z-40 flex flex-col text-[var(--c-text)]" style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}>
      <div className="flex items-center justify-between px-3">
        <button aria-label="收起" className="press h-10 w-10 flex items-center justify-center" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/music'))}><Icon name="expand" /></button>
        <span className="desk-serif italic text-[13px] tracking-[0.12em] text-[#6f88a8]">Now Playing</span>
        <span className="w-10" />
      </div>
      {!p.track ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[13px] text-[var(--c-text-3)]">
          没有正在播放的歌曲
          <button className="press mt-3 text-[var(--c-accent-strong)]" onClick={() => nav('/music')}>去音乐库</button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex items-center justify-center px-10">
            <div className={`np-disc relative ${p.playing ? 'np-spin' : ''}`}>
              <Cover src={p.track.cover} size={236} className="rounded-full shadow-[0_18px_40px_rgba(60,90,130,0.25)]" />
              <span className="absolute inset-0 m-auto h-9 w-9 rounded-full bg-[rgba(246,249,253,0.9)] border border-white" aria-hidden />
            </div>
          </div>
          <div className="px-7">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate serif-zh text-[19px] tracking-[0.04em]">{p.track.title}</div>
                <div className="truncate text-[13px] text-[var(--c-text-3)]">{p.track.artist || '未知歌手'}{p.track.album ? ` · ${p.track.album}` : ''}</div>
              </div>
              <button aria-label={fav ? '取消收藏' : '收藏'} aria-pressed={!!fav} className={`press h-9 w-9 flex items-center justify-center ${fav ? 'text-[var(--c-accent)]' : 'text-[var(--c-text-3)]'}`} onClick={() => void toggleFavorite(p.track!.id)}>
                <Icon name="star" size="sm" stroke={fav ? 'regular' : 'thin'} />
              </button>
            </div>
            <input
              aria-label="播放进度"
              type="range"
              min={0}
              max={Math.max(1, p.duration)}
              step={0.5}
              value={Math.min(pos, Math.max(1, p.duration))}
              onChange={(e) => setDrag(Number(e.target.value))}
              onPointerUp={() => { if (drag !== null) seek(drag); setDrag(null) }}
              onKeyUp={() => { if (drag !== null) seek(drag); setDrag(null) }}
              className="np-range mt-4 w-full"
            />
            <div className="flex justify-between text-[11px] tabular-nums text-[var(--c-text-3)]"><span>{formatDuration(pos)}</span><span>{formatDuration(p.duration)}</span></div>
            <div className="mt-3 flex items-center justify-between">
              <button aria-label={p.shuffle ? '关闭随机播放' : '随机播放'} aria-pressed={p.shuffle} className={`press h-10 w-10 flex items-center justify-center ${p.shuffle ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-text-3)]'}`} onClick={() => setShuffle(!p.shuffle)}><Icon name="shuffle" size="sm" /></button>
              <button aria-label="上一首" className="press h-12 w-12 flex items-center justify-center" onClick={() => void prev()}><Icon name="prevTrack" /></button>
              <button aria-label={p.playing ? '暂停' : '播放'} className="press h-16 w-16 rounded-full bg-[var(--c-accent)] text-white flex items-center justify-center shadow-[0_10px_24px_rgba(90,120,170,0.35)]" onClick={toggle}><Icon name={p.playing ? 'pause' : 'play'} size="lg" /></button>
              <button aria-label="下一首" className="press h-12 w-12 flex items-center justify-center" onClick={() => void next()}><Icon name="nextTrack" /></button>
              <button aria-label={`循环：${p.repeat === 'off' ? '关闭' : p.repeat === 'all' ? '列表循环' : '单曲循环'}`} className={`press h-10 w-10 flex items-center justify-center ${p.repeat === 'off' ? 'text-[var(--c-text-3)]' : 'text-[var(--c-accent-strong)]'}`} onClick={() => setRepeat(p.repeat === 'off' ? 'all' : p.repeat === 'all' ? 'one' : 'off')}><Icon name={p.repeat === 'one' ? 'repeatOne' : 'repeat'} size="sm" /></button>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Icon name="volume" size="sm" stroke="thin" className="text-[var(--c-text-3)]" />
              {p.volumeLocked || ios ? (
                <span className="text-[11.5px] text-[var(--c-text-3)]">iPhone 上请用侧边音量键调节音量</span>
              ) : (
                <input aria-label="音量" type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => setVolume(Number(e.target.value))} className="np-range flex-1" />
              )}
            </div>
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <button className={`press flex items-center gap-1 ${p.sleep ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-text-3)]'}`} onClick={() => setSleepMenu(true)}><Icon name="timer" size="xs" />{sleepText}</button>
              <button className="press flex items-center gap-1 text-[var(--c-text-3)]" onClick={() => nav('/music')}><Icon name="playlist" size="xs" />音乐库</button>
            </div>
            {p.error && <p role="alert" className="mt-2 text-[12px] text-[var(--c-danger)]">{p.error}</p>}
            {ios && <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--c-text-3)]">iPhone 的 Safari 在锁屏或切到其他 App 后可能会暂停网页播放；从主屏幕打开时更容易被暂停。这是系统限制。</p>}
          </div>
        </>
      )}
      {sleepMenu && (
        <ActionSheet
          title="睡眠定时"
          actions={[
            ...[15, 30, 45, 60].map((m) => ({ label: `${m} 分钟后停止`, onClick: () => { setSleep(m); setSleepMenu(false) } })),
            { label: '播完这首后停止', onClick: () => { setSleep('track'); setSleepMenu(false) } },
            ...(p.sleep ? [{ label: '取消睡眠定时', danger: true, onClick: () => { setSleep(null); setSleepMenu(false) } }] : []),
          ]}
          onClose={() => setSleepMenu(false)}
        />
      )}
    </div>
  )
}
