/** 备份与恢复：读写 IndexedDB（纯逻辑见 backup.ts） */
import { db } from '../db/db'
import { DB_SCHEMA_VERSION } from '../db/schema'
import { BackupError, parseBackup, presentTables, TABLES, type BackupFile, type Dump, type RestoreMode, type Row, type TableName } from './backup'
import { writeZip, type ZipInput } from '../lib/zipWrite'
import { readZip, type ZipLimits } from '../import/extract/zip'

/** 照片原图在 ZIP 中的路径 */
export const photoPath = (id: string) => `photos/${id}`
/** 音乐文件在 ZIP 中的路径 */
export const musicPath = (id: string) => `music/${id}`

/** 备份 ZIP 的读取上限（防止损坏或伪造的文件耗尽内存） */
export const BACKUP_ZIP_LIMITS: ZipLimits = { maxEntries: 60000, maxEntryBytes: 60 * 1024 * 1024, maxTotalBytes: 1500 * 1024 * 1024, maxRatio: 400 }
/** 超过这个大小时提醒：iPhone 上一次读入内存可能失败 */
export const LARGE_BACKUP_BYTES = 300 * 1024 * 1024

const table = (t: TableName) => db.table(t)

export async function dumpAll(): Promise<Dump> {
  const out: Dump = {}
  await db.transaction('r', TABLES.map(table), async () => {
    for (const t of TABLES) out[t] = (await table(t).toArray()) as Row[]
  })
  return out
}

export interface RestoreExtras {
  /** 备份中实际包含的表：替换时只清空这些（旧版备份里没有的生活应用数据不会被清空）。不传时清空全部（兼容旧调用） */
  present?: TableName[]
  /** 随备份一起的照片原图（照片 ID → Blob） */
  photoBlobs?: Map<string, Blob>
  /** 随备份一起的音乐文件（歌曲 ID → Blob） */
  musicBlobs?: Map<string, Blob>
}

/** 写入恢复数据：在一个事务里完成，任何一步失败都整体回滚，本机数据保持原样 */
export async function applyRestore(rows: Dump, mode: RestoreMode, extras: RestoreExtras = {}): Promise<number> {
  let n = 0
  const present = extras.present ?? TABLES
  await db.transaction('rw', [...TABLES.map(table), db.photoBlobs, db.trackBlobs], async () => {
    if (mode === 'replace') {
      for (const t of present) await table(t).clear()
      // 照片信息被替换时，原图也一起替换，避免留下没有信息的原图；音乐同理
      if (present.includes('photos')) await db.photoBlobs.clear()
      if (present.includes('tracks')) await db.trackBlobs.clear()
    }
    for (const t of TABLES) {
      const list = rows[t]
      if (!list?.length) continue
      await table(t).bulkPut(list)
      n += list.length
    }
    // 只写入这次实际写入了照片信息的原图（「合并并保留本机」时，本机已有的照片不会被覆盖）
    const written = new Set((rows.photos ?? []).map((p) => p.id as string))
    const blobs = [...(extras.photoBlobs ?? new Map()).entries()].filter(([id]) => written.has(id)).map(([id, blob]) => ({ id, blob }))
    if (blobs.length) await db.photoBlobs.bulkPut(blobs)
    const writtenTracks = new Set((rows.tracks ?? []).map((t) => t.id as string))
    const music = [...(extras.musicBlobs ?? new Map()).entries()].filter(([id]) => writtenTracks.has(id)).map(([id, blob]) => ({ id, blob }))
    if (music.length) await db.trackBlobs.bulkPut(music)
  })
  return n
}

/** 估算备份大小（字节）：JSON 部分 + 照片原图 + 音乐文件 */
export async function estimateBackup(file: BackupFile, includePhotos: boolean): Promise<{ jsonBytes: number; photoBytes: number; photoCount: number; musicBytes: number; musicCount: number }> {
  const jsonBytes = new Blob([JSON.stringify(file)]).size
  const photos = includePhotos ? ((file.tables.photos ?? []) as Row[]) : []
  const tracks = (file.tables.tracks ?? []) as Row[]
  return {
    jsonBytes,
    photoBytes: photos.reduce((n, p) => n + (Number(p.bytes) || 0), 0),
    photoCount: photos.length,
    musicBytes: tracks.reduce((n, t) => n + (Number(t.bytes) || 0), 0),
    musicCount: tracks.length,
  }
}

/**
 * 生成备份文件：没有照片原图时是 JSON；有照片时是 ZIP（backup.json + photos/<id>），照片逐张读取，
 * 不会把所有图片塞进一条 JSON。
 */
