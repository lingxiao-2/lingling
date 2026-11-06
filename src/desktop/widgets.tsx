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
    <div className={`desk-widget h-full w-full overflow-hidden ${className}`} role="group" aria-label={label}>
      {children}
    </div>
  )
}

function ClockWidget() {
  const t = clockText(useMinute())
  return (
    <Shell label="时间日期" className="relative flex items-center justify-between px-5">
      <div>
        <div className="desk-serif text-[54px] leading-none tracking-[0.02em] text-[var(--c-brand)]" aria-label={`现在 ${t.time}`}>
          {t.time}
        </div>
        <div className="mt-1.5 desk-serif italic text-[14px] text-[var(--c-text-2)]">{t.en}</div>
      </div>
      <div className="text-right">
        <Icon name="sparkle" size="md" stroke="thin" className="ml-auto text-[var(--c-accent)] opacity-70" />
        <div className="mt-2 serif-zh text-[13px] tracking-[0.08em] text-[var(--c-text)]">{t.zh}</div>
      </div>
    </Shell>
  )
}

function MusicWidget({ size }: { size: Widget['size'] }) {
  return (
    <Shell label="音乐（未连接）" className={`flex items-center gap-3.5 ${size === 'medium' ? 'px-4' : 'flex-col justify-center px-3 text-center'}`}>
      <span className="shrink-0 h-[64px] w-[64px] rounded-[14px] flex items-center justify-center text-[var(--c-text-3)] bg-[linear-gradient(150deg,rgba(255,255,255,0.7),rgba(214,227,241,0.55))] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)]">
        <Icon name="music" size="lg" stroke="thin" />
      </span>
      <span className="min-w-0">
        <span className="block desk-serif italic text-[15px] text-[var(--c-brand)]">Not connected</span>
        <span className="block text-[13px] text-[var(--c-text)]">音乐未连接</span>
        <span className="block mt-0.5 text-[11px] leading-snug text-[var(--c-text-3)]">还没有可播放的音乐</span>
      </span>
    </Shell>
  )
}

function NoteWidget() {
  const note = useDesktopNote()
  return (
    <Shell label="便签小组件" className="flex flex-col px-3.5 pt-3 pb-2.5">
      <div className="flex items-center gap-1.5 text-[11px] tracking-[0.12em] text-[var(--c-accent-strong)]">
        <Icon name="note" size="xs" stroke="thin" />
        便签
      </div>
      {note?.text ? (
        <div className="mt-1.5 flex-1 min-h-0 overflow-hidden whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-[var(--c-text)] desk-note-fade">{note.text}</div>
      ) : (
        <div className="mt-1.5 flex-1 text-[12.5px] leading-snug text-[var(--c-text-3)]">点按写一句话，只保存在这台设备上</div>
      )}
    </Shell>
  )
}

function CharacterWidget({ characterId }: { characterId?: string }) {
  const c = useLiveQuery(async () => (characterId ? (await db.characters.get(characterId)) ?? null : null), [characterId])
  if (c === undefined) return <Shell label="角色">{null}</Shell>
  if (!c) {
    return (
      <Shell label="角色（未选择）" className="flex flex-col items-center justify-center gap-1.5 px-3 text-center">
        <span className="h-[52px] w-[52px] rounded-full border border-dashed border-[var(--c-line)] flex items-center justify-center text-[var(--c-text-3)]">
          <Icon name="character" size="md" stroke="thin" />
        </span>
        <span className="text-[12px] text-[var(--c-text-2)]">{characterId ? '角色已删除，点按重新选择' : '点按选择一个角色'}</span>
      </Shell>
    )
  }
  return (
    <Shell label={`和${c.name}聊天`} className="flex flex-col items-center justify-center gap-2 px-3 text-center">
      <Avatar name={c.name} src={c.avatar} size={64} />
      <span className="max-w-full truncate serif-zh text-[14px] tracking-[0.06em] text-[var(--c-text)]">{c.name}</span>
    </Shell>
  )
}

export function WidgetView({ item }: { item: Widget }) {
  if (item.widget === 'clock') return <ClockWidget />
  if (item.widget === 'music') return <MusicWidget size={item.size} />
  if (item.widget === 'note') return <NoteWidget />
  return <CharacterWidget characterId={item.characterId} />
}
