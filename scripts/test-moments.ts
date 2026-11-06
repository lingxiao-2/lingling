/** 动态（朋友圈）PR A：发布校验、可见范围、点赞评论、软删除与撤销、备份往返、无需数据库迁移：npm test */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import type { Moment } from '../src/db/schema'
import { addComment, createMoment, deleteComment, deleteMoment, restoreMoment, toggleLike } from '../src/db/momentRepo'
import { feed, isSafeMomentImage, momentTime, normalizeDraft, USER_ACTOR, visibilityLabel, visibleComments, visibleToCharacter } from '../src/services/moments'
import { buildBackup, parseBackup, planRestore, rowsToWrite } from '../src/services/backup'
import { applyRestore, CURRENT_SCHEMA, dumpAll } from '../src/services/backupDb'

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
const base = (extra: Partial<Moment> = {}): Moment => ({ id: 'm', authorType: 'user', authorId: 'user', content: 'x', imageRefs: [], visibility: 'all', createdAt: 0, ...extra })

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('发布校验：不能为空；字数和图片数量有上限；只接受本机图片；部分可见必须选角色', () => {
  assert.throws(() => normalizeDraft({ content: '  ', images: [], visibility: 'all' }), /写点什么/)
  assert.equal(normalizeDraft({ content: '', images: [IMG], visibility: 'all' }).images.length, 1)
  assert.throws(() => normalizeDraft({ content: 'a'.repeat(2001), images: [], visibility: 'all' }), /最多 2000 字/)
  assert.throws(() => normalizeDraft({ content: 'a', images: Array(10).fill(IMG), visibility: 'all' }), /最多 9 张/)
  assert.throws(() => normalizeDraft({ content: 'a', images: ['https://evil.example/x.jpg'], visibility: 'all' }), /图片格式不正确/)
  assert.equal(isSafeMomentImage('data:image/svg+xml;base64,PHN2Zz4='), false)
  assert.throws(() => normalizeDraft({ content: 'a', images: [], visibility: 'some', visibleTo: [] }), /至少要选择一个角色/)
  assert.deepEqual(normalizeDraft({ content: ' 下雪了 ', images: [], visibility: 'some', visibleTo: ['c1', 'c1', 'c2'] }), { content: '下雪了', images: [], visibility: 'some', visibleTo: ['c1', 'c2'] })
  // 其他可见范围不保留角色列表
  assert.deepEqual(normalizeDraft({ content: 'a', images: [], visibility: 'all', visibleTo: ['c1'] }).visibleTo, [])
})

test('可见范围：所有角色 / 部分角色 / 仅自己；已删除的谁都看不到；角色自己的动态', () => {
  assert.equal(visibleToCharacter(base(), 'c1'), true)
  assert.equal(visibleToCharacter(base({ visibility: 'private' }), 'c1'), false)
  assert.equal(visibleToCharacter(base({ visibility: 'some', visibleTo: ['c2'] }), 'c1'), false)
  assert.equal(visibleToCharacter(base({ visibility: 'some', visibleTo: ['c1'] }), 'c1'), true)
  assert.equal(visibleToCharacter(base({ deleted: true }), 'c1'), false)
  assert.equal(visibleToCharacter(base({ authorType: 'character', authorId: 'c1', visibility: 'private' }), 'c1'), true)
  assert.equal(visibilityLabel({ visibility: 'some', visibleTo: ['a', 'b'] }, (id) => ({ a: '阿玲', b: '沈遥' })[id] ?? ''), '阿玲、沈遥可见')
  assert.equal(visibilityLabel({ visibility: 'private' }), '仅自己可见')
})

test('时间显示', () => {
  const now = new Date(2026, 10, 6, 15, 0).getTime()
  assert.equal(momentTime(now - 10_000, now), '刚刚')
  assert.equal(momentTime(now - 5 * 60_000, now), '5 分钟前')
  assert.equal(momentTime(now - 3 * 3_600_000, now), '3 小时前')
  assert.equal(momentTime(new Date(2026, 10, 5, 9).getTime(), now), '昨天')
  assert.equal(momentTime(new Date(2026, 9, 1).getTime(), now), '10月1日')
  assert.equal(momentTime(new Date(2025, 0, 2).getTime(), now), '2025年1月2日')
})

