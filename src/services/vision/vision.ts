/**
 * 表情包识图：用支持图片输入的模型（OpenAI 兼容格式）看懂表情包，结果按图片内容哈希缓存。
 *
 *  - 两种方式：直接用聊天模型（需要它支持图片）；或单独配置一个视觉模型（可以来自不同服务商）
 *  - 首次开启需要用户确认：图片会发送给模型服务商，并消耗 API 额度
 *  - 同一张图（相同哈希）只识别一次；识别失败不会卡住聊天，也不会生成假的识别结果
 *  - 动图按时间顺序抽取最多 4 帧拼成一张图交给模型，并在结果里标明理解范围
 */
import type { AIConfig, StickerAnalysis } from '../../db/schema'
import { AIError, configProblem, errorFromResponse, networkError, resolveTarget } from '../ai/openai'

export interface VisionConfig {
  enabled: boolean
  /** 用户同意「图片会发送给服务商、会消耗额度」的时间；未同意时不会发送任何图片 */
  consentAt?: number
  /** chat：使用聊天模型识图；separate：单独的视觉模型 */
  mode: 'chat' | 'separate'
  baseUrl: string
  apiKey: string
  model: string
  /** 聊天模型支持图片时，是否把最新的表情包原图也一起发给聊天模型 */
  attachToChat: boolean
}

export const DEFAULT_VISION_CONFIG: VisionConfig = { enabled: false, mode: 'separate', baseUrl: '', apiKey: '', model: '', attachToChat: true }

export interface VisionUsage {
  calls: number
  failures: number
  promptTokens: number
  completionTokens: number
  since: number
}

export const VISION_TIMEOUT_MS = 30_000

/** 识图使用的连接配置；不可用时返回原因（不会发出请求） */
export function visionTarget(v: VisionConfig, chat: AIConfig): { config: AIConfig } | { problem: string } {
  if (!v.enabled) return { problem: '识图未开启' }
  if (!v.consentAt) return { problem: '还没有同意把图片发送给模型服务商' }
  if (v.mode === 'chat') {
    if (chat.service === 'lingling') return { problem: '聆聆默认服务暂不支持识图，请改用自己的 API 或单独配置视觉模型' }
    const p = configProblem(chat)
    return p ? { problem: p } : { config: chat }
  }
  const config: AIConfig = {
    service: 'custom',
    mode: 'direct',
    baseUrl: v.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: v.apiKey.trim(),
    proxyUrl: '',
    proxyToken: '',
    model: v.model.trim(),
    temperature: 0.2,
    maxTokens: 400,
  }
  if (!config.baseUrl || !config.apiKey || !config.model) return { problem: '请先填写视觉模型的接口地址、API Key 和模型名称' }
  const p = configProblem(config)
  return p ? { problem: p } : { config }
}

export const ANALYZE_PROMPT = (frames: number) =>
  [
    '你在帮一个聊天应用理解用户收藏的表情包。请仔细看图，只输出一个 JSON 对象，不要输出其他文字：',
    '{"summary":"画面内容：人物/动物、动作、表情，30 字以内","text":"图上的文字，原样照抄，没有则为空","emotion":"它表达的情绪或语气，例如开心、委屈、无语、翻白眼、阴阳怪气、调侃、害羞、愤怒，可以写网络梗","scenes":["适合在聊天中什么时候发，最多 3 个短语"],"confidence":0.0}',
    'confidence 是你对理解是否准确的把握（0–1）。看不清或不确定时如实降低，不要编造。',
    frames > 1 ? `这是一张动图，按时间顺序抽取了 ${frames} 帧，从左到右、从上到下排列。请理解整个动作的含义，而不只是第一帧。` : '',
  ]
    .filter(Boolean)
    .join('\n')

