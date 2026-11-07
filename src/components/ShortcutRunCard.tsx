/**
 * 一次快捷指令运行的状态卡片：等待确认时显示「打开快捷指令」按钮（在点按里同步打开，符合 iOS 的要求）；
 * 之后显示真实状态。没有回跳时只会显示「已发起」或「无法验证」，绝不显示成功。
 */
import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { ShortcutRun } from '../db/schema'
import { cancelRun, launchRun, STATUS_LABEL, userReport, watchAfterLaunch } from '../ios/runs'

const TONE: Record<ShortcutRun['status'], string> = {
  awaiting_confirmation: 'text-[var(--c-accent-strong)]',
  launched: 'text-[#8a7a3c]',
  confirmed: 'text-[#2f7d5b]',
  unverifiable: 'text-[#8a7a3c]',
  failed: 'text-[var(--c-danger)]',
  cancelled: 'text-[var(--c-text-3)]',
  user_reported: 'text-[#2f7d5b]',
}

export const STATUS_HINT: Record<ShortcutRun['status'], string> = {
  awaiting_confirmation: '确认内容无误后再打开快捷指令；取消则什么都不会发生。',
  launched: '已经请求打开快捷指令，还没有收到结果。',
  confirmed: '快捷指令回报运行成功。',
  unverifiable: '没有收到快捷指令的回报，聆聆无法确认是否完成。请在 iPhone 上查看。',
  failed: '快捷指令报告出错，没有完成。',
  cancelled: '没有执行。',
  user_reported: '这是你自己的确认，不是系统回报。',
}

export default function ShortcutRunCard({ runId, compact, onDone }: { runId: string; compact?: boolean; onDone?: (r: ShortcutRun) => void }) {
  const run = useLiveQuery(() => db.shortcutRuns.get(runId), [runId])
  const stopWatch = useRef<(() => void) | null>(null)
  const clicked = useRef(false)
  useEffect(() => () => stopWatch.current?.(), [])
  useEffect(() => {
    if (run && run.status !== 'awaiting_confirmation' && run.status !== 'launched') {
      stopWatch.current?.()
      onDone?.(run)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status])
  if (!run) return null
  const open = () => {
    if (clicked.current) return
    clicked.current = true
    // 同步打开（iOS 要求在点按中直接打开其他 App）；之后开始等待回跳
    void launchRun(run)
    stopWatch.current = watchAfterLaunch(run.id)
  }
  return (
    <div className="shortcut-run rounded-[16px] bg-white/60 border border-[var(--c-line)] px-3.5 py-2.5 text-[13px]" data-status={run.status}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-[var(--c-text)]">{run.title}</span>
        <span className={`shrink-0 text-[12px] ${TONE[run.status]}`} aria-label="运行状态">{STATUS_LABEL[run.status]}</span>
      </div>
      {!compact && run.lines.map((l, i) => <div key={i} className="text-[12.5px] text-[var(--c-text-2)] whitespace-pre-wrap break-words">{l}</div>)}
      <div className="mt-1 text-[11px] text-[var(--c-text-3)]">
        {STATUS_HINT[run.status]}
        {run.error && run.status !== 'cancelled' ? `（${run.error}）` : ''}
        {run.status === 'cancelled' && run.error ? `（${run.error}）` : ''}
      </div>
      {run.status === 'awaiting_confirmation' && (
        <div className="mt-2 flex justify-end gap-2">
          <button className="press h-8 px-3.5 rounded-full text-[12.5px] text-[#5a6a86]" onClick={() => void cancelRun(run.id)}>取消</button>
          <button className="press h-8 px-4 rounded-full bg-[var(--c-accent)] text-white text-[12.5px]" onClick={open}>打开快捷指令</button>
        </div>
      )}
      {(run.status === 'unverifiable' || run.status === 'launched') && (
        <div className="mt-2 flex justify-end gap-2">
          <button className="press h-8 px-3 rounded-full text-[12px] text-[#5a6a86]" onClick={() => void userReport(run.id, false)}>没有完成</button>
          <button className="press h-8 px-3 rounded-full bg-white/80 text-[12px] text-[var(--c-accent-strong)]" onClick={() => void userReport(run.id, true)}>我在 iPhone 上看到了</button>
        </div>
      )}
    </div>
  )
}
