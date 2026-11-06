/** 备份与恢复：读写 IndexedDB（纯逻辑见 backup.ts） */
import { db } from '../db/db'
import { DB_SCHEMA_VERSION } from '../db/schema'
import { TABLES, type BackupFile, type Dump, type RestoreMode, type Row, type TableName } from './backup'

const table = (t: TableName) => db.table(t)

export async function dumpAll(): Promise<Dump> {
  const out: Dump = {}
  await db.transaction('r', TABLES.map(table), async () => {
    for (const t of TABLES) out[t] = (await table(t).toArray()) as Row[]
  })
  return out
}

/** 写入恢复数据：在一个事务里完成，任何一步失败都整体回滚，本机数据保持原样 */
export async function applyRestore(rows: Dump, mode: RestoreMode): Promise<number> {
  let n = 0
  await db.transaction('rw', TABLES.map(table), async () => {
    if (mode === 'replace') for (const t of TABLES) await table(t).clear()
    for (const t of TABLES) {
      const list = rows[t]
      if (!list?.length) continue
      await table(t).bulkPut(list)
      n += list.length
    }
  })
  return n
}

export const CURRENT_SCHEMA = DB_SCHEMA_VERSION

/** 保存文件：优先系统分享面板（iPhone 可「存储到文件」），否则下载 */
export async function saveBackupFile(b: BackupFile, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' })
  const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'application/json' }) : null
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (file && nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: name })
      return 'shared'
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelled'
      // 分享失败时改为下载
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 30_000)
  return 'downloaded'
}
