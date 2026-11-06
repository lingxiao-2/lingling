/**
 * 「通过链接导入」：粘贴 URL → 自动识别（图片 / ZIP / 网页）→ 预览 → 选择 → 保存。
 * 浏览器直接请求，不经过第三方代理；访问受限时如实说明原因。
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { checkLink, extractCandidates, fetchLink, LinkError, type PageCandidate } from '../services/linkImport'
import { expandInputs, importStickers, type StickerImportResult, type StickerInput } from '../services/stickerImport'
import { prepareStickerBytes } from '../services/stickers'
import { addSticker, existingStickerHashes } from '../db/stickerRepo'
import { Icon } from '../theme/icons'

type Item = { key: string; label: string; preview: string; input?: StickerInput; remote?: PageCandidate; selected: boolean }

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

function blobUrl(bytes: Uint8Array, name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[ext] ?? 'image/png' }))
}

function stemOf(url: string) {
  try {
    const u = new URL(url)
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? u.hostname)
  } catch {
    return 'link'
  }
}

export default function LinkImport({ onClose, onDone }: { onClose: () => void; onDone: (r: StickerImportResult) => void }) {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<'input' | 'loading' | 'preview' | 'importing'>('input')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [pack, setPack] = useState('mine')
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  // 释放本地预览图
  useEffect(() => () => items.forEach((i) => i.preview.startsWith('blob:') && URL.revokeObjectURL(i.preview)), [items])

  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim()
      if (t) setUrl(t)
    } catch {
      setError('无法读取剪贴板，请长按输入框选择「粘贴」')
    }
  }

  const recognize = async () => {
    setError('')
    setNote('')
    let u: URL
    try {
      u = checkLink(url)
    } catch (e) {
      return setError((e as Error).message)
    }
    setPhase('loading')
    try {
      const f = await fetchLink(u.href)
      if (f.kind === 'image') {
        const name = stemOf(f.finalUrl)
        setPack('mine')
        setItems([{ key: f.finalUrl, label: name, preview: blobUrl(f.bytes, name), input: { name, bytes: f.bytes }, selected: true }])
      } else if (f.kind === 'zip') {
        const zipName = stemOf(f.finalUrl)
        const { items: imgs, failed } = await expandInputs([{ name: zipName, bytes: f.bytes }])
        if (!imgs.length) throw new LinkError(failed[0]?.reason ?? '压缩包里没有可导入的图片', 'empty')
        setPack(imgs[0].packId)
        if (failed.length) setNote(failed.map((x) => x.reason).join('；'))
        setItems(imgs.map((x, i) => ({ key: `${i}`, label: x.name.split(' › ').pop() ?? x.name, preview: blobUrl(x.bytes, x.name), input: { name: x.name, bytes: x.bytes, packId: x.packId }, selected: true })))
      } else {
        const html = new TextDecoder().decode(f.bytes)
        const found = extractCandidates(html, f.finalUrl)
        if (!found.length) {
          throw new LinkError('没有在这个网页的主要内容里找到可导入的图片。页面可能需要登录、由脚本动态加载图片，或者图片不在正文区域', 'empty')
        }
        setPack(new URL(f.finalUrl).hostname)
        setNote('已过滤头像、图标、广告等无关图片。网页里的图片是否能导入，取决于对方网站是否允许跨域读取。')
        setItems(found.map((c) => ({ key: c.url, label: c.kind === 'zip' ? `ZIP：${stemOf(c.url)}` : c.alt || stemOf(c.url), preview: c.kind === 'zip' ? '' : c.url, remote: c, selected: c.kind === 'image' })))
      }
      setPhase('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '识别失败')
      setPhase('input')
    }
  }

  const chosen = useMemo(() => items.filter((i) => i.selected), [items])

  const doImport = async () => {
    setPhase('importing')
    setProgress({ done: 0, total: chosen.length })
    const inputs: StickerInput[] = []
    const failed: { name: string; reason: string }[] = []
    // 网页中的图片：逐个下载（每张都可能因为跨域被拒绝）
    let fetched = 0
    for (const it of chosen) {
      if (it.input) inputs.push(it.input)
      else if (it.remote) {
        try {
          const f = await fetchLink(it.remote.url)
          if (f.kind === 'html') throw new LinkError('链接指向的是网页，不是图片', 'unsupported')
          inputs.push({ name: stemOf(it.remote.url) + (f.kind === 'zip' ? '.zip' : ''), bytes: f.bytes, packId: f.kind === 'zip' ? undefined : pack })
        } catch (e) {
          failed.push({ name: it.label, reason: e instanceof Error ? e.message : '下载失败' })
        }
        setProgress({ done: ++fetched, total: chosen.length })
      }
    }
    const r = await importStickers(inputs, {
      prepare: prepareStickerBytes,
      existingHashes: await existingStickerHashes(),
      save: async (p, packId) => void (await addSticker(p, '', packId)),
      onProgress: (done, total) => setProgress({ done, total }),
    })
    onDone({ ...r, failed: [...failed, ...r.failed] })
  }

  const allOn = items.length > 0 && items.every((i) => i.selected)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={phase === 'importing' ? undefined : onClose}>
      <div className="absolute inset-0 sheet-overlay sheet-fade" />
      <div
        className="relative w-full max-w-[480px] card rounded-b-none px-5 pt-4 sheet-rise max-h-[86dvh] flex flex-col"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="serif-zh text-[16px] text-[var(--c-brand)]">通过链接导入</div>
        {(phase === 'input' || phase === 'loading') && (
          <>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--c-text-3)]">支持图片直链（PNG / JPEG / WebP / GIF）、ZIP 下载链接，以及公开的图片合集网页。</p>
            <div className="mt-3 flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="flex-1 min-w-0 rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none focus:border-[var(--c-accent)]"
              />
              <button onClick={() => void paste()} className="press shrink-0 px-3 rounded-[12px] border border-[var(--c-line)] bg-white/45 text-[12.5px] text-[var(--c-accent-strong)] inline-flex items-center gap-1">
                <Icon name="paste" size="xs" />
                粘贴
              </button>
            </div>
            {error && <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--c-danger)]">{error}</p>}
            <button
              onClick={() => void recognize()}
              disabled={!url.trim() || phase === 'loading'}
              className="press mt-4 h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px] tracking-[0.08em] disabled:opacity-45"
            >
              {phase === 'loading' ? '正在识别…' : '识别'}
            </button>
            <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--c-text-3)]">
              聆聆在你的浏览器里直接读取链接，不经过任何第三方服务器。需要登录、有权限限制或不允许跨域读取的网站无法导入，会提示原因。请只导入你有权使用的图片。
            </p>
          </>
        )}
        {phase === 'preview' && (
          <>
            <div className="mt-1 flex items-center justify-between text-[12.5px] text-[var(--c-text-2)]">
              <span>找到 {items.length} 个，已选 {chosen.length} 个</span>
              {items.length > 1 && (
                <button onClick={() => setItems((xs) => xs.map((x) => ({ ...x, selected: !allOn })))} className="press text-[var(--c-accent-strong)]">
                  {allOn ? '全不选' : '全选'}
                </button>
              )}
            </div>
            {note && <p className="mt-1 text-[11px] leading-relaxed text-[var(--c-text-3)]">{note}</p>}
            <div className="mt-2 grid grid-cols-4 gap-1.5 overflow-y-auto min-h-0">
              {items.map((it) => (
                <button
                  key={it.key}
                  onClick={() => setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, selected: !x.selected } : x)))}
                  className={`press relative aspect-square rounded-[12px] overflow-hidden bg-white/45 border ${it.selected ? 'border-[var(--c-accent)]' : 'border-transparent opacity-60'}`}
                  aria-pressed={it.selected}
                  aria-label={it.label}
                >
                  {it.preview ? (
                    <img src={it.preview} alt="" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center px-1 text-[10px] text-[var(--c-text-2)] break-all">{it.label}</span>
                  )}
                  {it.selected && (
                    <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-[var(--c-accent)] text-white flex items-center justify-center">
                      <Icon name="check" size="xs" />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => { setPhase('input'); setItems([]) }} className="press h-10 px-4 rounded-full text-[13px] text-[var(--c-text-2)]">
                换一个链接
              </button>
              <button onClick={() => void doImport()} disabled={!chosen.length} className="press flex-1 h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px] disabled:opacity-45">
                {items.length === 1 ? '加入收藏' : `导入所选 ${chosen.length} 个`}
              </button>
            </div>
          </>
        )}
        {phase === 'importing' && (
          <div className="py-8 text-center text-[13px] text-[var(--c-text-2)]">
            正在导入 {progress.done} / {progress.total}
            <div className="mt-2 h-1 rounded-full bg-white/60 overflow-hidden">
              <div className="h-full bg-[var(--c-accent)]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
