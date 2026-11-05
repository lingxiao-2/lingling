import { db } from '../db/db'
import type { FeedbackEntry } from './feedback'

/** 在本机保留最近 50 份自己写过的反馈 */
const KEY = 'feedback-log'

export async function saveFeedbackLocally(e: FeedbackEntry): Promise<void> {
  const row = await db.settings.get(KEY)
  const list = Array.isArray(row?.value) ? (row.value as FeedbackEntry[]) : []
  await db.settings.put({ key: KEY, value: [...list, e].slice(-50) })
}

export async function readFeedbackLog(): Promise<FeedbackEntry[]> {
  const row = await db.settings.get(KEY)
  return Array.isArray(row?.value) ? (row.value as FeedbackEntry[]) : []
}
