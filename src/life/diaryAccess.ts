/**
 * 为下一阶段（AI 工具调用）预留的日记访问接口。本阶段没有任何 AI 调用这些函数。
 *  - 只返回用户逐篇勾选了「允许 AI 读取」的日记（aiReadable = true）；默认所有日记都不可读
 *  - 最近删除中的日记永远不会返回
 *  - 不会把日记自动变成角色的长期记忆
 */
import { db } from '../db/db'
import { filterDiaries, moodOf, type DiaryFilter } from './diary'

export interface DiaryForAI {
  id: string
  date: string
  title: string
  body: string
  mood?: string
  tags: string[]
}

export async function listReadableDiaries(f: DiaryFilter & { limit?: number } = {}): Promise<DiaryForAI[]> {
  const all = await db.diaries.toArray()
  return filterDiaries(all.filter((d) => d.aiReadable === true), f)
    .slice(0, Math.min(f.limit ?? 20, 50))
    .map((d) => ({ id: d.id, date: d.date, title: d.title, body: d.body, mood: moodOf(d.mood)?.label, tags: d.tags }))
}
