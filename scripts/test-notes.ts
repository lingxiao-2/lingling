/** 便签 PR C：文字与清单、搜索与置顶排序、自动保存（空白不保存）、删除恢复；桌面小组件指定便签；旧版桌面便签迁移只执行一次且保留原记录：npm test */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import type { Note } from '../src/db/schema'
import { LEGACY_MIGRATED_KEY, migrateLegacyDesktopNote, purgeNote, restoreNote, saveNote, trashNote } from '../src/db/noteRepo'
import { firstNoteWidget, LAYOUT_KEY, loadLayout, NOTE_KEY, saveWidgetNote } from '../src/desktop/layoutStore'
import { normalizeLayout, type DesktopLayout } from '../src/desktop/layout'
import { isBlankNote, previewLines, progress, toChecklist, toText, visibleNotes } from '../src/life/notes'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

let n = 0
const id = () => `i${++n}`
const note = (x: Partial<Note>): Note => ({ id: id(), title: '', kind: 'text', text: '', items: [], color: 'pearl', pinned: false, createdAt: 1, updatedAt: 1, ...x })
const widgetNoteId = (l: DesktopLayout) => (l.pages.flat().find((x) => x.kind === 'widget' && x.widget === 'note') as { noteId?: string } | undefined)?.noteId

test('文字与清单互转、完成进度、空白判断、预览', () => {
  const items = toChecklist('- 牛奶\n2. 面包\n[x] 鸡蛋\n\n☐ 草莓', id)
  assert.deepEqual(items.map((i) => i.text), ['牛奶', '面包', '鸡蛋', '草莓'])
  assert.equal(toText(items), '牛奶\n面包\n鸡蛋\n草莓')
  items[0].done = true
  assert.deepEqual(progress([...items, { id: 'x', text: ' ', done: true }]), { done: 1, total: 4 })
  assert.ok(isBlankNote({ title: '', kind: 'checklist', text: 'x', items: [{ id: 'a', text: ' ', done: false }] }))
  assert.ok(!isBlankNote({ title: '', kind: 'text', text: '写点什么', items: [] }))
  assert.deepEqual(previewLines(note({ kind: 'checklist', items }), 2), [{ text: '牛奶', done: true }, { text: '面包', done: false }])
})

test('列表：置顶在前，其余按更新时间；搜索标题、正文和清单项；删除的不显示', () => {
  const list = [
    note({ id: 'a', text: '买花', updatedAt: 3 }),
    note({ id: 'b', title: '周末', pinned: true, updatedAt: 1 }),
    note({ id: 'c', kind: 'checklist', items: [{ id: 'x', text: '洋桔梗', done: false }], updatedAt: 2 }),
    note({ id: 'd', text: '买花', deletedAt: 5 }),
  ]
  assert.deepEqual(visibleNotes(list).map((x) => x.id), ['b', 'a', 'c'])
  assert.deepEqual(visibleNotes(list, '洋桔梗').map((x) => x.id), ['c'])
  assert.deepEqual(visibleNotes(list, '买花').map((x) => x.id), ['a'])
})

test('自动保存：空白不新建；之后更新同一张；删除、恢复、只能彻底删除最近删除中的', async () => {
  assert.equal(await saveNote(null, { title: ' ' }), null)
  const a = (await saveNote(null, { text: '记得买牛奶', color: 'ice' }))!
  await saveNote(a, { pinned: true, kind: 'checklist', items: [{ id: 'i', text: '牛奶', done: true }] })
  const row = (await db.notes.get(a))!
  assert.equal(row.pinned, true)
  assert.equal(row.items[0].done, true)
  assert.equal(row.color, 'ice')
  assert.equal(await purgeNote(a), false)
  await trashNote(a)
  assert.equal(visibleNotes(await db.notes.toArray()).length, 0)
  await restoreNote(a)
  assert.equal(visibleNotes(await db.notes.toArray()).length, 1)
  await trashNote(a)
  assert.equal(await purgeNote(a), true)
})

test('桌面小组件：指定便签只改这一个小组件，布局其他部分不变；删除便签后小组件仍保存原 ID（显示空状态）', async () => {
  const before = await loadLayout()
  const w = (await firstNoteWidget())!
  assert.equal(w, 'w-note')
  const a = (await saveNote(null, { text: '周五写信' }))!
  await saveWidgetNote(w, a)
  const after = await loadLayout()
  assert.equal(widgetNoteId(after), a)
  assert.deepEqual({ ...after, pages: after.pages.map((p) => p.map((x) => (x.kind === 'widget' ? { ...x, noteId: undefined } : x))) }, { ...before, pages: before.pages.map((p) => p.map((x) => (x.kind === 'widget' ? { ...x, noteId: undefined } : x))) })
  await trashNote(a)
  assert.equal(widgetNoteId(await loadLayout()), a)
  // 布局修复不会丢掉 noteId
  assert.equal(widgetNoteId(normalizeLayout(JSON.parse(JSON.stringify(await loadLayout())))), a)
})

test('旧版桌面便签迁移：复制成一张便签并显示在小组件上；只执行一次；原记录保留', async () => {
  await loadLayout()
  await db.settings.put({ key: NOTE_KEY, value: { text: '周五记得给沈遥写信', updatedAt: 123 } })
  const nid = (await migrateLegacyDesktopNote())!
  const created = (await db.notes.get(nid))!
  assert.equal(created.text, '周五记得给沈遥写信')
  assert.equal(created.createdAt, 123)
  assert.equal(widgetNoteId(await loadLayout()), nid)
  assert.ok(await db.settings.get(NOTE_KEY), '原来的记录保留')
  assert.equal(await migrateLegacyDesktopNote(), null, '第二次不再执行')
  assert.equal(await db.notes.count(), 1)
})

test('迁移：没有旧便签时只做标记；小组件已经指定了便签时不覆盖', async () => {
  assert.equal(await migrateLegacyDesktopNote(), null)
  assert.ok(await db.settings.get(LEGACY_MIGRATED_KEY))
  await db.delete()
  await db.open()
  await loadLayout()
  const mine = (await saveNote(null, { text: '我自己选的' }))!
  await saveWidgetNote('w-note', mine)
  await db.settings.put({ key: NOTE_KEY, value: { text: '旧的', updatedAt: 1 } })
  await migrateLegacyDesktopNote()
  assert.equal(widgetNoteId(normalizeLayout((await db.settings.get(LAYOUT_KEY))!.value)), mine)
  assert.equal(await db.notes.count(), 2, '旧便签也保存为一张便签，不丢失')
})
