/**
 * 「查看发送给 AI 的设定」：用与回复引擎相同的读取逻辑和 buildContext，按当前聊天状态构建一次上下文（只读），
 * 显示实际会发送的 system 内容、各段长度，以及没有发送的内容和原因。
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import { db } from '../db/db'
import type { BuiltContext } from '../services/ai/context'
import { previewContext } from '../services/ai/contextInput'

const n = (x: number) => x.toLocaleString()

export default function ContextPreviewPage() {
  const { id = '' } = useParams()
  const c = useLiveQuery(() => db.characters.get(id), [id])
  const [ctx, setCtx] = useState<BuiltContext | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!c) return
    previewContext(c).then(setCtx, (e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [c])

  const system = (ctx?.messages[0]?.content as string | undefined) ?? ''
  const historyChars = ctx ? ctx.messages.slice(1).reduce((s, m) => s + String(m.content).length, 0) : 0

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="发送给 AI 的设定" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14 px-4">
        <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--c-text-3)]">
          这是按「{c?.name ?? ''}」现在的资料和聊天记录，用与实际回复完全相同的逻辑构建出来的内容（只是预览，不会发送，也不会产生费用）。
          扩展资料、世界书和记忆会随话题变化，所以下一次实际发送的内容可能略有不同。
        </p>
        {err && <p className="mt-3 text-[12.5px] text-[var(--c-danger)]">{err}</p>}
        {!ctx && !err && <p className="mt-6 text-center text-[13px] text-[var(--c-text-3)]">正在构建…</p>}
        {ctx && (
          <>
            <section className="mt-3 glass rounded-[var(--radius-card)] px-4 py-3 text-[13px] text-[var(--c-text-2)]">
              <div className="serif-zh text-[15px] text-[var(--c-brand)]">概览</div>
              <div className="mt-1.5">
                设定（system）{n(system.length)} 字 · 聊天记录 {ctx.report.history.sent} / {ctx.report.history.total} 条（{n(historyChars)} 字）
              </div>
              <div className="mt-0.5 text-[11.5px] text-[var(--c-text-3)]">合计约 {n(Math.round((system.length + historyChars) * 1.1))} Token（粗略估算，中文约 1 字 1 Token）</div>
              {ctx.report.history.total > ctx.report.history.sent && (
                <div className="mt-0.5 text-[11.5px] text-[var(--c-text-3)]">更早的 {ctx.report.history.total - ctx.report.history.sent} 条聊天超出长度上限，没有发送（重要的事可以存为长期记忆）。</div>
              )}
            </section>

            <section className="mt-3 glass rounded-[var(--radius-card)] px-4 py-3 text-[13px] text-[var(--c-text-2)]">
              <div className="serif-zh text-[15px] text-[var(--c-brand)]">已发送的内容</div>
              {ctx.report.sections.map((s, i) => (
                <div key={i} className="mt-1 flex justify-between gap-3">
                  <span>{s.label}</span>
                  <span className="shrink-0 text-[var(--c-text-3)]">{n(s.chars)} 字</span>
                </div>
              ))}
            </section>

            <section className="mt-3 glass rounded-[var(--radius-card)] px-4 py-3 text-[13px] text-[var(--c-text-2)]">
              <div className="serif-zh text-[15px] text-[var(--c-brand)]">这次没有发送的内容</div>
              {ctx.report.omitted.length === 0 && <div className="mt-1 text-[var(--c-text-3)]">没有。全部资料都已发送。</div>}
              {ctx.report.omitted.map((s, i) => (
                <div key={i} className="mt-1.5">
                  <div className="flex justify-between gap-3">
                    <span>{s.label}</span>
                    <span className="shrink-0 text-[var(--c-text-3)]">约 {n(s.chars)} 字</span>
                  </div>
                  <div className="text-[11.5px] text-[var(--c-text-3)]">{s.reason}</div>
                </div>
              ))}
            </section>

            <section className="mt-3 glass rounded-[var(--radius-card)] px-4 py-3">
              <div className="serif-zh text-[15px] text-[var(--c-brand)]">完整设定原文</div>
              <pre className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--c-text-2)] font-[inherit]">{system}</pre>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
