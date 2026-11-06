/**
 * 表情包识图的本地状态：配置、用量、按哈希缓存的识别结果、单张 / 批量识别。
 * 图片只在用户开启识图并同意后才会发送；批量识别必须由用户手动点击确认。
 */
import { db, getSetting, setSetting } from '../../db/db'
import type { AIConfig, Sticker, StickerAnalysis } from '../../db/schema'
import { ensureStickerHash, getStickerImage } from '../../db/stickerRepo'
import { normalizeAIConfig } from '../ai/service'
import { AIError } from '../ai/openai'
import { DEFAULT_VISION_CONFIG, requestAnalysis, visionTarget, type VisionConfig, type VisionImage, type VisionUsage } from './vision'

export async function loadVisionConfig(): Promise<VisionConfig> {
  return { ...DEFAULT_VISION_CONFIG, ...(await getSetting<Partial<VisionConfig>>('vision-config', {})) }
}

export async function saveVisionConfig(v: VisionConfig) {
  await setSetting('vision-config', v)
}

export async function loadVisionUsage(): Promise<VisionUsage> {
  return { calls: 0, failures: 0, promptTokens: 0, completionTokens: 0, since: Date.now(), ...(await getSetting<Partial<VisionUsage>>('vision-usage', {})) }
}

async function addUsage(ok: boolean, usage?: { prompt: number; completion: number }) {
  const u = await loadVisionUsage()
  await setSetting('vision-usage', {
    ...u,
    calls: u.calls + 1,
    failures: u.failures + (ok ? 0 : 1),
    promptTokens: u.promptTokens + (usage?.prompt ?? 0),
    completionTokens: u.completionTokens + (usage?.completion ?? 0),
  })
}

/** 当前识图是否可用；不可用时给出原因 */
export async function visionStatus(): Promise<{ ok: true; config: AIConfig; vision: VisionConfig } | { ok: false; reason: string; vision: VisionConfig }> {
  const vision = await loadVisionConfig()
  const chat = normalizeAIConfig((await db.settings.get('ai-config'))?.value as Partial<AIConfig> | undefined)
  const t = visionTarget(vision, chat)
  return 'problem' in t ? { ok: false, reason: t.problem, vision } : { ok: true, config: t.config, vision }
}

export async function analysesFor(stickers: Sticker[]): Promise<Map<string, StickerAnalysis>> {
  const hashes = [...new Set(stickers.map((s) => s.hash).filter((h): h is string => !!h))]
  const rows = await db.stickerAnalyses.bulkGet(hashes)
  return new Map(rows.filter((r): r is StickerAnalysis => !!r).map((r) => [r.hash, r]))
}

/** 失败结果在这段时间内不重复请求（避免反复产生费用） */
const RETRY_FAILED_AFTER = 10 * 60 * 1000
const inflight = new Map<string, Promise<StickerAnalysis | null>>()
let rendererOverride: ((dataUrl: string) => Promise<VisionImage>) | null = null
/** 仅供测试：替换浏览器端的图片整理（Node 中没有 canvas） */
export function setVisionRendererForTesting(fn: ((dataUrl: string) => Promise<VisionImage>) | null) {
  rendererOverride = fn
}

export interface AnalyzeStickerOptions {
  /** 忽略失败缓存，重新识别 */
  force?: boolean
  signal?: AbortSignal
  /** 测试用：替换图片整理与网络请求 */
  render?: (dataUrl: string) => Promise<VisionImage>
  fetchImpl?: typeof fetch
}

/**
 * 识别一张表情包：已有结果直接返回（不产生费用）；识图不可用时返回 null（不会编造结果）。
 * 失败时保存失败记录并抛出错误，调用方决定是否提示。
 */
export async function analyzeSticker(sticker: Sticker, opts: AnalyzeStickerOptions = {}): Promise<StickerAnalysis | null> {
  const hash = await ensureStickerHash(sticker)
  if (!hash) return null
  const cached = await db.stickerAnalyses.get(hash)
  if (cached?.status === 'done') return cached
  if (cached?.status === 'failed' && !opts.force && Date.now() - cached.analyzedAt < RETRY_FAILED_AFTER) return cached
  const status = await visionStatus()
  if (!status.ok) return null
  const running = inflight.get(hash)
  if (running) return running
  const task = (async () => {
    const dataUrl = await getStickerImage(sticker.id)
    if (!dataUrl) throw new AIError('表情包已删除', 'other')
    const render = opts.render ?? rendererOverride ?? (await import('./visionImage')).renderVisionImage
    const image = await render(dataUrl)
    try {
      const out = await requestAnalysis(status.config, image, { fetchImpl: opts.fetchImpl, signal: opts.signal })
      const row: StickerAnalysis = { hash, ...out.analysis }
      await db.stickerAnalyses.put(row)
      await addUsage(true, out.usage)
      return row
    } catch (e) {
      const err = e instanceof AIError ? e : new AIError(e instanceof Error ? e.message : String(e), 'other')
      if (err.kind !== 'aborted') {
        await db.stickerAnalyses.put({
          hash, status: 'failed', summary: '', text: '', emotion: '', scenes: [], confidence: 0,
          coverage: image.coverage, frames: image.frames, model: status.config.model, analyzedAt: Date.now(), error: err.message,
        })
        await addUsage(false)
      }
      throw err
    }
  })()
  inflight.set(hash, task)
  try {
    return await task
  } finally {
    inflight.delete(hash)
  }
}

/** 批量识别（用户确认后调用）：逐张进行，单张失败不影响其余；可中途取消 */
export async function analyzeMany(
  stickers: Sticker[],
  onProgress: (done: number, total: number, ok: number, failed: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: number; failed: number; skipped: number }> {
  const known = await analysesFor(stickers)
  const todo = stickers.filter((s) => !(s.hash && known.get(s.hash)?.status === 'done'))
  let ok = 0
  let failed = 0
  onProgress(0, todo.length, 0, 0)
  for (let i = 0; i < todo.length; i++) {
    if (signal?.aborted) break
    try {
      const r = await analyzeSticker(todo[i], { signal, force: true })
      if (r?.status === 'done') ok++
      else failed++
    } catch (e) {
      if ((e as AIError)?.kind === 'aborted') break
      failed++
      // 密钥无效、模型不支持图片、余额不足：后面的也会失败，直接停止，避免浪费
      if (['auth', 'model', 'quota'].includes((e as AIError)?.kind)) break
    }
    onProgress(i + 1, todo.length, ok, failed)
  }
  return { ok, failed, skipped: stickers.length - todo.length }
}
