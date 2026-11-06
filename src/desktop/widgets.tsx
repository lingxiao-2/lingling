/**
 * 桌面小组件（只负责外观与自身数据；点按、拖动由桌面统一处理）：
 *  - 时间日期：衬线数字，每分钟整点自动更新
 *  - 音乐：播放器外观；目前没有可播放的音乐资源，明确显示「未连接」，没有任何播放按钮
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
  const t = clockText(useMinute())
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
        <span className="desk-serif italic text-[13px] tracking-[0.04em] text-[#5d7392] whitespace-nowrap">{t.en}</span>
        <Ribbon />
      </div>
    </Shell>
  )
}

/** 音乐：横向的精致播放器外观；没有可播放的资源时明确写「未连接」，不放任何播放按钮 */
function MusicWidget() {
  return (
    <Shell label="音乐（未连接）" className="desk-glass flex items-center gap-3.5 px-3.5">
      <span className="desk-vinyl shrink-0" aria-hidden>
        <Icon name="music" size="sm" stroke="thin" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block desk-serif italic text-[15px] leading-tight text-[#3f5674]">Not connected</span>
        <span className="mt-0.5 block text-[12.5px] text-[#4a5f7b]">音乐未连接</span>
        <span className="mt-1.5 flex items-center gap-2 text-[10.5px] text-[#8496ae]">
          <span className="h-[5px] w-[5px] rounded-full border border-[#9fb3cc]" aria-hidden />
          还没有可播放的音乐
        </span>
      </span>
    </Shell>
  )
}

/** 便签：珍珠白信纸，顶端一小段半透明丝带胶带 */
function NoteWidget() {
  const note = useDesktopNote()
  return (
    <Shell label="便签小组件" className="desk-paper flex flex-col px-3 pt-2.5 pb-2">
      <span className="desk-tape" aria-hidden />
      <div className="flex items-center justify-between">
        <span className="desk-serif italic text-[12px] tracking-[0.06em] text-[#6f88a8]">Memo</span>
        <span className="text-[10px] tracking-[0.2em] text-[#93a5bc]">便签</span>
      </div>
      {note?.text ? (
        <div className="mt-[7px] flex-1 min-h-0 overflow-hidden whitespace-pre-wrap break-words text-[12px] leading-[18.5px] text-[#3f5674] desk-note-fade">{note.text}</div>
      ) : (
        <div className="mt-[7px] flex-1 text-[11.5px] leading-[18.5px] text-[#93a5bc]">点按写一句话，只保存在这台设备上</div>
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

export function WidgetView({ item }: { item: Widget }) {
  if (item.widget === 'clock') return <ClockWidget />
  if (item.widget === 'music') return <MusicWidget />
  if (item.widget === 'note') return <NoteWidget />
  return <CharacterWidget characterId={item.characterId} />
}
