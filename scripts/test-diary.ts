/** 日记 PR B：标签、搜索、按日期筛选、月历；自动保存（空白不保存）；删除与恢复；照片关联；AI 读取默认关闭且只返回授权的日记：npm test */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import type { Diary } from '../src/db/schema'
import { purgeDiary, restoreDiary, saveDiary, trashDiary } from '../src/db/diaryRepo'
import { addPhoto, trashPhotos } from '../src/db/photoRepo'
import { dateParts, daysWithEntries, filterDiaries, isBlank, monthGrid, normalizeTags, topTags } from '../src/life/diary'
import { listReadableDiaries } from '../src/life/diaryAccess'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const d = (x: Partial<Diary>): Diary => ({ id: Math.random().toString(36), date: '2026-11-06', title: '', body: '', tags: [], photoIds: [], aiReadable: false, createdAt: 1, updatedAt: 1, ...x })

test('标签整理、空白判断、日期显示、月历格子', () => {
  assert.deepEqual(normalizeTags('#初雪  沈遥，初雪、 咖啡'), ['初雪', '沈遥', '咖啡'])
  assert.equal(normalizeTags(Array.from({ length: 12 }, (_, i) => `t${i}`)).length, 8)
  assert.equal(normalizeTags(['这是一个非常非常非常长的标签名字'])[0].length, 12)
  assert.ok(isBlank({ title: ' ', body: '\n', photoIds: [] }))
  assert.ok(!isBlank({ title: '', body: '', photoIds: ['p'] }))
  assert.deepEqual(dateParts('2026-11-06'), { day: '06', monEn: 'NOV', year: 2026, week: '星期五', zh: '2026年11月6日' })
  const g = monthGrid(2026, 10) // 2026 年 11 月 1 日是星期日
  assert.equal(g[0], 1)
  assert.equal(g.filter(Boolean).length, 30)
})

test('筛选：全文搜索（标题 / 正文 / 标签 / 心情）、按日期、按标签；最近删除不出现；按日期从新到旧', () => {
  const list = [
    d({ id: 'a', date: '2026-11-01', title: '初雪', body: '和沈遥看雪', tags: ['冬天'], mood: 'happy' }),
    d({ id: 'b', date: '2026-11-06', title: '加班', body: '好累', tags: ['工作'], mood: 'tired' }),
    d({ id: 'c', date: '2026-10-20', title: '秘密', body: '沈遥', deletedAt: 5 }),
  ]
  assert.deepEqual(filterDiaries(list).map((x) => x.id), ['b', 'a'])
  assert.deepEqual(filterDiaries(list, { query: '沈遥' }).map((x) => x.id), ['a'])
  assert.deepEqual(filterDiaries(list, { query: '疲惫' }).map((x) => x.id), ['b'], '按心情搜索')
  assert.deepEqual(filterDiaries(list, { date: '2026-11-01' }).map((x) => x.id), ['a'])
  assert.deepEqual(filterDiaries(list, { tag: '工作' }).map((x) => x.id), ['b'])
  assert.deepEqual(filterDiaries(list, { month: '2026-10' }).map((x) => x.id), [])
  assert.deepEqual([...daysWithEntries(list, '2026-11')].sort(), [1, 6])
  assert.deepEqual(topTags(list), ['冬天', '工作'])
})

test('自动保存：空白的新日记不保存；有内容才新建；之后更新同一篇；默认不允许 AI 读取', async () => {
  assert.equal(await saveDiary(null, { title: '  ', body: '' }), null)
  assert.equal(await db.diaries.count(), 0)
  const id = (await saveDiary(null, { date: '2026-11-06', body: '今天下雪了', tags: ['初雪', '#初雪'] }))!
  assert.ok(id)
  await saveDiary(id, { title: '初雪', mood: 'tender', date: 'not-a-date' })
  const row = (await db.diaries.get(id))!
  assert.equal(row.title, '初雪')
  assert.equal(row.date, '2026-11-06', '非法日期不会写入')
  assert.deepEqual(row.tags, ['初雪'])
  assert.equal(row.aiReadable, false)
  assert.equal(await db.diaries.count(), 1)
})

test('删除进入最近删除可恢复；只有最近删除中的才能彻底删除', async () => {
  const id = (await saveDiary(null, { body: 'x' }))!
  assert.equal(await purgeDiary(id), false)
  await trashDiary(id)
  assert.equal(filterDiaries(await db.diaries.toArray()).length, 0)
  await restoreDiary(id)
  assert.equal(filterDiaries(await db.diaries.toArray()).length, 1)
  await trashDiary(id)
  assert.equal(await purgeDiary(id), true)
  assert.equal(await db.diaries.count(), 0)
})

test('关联照片：用稳定 ID；照片删除后日记仍可打开（照片 ID 保留，界面显示「已删除」）', async () => {
  const p = await addPhoto({ name: '雪', blob: new Blob([new Uint8Array(10)]), mime: 'image/jpeg', width: 10, height: 10, thumb: 'data:image/jpeg;base64,AA', originalBytes: 10, originalType: 'image/jpeg' })
  const id = (await saveDiary(null, { body: '看雪', photoIds: [p.id, p.id] }))!
  assert.deepEqual((await db.diaries.get(id))!.photoIds, [p.id])
  await trashPhotos([p.id])
  assert.deepEqual((await db.diaries.get(id))!.photoIds, [p.id])
  assert.ok((await db.photos.get(p.id))!.deletedAt)
})

test('预留的 AI 读取接口：只返回勾选了「允许 AI 读取」的日记；删除的永远不返回', async () => {
  const a = (await saveDiary(null, { title: '公开', body: '可以给 AI 看', aiReadable: true }))!
  await saveDiary(null, { title: '私密', body: '只有我知道' })
  const c = (await saveDiary(null, { title: '删掉的', body: '曾经允许', aiReadable: true }))!
  await trashDiary(c)
  const r = await listReadableDiaries()
  assert.deepEqual(r.map((x) => x.id), [a])
  assert.ok(!JSON.stringify(r).includes('只有我知道'))
  await saveDiary(a, { aiReadable: false })
  assert.deepEqual(await listReadableDiaries(), [], '取消授权后立即不可读')
})

test('回归：不合法的日期（13 月 40 日、2 月 30 日）不会被当成合法日期', async () => {
  const { isDateString } = await import('../src/life/diary')
  assert.equal(isDateString('2026-13-40'), false)
  assert.equal(isDateString('2026-02-30'), false)
  assert.equal(isDateString('2028-02-29'), true)
  assert.equal(isDateString('2026-11-06'), true)
})
