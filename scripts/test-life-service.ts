/** 生活应用统一数据服务层 + 跨应用关联（PR E）：默认全部未授权；授权后只返回必要字段；草稿需确认；删除 / 修改关联内容后其他应用不出错：npm test */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { addPhoto, trashPhotos } from '../src/db/photoRepo'
import { saveDiary, trashDiary } from '../src/db/diaryRepo'
import { saveNote, trashNote } from '../src/db/noteRepo'
import { saveEvent, eventsForDiary } from '../src/db/eventRepo'
import { createCharacter, deleteCharacter } from '../src/db/repo'
import { firstNoteWidget, loadLayout, saveWidgetNote } from '../src/desktop/layoutStore'
import { confirmDraft, getPolicy, LIFE_TOOLS, listDrafts, POLICY_KEY, rejectDraft, runLifeTool, setPolicy } from '../src/life/service'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const photo = (name: string) => addPhoto({ name, blob: new Blob([new Uint8Array(10)]), mime: 'image/jpeg', width: 1, height: 1, thumb: 'data:image/jpeg;base64,AA', originalBytes: 10, originalType: 'image/jpeg' })

test('默认全部未授权：每个工具都返回「没有授权」，不读取任何数据；损坏的设置当作关闭', async () => {
  await saveNote(null, { text: '秘密' })
  assert.deepEqual(await getPolicy(), { version: 1, diary: false, notes: false, calendar: false, album: false, noteDrafts: false, eventDrafts: false })
  for (const t of LIFE_TOOLS) {
    const r = await runLifeTool(t.name, { text: 'x', title: 'x', date: '2026-11-06' })
    assert.deepEqual(r, { ok: false, reason: '用户没有授权这项访问' }, t.name)
  }
  await db.settings.put({ key: POLICY_KEY, value: { notes: 'yes', diary: 1 } })
  assert.equal((await getPolicy()).notes, false)
  assert.equal((await runLifeTool('nope')).ok, false)
  // 每个工具都有给第六阶段用的参数定义
  assert.ok(LIFE_TOOLS.every((t) => (t.parameters as { type: string }).type === 'object'))
})

test('授权后：日记只返回逐篇允许的；便签不含删除的；日历按日期展开；相册只有元数据', async () => {
  await setPolicy({ diary: true, notes: true, calendar: true, album: true })
  const ok = (await saveDiary(null, { title: '公开', body: '可以看', aiReadable: true }))!
  await saveDiary(null, { title: '私密', body: '不可以' })
  await saveNote(null, { text: '买花' })
  const gone = (await saveNote(null, { text: '删掉的' }))!
  await trashNote(gone)
  await saveEvent(null, { title: '周会', kind: 'event', allDay: false, date: '2026-11-02', startTime: '10:00', location: '', note: '', repeat: 'weekly', diaryIds: [] })
  await photo('初雪')
  const d = await runLifeTool('query_diaries')
  assert.ok(d.ok && (d.data as { id: string }[]).map((x) => x.id).join() === ok)
  const n = await runLifeTool('query_notes')
  assert.ok(n.ok && JSON.stringify(n.data).includes('买花') && !JSON.stringify(n.data).includes('删掉的'))
  const c = await runLifeTool('query_calendar', { from: '2026-11-01', to: '2026-11-30' })
  assert.ok(c.ok && (c.data as unknown[]).length === 5, '每周重复在 11 月出现 5 次')
  assert.equal((await runLifeTool('query_calendar', { from: '2026-01-01', to: '2028-01-01' })).ok, false, '一次最多一年')
  const a = await runLifeTool('query_album')
  assert.ok(a.ok && !JSON.stringify(a.data).includes('data:image'), '没有图片内容')
})

test('草稿：只在授权后创建；确认后才变成真的便签 / 日程；可以拒绝；参数不合法时拒绝', async () => {
  assert.equal((await runLifeTool('create_note_draft', { text: '买牛奶' })).ok, false)
  await setPolicy({ noteDrafts: true, eventDrafts: true })
  const r1 = await runLifeTool('create_note_draft', { title: '购物', items: ['牛奶', '面包'] }, { proposedBy: '沈遥' })
  assert.ok(r1.ok)
  assert.equal(await db.notes.count(), 0, '草稿不是真的便签')
  const r2 = await runLifeTool('create_event_draft', { title: '一起看雪', date: '2026-12-01', startTime: '19:00' })
  assert.ok(r2.ok)
  assert.equal(await db.events.count(), 0)
  assert.equal((await runLifeTool('create_event_draft', { title: '坏的', date: '2026-13-40' })).ok, false)
  assert.equal((await runLifeTool('create_note_draft', { text: '  ' })).ok, false)
  const drafts = await listDrafts()
  assert.equal(drafts.length, 2)
  assert.equal(drafts[0].proposedBy, '沈遥')
  const noteId = await confirmDraft(drafts[0].id)
  assert.deepEqual((await db.notes.get(noteId))!.items.map((i) => i.text), ['牛奶', '面包'])
  await rejectDraft(drafts[1].id)
  assert.equal(await db.events.count(), 0)
  assert.equal((await listDrafts()).length, 0)
  await assert.rejects(confirmDraft(drafts[1].id), /不存在或已处理/)
})

test('跨应用关联：照片、日记、便签、角色被删除后，引用它们的内容照常读取（稳定 ID，不依赖位置）', async () => {
  const p = await photo('雪')
  const d = (await saveDiary(null, { body: '看雪', photoIds: [p.id] }))!
  const c = await createCharacter({ name: '沈遥', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  const e = await saveEvent(null, { title: '初次见面', kind: 'anniversary', allDay: true, date: '2024-11-06', location: '', note: '', repeat: 'yearly', characterId: c.id, diaryIds: [d] })
  await loadLayout()
  const n = (await saveNote(null, { text: '桌面便签' }))!
  await saveWidgetNote((await firstNoteWidget())!, n)
  // 删除被引用的内容
  await trashPhotos([p.id])
  await trashDiary(d)
  await deleteCharacter(c.id)
  await trashNote(n)
  // 引用方仍然完整，界面据此显示「已删除」
  assert.deepEqual((await db.diaries.get(d))!.photoIds, [p.id])
  const ev = (await db.events.get(e))!
  assert.equal(ev.characterId, c.id)
  assert.deepEqual(ev.diaryIds, [d])
  assert.equal(await db.characters.get(c.id), undefined)
  const layout = await loadLayout()
  assert.equal((layout.pages.flat().find((x) => x.kind === 'widget' && x.widget === 'note') as { noteId?: string }).noteId, n)
  // 日历查询仍然正常（角色显示为 null）
  await setPolicy({ calendar: true })
  const r = await runLifeTool('query_calendar', { from: '2026-11-06', to: '2026-11-06' })
  assert.ok(r.ok && (r.data as { character: unknown }[])[0].character === null)
  assert.deepEqual(await eventsForDiary(d), [{ ...ev }])
})
