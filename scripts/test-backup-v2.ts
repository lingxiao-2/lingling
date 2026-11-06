/** 备份 v2（PR E）：生活应用数据进入备份、照片原图作为 ZIP 中的独立文件、v1 兼容、替换只清空备份包含的表、损坏 / 缺失文件整体失败不改本机：npm test */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { addPhoto, createAlbum } from '../src/db/photoRepo'
import { saveDiary } from '../src/db/diaryRepo'
import { saveNote } from '../src/db/noteRepo'
import { saveEvent } from '../src/db/eventRepo'
import { createCharacter } from '../src/db/repo'
import { BACKUP_VERSION, buildBackup, planRestore, presentTables, rowsToWrite, type BackupFile } from '../src/services/backup'
import { applyRestore, CURRENT_SCHEMA, dumpAll, estimateBackup, exportBackupBlob, readBackupFile } from '../src/services/backupDb'
import { crc32, writeZip } from '../src/lib/zipWrite'
import { readZip } from '../src/import/extract/zip'

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff)
const prepared = (name: string, n: number, seed: number) => ({ name, blob: new Blob([bytes(n, seed)], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 10, height: 10, thumb: 'data:image/jpeg;base64,AA', originalBytes: n, originalType: 'image/jpeg' })

async function seed() {
  const a = await createAlbum('冬天')
  const p1 = await addPhoto(prepared('初雪', 3000, 1), a.id)
  const p2 = await addPhoto(prepared('窗边', 5000, 2))
  const d = (await saveDiary(null, { title: '初雪', body: '下雪了', photoIds: [p1.id] }))!
  const n = (await saveNote(null, { text: '买花' }))!
  const e = await saveEvent(null, { title: '看雪', kind: 'event', allDay: true, date: '2026-11-06', location: '', note: '', repeat: 'none', diaryIds: [d] })
  const c = await createCharacter({ name: '沈遥', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  return { a, p1, p2, d, n, e, c }
}

async function wipe() {
  for (const t of db.tables) await t.clear()
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('ZIP 写入：CRC 正确，能被已有的 ZIP 读取器读回，中文文件名', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const blob = await writeZip([{ name: 'backup.json', data: new TextEncoder().encode('{"a":1}') }, { name: 'photos/照片', data: new Blob([bytes(100, 3)]) }])
  const entries = readZip(new Uint8Array(await blob.arrayBuffer()))
  assert.deepEqual(entries.map((e) => e.name), ['backup.json', 'photos/照片'])
  assert.deepEqual([...(await entries[1].read())], [...bytes(100, 3)])
})

test('全部备份包含相册、照片信息、日记、便签、日程；照片原图作为 ZIP 中的独立文件；估算体积', async () => {
  const s = await seed()
  const file = buildBackup(await dumpAll(), { schemaVersion: CURRENT_SCHEMA })
  assert.equal(file.version, BACKUP_VERSION)
  for (const t of ['albums', 'photos', 'diaries', 'notes', 'events'] as const) assert.ok(file.tables[t]?.length, `备份包含 ${t}`)
  assert.ok(!JSON.stringify(file.tables).includes('photoBlobs'))
  const est = await estimateBackup(file, true)
  assert.equal(est.photoBytes, 8000)
  assert.equal(est.photoCount, 2)
  const { blob, zip } = await exportBackupBlob(file)
  assert.ok(zip)
  const entries = readZip(new Uint8Array(await blob.arrayBuffer()))
  assert.deepEqual(entries.map((e) => e.name).sort(), ['backup.json', `photos/${s.p1.id}`, `photos/${s.p2.id}`].sort())
  const json = JSON.parse(new TextDecoder().decode(await entries.find((e) => e.name === 'backup.json')!.read()))
  assert.equal(json.photoFiles.length, 2)
  assert.ok(new TextDecoder().decode(await entries.find((e) => e.name === 'backup.json')!.read()).length < 20000, 'JSON 中没有图片数据')
})

test('完整往返：导出 → 清空 → 完全替换恢复后，照片原图、日记关联、便签、日程、角色都一致', async () => {
  const s = await seed()
  const { blob } = await exportBackupBlob(buildBackup(await dumpAll(), { schemaVersion: CURRENT_SCHEMA }))
  await wipe()
  const { file, photoBlobs } = await readBackupFile(blob)
  assert.equal(photoBlobs.size, 2)
  const local = await dumpAll()
  await applyRestore(rowsToWrite(file, local, planRestore(file, local), 'replace'), 'replace', { present: presentTables(file), photoBlobs })
  assert.deepEqual([...new Uint8Array(await (await db.photoBlobs.get(s.p2.id))!.blob.arrayBuffer())], [...bytes(5000, 2)])
  assert.deepEqual((await db.diaries.get(s.d))!.photoIds, [s.p1.id])
  assert.deepEqual((await db.events.get(s.e))!.diaryIds, [s.d])
  assert.equal((await db.notes.get(s.n))!.text, '买花')
  assert.equal((await db.albums.get(s.a.id))!.name, '冬天')
  assert.equal((await db.characters.get(s.c.id))!.name, '沈遥')
})

test('不含照片的备份：是 JSON，不带照片信息；恢复时不会清空本机相册', async () => {
  await seed()
  const file = buildBackup(await dumpAll(), { schemaVersion: CURRENT_SCHEMA, includePhotos: false })
  assert.equal(file.tables.photos, undefined)
  const { blob, zip } = await exportBackupBlob(file)
  assert.equal(zip, false)
  const parsed = await readBackupFile(blob)
  const local = await dumpAll()
  await applyRestore(rowsToWrite(parsed.file, local, planRestore(parsed.file, local), 'replace'), 'replace', { present: presentTables(parsed.file), photoBlobs: parsed.photoBlobs })
  assert.equal(await db.photos.count(), 2, '本机照片还在')
  assert.equal(await db.photoBlobs.count(), 2)
})

test('旧版（v1）备份：仍能读取；完全替换时不会清空它没有的生活应用数据', async () => {
  await seed()
  const v1: BackupFile = { format: 'lingling-backup', version: 1, schemaVersion: 4, exportedAt: 1, scope: 'all', includesSecrets: false, tables: { characters: [{ id: 'old', name: '旧角色', updatedAt: 1 }] } }
  const { file } = await readBackupFile(new Blob([JSON.stringify(v1)]))
  const local = await dumpAll()
  await applyRestore(rowsToWrite(file, local, planRestore(file, local), 'replace'), 'replace', { present: presentTables(file) })
  assert.deepEqual((await db.characters.toArray()).map((c) => c.name), ['旧角色'], '备份包含的表被替换')
  assert.equal(await db.diaries.count(), 1, '日记没有被清空')
  assert.equal(await db.photos.count(), 2)
  assert.equal(await db.notes.count(), 1)
  assert.equal(await db.events.count(), 1)
})

test('合并（保留本机）：本机已有的照片原图不会被备份覆盖', async () => {
  const s = await seed()
  const { blob } = await exportBackupBlob(buildBackup(await dumpAll(), { schemaVersion: CURRENT_SCHEMA }))
  await db.photoBlobs.put({ id: s.p1.id, blob: new Blob([bytes(10, 9)]) })
  const { file, photoBlobs } = await readBackupFile(blob)
  const local = await dumpAll()
  await applyRestore(rowsToWrite(file, local, planRestore(file, local), 'merge-keep'), 'merge-keep', { present: presentTables(file), photoBlobs })
  assert.equal((await db.photoBlobs.get(s.p1.id))!.blob.size, 10)
})

test('损坏或不完整的备份：明确报错，本机数据不变；恢复中途失败整体回滚', async () => {
  const s = await seed()
  const { blob } = await exportBackupBlob(buildBackup(await dumpAll(), { schemaVersion: CURRENT_SCHEMA }))
  const buf = new Uint8Array(await blob.arrayBuffer())
  await assert.rejects(readBackupFile(new Blob([buf.slice(0, buf.length - 30)])), /损坏|不是聆聆备份/)
  // 缺少一张照片文件
  const entries = readZip(buf)
  const json = await entries.find((e) => e.name === 'backup.json')!.read()
  const missing = await writeZip([{ name: 'backup.json', data: json }, { name: `photos/${s.p1.id}`, data: await entries.find((e) => e.name === `photos/${s.p1.id}`)!.read() }])
  await assert.rejects(readBackupFile(missing), /不完整/)
  // 写入时出错：整个事务回滚
  const before = await db.diaries.count()
  const { file, photoBlobs } = await readBackupFile(blob)
  const local = await dumpAll()
  const rows = rowsToWrite(file, local, planRestore(file, local), 'replace')
  rows.notes = [{ id: undefined as unknown as string }]
  await assert.rejects(applyRestore(rows, 'replace', { present: presentTables(file), photoBlobs }))
  assert.equal(await db.diaries.count(), before, '失败后本机数据保持原样')
  assert.equal(await db.photoBlobs.count(), 2)
})

test('来自更新版本的备份会被拒绝', async () => {
  const future = { format: 'lingling-backup', version: 99, schemaVersion: 1, exportedAt: 1, scope: 'all', includesSecrets: false, tables: {} }
  await assert.rejects(readBackupFile(new Blob([JSON.stringify(future)])), /更新版本/)
})
