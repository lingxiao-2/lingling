import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'

/** 所有会话的未读数之和（桌面角标、底部导航共用） */
export function useUnreadTotal(): number {
  return useLiveQuery(async () => (await db.conversations.toArray()).reduce((s, c) => s + c.unread, 0), [], 0)
}
