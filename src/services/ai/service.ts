/**
 * 聆聆默认服务的公开配置。
 * 服务地址在构建时通过 VITE_LINGLING_SERVICE_URL 注入（GitHub 仓库变量 LINGLING_SERVICE_URL），
 * 它只是一个公开地址，不是密钥；官方模型密钥只保存在服务端，永远不会出现在前端或仓库中。
 * 未注入地址时，默认服务视为「尚未开通」，不会生成任何回复。
 */
import { db, DEFAULT_AI_CONFIG } from '../../db/db'
import type { AIConfig } from '../../db/schema'
import { uid } from '../../lib/util'

export { CLIENT_ID, getServiceUrl, serviceAvailable, setServiceUrlForTesting } from './serviceConfig'
import { CLIENT_ID, getServiceUrl, serviceAvailable } from './serviceConfig'

/** 匿名设备 ID：只用于默认服务的免费额度计数，不包含任何个人信息 */
export async function getDeviceId(): Promise<string> {
  const row = await db.settings.get('device-id')
  if (typeof row?.value === 'string' && row.value) return row.value
  const id = uid('dev').replace(/[^a-zA-Z0-9_-]/g, '')
  await db.settings.put({ key: 'device-id', value: id })
  return id
}

/**
 * 读取已保存的 AI 配置并补全默认值。
 * 迁移：旧版本没有 service 字段——已经填写过 API Key 或代理地址的，视为「使用自己的 API」，
 * 保证升级后原有的聊天方式不受影响。
 * 还没选择过服务的新用户：默认服务已开通时使用默认服务，否则引导使用自己的 API
 * （默认服务未开通时选中它只会得到「尚未开通」，首次使用体验很差）。
 * 已经保存过的选择永远不会被改动。
 */
export function normalizeAIConfig(saved: Partial<AIConfig> | undefined, serviceUrl = getServiceUrl()): AIConfig {
  const cfg: AIConfig = { ...DEFAULT_AI_CONFIG, ...(saved ?? {}) }
  if (!saved?.service) {
    cfg.service = saved && (saved.apiKey?.trim() || saved.proxyUrl?.trim()) ? 'custom' : serviceAvailable(serviceUrl) ? 'lingling' : 'custom'
  }
  return cfg
}

export interface QuotaInfo {
  limit: number
  used: number
  remaining: number
  /** 额度重置时间（ISO） */
  resetAt: string
}

/** 查询默认服务的剩余免费额度；服务未开通或请求失败时返回 null */
export async function fetchQuota(fetchImpl: typeof fetch = fetch): Promise<QuotaInfo | null> {
  const url = getServiceUrl()
  if (!serviceAvailable(url)) return null
  try {
    const res = await fetchImpl(`${url}/v1/quota`, { headers: { 'X-Lingling-Device': await getDeviceId(), 'X-Lingling-Client': CLIENT_ID } })
    if (!res.ok) return null
    return (await res.json()) as QuotaInfo
  } catch {
    return null
  }
}
