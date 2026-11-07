/**
 * 备份与恢复（.lingling 文件，内容为 JSON）。
 *
 *  导出：全部数据，或单个角色（角色 + 单聊记录 + 记忆 + 关联的世界 / 世界书 + 聊天中用到的表情包）
 *    - 默认不包含 API Key、代理口令等凭证（AI 服务设置中的这些字段被清空）
 *  恢复：先预览（每类数据：新增 / 已存在且相同 / 冲突），再选择方式：
 *    - merge-keep：只添加本机没有的数据；冲突时保留本机版本（默认，最安全）
 *    - merge-overwrite：添加新数据；冲突时用备份覆盖本机版本
 *    - replace：清空本机后整体恢复（需要用户再次确认）
 *    - 表情包按图片哈希去重：本机已有同一张图时不重复保存，聊天记录中的引用改指向本机那一张
 *    - 备份文件来自更新版本的聆聆（数据结构更新）时拒绝恢复，避免写坏数据
 *  纯函数部分不依赖 IndexedDB，便于测试；读写数据库见 backupDb.ts。
 */
import type { AIConfig } from '../db/schema'

export const BACKUP_FORMAT = 'lingling-backup'
/** 1：纯 JSON · 2：可以是 ZIP（backup.json + photos/ 下的照片原图文件）；v2 仍能读取 v1 */
export const BACKUP_VERSION = 2

/** 参与备份的表与主键 */
export const TABLE_KEYS = {
  characters: 'id',
  conversations: 'id',
  messages: 'id',
  messageVersions: 'id',
  memories: 'id',
  moments: 'id',
  stickers: 'id',
  stickerImages: 'id',
  stickerAnalyses: 'hash',
  worlds: 'id',
  settings: 'key',
  lorebooks: 'id',
  characterLorebooks: 'id',
  worldLorebooks: 'id',
  albums: 'id',
  photos: 'id',
  diaries: 'id',
  notes: 'id',
  events: 'id',
  // 第八阶段
  tracks: 'id',
  playlists: 'id',
  timers: 'id',
  letters: 'id',
  giftRecords: 'id',
  tarotReadings: 'id',
} as const

export type TableName = keyof typeof TABLE_KEYS
export const TABLES = Object.keys(TABLE_KEYS) as TableName[]
export type Row = Record<string, unknown>
export type Dump = Partial<Record<TableName, Row[]>>

export const TABLE_LABEL: Record<TableName, string> = {
  characters: '角色',
  conversations: '会话',
  messages: '聊天消息',
  messageVersions: '消息历史版本',
  memories: '记忆',
  moments: '动态',
  stickers: '表情包',
  stickerImages: '表情包原图',
  stickerAnalyses: '识图结果',
  worlds: '世界',
  settings: '设置',
  lorebooks: '世界书',
  characterLorebooks: '角色与世界书关联',
  worldLorebooks: '世界与世界书关联',
  albums: '相册',
  photos: '照片',
  diaries: '日记',
  notes: '便签',
  events: '日程',
  tracks: '音乐',
  playlists: '歌单',
  timers: '计时记录',
  letters: '信件',
  giftRecords: '礼物记录',
  tarotReadings: '塔罗记录',
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  /** 导出时的数据库结构版本 */
  schemaVersion: number
  exportedAt: number
  scope: 'all' | 'character'
  /** 单角色导出时的角色名 */
  characterName?: string
  includesSecrets: boolean
  tables: Dump
  /** v2：随备份一起保存的照片原图文件（ZIP 中 photos/ 目录下）；没有时表示备份不含照片原图 */
  photoFiles?: { id: string; path: string; bytes: number; mime: string }[]
  /** 随备份一起保存的音乐文件（ZIP 中 music/ 目录下）；没有时表示备份不含音乐 */
  musicFiles?: { id: string; path: string; bytes: number; mime: string }[]
}

export class BackupError extends Error {}

const SECRET_FIELDS: (keyof AIConfig)[] = ['apiKey', 'proxyToken']

/** 去掉凭证：AI 服务的 API Key / 代理口令，表情包图片代理的口令 */
export function stripSecrets(settings: Row[]): Row[] {
  return settings.map((r) => {
    if (r.key === 'ai-config' && r.value && typeof r.value === 'object') {
      const v = { ...(r.value as Record<string, unknown>) }
      for (const f of SECRET_FIELDS) if (v[f]) v[f] = ''
      return { ...r, value: v }
    }
    if (r.key === 'link-proxy' && r.value && typeof r.value === 'object') return { ...r, value: { ...(r.value as Record<string, unknown>), token: '' } }
    return r
  })
}