/** 从模型输出里取出 JSON 并校验字段 */
export function parseAnalysis(raw: string): Pick<StickerAnalysis, 'summary' | 'text' | 'emotion' | 'scenes' | 'confidence'> {
  const s = raw.replace(/```(?:json)?/gi, '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new AIError('识图结果格式不正确', 'other')
  let j: Record<string, unknown>
  try {
    j = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new AIError('识图结果格式不正确', 'other')
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const summary = str(j.summary, 80)
  const emotion = str(j.emotion, 40)
  if (!summary && !emotion) throw new AIError('识图结果为空', 'empty')
  const scenes = Array.isArray(j.scenes) ? j.scenes.map((x) => str(x, 20)).filter(Boolean).slice(0, 3) : []
  const c = typeof j.confidence === 'number' ? j.confidence : Number(j.confidence)
  return { summary, text: str(j.text, 60), emotion, scenes, confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5 }
}

/** 模型明确表示不支持图片输入 */
function unsupportedImage(e: AIError): boolean {
  return /image|vision|multimodal|image_url|图片|图像|视觉|不支持/i.test(e.message) && (e.kind === 'other' || e.kind === 'model')
}

export interface VisionImage {
  dataUrl: string
  coverage: StickerAnalysis['coverage']
  frames: number
}

export interface AnalyzeDeps {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export interface AnalyzeOutcome {
  analysis: Omit<StickerAnalysis, 'hash'>
  usage?: { prompt: number; completion: number }
}

/** 发送一次识图请求（不读写数据库，便于测试） */
export async function requestAnalysis(config: AIConfig, image: VisionImage, deps: AnalyzeDeps = {}): Promise<AnalyzeOutcome> {
  const { url, headers, params } = resolveTarget(config)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS)
  const onAbort = () => ctrl.abort()
  deps.signal?.addEventListener('abort', onAbort)
  let res: Response
  try {
    res = await (deps.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      // 注意：不要在任何日志中输出请求头或请求体（其中可能含有 API Key 与图片）
      body: JSON.stringify({
        ...params,
        temperature: 0.2,
        max_tokens: 400,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: ANALYZE_PROMPT(image.frames) },
              { type: 'image_url', image_url: { url: image.dataUrl, detail: 'low' } },
            ],
          },
        ],
      }),
    })
  } catch (e) {
    clearTimeout(timer)
    deps.signal?.removeEventListener('abort', onAbort)
    if ((e as { name?: string })?.name === 'AbortError') {
      throw deps.signal?.aborted ? new AIError('已取消识图', 'aborted') : new AIError('识图超时（30 秒），请稍后再试', 'network')
    }
    throw networkError(e, config)
  }
  clearTimeout(timer)
  deps.signal?.removeEventListener('abort', onAbort)
  if (!res.ok) {
    const err = await errorFromResponse(res, config)
    if (res.status === 400 || res.status === 422 || unsupportedImage(err)) {
      if (unsupportedImage(err) || res.status === 422) throw new AIError(`这个模型似乎不支持图片输入，请换用支持识图的模型${err.message ? `（${err.message.slice(0, 80)}）` : ''}`, 'model')
    }
    throw err
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  const text = j.choices?.[0]?.message?.content ?? ''
  const parsed = parseAnalysis(text)
  return {
    analysis: { status: 'done', ...parsed, coverage: image.coverage, frames: image.frames, model: config.model, analyzedAt: Date.now() },
    usage: j.usage ? { prompt: j.usage.prompt_tokens ?? 0, completion: j.usage.completion_tokens ?? 0 } : undefined,
  }
}

/** 给聊天模型看的一句话描述（识别成功时） */
export function describeAnalysis(a: Pick<StickerAnalysis, 'summary' | 'text' | 'emotion' | 'coverage' | 'confidence'>): string {
  const parts = [a.summary]
  if (a.text) parts.push(`图上文字「${a.text}」`)
  if (a.emotion) parts.push(`情绪：${a.emotion}`)
  if (a.coverage === 'first-frame') parts.push('（动图，只看了第一帧）')
  if (a.confidence < 0.4) parts.push('（识别把握不大）')
  return parts.filter(Boolean).join('；')
}
