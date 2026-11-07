/**
 * 桌面小组件（只负责外观与自身数据；点按、拖动由桌面统一处理）：
 *  - 时间日期：衬线数字，每分钟整点自动更新
 *  - 音乐：显示音乐 App 的真实播放状态（同一个播放器）
 *  - 便签：显示你在本机保存的一段便签
 *  - 角色：显示指定角色的头像与名字，点按进入聊天；不会调用 AI、不消耗 API
 */
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import Avatar from '../components/Avatar'
import { Icon } from '../theme/icons'
import { db } from '../db/db'
import type { DesktopItem } from './layout'
import { useDesktopNote } from './layoutStore'
import { colorOf, previewLines } from '../life/notes'
import { usePlayer } from '../music/player'
import { useWeather } from '../weather/useWeather'
import { describeCode } from '../weather/openMeteo'
import { wxIcon } from '../weather/wxIcon'

type Widget = Extract<DesktopItem, { kind: 'widget' }>

const WEEK_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** 每到下一分钟刷新一次 */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      const d = new Date()
      setNow(d)
      t = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 20)
    }
    t = setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20)
    const onShow = () => document.visibilityState === 'visible' && setNow(new Date())
    document.addEventListener('visibilitychange', onShow)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', onShow)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return now
}

export function clockText(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return {
    time: `${hh}:${mm}`,
    zh: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_ZH[d.getDay()]}`,
    en: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  }
}

function Shell({ children, className = '', label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <div className={`desk-widget relative h-full w-full overflow-hidden ${className}`} role="group" aria-label={label}>
      {children}
    </div>
  )
}

/** 细小的银白丝带分隔线 */
function Ribbon({ className = '' }: { className?: string }) {
  return <span className={`block h-px flex-1 bg-[linear-gradient(90deg,rgba(255,255,255,0),rgba(150,175,205,0.55),rgba(255,255,255,0))] ${className}`} aria-hidden />
}

/** 时间日期：不做玻璃卡片，衬线数字直接落在雪景上（主视觉），日期用细丝带分隔 */
function ClockWidget() {
  const now = useMinute()
  const t = clockText(now)
  // 正在进行的倒计时（与时钟 App 同步；按分钟显示，精确时间在时钟 App 中）
  const timer = useLiveQuery(async () => (await db.timers.where('status').equals('running').sortBy('endAt'))[0] ?? null, [])
  return (
    <Shell label="时间日期" className="desk-clock flex flex-col justify-center px-1">
      <div className="flex items-end justify-between gap-3">
        <div className="desk-serif desk-clock-time" aria-label={`现在 ${t.time}`}>
          {t.time}
        </div>
        <div className="pb-1.5 text-right">
          <div className="serif-zh text-[13px] tracking-[0.1em] text-[#3f5674]">{t.zh.split(' ')[0]}</div>
          <div className="mt-0.5 text-[11px] tracking-[0.18em] text-[#6d819c]">{t.zh.split(' ')[1]}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <Ribbon />
        <span className="desk-serif italic text-[13px] tracking-[0.04em] text-[#5d7392] whitespace-nowrap">{timer?.endAt ? `${timer.name} · ${new Date(timer.endAt).getHours()}:${String(new Date(timer.endAt).getMinutes()).padStart(2, '0')} 结束` : t.en}</span>
        <Ribbon />
      </div>
    </Shell>
  )
}

/**
 * 音乐：显示全局播放器的真实状态（与音乐 App 同步）。没有歌曲时说明怎么导入；
 * 点按由桌面统一处理（进入音乐 App），这里不放按钮，避免和拖动编辑冲突。
 */
function MusicWidget() {
  const p = usePlayer()
  const count = useLiveQuery(() => db.tracks.count(), [], 0)
  const t = p.track
  const pct = t && p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0
  return (
    <Shell label={t ? `音乐：${t.title}${p.playing ? '（正在播放）' : '（已暂停）'}` : '音乐'} className="desk-glass flex items-center gap-3.5 px-3.5">
      {t?.cover ? (
        <img src={t.cover} alt="" className={`desk-vinyl shrink-0 object-cover ${p.playing ? 'np-spin' : ''}`} />
      ) : (
        <span className={`desk-vinyl shrink-0 ${p.playing ? 'np-spin' : ''}`} aria-hidden>
          <Icon name="music" size="sm" stroke="thin" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block desk-serif italic text-[13px] leading-tight text-[#6f88a8]">{t ? (p.playing ? 'Now playing' : 'Paused') : 'Music'}</span>
        <span className="mt-0.5 block truncate text-[13px] text-[#3f5674]">{t ? t.title : count ? `${count} 首歌曲` : '还没有音乐'}</span>
        <span className="block truncate text-[10.5px] text-[#8496ae]">{t ? t.artist || '未知歌手' : count ? '点按打开音乐' : '点按，从「文件」导入你的音乐'}</span>
        {t && (
          <span className="mt-1.5 block h-[2px] rounded-full bg-[rgba(150,175,205,0.35)]" aria-hidden>
            <span className="block h-full rounded-full bg-[#7f9cc4]" style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
    </Shell>
  )
}

/**
 * 便签：显示「便签」应用里指定的那一张（实时同步）。便签被删除时显示空状态；
 * 还没有迁移的旧版桌面便签文字照常显示。
 */
function NoteWidget({ noteId }: { noteId?: string }) {
  const note = useLiveQuery(async () => (noteId ? (await db.notes.get(noteId)) ?? null : null), [noteId])
  const legacy = useDesktopNote()
  const c = colorOf(note?.color)
  const lines = note && !note.deletedAt ? previewLines(note, 5) : []
  const gone = !!noteId && (note === null || !!note?.deletedAt)
  return (
    <Shell label="便签小组件" className="desk-paper flex flex-col px-3 pt-2.5 pb-2">
      {note && !note.deletedAt && <span className="absolute inset-0 -z-0 opacity-90" style={{ background: c.bg }} aria-hidden />}
      <span className="desk-tape" aria-hidden />
      <div className="relative flex items-center justify-between">
        <span className="desk-serif italic text-[12px] tracking-[0.06em] text-[#6f88a8]">Memo</span>
        <span className="text-[10px] tracking-[0.2em] text-[#93a5bc]">{note?.pinned && !note.deletedAt ? '置顶 · ' : ''}便签</span>
      </div>
      {note && !note.deletedAt ? (
        <div className="relative mt-[7px] flex-1 min-h-0 overflow-hidden text-[12px] leading-[18.5px] desk-note-fade" style={{ color: c.ink }}>
          {note.title && <div className="truncate font-medium">{note.title}</div>}
          {lines.map((l, i) => (
            <div key={i} className={`truncate ${l.done ? 'line-through opacity-50' : ''}`}>
              {note.kind === 'checklist' ? (l.done ? '☑ ' : '☐ ') : ''}
              {l.text}
            </div>
          ))}
        </div>
      ) : gone ? (
        <div className="relative mt-[7px] flex-1 text-[11.5px] leading-[18.5px] text-[#93a5bc]">这张便签已删除，点按选择另一张</div>
      ) : !noteId && legacy?.text ? (
        <div className="relative mt-[7px] flex-1 min-h-0 overflow-hidden whitespace-pre-wrap break-words text-[12px] leading-[18.5px] text-[#3f5674] desk-note-fade">{legacy.text}</div>
      ) : (
        <div className="relative mt-[7px] flex-1 text-[11.5px] leading-[18.5px] text-[#93a5bc]">点按写一张便签，只保存在这台设备上</div>
      )}
    </Shell>
  )
}

/** 角色：头像为主（银白双圈），名字用中文衬线，下方一行很小的英文 */
function CharacterWidget({ characterId }: { characterId?: string }) {
  const c = useLiveQuery(async () => (characterId ? (await db.characters.get(characterId)) ?? null : null), [characterId])
  if (c === undefined) return <Shell label="角色" className="desk-glass">{null}</Shell>
  if (!c) {
    return (
      <Shell label="角色（未选择）" className="desk-glass flex flex-col items-center justify-center gap-2 px-3 text-center">
        <span className="h-[46px] w-[46px] rounded-full border border-dashed border-[#a9bdd5] flex items-center justify-center text-[#8ea3bf]">
          <Icon name="character" size="sm" stroke="thin" />
        </span>
        <span className="text-[11px] leading-snug text-[#6d819c]">{characterId ? '角色已删除，点按重新选择' : '点按选择一个角色'}</span>
      </Shell>
    )
  }
  return (
    <Shell label={`和${c.name}聊天`} className="desk-glass flex flex-col items-center justify-center px-2.5 text-center">
      <span className="absolute right-2.5 top-2 text-[#b8c9de]" aria-hidden>
        <Icon name="sparkle" size="xs" stroke="thin" />
      </span>
      <span className="desk-avatar-ring">
        <Avatar name={c.name} src={c.avatar} size={50} />
      </span>
      <span className="mt-2 max-w-full truncate serif-zh text-[13.5px] tracking-[0.08em] text-[#3f5674]">{c.name}</span>
      <span className="desk-serif italic text-[11px] text-[#8496ae]">a letter for you</span>
    </Shell>
  )
}

/** 天气：所选城市的温度与天气（与天气 App 同步；没有同意联网或没有城市时说明怎么设置；不显示虚构的天气） */
function WeatherWidget() {
  const w = useWeather()
  const d = w?.data
  const label = !w ? '天气' : !w.consent || !w.city ? '天气（未设置）' : d ? `天气：${w.city.name} ${Math.round(d.current.temp)}°` : `天气：${w.city.name}`
  return (
    <Shell label={label} className="desk-glass flex flex-col justify-between px-3 py-2.5">
      <span className="flex items-center justify-between">
        <span className="desk-serif italic text-[12px] text-[#6f88a8]">Weather</span>
        {d && <span className="text-[#5d7392]"><Icon name={wxIcon(d.current.code, d.current.isDay)} size="sm" stroke="thin" /></span>}
      </span>
      {w && w.consent && w.city ? (
        d ? (
          <span>
            <span className="block desk-serif text-[30px] leading-none tabular-nums text-[#3f5674]">{Math.round(d.current.temp)}°</span>
            <span className="mt-1 block truncate text-[11.5px] text-[#4a5f7b]">{w.city.name} · {describeCode(d.current.code, d.current.isDay).text}</span>
            <span className="block text-[9.5px] text-[#93a5bc]">{w.error ? `更新失败 · ${new Date(d.fetchedAt).getHours()}:${String(new Date(d.fetchedAt).getMinutes()).padStart(2, '0')} 的数据` : 'Open-Meteo'}</span>
          </span>
        ) : (
          <span className="text-[11px] leading-snug text-[#6d819c]">{w.city.name}<br />{w.loading ? '正在获取…' : w.error ? '暂时获取不到天气' : '点按查看'}</span>
        )
      ) : (
        <span className="text-[11px] leading-snug text-[#6d819c]">点按设置城市</span>
      )}
    </Shell>
  )
}

export function WidgetView({ item }: { item: Widget }) {
  if (item.widget === 'weather') return <WeatherWidget />
  if (item.widget === 'clock') return <ClockWidget />
  if (item.widget === 'music') return <MusicWidget />
  if (item.widget === 'note') return <NoteWidget noteId={item.noteId} />
  return <CharacterWidget characterId={item.characterId} />
}
