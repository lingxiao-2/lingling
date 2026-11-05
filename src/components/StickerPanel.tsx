/**
 * 微信式表情包面板：最近使用 / 收藏 / 全部 / 各个合集；点一下立即发送，长按预览、收藏、删除。
 * 「添加」：相册或文件多选、ZIP 合集一键导入，显示进度与结果（成功 / 重复 / 失败）。
 */
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import { ActionSheet } from './Sheet'
import { StickerPicture } from './StickerView'
import type { Sticker, StickerAnalysis } from '../db/schema'
import { addSticker, deleteSticker, existingStickerHashes, listStickers, updateSticker } from '../db/stickerRepo'
import { prepareStickerBytes, isSafeStickerSrc } from '../services/stickers'
import { importStickers, storageEstimate, type StickerImportResult } from '../services/stickerImport'
import { analysesFor, analyzeSticker, visionStatus } from '../services/vision/stickerVision'
import { describeAnalysis } from '../services/vision/vision'
import { useLongPress } from '../lib/usePress'

type Tab = 'recent' | 'fav' | 'all' | `pack:${string}`

/** 弹层放到 body 下：面板带毛玻璃（backdrop-filter），fixed 定位会被限制在面板内 */
function Layer({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

function Tile({ sticker, onSend, onMenu }: { sticker: Sticker; onSend: () => void; onMenu: () => void }) {
  const { consumeClick, ...press } = useLongPress(onMenu)
  return (
    <button
      {...press}
      onClick={() => {
        if (!consumeClick()) onSend()
      }}
      aria-label={`发送表情包${sticker.name ? `：${sticker.name}` : ''}`}
      data-id={sticker.id}
      className="press relative aspect-square rounded-[12px] bg-white/35 flex items-center justify-center overflow-hidden select-none"
      style={{ WebkitTouchCallout: 'none' }}
    >
      {isSafeStickerSrc(sticker.thumbUrl) && <img src={sticker.thumbUrl} alt="" draggable={false} className="max-h-[86%] max-w-[86%] object-contain" />}
      {sticker.mime === 'image/gif' && <span className="absolute bottom-0.5 right-1 text-[8px] tracking-wider text-[#6f7f9c]">GIF</span>}
      {sticker.favorite && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[var(--c-accent)]" />}
    </button>
  )
}

function Preview({ sticker, analysis, onClose, toast }: { sticker: Sticker; analysis?: StickerAnalysis; onClose: () => void; toast: (s: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [a, setA] = useState(analysis)
  const recognize = async () => {
    setBusy(true)
    try {
      const st = await visionStatus()
      if (!st.ok) return toast(`识图不可用：${st.reason}`)
      const r = await analyzeSticker(sticker, { force: true })
      if (r) setA(r)
    } catch (e) {
      toast(e instanceof Error ? e.message : '识别失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-8" onClick={onClose}>
      <div className="absolute inset-0 sheet-overlay sheet-fade" />
      <div className="relative w-full max-w-[320px] card px-5 pt-5 pb-4 sheet-rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-center">
          <StickerPicture sticker={sticker} max={200} />
        </div>
        <div className="mt-3 text-[12px] leading-relaxed text-[var(--c-text-2)]">
          {a?.status === 'done' ? (
            <>
              <div className="text-[11px] tracking-wider text-[var(--c-text-3)]">角色看到的样子</div>
              <div className="mt-0.5">{describeAnalysis(a)}</div>
              {a.coverage === 'keyframes' && <div className="mt-0.5 text-[11px] text-[var(--c-text-3)]">动图：按 {a.frames} 个关键帧理解</div>}
            </>
          ) : a?.status === 'failed' ? (
            <div className="text-[var(--c-danger)]">上次识别失败：{a.error}</div>
          ) : (
            <div className="text-[var(--c-text-3)]">还没有识别过这张图。没识别时，角色不会假装知道它画了什么，也不会主动发它。</div>
          )}
        </div>
        <div className="mt-3.5 flex justify-end gap-2">
          <button onClick={onClose} className="press h-8 px-3.5 rounded-full text-[13px] text-[var(--c-text-2)]">
            关闭
          </button>
          {a?.status !== 'done' && (
            <button onClick={() => void recognize()} disabled={busy} className="press h-8 px-4 rounded-full bg-[var(--c-accent)] text-white text-[13px] disabled:opacity-50">
              {busy ? '识别中…' : '识别这张'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function StickerPanel({ onSend, toast }: { onSend: (s: Sticker) => void; toast: (s: string) => void }) {
  const stickers = useLiveQuery(listStickers, [], [] as Sticker[])
  const analyses = useLiveQuery(() => analysesFor(stickers), [stickers], new Map<string, StickerAnalysis>())
  const [tab, setTab] = useState<Tab>('all')
  const [menu, setMenu] = useState<Sticker | null>(null)
  const [preview, setPreview] = useState<Sticker | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<StickerImportResult | null>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)

  const packs = useMemo(() => [...new Set(stickers.map((s) => s.packId).filter((p) => p !== 'mine'))], [stickers])
  const shown = useMemo(() => {
    const list = [...stickers]
    if (tab === 'recent') return list.filter((s) => s.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 30)
    if (tab === 'fav') return list.filter((s) => s.favorite).sort((a, b) => b.updatedAt - a.updatedAt)
    if (tab.startsWith('pack:')) return list.filter((s) => s.packId === tab.slice(5)).sort((a, b) => a.createdAt - b.createdAt)
    return list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.createdAt - a.createdAt)
  }, [stickers, tab])

  const runImport = async (files: File[]) => {
    if (!files.length) return // 用户取消选择
    const est = await storageEstimate()
    let total = 0
    for (const f of files) total += f.size
    if (est && est.quota - est.usage < total * 1.6) {
      toast('设备存储空间可能不足，请先删除一些表情包或清理 Safari 网站数据')
      return
    }
    setProgress({ done: 0, total: files.length })
    try {
      const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))
      const r = await importStickers(inputs, {
        prepare: prepareStickerBytes,
        existingHashes: await existingStickerHashes(),
        save: async (p, packId) => void (await addSticker(p, '', packId)),
        onProgress: (done, t) => setProgress({ done, total: t }),
      })
      setResult(r)
    } catch {
      toast('读取文件失败。如果文件在 iCloud 中，请先在「文件」App 里点开一次再导入')
    } finally {
      setProgress(null)
    }
  }

  const tabs: [Tab, string][] = [
    ['recent', '最近'],
    ['fav', '收藏'],
    ['all', '全部'],
    ...packs.map((p): [Tab, string] => [`pack:${p}`, p]),
  ]

  return (
    <div>
      <div className="flex items-center gap-1 overflow-x-auto px-0.5 pb-1.5 no-scrollbar">
        {tabs.map(([t, l]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`press shrink-0 h-6 px-2.5 rounded-full text-[11.5px] ${tab === t ? 'ice-hi text-[var(--c-accent-strong)]' : 'text-[#6f7f9c]'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {progress ? (
        <div className="py-6 px-3 text-center text-[12px] text-[#5a6a86]">
          正在导入 {progress.done} / {progress.total}
          <div className="mt-2 h-1 rounded-full bg-white/50 overflow-hidden">
            <div className="h-full bg-[var(--c-accent)] transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-1.5 max-h-[200px] overflow-y-auto">
          {tab === 'all' && (
            <button
              aria-label="添加表情"
              onClick={() => setAddOpen(true)}
              className="press aspect-square rounded-[12px] border border-dashed border-[#9fb0cc] flex flex-col items-center justify-center gap-0.5 text-[#6f7f9c]"
            >
              <Icon name="plus" size="sm" stroke="thin" />
              <span className="text-[10px]">添加</span>
            </button>
          )}
          {shown.map((st) => (
            <Tile key={st.id} sticker={st} onSend={() => onSend(st)} onMenu={() => setMenu(st)} />
          ))}
        </div>
      )}
      {!progress && shown.length === 0 && (
        <p className="px-1 pt-2 text-[11px] leading-relaxed text-[#7d8cab]">
          {tab === 'recent' ? '还没有发过表情包' : tab === 'fav' ? '长按表情包可以收藏' : '从相册或 ZIP 合集添加，不需要填写名称；表情包只保存在这台设备上。'}
        </p>
      )}

      <input ref={imgRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => {
          // 先复制文件列表：清空 value 会同时清空 FileList
          const files: File[] = Array.from(e.target.files ?? [])
          e.target.value = ''
          void runImport(files)
        }} />
      <input ref={zipRef} type="file" accept=".zip,application/zip" multiple className="hidden" onChange={(e) => {
          // 先复制文件列表：清空 value 会同时清空 FileList
          const files: File[] = Array.from(e.target.files ?? [])
          e.target.value = ''
          void runImport(files)
        }} />

      {addOpen && (
        <Layer>
        <ActionSheet
          title="添加表情"
          onClose={() => setAddOpen(false)}
          actions={[
            { label: '从相册或文件选择', hint: '可以一次选很多张，支持 PNG / JPEG / WebP / GIF', icon: <Icon name="image" />, onClick: () => imgRef.current?.click() },
            { label: '导入 ZIP 表情合集', hint: '解压后按合集分类，重复的图片会自动跳过', icon: <Icon name="import" />, onClick: () => zipRef.current?.click() },
          ]}
        />
        </Layer>
      )}
      {menu && (
        <Layer>
        <ActionSheet
          onClose={() => setMenu(null)}
          actions={[
            { label: '预览', onClick: () => setPreview(menu) },
            { label: menu.favorite ? '取消收藏' : '收藏', onClick: () => void updateSticker(menu.id, { favorite: !menu.favorite }) },
            { label: menu.aiUsable ? '不让角色使用' : '允许角色使用', onClick: () => void updateSticker(menu.id, { aiUsable: !menu.aiUsable }) },
            { label: '删除', danger: true, onClick: () => void deleteSticker(menu.id) },
          ]}
        />
        </Layer>
      )}
      {preview && (
        <Layer>
          <Preview sticker={preview} analysis={preview.hash ? analyses.get(preview.hash) : undefined} onClose={() => setPreview(null)} toast={toast} />
        </Layer>
      )}
      {result && (
        <Layer>
        <div className="fixed inset-0 z-50 flex items-center justify-center px-8" onClick={() => setResult(null)}>
          <div className="absolute inset-0 sheet-overlay sheet-fade" />
          <div className="relative w-full max-w-[320px] card px-5 pt-5 pb-4 sheet-rise" onClick={(e) => e.stopPropagation()}>
            <div className="serif-zh text-[15px] text-[var(--c-brand)]">导入完成</div>
            <div className="mt-2 text-[13px] text-[var(--c-text-2)]">
              成功 {result.added} 张 · 重复 {result.duplicates} 张 · 失败 {result.failed.filter((f) => !/已跳过/.test(f.reason)).length} 张
            </div>
            {result.stoppedForQuota && <div className="mt-1.5 text-[12px] text-[var(--c-danger)]">设备存储空间不足，导入已停止。</div>}
            {result.failed.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto text-[11.5px] leading-relaxed text-[var(--c-text-3)]">
                {result.failed.slice(0, 30).map((f, i) => (
                  <div key={i}>· {f.name}：{f.reason}</div>
                ))}
              </div>
            )}
            <div className="mt-3.5 flex justify-end">
              <button onClick={() => setResult(null)} className="press h-8 px-4 rounded-full bg-[var(--c-accent)] text-white text-[13px]">
                好
              </button>
            </div>
          </div>
        </div>
        </Layer>
      )}
    </div>
  )
}
