/** 音乐页面底部的迷你播放条：显示当前歌曲，点开进入正在播放 */
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../theme/icons'
import { toggle, usePlayer } from '../../music/player'

export function Cover({ src, size = 44, className = '' }: { src?: string; size?: number; className?: string }) {
  return src ? (
    <img src={src} alt="" className={`shrink-0 rounded-[10px] object-cover ${className}`} style={{ width: size, height: size }} />
  ) : (
    <span className={`music-cover-empty shrink-0 rounded-[10px] flex items-center justify-center text-[#8ea3bf] ${className}`} style={{ width: size, height: size }} aria-hidden>
      <Icon name="music" size={size > 60 ? 'lg' : 'sm'} stroke="thin" />
    </span>
  )
}

export default function MiniPlayer() {
  const p = usePlayer()
  const nav = useNavigate()
  if (!p.track) return null
  const pct = p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 px-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 8px)' }}>
      <div className="mini-player glass-3 relative overflow-hidden rounded-[18px] h-[58px] flex items-center gap-3 pl-2 pr-1.5 shadow-[var(--shadow-soft)]">
        <span className="absolute left-0 bottom-0 h-[2px] bg-[var(--c-accent)]" style={{ width: `${pct}%` }} aria-hidden />
        <button className="press flex flex-1 min-w-0 items-center gap-3 text-left" onClick={() => nav('/music/now')} aria-label="打开正在播放">
          <Cover src={p.track.cover} size={42} />
          <span className="min-w-0">
            <span className="block truncate text-[14px] text-[var(--c-text)]">{p.track.title}</span>
            <span className="block truncate text-[11.5px] text-[var(--c-text-3)]">{p.track.artist || '未知歌手'}</span>
          </span>
        </button>
        <button aria-label={p.playing ? '暂停' : '播放'} className="press h-10 w-10 flex items-center justify-center text-[var(--c-accent-strong)]" onClick={toggle}>
          <Icon name={p.playing ? 'pause' : 'play'} />
        </button>
      </div>
    </div>
  )
}