export function buildBackup(dump: Dump, opts: { schemaVersion: number; includeSecrets?: boolean; includePhotos?: boolean; includeMusic?: boolean; now?: number }): BackupFile {
  const tables: Dump = {}
  for (const t of TABLES) {
    // 不含照片的备份：照片信息也不放进去（只有信息没有原图的照片会让人误以为照片还在）
    if (t === 'photos' && opts.includePhotos === false) continue
    // 不含音乐的备份：歌曲信息和歌单也不放进去（恢复时本机的音乐不会被动到）
    if ((t === 'tracks' || t === 'playlists') && opts.includeMusic === false) continue
    const rows = dump[t] ?? []
    // 全部数据备份也记下空表：这样「替换」恢复时，备份里明确为空的表会被清空，备份里根本没有的表（例如不含照片）不会被动到
    if (!rows.length) {
      tables[t] = []
      continue
    }
    tables[t] = t === 'settings' && !opts.includeSecrets ? stripSecrets(rows) : rows
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaVersion: opts.schemaVersion, exportedAt: opts.now ?? Date.now(), scope: 'all', includesSecrets: !!opts.includeSecrets, tables }
}

/** 单角色导出：只挑出与这个角色相关的数据 */
export function pickCharacter(dump: Dump, characterId: string, opts: { schemaVersion: number; now?: number }): BackupFile {
  const ch = (dump.characters ?? []).find((c) => c.id === characterId)
  if (!ch) throw new BackupError('角色不存在')
  const convs = (dump.conversations ?? []).filter((c) => c.type === 'single' && Array.isArray(c.characterIds) && (c.characterIds as string[]).length === 1 && (c.characterIds as string[])[0] === characterId)
  const convIds = new Set(convs.map((c) => c.id))
  const messages = (dump.messages ?? []).filter((m) => convIds.has(m.conversationId as string))
  const msgIds = new Set(messages.map((m) => m.id))
  const links = (dump.characterLorebooks ?? []).filter((l) => l.characterId === characterId)
  const world = (dump.worlds ?? []).filter((w) => w.id === ch.worldId)
  const worldLinks = (dump.worldLorebooks ?? []).filter((l) => l.worldId === ch.worldId)
  const bookIds = new Set([...links, ...worldLinks].map((l) => l.lorebookId))
  const stickerIds = new Set(messages.map((m) => m.stickerId).filter(Boolean))
  const stickers = (dump.stickers ?? []).filter((s) => stickerIds.has(s.id))
  const hashes = new Set(stickers.map((s) => s.hash).filter(Boolean))
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: opts.schemaVersion,
    exportedAt: opts.now ?? Date.now(),
    scope: 'character',
    characterName: ch.name as string,
    includesSecrets: false,
    tables: {
      characters: [ch],
      conversations: convs,
      messages,
      messageVersions: (dump.messageVersions ?? []).filter((v) => msgIds.has(v.messageId as string)),
      memories: (dump.memories ?? []).filter((m) => m.characterId === characterId),
      worlds: world,
      worldLorebooks: worldLinks,
      characterLorebooks: links,
      lorebooks: (dump.lorebooks ?? []).filter((b) => bookIds.has(b.id)),
      stickers,
      stickerImages: (dump.stickerImages ?? []).filter((i) => stickerIds.has(i.id)),
      stickerAnalyses: (dump.stickerAnalyses ?? []).filter((a) => hashes.has(a.hash)),
      // 与这个角色关联的纪念日 / 生日
      events: (dump.events ?? []).filter((e) => e.characterId === characterId),
      // 与这个角色之间的信件和礼物（只包括这个角色的）
      letters: (dump.letters ?? []).filter((l) => l.characterId === characterId),
      giftRecords: (dump.giftRecords ?? []).filter((g) => g.characterId === characterId),
    },
  }
}

/** 读取并校验备份文件 */
export function parseBackup(text: string, currentSchema: number): BackupFile {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    throw new BackupError('文件不是聆聆备份（无法解析）')
  }
  const b = j as Partial<BackupFile>
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object' || !b.tables) throw new BackupError('文件不是聆聆备份')
  if ((b.version ?? 0) > BACKUP_VERSION || (b.schemaVersion ?? 0) > currentSchema) {
    throw new BackupError('这个备份来自更新版本的聆聆，当前版本无法安全恢复。请先刷新页面更新聆聆再试')
  }
  const tables: Dump = {}
  for (const t of TABLES) {
    const rows = (b.tables as Dump)[t]
    if (rows === undefined) continue
    if (!Array.isArray(rows)) throw new BackupError(`备份中「${TABLE_LABEL[t]}」的格式不正确`)
    const key = TABLE_KEYS[t]
    for (const r of rows) if (!r || typeof r !== 'object' || typeof (r as Row)[key] !== 'string' || !(r as Row)[key]) throw new BackupError(`备份中「${TABLE_LABEL[t]}」有损坏的记录`)
    tables[t] = rows
  }
  return { ...(b as BackupFile), tables }
}

