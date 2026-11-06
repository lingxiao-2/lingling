/**
 * 角色资料页「资料整理」：说明费用与隐私 → 用户同意后用自己配置的 AI 服务整理（或选择不联网的规则整理）
 * → 显示结果（含原文冲突、被丢弃条数）→ 用户确认后保存。整理失败、取消或放弃都不改动原资料。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { db } from '../db/db'
import type { Character, OrganizedProfile } from '../db/schema'
import { configProblem } from '../services/ai/openai'
import { CATEGORIES, organizeSource, organizeWithAI, organizeWithRules, planOrganize } from '../services/ai/organize'
import { getDeviceId } from '../services/ai/service'
import { useAIConfig } from '../store/profile'
import { Section } from './ui'

function Result({ o }: { o: OrganizedProfile }) {
  return (
    <div className="text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
      {o.conflicts.length > 0 && (
        <div className="mb-2 rounded-[12px] border border-[var(--c-danger)]/40 bg-white/40 px-3 py-2">
          <div className="text-[12px] text-[var(--c-danger)]">原文中有 {o.conflicts.length} 处前后矛盾，已保留双方原文，请自行确认：</div>
          {o.conflicts.map((c, i) => (
            <div key={i} className="mt-1">
              <b>{c.topic}</b>
              {c.quotes.map((q, j) => (
                <div key={j} className="text-[11.5px] text-[var(--c-text-3)]">「{q}」</div>
              ))}
            </div>
          ))}
        </div>
      )}
      {CATEGORIES.map((cat) => {
        const items = o.items.filter((i) => i.cat === cat.key)
        if (!items.length) return null
        return (
          <details key={cat.key} className="mt-1.5" open={items.length <= 4}>
            <summary className="text-[13px] text-[var(--c-brand)]">
              {cat.label} <span className="text-[11px] text-[var(--c-text-3)]">{items.length}</span>
            </summary>
            {items.map((it, i) => (
              <div key={i} className="mt-1 pl-2">
                · {it.point}
                {o.method === 'ai' && <div className="text-[11px] text-[var(--c-text-3)] pl-2">原文：「{it.quote.length > 60 ? `${it.quote.slice(0, 60)}…` : it.quote}」</div>}
              </div>
            ))}
          </details>
        )
      })}
    </div>
  )
}

export default function OrganizeCard({ c, autoOpen }: { c: Character; autoOpen?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (autoOpen && !c.organized) setOpen(true)
  }, [autoOpen, c.organized])
  const o = c.organized
  return (
    <Section title="资料整理">
      <div className="px-4 py-3 text-[13px] text-[var(--c-text-2)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            {o ? (
              <>
                {o.method === 'ai' ? `AI 整理（${o.model ?? ''}）` : '规则整理（未使用 AI）'}：{o.items.length} 条要点
                {o.conflicts.length > 0 && <span className="text-[var(--c-danger)]">，{o.conflicts.length} 处原文冲突</span>}
              </>
            ) : (
              '还没有整理。整理后会提取身份、性格、说话方式、关系等要点，聊天时一起发给模型；原文完整保留。'
            )}
          </div>
          <button onClick={() => setOpen(true)} className="press shrink-0 h-7 px-3 rounded-full border border-[var(--c-line)] text-[12px] text-[var(--c-accent-strong)]">
            {o ? '重新整理' : '整理'}
          </button>
        </div>
        {o && (
          <div className="mt-2">
            <Result o={o} />
          </div>
        )}
      </div>
      {open && <OrganizeSheet c={c} onClose={() => setOpen(false)} />}
    </Section>
  )
}

function OrganizeSheet({ c, onClose }: { c: Character; onClose: () => void }) {
  const config = useAIConfig()
  const text = organizeSource(c)
  const plan = planOrganize(text)
  const problem = configProblem(config)
  const [phase, setPhase] = useState<'consent' | 'running' | 'result'>('consent')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [result, setResult] = useState<OrganizedProfile | null>(null)
  const abort = useRef<AbortController | null>(null)
  const serviceName = config.service === 'lingling' ? '聆聆默认服务' : `${config.mode === 'proxy' ? '你的安全代理' : config.baseUrl.replace(/^https?:\/\//, '').split('/')[0]} · ${config.model}`

  const runAI = async () => {
    setError('')
    setPhase('running')
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const r = await organizeWithAI(config, text, { signal: ctrl.signal, deviceId: await getDeviceId(), onProgress: (done, total) => setProgress({ done, total }) })
      setResult(r)
      setPhase('result')
    } catch (e) {
      setError(ctrl.signal.aborted ? '已取消整理，原资料没有改动' : `${e instanceof Error ? e.message : String(e)}${/原资料/.test(String(e)) ? '' : '。原资料没有改动'}`)
      setPhase('consent')
    }
  }
  const runRules = () => {
    setError('')
    setResult(organizeWithRules(text))
    setPhase('result')
  }
  const save = async () => {
    if (!result) return
    await db.characters.update(c.id, { organized: result, updatedAt: Date.now() })
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={phase === 'running' ? undefined : onClose}>
      <div className="absolute inset-0 sheet-overlay sheet-fade" />
      <div
        className="relative w-full max-w-[480px] card rounded-b-none px-5 pt-4 sheet-rise max-h-[88dvh] flex flex-col"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="serif-zh text-[16px] text-[var(--c-brand)]">整理「{c.name}」的资料</div>
        {phase === 'consent' && (
          <div className="mt-2 text-[12.5px] leading-relaxed text-[var(--c-text-2)] overflow-y-auto">
            <p>
              原文共 {text.length.toLocaleString()} 字。AI 整理会把原文分 {plan.chunks.length} 次发送到<b>你配置的 AI 服务</b>（{serviceName}），
              预计消耗约 {(plan.estInputTokens / 1000).toFixed(1)}k 输入 Token、最多约 {(plan.estOutputTokens / 1000).toFixed(1)}k 输出 Token，费用由服务商按其价格结算
              {config.service === 'lingling' ? '（使用默认服务时计入你的免费额度）' : ''}。
            </p>
            {plan.skippedChars > 0 && <p className="mt-1 text-[var(--c-danger)]">原文较长，最后约 {plan.skippedChars.toLocaleString()} 字超出整理上限，不会被整理（原文仍完整保留）。</p>}
            <p className="mt-1">
              隐私：人设原文会发送给该服务商，由服务商按其隐私政策处理；不会发送给聆聆或其他第三方。整理只摘录原文，每条要点都会在本机与原文核对，核对不上的会被丢弃。
            </p>
            <p className="mt-1">也可以选择「规则整理」：不联网、不花钱，只按标题归类原文段落，不会理解内容，也不会发现矛盾。</p>
            {problem && <p className="mt-1.5 text-[var(--c-danger)]">现在无法使用 AI 整理：{problem}</p>}
            {error && <p className="mt-1.5 text-[var(--c-danger)]">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={runRules} className="press h-10 px-4 rounded-full border border-[var(--c-line)] bg-white/45 text-[13px] text-[var(--c-text-2)]">
                规则整理
              </button>
              <button onClick={() => void runAI()} disabled={!!problem || !text.trim()} className="press flex-1 h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px] disabled:opacity-45">
                同意并用 AI 整理
              </button>
            </div>
          </div>
        )}
        {phase === 'running' && (
          <div className="py-8 text-center text-[13px] text-[var(--c-text-2)]">
            正在整理 {progress.done} / {progress.total || plan.chunks.length}
            <div className="mt-2 h-1 rounded-full bg-white/60 overflow-hidden">
              <div className="h-full bg-[var(--c-accent)]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 5}%` }} />
            </div>
            <button onClick={() => abort.current?.abort()} className="press mt-3 h-8 px-4 rounded-full border border-[var(--c-line)] text-[12.5px]">
              取消
            </button>
          </div>
        )}
        {phase === 'result' && result && (
          <>
            <div className="mt-1 text-[12px] text-[var(--c-text-3)]">
              {result.method === 'ai' ? `AI 整理（${result.model}）` : '规则整理（未使用 AI）'}：{result.items.length} 条
              {result.dropped > 0 && `；${result.dropped} 条在原文中核对不到，已丢弃`}
            </div>
            <div className="mt-2 overflow-y-auto min-h-0">
              <Result o={result} />
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={onClose} className="press h-10 px-4 rounded-full text-[13px] text-[var(--c-text-2)]">
                放弃
              </button>
              <button onClick={() => void save()} className="press flex-1 h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px]">
                确认保存
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[var(--c-text-3)]">保存后，这些要点会和人设一起发给聊天模型。原文与各字段不会被修改。</p>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
