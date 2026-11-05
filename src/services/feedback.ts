/**
 * 付费意向登记与体验反馈。
 *
 * 原则：自愿、匿名、最少信息。不收集姓名、手机号、微信号、设备 ID 或聊天内容。
 * 提交方式（按优先顺序）：
 *   1. 构建时配置了 VITE_FEEDBACK_FORM_URL（例如自己创建的腾讯问卷链接）：复制摘要并打开问卷；
 *   2. 未配置：保存在本机并复制摘要，用户可以自行粘贴发给开发者。
 * 两种方式都会在本机保留一份记录，方便用户查看自己提交过什么。
 */
export const FEEDBACK_FORM_URL: string = (((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_FEEDBACK_FORM_URL ?? '') as string).trim()

export function feedbackChannelOpen(url = FEEDBACK_FORM_URL): boolean {
  return /^https:\/\//i.test(url)
}

export const INTENT_OPTIONS = [
  { id: 'lite', label: '开售后可能选 ¥9.9/月' },
  { id: 'plus', label: '开售后可能选 ¥19.9/月' },
  { id: 'maybe', label: '看具体权益再决定' },
  { id: 'own-api', label: '继续用自己的 API 就够了' },
  { id: 'no', label: '暂时不会付费' },
] as const

export const PERK_OPTIONS = [
  { id: 'no-key', label: '不用申请 API Key，直接聊' },
  { id: 'quota', label: '更多聊天额度' },
  { id: 'sync', label: '云端备份、多设备同步' },
  { id: 'memory', label: '角色能长期记住我' },
  { id: 'theme', label: '更多主题与装饰' },
  { id: 'voice', label: '语音消息' },
] as const

export const PRICE_OPTIONS = [
  { id: 'lt6', label: '¥6 以下' },
  { id: '6-10', label: '¥6–10' },
  { id: '10-20', label: '¥10–20' },
  { id: 'gt20', label: '¥20 以上' },
] as const

export type IntentId = (typeof INTENT_OPTIONS)[number]['id']
export type PerkId = (typeof PERK_OPTIONS)[number]['id']
export type PriceId = (typeof PRICE_OPTIONS)[number]['id']

export interface FeedbackEntry {
  intent?: IntentId
  perks: PerkId[]
  price?: PriceId
  /** 使用体验（自由填写，可空） */
  experience: string
  /** 是否已经能和角色正常聊天（帮助判断首次使用流程是否顺畅） */
  chatWorking?: boolean
  createdAt: number
  /** 应用版本，方便区分不同测试版本的反馈 */
  appVersion: string
}

export const APP_VERSION = 'V0.1-validation'

const label = <T extends { id: string; label: string }>(list: readonly T[], id?: string) => list.find((o) => o.id === id)?.label

export function feedbackSummary(e: FeedbackEntry): string {
  const lines = ['【聆聆 意向登记与反馈】']
  if (e.intent) lines.push(`付费意向：${label(INTENT_OPTIONS, e.intent)}`)
  if (e.perks.length) lines.push(`看重的权益：${e.perks.map((p) => label(PERK_OPTIONS, p)).filter(Boolean).join('；')}`)
  if (e.price) lines.push(`心理价位：${label(PRICE_OPTIONS, e.price)}`)
  if (e.chatWorking !== undefined) lines.push(`已能正常聊天：${e.chatWorking ? '是' : '否'}`)
  if (e.experience.trim()) lines.push(`体验反馈：${e.experience.trim()}`)
  const d = new Date(e.createdAt)
  lines.push(`（${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} · ${e.appVersion}）`)
  return lines.join('\n')
}

export function isEmptyFeedback(e: Pick<FeedbackEntry, 'intent' | 'perks' | 'price' | 'experience'>): boolean {
  return !e.intent && e.perks.length === 0 && !e.price && !e.experience.trim()
}