export async function exportBackupBlob(file: BackupFile): Promise<{ blob: Blob; zip: boolean }> {
  const photos = (file.tables.photos ?? []) as Row[]
  const tracks = (file.tables.tracks ?? []) as Row[]
  if (!photos.length && !tracks.length) return { blob: new Blob([JSON.stringify(file)], { type: 'application/json' }), zip: false }
  const entries: ZipInput[] = []
  const manifest: NonNullable<BackupFile['photoFiles']> = []
  for (const p of photos) {
    const b = (await db.photoBlobs.get(p.id as string))?.blob
    if (!b) continue
    manifest.push({ id: p.id as string, path: photoPath(p.id as string), bytes: b.size, mime: b.type || String(p.mime) })
    entries.push({ name: photoPath(p.id as string), data: b })
  }
  const music: NonNullable<BackupFile['musicFiles']> = []
  for (const t of tracks) {
    const b = (await db.trackBlobs.get(t.id as string))?.blob
    if (!b) continue
    music.push({ id: t.id as string, path: musicPath(t.id as string), bytes: b.size, mime: b.type || String(t.mime) })
    entries.push({ name: musicPath(t.id as string), data: b })
  }
  const json = new TextEncoder().encode(JSON.stringify({ ...file, photoFiles: manifest, musicFiles: music }))
  return { blob: await writeZip([{ name: 'backup.json', data: json }, ...entries]), zip: true }
}

/** 读取备份文件（JSON 或 ZIP），校验后返回备份内容与照片原图 */
export async function readBackupFile(f: Blob, currentSchema = CURRENT_SCHEMA): Promise<{ file: BackupFile; photoBlobs: Map<string, Blob>; musicBlobs: Map<string, Blob> }> {
  const head = new Uint8Array(await f.slice(0, 4).arrayBuffer())
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
  if (!isZip) return { file: parseBackup(await f.text(), currentSchema), photoBlobs: new Map(), musicBlobs: new Map() }
  if (f.size > BACKUP_ZIP_LIMITS.maxTotalBytes) throw new BackupError('备份文件太大，无法在这台设备上一次读取')
  let entries
  try {
    entries = readZip(new Uint8Array(await f.arrayBuffer()), BACKUP_ZIP_LIMITS)
  } catch (e) {
    throw new BackupError(`备份文件已损坏：${e instanceof Error ? e.message : String(e)}`)
  }
  const jsonEntry = entries.find((e) => e.name === 'backup.json')
  if (!jsonEntry) throw new BackupError('文件不是聆聆备份（缺少 backup.json）')
  const file = parseBackup(new TextDecoder().decode(await jsonEntry.read()), currentSchema)
  const photoBlobs = new Map<string, Blob>()
  const byName = new Map(entries.map((e) => [e.name, e]))
  const known = new Set(((file.tables.photos ?? []) as Row[]).map((p) => p.id as string))
  for (const m of file.photoFiles ?? []) {
    if (!known.has(m.id)) continue
    const e = byName.get(m.path)
    if (!e) throw new BackupError(`备份文件不完整：缺少照片「${m.id}」`)
    const bytes = await e.read()
    if (bytes.length !== m.bytes) throw new BackupError(`备份文件已损坏：照片「${m.id}」大小不一致`)
    photoBlobs.set(m.id, new Blob([bytes], { type: m.mime }))
  }
  const musicBlobs = new Map<string, Blob>()
  const knownTracks = new Set(((file.tables.tracks ?? []) as Row[]).map((t) => t.id as string))
  for (const m of file.musicFiles ?? []) {
    if (!knownTracks.has(m.id)) continue
    const e = byName.get(m.path)
    if (!e) throw new BackupError(`备份文件不完整：缺少音乐「${m.id}」`)
    const bytes = await e.read()
    if (bytes.length !== m.bytes) throw new BackupError(`备份文件已损坏：音乐「${m.id}」大小不一致`)
    musicBlobs.set(m.id, new Blob([bytes], { type: m.mime }))
  }
  return { file, photoBlobs, musicBlobs }
}

export { presentTables }

export const CURRENT_SCHEMA = DB_SCHEMA_VERSION

/** 保存文件：优先系统分享面板（iPhone 可「存储到文件」），否则下载 */
export async function saveBackupFile(b: BackupFile | Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = b instanceof Blob ? b : new Blob([JSON.stringify(b)], { type: 'application/json' })
  const file = typeof File !== 'undefined' ? new File([blob], name, { type: blob.type || 'application/octet-stream' }) : null
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
