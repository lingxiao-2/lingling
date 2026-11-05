import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_AI_CONFIG, DEFAULT_PROFILE, setSetting } from '../db/db'
import type { AIConfig, UserProfile } from '../db/schema'
import { normalizeAIConfig } from '../services/ai/service'

async function readProfile(): Promise<UserProfile> {
  return { ...DEFAULT_PROFILE, ...(((await db.settings.get('profile'))?.value as Partial<UserProfile> | undefined) ?? {}) }
}

async function readAIConfig(): Promise<AIConfig> {
  return normalizeAIConfig((await db.settings.get('ai-config'))?.value as Partial<AIConfig> | undefined)
}

/** 以下 hook 直接订阅 IndexedDB，刷新页面后数据保持不变。读取完成前返回默认值，适合展示。 */
export function useProfile(): UserProfile {
  return useLiveQuery(readProfile, [], DEFAULT_PROFILE)
}

export function useAIConfig(): AIConfig {
  return useLiveQuery(readAIConfig, [], DEFAULT_AI_CONFIG)
}

/** 编辑表单用：读取完成前返回 undefined，避免用默认值覆盖已保存的数据 */
export function useProfileLoaded(): UserProfile | undefined {
  return useLiveQuery(readProfile, [])
}

export function useAIConfigLoaded(): AIConfig | undefined {
  return useLiveQuery(readAIConfig, [])
}

/** 只更新个人资料中的部分字段（例如在「我的」页直接换头像） */
export async function updateProfile(patch: Partial<UserProfile>): Promise<void> {
  await setSetting('profile', { ...(await readProfile()), ...patch })
}
