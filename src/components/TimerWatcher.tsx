/**
 * 全局计时提醒：聆聆在前台时，每秒检查倒计时是否结束，结束就在任何页面弹出提示并响铃（视浏览器支持）。
 * 在后台期间结束的计时（Safari 会暂停网页）：回来后如实提示「在你离开期间结束」，不假装响过铃。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ClockTimer } from '../db/schema'
import { settleTimers } from '../clock/timers'
import { chime } from '../clock/chime'

const hm = (ts?: number) => (ts ? `${String(new Date(ts).getHours()).padStart(2, '0')}:${String(new Date(ts).getMinutes()).padStart(2, '0')}` : '')

export default function TimerWatcher() {
  const [done, setDone] = useState<(ClockTimer & { rang: boolean })[]>([])
  const nav = useNavigate()
  useEffect(() => {
    let alive = true
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      const list = await settleTimers(Date.now(), true)
      if (!alive || !list.length) return
      const rang = list.some((t) => t.alerted) ? chime() : false
      setDone((d) => [...d, ...list.map((t) => ({ ...t, rang: rang && !!t.alerted }))])
    }
    const id = setInterval(() => void check(), 1000)
    const onVis = () => void check()
    document.addEventListener('visibilitychange', onVis)
    void check()
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  if (!done.length) return null
  const t = done[0]
  return (
    <div className="fixed inset-x-0 top-0 z-[60] px-4" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }} role="alertdialog" aria-label="计时结束">
      <div className="timer-alert glass-3 rounded-[20px] px-4 py-3 shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between">
          <span className="serif-zh text-[15px] text-[var(--c-brand)]">「{t.name}」计时结束</span>
          <span className="text-[12px] tabular-nums text-[var(--c-text-3)]">{hm(t.finishedAt)}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-[var(--c-text-2)]">
          {t.alerted ? (t.rang ? '已在聆聆中提醒。' : '已在聆聆中提醒（这台设备没有允许网页出声）。') : `在你离开聆聆期间（${hm(t.finishedAt)}）结束了；网页在后台时不能响铃。`}
        </p>
        <div className="mt-2 flex justify-end gap-2">
          <button className="press h-8 px-3 rounded-full text-[12.5px] text-[#5a6a86]" onClick={() => { setDone((d) => d.slice(1)); nav('/clock?tab=timer') }}>查看</button>
          <button className="press h-8 px-4 rounded-full bg-[var(--c-accent)] text-white text-[12.5px]" onClick={() => setDone((d) => d.slice(1))}>知道了{done.length > 1 ? `（还有 ${done.length - 1} 个）` : ''}</button>
        </div>
      </div>
    </div>
  )
}
