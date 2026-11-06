/**
 * 把用户确认过的一张照片交给已配置的识图模型（与表情包识图共用「识图设置」），返回文字描述。
 * 没有配置识图时如实返回不可用；不缓存、不保存图片或描述。
 */
import { db } from '../db/db'
import { chatTurn, AIError } from '../services/ai/openai'
import { visionStatus } from '../services/vision/stickerVision'

export async function photoVisionInfo(): Promise<{ ok: true; model: string } | { ok: false; reason: string }> {
  const s = await visionStatus()
  if (!s.ok) return { ok: false, reason: s.reason }
  if (!s.vision.enabled) return { ok: false, reason: '识图没有开启' }
  return { ok: true, model: s.config.model }
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(b)
  })
}

export async function describePhoto(photoId: string, signal: AbortSignal): Promise<{ ok: true; description: string; model: string } | { ok: false; reason: string; unavailable?: boolean }> {
  const s = await visionStatus()
  if (!s.ok || !s.vision.enabled) return { ok: false, unavailable: true, reason: `没有可用的识图模型，看不到照片内容${s.ok ? '' : `（${s.reason}）`}` }
  const blob = (await db.photoBlobs.get(photoId))?.blob
  if (!blob) return { ok: false, reason: '照片原图读取失败' }
  try {
    const { renderVisionImage } = await import('../services/vision/visionImage')
    const img = await renderVisionImage(await blobToDataUrl(blob))
    const r = await chatTurn({
      config: { ...s.config, temperature: 0.2, maxTokens: 300 },
      signal,
      messages: [{ role: 'user', content: [{ type: 'text', text: '请用中文客观描述这张照片的画面内容（人物、场景、物品、文字），不超过 150 字，不要猜测拍摄者的隐私信息。' }, { type: 'image_url', image_url: { url: img.dataUrl, detail: 'low' } }] }],
    })
    return { ok: true, description: r.content.trim(), model: s.config.model }
  } catch (e) {
    if (e instanceof AIError && e.kind === 'aborted') throw e
    return { ok: false, reason: `识图失败：${e instanceof Error ? e.message : String(e)}` }
  }
}