export type RestoreMode = 'merge-keep' | 'merge-overwrite' | 'replace'

export interface TablePlan {
  table: TableName
  added: number
  same: number
  conflicts: number
  /** 表情包：本机已有同一张图（按哈希），不重复保存 */
  dedup: number
}

export interface RestorePlan {
  tables: TablePlan[]
  /** 备份中的表情包 id → 本机已有的同图表情包 id */
  stickerRemap: Map<string, string>
}

const same = (a: Row, b: Row) => JSON.stringify(a) === JSON.stringify(b)

/** 对比备份与本机数据，生成预览 */
export function planRestore(backup: BackupFile, local: Dump): RestorePlan {
  const stickerRemap = new Map<string, string>()
  const localByHash = new Map((local.stickers ?? []).filter((s) => s.hash).map((s) => [s.hash as string, s.id as string]))
  const localStickerIds = new Set((local.stickers ?? []).map((s) => s.id as string))
  for (const s of backup.tables.stickers ?? []) {
    const id = s.id as string
    const existing = s.hash ? localByHash.get(s.hash as string) : undefined
    if (existing && existing !== id && !localStickerIds.has(id)) stickerRemap.set(id, existing)
  }
  const tables: TablePlan[] = []
  for (const t of TABLES) {
    const rows = backup.tables[t]
    if (!rows?.length) continue
    const key = TABLE_KEYS[t]
    const mine = new Map((local[t] ?? []).map((r) => [r[key] as string, r]))
    const p: TablePlan = { table: t, added: 0, same: 0, conflicts: 0, dedup: 0 }
    for (const r of rows) {
      if ((t === 'stickers' || t === 'stickerImages') && stickerRemap.has(r.id as string)) {
        p.dedup++
        continue
      }
      const cur = mine.get(r[key] as string)
      if (!cur) p.added++
      else if (same(cur, r)) p.same++
      else p.conflicts++
    }
    tables.push(p)
  }
  return { tables, stickerRemap }
}

/** 按方式算出要写入的行（每张表：要 put 的行；replace 时调用方先清空） */
export function rowsToWrite(backup: BackupFile, local: Dump, plan: RestorePlan, mode: RestoreMode): Dump {
  const out: Dump = {}
  for (const t of TABLES) {
    const rows = backup.tables[t]
    if (!rows?.length) continue
    const key = TABLE_KEYS[t]
    const mine = new Set((local[t] ?? []).map((r) => r[key] as string))
    let list = rows
    if (t === 'stickers' || t === 'stickerImages') list = list.filter((r) => !plan.stickerRemap.has(r.id as string))
    if (t === 'messages' && plan.stickerRemap.size) {
      list = list.map((m) => (m.stickerId && plan.stickerRemap.has(m.stickerId as string) ? { ...m, stickerId: plan.stickerRemap.get(m.stickerId as string) } : m))
    }
    // 恢复时永远不用备份中空的凭证覆盖本机已填写的 API Key
    if (t === 'settings' && !backup.includesSecrets) {
      const localSettings = new Map((local.settings ?? []).map((r) => [r.key as string, r]))
      list = list.map((r) => {
        const cur = localSettings.get(r.key as string)
        if (!cur || typeof r.value !== 'object' || typeof cur.value !== 'object' || !r.value || !cur.value) return r
        if (r.key === 'ai-config') {
          const v = { ...(r.value as Record<string, unknown>) }
          for (const f of SECRET_FIELDS) if (!v[f]) v[f] = (cur.value as Record<string, unknown>)[f] ?? ''
          return { ...r, value: v }
        }
        if (r.key === 'link-proxy') return { ...r, value: { ...(r.value as Record<string, unknown>), token: (r.value as Record<string, unknown>).token || (cur.value as Record<string, unknown>).token || '' } }
        return r
      })
    }
    if (mode === 'merge-keep') list = list.filter((r) => !mine.has(r[key] as string))
    if (list.length) out[t] = list
  }
  return out
}

/** 备份中实际包含的表（恢复为「替换」时只清空这些表；旧版备份里没有的生活应用数据不会被清空） */
export function presentTables(b: BackupFile): TableName[] {
  return TABLES.filter((t) => Array.isArray(b.tables[t]))
}

export function summarize(b: BackupFile): { table: TableName; count: number }[] {
  return TABLES.filter((t) => b.tables[t]?.length).map((t) => ({ table: t, count: b.tables[t]!.length }))
}

export function backupFileName(b: BackupFile, now = new Date(b.exportedAt)): string {
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const who = b.scope === 'character' ? `-${(b.characterName ?? '角色').replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20)}` : ''
  return `聆聆备份${who}-${d}.lingling`
}
