/**
 * 数据持久化测试（使用 fake-indexeddb 在 Node 中模拟 IndexedDB）：npm test
 *  - 保存前取消：解析文件不会写入任何数据
 *  - 导入后关闭并重新打开数据库，数据仍在
 *  - 导入同名角色不会覆盖已有角色与聊天记录
 */
import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { db } from '../src/db/db'
import { LinglingDB } from '../src/db/schema'
import { createCharacter, getOrCreateSingleConversation, saveImport, sendUserMessage } from '../src/db/repo'
import { importFile } from '../src/import/pipeline'

const FILES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/files')
const read = (n: string) => new Uint8Array(readFileSync(path.join(FILES, n)))

async function counts(d: LinglingDB) {
  return {
    characters: await d.characters.count(),
    lorebooks: await d.lorebooks.count(),
    links: await d.characterLorebooks.count(),
    messages: await d.messages.count(),
  }
}

test('保存前取消导入：只解析不保存，数据库没有任何新增', async () => {
  const before = await counts(db)
  const [r] = await importFile('card-v2.png', read('card-v2.png'), 'character')
  assert.equal(r.ok, true)
  // 用户在预览页点「重选」或返回 —— 不调用 saveImport
  assert.deepEqual(await counts(db), before)
})

test('导入后重新打开数据库：角色、世界书、关联与头像都在，已有数据不被覆盖', async () => {
  // 已有同名角色和聊天记录
  const existing = await createCharacter({
    name: '阿玲',
    bio: '原有角色',
    personality: '原有性格',
    speakingStyle: '',
    backstory: '',
    relationToUser: '',
  })
  const conv = await getOrCreateSingleConversation(existing.id)
  await sendUserMessage(conv, '原有的聊天记录')

  const [r] = await importFile('card-v2.png', read('card-v2.png'), 'character')
  if (!r.ok) assert.fail(r.error)
  const f = r.file
  const summary = await saveImport(
    f.characters.map((draft, i) => ({ key: `c${i}`, draft, avatar: 'data:image/png;base64,AAAA', source: { fileName: f.fileName, format: f.format } })),
    f.lorebooks.map((draft, i) => ({
      key: `b${i}`,
      draft,
      source: { fileName: f.fileName, format: f.format },
      linkNewCharacters: f.links.filter((l) => l.lorebook === i).map((l) => `c${l.character}`),
      linkExistingCharacters: [],
    })),
  )
  assert.equal(summary.characters, 1)
  assert.equal(summary.characterIds.length, 1)
  db.close()

  const reopened = new LinglingDB()
  await reopened.open()
  const chars = await reopened.characters.toArray()
  const imported = chars.find((c) => c.id === summary.characterIds[0])!
  const old = chars.find((c) => c.id === existing.id)!
  assert.equal(imported.name, '阿玲')
  assert.equal(imported.greeting, '今天窗外下雪了。')
  assert.equal(imported.avatar, 'data:image/png;base64,AAAA')
  assert.equal(old.bio, '原有角色')
  assert.equal(old.personality, '原有性格')
  const books = await reopened.lorebooks.toArray()
  assert.equal(books[0].name, '雪城设定')
  const links = await reopened.characterLorebooks.toArray()
  assert.deepEqual(links.map((l) => [l.characterId, l.lorebookId]), [[imported.id, books[0].id]])
  const msgs = await reopened.messages.toArray()
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].content, '原有的聊天记录')
  // 开场白不会被写成聊天记录
  assert.ok(!msgs.some((m) => m.content === '今天窗外下雪了。'))
  reopened.close()
})
