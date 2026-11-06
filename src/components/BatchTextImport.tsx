/**
 * 「批量文本导入」：粘贴多行「名称 + 图片链接」→ 解析预览 → 逐个真实下载校验（缩略图、去重）→ 确认导入。
 * 名称保存为表情包名称（用于搜索、管理和 AI 参考）；聊天中点击仍直接发送图片。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addSticker, existingStickerHashes } from '../db/stickerRepo'
import { fetchBatch, fetchItem, parseBatchText, type BatchDeps, type BatchItem } from '../services/batchText'
import { expandInputs } from '../services/stickerImport'
import { browserProbe, fetchLink, type LinkProxy } from '../services/linkImport'
import { loadLinkProxy } from '../services/linkProxy'
import { prepareStickerBytes } from '../services/stickers'
import type { StickerImportResult } from '../services/stickerImport'

const EXAMPLE = '叹气：https://example.com/a.jpeg\n开心: https://example.com/b.png\n小狗皱眉 https://example.com/c.gif'

const STATUS: Record<BatchItem['status'], { label: string; cls: string }> = {
  pending: { label: '等待', cls: 'text-[var(--c-text-3)]' },
  fetching: { label: '下载中', cls: 'text-[var(--c-text-3)]' },
  ok: { label: '可导入', cls: 'text-[var(--c-accent-strong)]' },
  duplicate: { label: '重复', cls: 'text-[var(--c-text-3)]' },
  failed: { label: '失败', cls: 'text-[var(--c-danger)]' },
}

export default function BatchTextImport({ onClose, onDone }: { onClose: () => void; onDone: (r: StickerImportResult) => void }) {
  const [text, setText] = useState('')
  const [items, setItems] = useState<BatchItem[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [phase, setPhase] = useState<'input' | 'checking' | 'preview' | 'saving'>('input')
  const [proxy, setProxy] = useState<LinkProxy | null>(null)
  const [saved, setSaved] = useState(0)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => void loadLinkProxy().then(setProxy), [])
  useEffect(() => () => abort.current?.abort(), [])

  const seen = useRef<Set<string>>(new Set())
  const depsFor = (signal: AbortSignal): BatchDeps => ({
    // 每个链接都真实下载；直连读不到时用 <img> 判断是否为跨域，配置了代理则走代理
    fetch: (url, sig) => fetchLink(url, fetch, sig, { proxy, probe: (u) => browserProbe(u, 6000) }),
    prepare: prepareStickerBytes,
    unzip: async (bytes) => (await expandInputs([{ name: 'pack.zip', bytes }])).items.map((i) => i.bytes),
    existingHashes: seen.current,
    concurrency: 3,
    signal,
    onUpdate: (it) => setItems((xs) => xs.map((x) => (x.line === it.line ? it : x))),
  })

  const parse = async () => {
    const lines = parseBatchText(text)
    if (!lines.length) return
    const ctrl = new AbortController()
    abort.current = ctrl
    seen.current = await existingStickerHashes()
    setItems(lines.map((l) => ({ ...l, status: l.error ? 'failed' : 'pending', reason: l.error })))
    setSelected(new Set())
    setPhase('checking')
    const done = await fetchBatch(lines, depsFor(ctrl.signal))
    setItems(done)
    setSelected(new Set(done.filter((i) => i.status === 'ok').map((i) => i.line)))
    setPhase('preview')
  }

  /** 用户确认后，用建议的修正链接重试这一行 */
  const tryFix = async (it: BatchItem) => {
    const ctrl = new AbortController()
    const r = await fetchItem({ ...it }, depsFor(ctrl.signal), seen.current, true)
    setItems((xs) => xs.map((x) => (x.line === r.line ? { ...r } : x)))
    if (r.status === 'ok') setSelected((s) => new Set([...s, r.line]))
  }

  const save = async () => {
    setPhase('saving')
    const chosen = items.filter((i) => i.status === 'ok' && i.prepared && selected.has(i.line))
    const failed: StickerImportResult['failed'] = items
      .filter((i) => i.status === 'failed')
      .map((i) => ({ name: `第 ${i.line} 行${i.name ? `「${i.name}」` : ''}`, reason: i.reason ?? '失败' }))
    let added = 0
    let stoppedForQuota = false
    for (const it of chosen) {
      try {
        for (const p of [it.prepared!, ...(it.more ?? [])]) {
          await addSticker(p, it.name, 'mine')
          added++
          setSaved(added)
        }
      } catch (e) {
        const quota = /QuotaExceeded/i.test(String((e as { name?: string })?.name ?? '') + String((e as { inner?: { name?: string } })?.inner?.name ?? ''))
        failed.push({ name: `第 ${it.line} 行「${it.name}」`, reason: quota ? '设备存储空间不足，已停止导入' : e instanceof Error ? e.message : '保存失败' })
        if (quota) {
          stoppedForQuota = true
          break
        }
      }
    }
    onDone({ added, duplicates: items.filter((i) => i.status === 'duplicate').length, failed, stoppedForQuota })
  }

  const counts = useMemo(() => {
    const c = { ok: 0, duplicate: 0, failed: 0, busy: 0 }
    for (const i of items) {
      if (i.status === 'ok') c.ok++
      else if (i.status === 'duplicate') c.duplicate++
      else if (i.status === 'failed') c.failed++
      else c.busy++
    }
    return c
  }, [items])
  const okLines = items.filter((i) => i.status === 'ok').map((i) => i.line)
  const allOn = okLines.length > 0 && okLines.every((l) => selected.has(l))
  const lineCount = useMemo(() => text.split('\n').filter((l) => l.trim()).length, [text])

  const remove = (line: number) => {
    setItems((xs) => xs.filter((x) => x.line !== line))
    setSelected((s) => {
      const n = new Set(s)
      n.delete(line)
      return n
    })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={phase === 'saving' ? undefined : onClose}>
      <div className="absolute inset-0 sheet-overlay sheet-fade" />
      <div
        className="relative w-full max-w-[480px] card rounded-b-none px-5 pt-4 sheet-rise max-h-[90dvh] flex flex-col"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="serif-zh text-[16px] text-[var(--c-brand)]">批量文本导入</div>
        {phase === 'input' && (
          <>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--c-text-3)]">每行一个：名称 + 图片链接。名称和链接之间可以用中文冒号、英文冒号或空格分隔；空行会被忽略。</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={EXAMPLE}
              rows={9}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="mt-2.5 w-full rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-[var(--c-accent)] placeholder:text-[12.5px] placeholder:text-[var(--c-text-3)] resize-none"
            />
            <div className="mt-1 text-[11px] text-[var(--c-text-3)]">{lineCount ? `${lineCount} 行` : '示例见输入框'}</div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setText('')} disabled={!text} className="press h-10 px-4 rounded-full border border-[var(--c-line)] bg-white/45 text-[13px] text-[var(--c-text-2)] disabled:opacity-45">
                清空
              </button>
              <button onClick={() => void parse()} disabled={!lineCount} className="press flex-1 h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px] disabled:opacity-45">
                解析预览
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--c-text-3)]">
              每个链接都会真实下载并检查是否为 PNG / JPEG / WebP / GIF 图片。{proxy ? '浏览器读不到的公开图片会改用你自己部署的图片代理。' : '不允许跨域读取的网站需要在「表情包与识图」中配置图片代理。'}
            </p>
          </>
        )}
        {phase !== 'input' && (
          <>
            <div className="mt-1 flex items-center justify-between text-[12px] text-[var(--c-text-2)]">
              <span>
                可导入 {counts.ok} · 重复 {counts.duplicate} · 失败 {counts.failed}
                {counts.busy > 0 && ` · 检查中 ${counts.busy}`}
              </span>
              {phase === 'preview' && okLines.length > 0 && (
                <button onClick={() => setSelected(allOn ? new Set() : new Set(okLines))} className="press text-[var(--c-accent-strong)]">
                  {allOn ? '全不选' : '全选'}
                </button>
              )}
            </div>
            <div className="mt-2 overflow-y-auto min-h-0 -mx-1 px-1">
              {items.map((it) => (
                <div key={it.line} className="flex gap-2.5 py-2 hairline-b">
                  <button
                    disabled={it.status !== 'ok' || phase !== 'preview'}
                    onClick={() =>
                      setSelected((s) => {
                        const n = new Set(s)
                        if (n.has(it.line)) n.delete(it.line)
                        else n.add(it.line)
                        return n
                      })
                    }
                    aria-pressed={selected.has(it.line)}
                    className={`press relative shrink-0 h-14 w-14 rounded-[10px] overflow-hidden bg-white/45 border ${selected.has(it.line) ? 'border-[var(--c-accent)]' : 'border-transparent'}`}
                  >
                    {it.prepared ? <img src={it.prepared.thumbUrl} alt="" className="h-full w-full object-contain" /> : <span className="text-[10px] text-[var(--c-text-3)]">{STATUS[it.status].label}</span>}
                  </button>
                  <div className="min-w-0 flex-1 text-[12px] leading-snug">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[var(--c-text-3)] shrink-0">第 {it.line} 行</span>
                      <span className="truncate text-[13.5px] text-[var(--c-text)]">{it.name || '（无名称）'}</span>
                      <span className={`ml-auto shrink-0 text-[11.5px] ${STATUS[it.status].cls}`}>{STATUS[it.status].label}</span>
                    </div>
                    <div className="mt-0.5 break-all text-[11px] text-[var(--c-text-3)]">{it.rawUrl || it.raw.trim()}</div>
                    {it.finalUrl && it.finalUrl !== it.rawUrl && <div className="break-all text-[11px] text-[var(--c-text-2)]">→ {it.finalUrl}</div>}
                    {it.cleaned.map((c, i) => (
                      <div key={i} className="text-[11px] text-[var(--c-accent-strong)]">已自动修正：{c}</div>
                    ))}
                    {it.status === 'ok' || it.status === 'duplicate'
                      ? it.appliedFix && <div className="text-[11px] text-[var(--c-accent-strong)]">已按你的确认修正：{it.appliedFix}（已下载验证）</div>
                      : it.warning && <div className="text-[11px] text-[var(--c-text-2)]">注意：{it.warning}</div>}
                    {it.reason && <div className={`text-[11px] ${it.status === 'failed' ? 'text-[var(--c-danger)]' : 'text-[var(--c-text-3)]'}`}>{it.reason}</div>}
                    {it.status === 'failed' && it.suggestFix && phase === 'preview' && (
                      <button onClick={() => void tryFix(it)} className="press mt-1 h-6 px-2.5 rounded-full border border-[var(--c-line)] bg-white/45 text-[11px] text-[var(--c-accent-strong)] text-left">
                        原链接打不开，试试修正：{it.suggestFix.fix}
                      </button>
                    )}
                  </div>
                  {phase === 'preview' && (
                    <button onClick={() => remove(it.line)} aria-label={`删除第 ${it.line} 行`} className="press shrink-0 self-start h-6 px-2 rounded-full text-[11px] text-[var(--c-text-3)]">
                      删除
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {phase === 'checking' ? (
                <button onClick={() => abort.current?.abort()} className="press flex-1 h-10 rounded-full border border-[var(--c-line)] bg-white/45 text-[13px]">
                  停止检查
                </button>
              ) : phase === 'saving' ? (
                <div className="flex-1 h-10 flex items-center justify-center text-[13px] text-[var(--c-text-2)]">正在导入 {saved} / {selected.size}</div>
              ) : (
                <>
                  <button onClick={() => setPhase('input')} className="press h-10 px-4 rounded-full text-[13px] text-[var(--c-text-2)]">
                    返回修改
                  </button>
                  <button onClick={() => void save()} disabled={!selected.size} className="press flex-1 h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px] disabled:opacity-45">
                    确认导入 {selected.size} 个
                  </button>
                </>
              )}
            </div>
            {phase === 'preview' && <p className="mt-2 text-[11px] text-[var(--c-text-3)]">只会导入勾选的「可导入」项；重复和失败的不会保存。</p>}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
