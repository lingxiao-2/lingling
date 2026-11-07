/**
 * 第八阶段 PR G：新应用的数据进入备份与恢复（音乐文件作为 ZIP 中的独立文件、可以不含音乐、旧备份不清空新数据、
 * 单角色导出只含这个角色的信件与礼物、执行记录类数据不进入备份）：npm test
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { createCharacter } from '../src/db/repo'
import { addTrack, addToPlaylist, createPlaylist, getTrackBlob } from '../src/db/musicRepo'
import { createTimer } from '../src/clock/timers'
import { receiveLetter, saveDraft, sendDraft } from '../src/db/letterRepo'
import { newReading } from '../src/tarot/readings'
import { buildBackup, pickCharacter, planRestore, presentTables, rowsToWrite, TABLES, type BackupFile } from '../src/services/backup'
import { applyRestore, CURRENT_SCHEMA, dumpAll, estimateBackup, exportBackupBlob, readBackupFile } from '../src/services/backupDb'
import { uid } from '../src/lib/util'

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 17 + seed) & 0xff)
async function seed() {
  const a = await createCharacter({ name: '沈星回', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  const b = await createCharacter({ name: '林小满', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  const t = await addTrack({ title: '初雪', artist: '乐队', album: '', duration: 3, mime: 'audio/wav', bytes: 4000, fileName: '初雪.wav' }, new Blob([bytes(4000, 1)], { type: 'audio/wav' }))
  const pl = await createPlaylist('冬天')
  await addToPlaylist(pl.id, [t.id])
  await createTimer('泡茶', 60_000)
  await sendDraft(await saveDraft(null, { characterId: a.id, subject: '给沈星回', body: '你好' }))
  await receiveLetter({ characterId: b.id, subject: '来自小满', body: '嘿！今天店里好忙', paper: 'snow', model: 'm' })
  await db.giftRecords.add({ id: uid('gift'), characterId: a.id, direction: 'to_character', giftId: 'rose', message: '', starred: false, createdAt: 1, replyStatus: 'done', reply: '谢谢' })
  await db.giftRecords.add({ id: uid('gift'), characterId: b.id, direction: 'to_character', giftId: 'cake', message: '', starred: false, createdAt: 2 })
  await newReading('single', '今天', 'ice')
  await db.toolLogs.add({ id: 'log1', at: 1, characterId: a.id, tool: 'calendar.list_events', confirmation: 'once', status: 'ok', summary: '', durationMs: 1 })
  await db.shortcutRuns.add({ id: 'run1', nonce: 'abcdefabcdef', kind: 'test', title: 't', lines: [], url: 'shortcuts://x', status: 'confirmed', source: 'settings', dedupeKey: 'k', createdAt: 1, updatedAt: 1 })
  return { a, b, t, pl }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('全部备份包含音乐、歌单、计时、信件、礼物、塔罗；执行记录与快捷指令运行记录不进入备份', async () => {
  await seed()
  const file = buildBackup(await dumpAll(), { schemaVersion: CURRENT_SCHEMA })
  for (const t of ['tracks', 'playlists', 'timers', 'letters', 'giftRecords', 'tarotReadings'] as const) assert.ok(file.tables[t]?.length, `备份包含 ${t}`)
  assert.ok(!TABLES.includes('toolLogs' as never) && !TABLES.includes('shortcutRuns' as never) && !TABLES.includes('trackBlobs' as never))
  assert.ok(!JSON.stringify(file.tables).includes('calendar.list_events'))
  const est = await estimateBackup(file, true)
  assert.deepEqual([est.musicCount, est.musicBytes], [1, 4000])
})

test('音乐文件作为 ZIP 中的独立文件，读回后与原文件完全一致；替换恢复后音乐可以播放（文件还在）', async () => {
  const { t, pl } = await seed()
  const file = buildBackup(await dumpAll(), { schemaVersion: CURRENT_SCHEMA })
  const out = await exportBackupBlob(file)
  assert.equal(out.zip, true)
  const back = await readBackupFile(out.blob, CURRENT_SCHEMA)
  assert.equal(back.musicBlobs.size, 1)
  assert.deepEqual([...new Uint8Array(await back.musicBlobs.get(t.id)!.arrayBuffer())], [...bytes(4000, 1)])
  assert.equal(back.file.musicFiles![0].path, `music/${t.id}`)
  for (const x of db.tables) await x.clear()
  const rows = rowsToWrite(back.file, await dumpAll(), planRestore(back.file, await dumpAll()), 'replace')
  await applyRestore(rows, 'replace', { present: presentTables(back.file), photoBlobs: back.photoBlobs, musicBlobs: back.musicBlobs })
  assert.equal((await getTrackBlob(t.id))!.size, 4000)
  assert.deepEqual((await db.playlists.get(pl.id))!.trackIds, [t.id])
  assert.equal(await db.letters.count(), 2)
  assert.equal(await db.tarotReadings.count(), 1)
})

test('不含音乐的备份：歌曲与歌单都不放进去；替换恢复时本机音乐不受影响', async () => {
  const { t } = await seed()
  const file = buildBackup(await dumpAll(), { schemaVersion: CURRENT_SCHEMA, includeMusic: false })
  assert.equal(file.tables.tracks, undefined)
  assert.equal(file.tables.playlists, undefined)
  assert.ok(file.tables.letters?.length)
  const out = await exportBackupBlob(file)
  const back = await readBackupFile(out.blob, CURRENT_SCHEMA)
  assert.equal(back.musicBlobs.size, 0)
  const rows = rowsToWrite(back.file, await dumpAll(), planRestore(back.file, await dumpAll()), 'replace')
  await applyRestore(rows, 'replace', { present: presentTables(back.file), musicBlobs: back.musicBlobs })
  assert.ok(await db.tracks.get(t.id))
  assert.equal((await getTrackBlob(t.id))!.size, 4000, '本机音乐文件还在')
})

test('第七阶段的旧备份（没有新应用的表）：替换恢复不会清空信件、音乐、礼物、塔罗', async () => {
  await seed()
  const old: BackupFile = { format: 'lingling-backup', version: 2, schemaVersion: 10, exportedAt: 1, scope: 'all', includesSecrets: false, tables: { characters: [], notes: [] } }
  const rows = rowsToWrite(old, await dumpAll(), planRestore(old, await dumpAll()), 'replace')
  await applyRestore(rows, 'replace', { present: presentTables(old) })
  assert.equal(await db.letters.count(), 2)
  assert.equal(await db.tracks.count(), 1)
  assert.equal(await db.giftRecords.count(), 2)
  assert.equal(await db.tarotReadings.count(), 1)
  assert.equal(await db.characters.count(), 0, '备份里明确为空的表才会被清空')
})

test('单角色导出：只包含这个角色的信件与礼物', async () => {
  const { a, b } = await seed()
  const f = pickCharacter(await dumpAll(), a.id, { schemaVersion: CURRENT_SCHEMA })
  assert.deepEqual(f.tables.letters!.map((l) => l.characterId), [a.id])
  assert.deepEqual(f.tables.giftRecords!.map((g) => g.characterId), [a.id])
  assert.ok(!JSON.stringify(f).includes(b.id))
})
