/**
 * 工具执行记录：时间、角色、工具、确认状态、结果、错误、耗时。
 * 只记录简短说明（条数、ID），从不记录 API Key、请求内容、日记正文、照片或便签正文。
 * 最多保留 MAX_LOGS 条；用户可以在「AI 工具权限」中查看和清空。这张表不进入备份。
 */
import { db } from '../db/db'
import type { ToolLog } from '../db/schema'
import { uid } from '../lib/util'

export const MAX_LOGS = 500

/** 去掉看起来像密钥的内容，并限制长度 */
export function scrub(text: string, max = 160): string {
  return text
    .replace(/(sk|key|token|bearer)[-_ ]?[a-z0-9]{8,}/gi, '[已隐藏]')
    .replace(/[A-Za-z0-9+/_-]{32,}/g, '[已隐藏]')
    .replace(/\s+/g, ' ')
    .slice(0, max)
}

export async function logToolCall(entry: Omit<ToolLog, 'id' | 'at'> & { at?: number }): Promise<void> {
  try {
    await db.toolLogs.add({ ...entry, id: uid('tlog'), at: entry.at ?? Date.now(), summary: scrub(entry.summary), error: entry.error ? scrub(entry.error) : undefined })
    const n = await db.toolLogs.count()
    if (n > MAX_LOGS) {
      const old = await db.toolLogs.orderBy('at').limit(n - MAX_LOGS).primaryKeys()
      await db.toolLogs.bulkDelete(old)
    }
  } catch {
    /* 记录失败不影响工具结果本身 */
  }
}

export async function listToolLogs(opts: { characterId?: string; limit?: number } = {}): Promise<ToolLog[]> {
  const all = await db.toolLogs.orderBy('at').reverse().toArray()
  return all.filter((l) => !opts.characterId || l.characterId === opts.characterId).slice(0, opts.limit ?? MAX_LOGS)
}

export async function clearToolLogs(characterId?: string): Promise<void> {
  if (characterId) await db.toolLogs.where('characterId').equals(characterId).delete()
  else await db.toolLogs.clear()
}