test('发布后出现在列表最上面；点赞可取消且不重复；评论与回复；删除评论可撤销', async () => {
  const a = await createMoment({ content: '第一条', images: [IMG], visibility: 'all' })
  await new Promise((r) => setTimeout(r, 2))
  const b = await createMoment({ content: '第二条', images: [], visibility: 'some', visibleTo: ['c1'] })
  assert.deepEqual(feed(await db.moments.toArray()).map((m) => m.id), [b.id, a.id])
  assert.deepEqual((await db.moments.get(b.id))!.visibleTo, ['c1'])

  await toggleLike(a.id, USER_ACTOR)
  let m = await toggleLike(a.id, { type: 'character', id: 'c1' })
  assert.equal(m.likes!.length, 2)
  m = await toggleLike(a.id, USER_ACTOR)
  assert.deepEqual(m.likes!.map((l) => l.id), ['c1'])

  const c1 = await addComment(a.id, { type: 'character', id: 'c1' }, '好看')
  const c2 = await addComment(a.id, USER_ACTOR, ' 谢谢 ', { type: 'character', id: 'c1' })
  await assert.rejects(addComment(a.id, USER_ACTOR, '   '), /评论不能为空/)
  m = (await db.moments.get(a.id))!
  assert.deepEqual(visibleComments(m).map((c) => [c.content, c.replyTo?.id]), [['好看', undefined], ['谢谢', 'c1']])
  await deleteComment(a.id, c2.id)
  assert.deepEqual(visibleComments((await db.moments.get(a.id))!).map((c) => c.id), [c1.id])
  await deleteComment(a.id, c2.id, false)
  assert.equal(visibleComments((await db.moments.get(a.id))!).length, 2)
})

test('删除动态是软删除：从列表隐藏、不能再评论；撤销后完整恢复（点赞评论图片都在）', async () => {
  const a = await createMoment({ content: '会被删除', images: [IMG, IMG], visibility: 'all' })
  await toggleLike(a.id, USER_ACTOR)
  await addComment(a.id, USER_ACTOR, '留言')
  await deleteMoment(a.id)
  assert.equal(feed(await db.moments.toArray()).length, 0)
  assert.equal(await db.moments.count(), 1, '数据没有被真正删除')
  await assert.rejects(addComment(a.id, USER_ACTOR, '还能评论吗'), /已经删除/)
  await restoreMoment(a.id)
  const back = feed(await db.moments.toArray())
  assert.equal(back.length, 1)
  assert.equal(back[0].imageRefs.length, 2)
  assert.equal(back[0].likes!.length, 1)
  assert.equal(visibleComments(back[0]).length, 1)
})

test('旧版本留下的动态（没有新字段）可以正常显示和互动；数据库版本没有变化', async () => {
  await db.moments.put({ id: 'old', authorType: 'user', authorId: 'user', content: '旧动态', imageRefs: [], visibility: 'all', createdAt: 1 })
  assert.equal(feed(await db.moments.toArray())[0].id, 'old')
  const m = await toggleLike('old', USER_ACTOR)
  assert.equal(m.likes!.length, 1)
  await addComment('old', USER_ACTOR, '补一句')
  assert.equal(visibleComments((await db.moments.get('old'))!).length, 1)
  assert.equal(db.verno, 4)
})

test('备份往返：动态、配图、点赞评论、可见范围都能恢复', async () => {
  const a = await createMoment({ content: '去看雪', images: [IMG], visibility: 'some', visibleTo: ['c1'] })
  await toggleLike(a.id, { type: 'character', id: 'c1' })
  await addComment(a.id, USER_ACTOR, '冷')
  const before = await dumpAll()
  const file = parseBackup(JSON.stringify(buildBackup(before, { schemaVersion: CURRENT_SCHEMA })), CURRENT_SCHEMA)
  for (const t of db.tables) await t.clear()
  const local = await dumpAll()
  await applyRestore(rowsToWrite(file, local, planRestore(file, local), 'replace'), 'replace')
  const m = (await db.moments.get(a.id))!
  assert.equal(m.content, '去看雪')
  assert.deepEqual(m.imageRefs, [IMG])
  assert.deepEqual(m.visibleTo, ['c1'])
  assert.equal(m.likes!.length, 1)
  assert.equal(visibleComments(m)[0].content, '冷')
})
