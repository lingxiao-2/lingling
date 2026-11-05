import { LinglingDB, DEFAULT_WORLD_ID } from './schema'
import type { AIConfig, UserProfile } from './schema'

export const db = new LinglingDB()

export const DEFAULT_PROFILE: UserProfile = { nickname: '我', signature: '' }

export const DEFAULT_AI_CONFIG: AIConfig = {
  service: 'lingling',
  mode: 'direct',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  proxyUrl: '',
  proxyToken: '',
  model: 'deepseek-flash',
  temperature: 0.8,
  maxTokens: 1024,
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return (row?.value as T | undefined) ?? fallback
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}

/** 首次启动时写入默认世界；可重复调用 */
export async function ensureDefaults(): Promise<void> {
  const exists = await db.worlds.get(DEFAULT_WORLD_ID)
  if (!exists) {
    await db.worlds.put({
      id: DEFAULT_WORLD_ID,
      name: '默认世界',
      description: '',
      createdAt: Date.now(),
    })
  }
}
