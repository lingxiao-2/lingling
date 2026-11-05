import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_AI_CONFIG, DEFAULT_PROFILE } from '../db/db'
import type { AIConfig, UserProfile } from '../db/schema'

/** 以下两个 hook 直接订阅 IndexedDB，刷新页面后数据保持不变 */
export function useProfile(): UserProfile {
  return useLiveQuery(
    async () => ((await db.settings.get('profile'))?.value as UserProfile | undefined) ?? DEFAULT_PROFILE,
    [],
    DEFAULT_PROFILE,
  )
}

export function useAIConfig(): AIConfig {
  return useLiveQuery(
    async () => ({
      ...DEFAULT_AI_CONFIG,
      ...(((await db.settings.get('ai-config'))?.value as Partial<AIConfig> | undefined) ?? {}),
    }),
    [],
    DEFAULT_AI_CONFIG,
  )
}
