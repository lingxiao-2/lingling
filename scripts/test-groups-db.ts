/** 角色分组（IndexedDB，fake-indexeddb）：新建、重命名、移动、删除分组保留角色、关闭重开仍在、已有数据不变：npm test */
import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { createGroup, deleteGroup, GroupError, loadGroupSettings, moveCharacter, renameGroup, saveGroupSettings } from '../src/db/groupRepo'

test('分组完整流程，数据持久化，角色与聊天记录不受影响', async () => {
  const a = await createCharacter({ name: '沈遥', bio: '', personality: '冷静', speakingStyle: '', backstory: '', relationToUser: '恋人' })
  const b = await createCharacter({ name: '阿玲', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })
  const conv = await getOrCreateSingleConversation(a.id)
  await sendUserMessage(conv, '早')
  await db.memories.add({ id: 'm', characterId: a.id, kind: 'user-fact', content: '芒果过敏', sourceMessageIds: [], status: 'active', createdAt: 1 })
  // 旧数据：没有分组
  assert.equal((await db.characters.get(a.id))!.groupId, undefined)
  assert.deepEqual((await loadGroupSettings()).groups, [])

  const g = await createGroup('恋人')
  await assert.rejects(createGroup('恋人'), GroupError)
  await renameGroup(g, '心上人')
  const before = (await db.characters.get(a.id))!
  await moveCharacter(a.id, g)
  await saveGroupSettings({ sort: 'recent' })
  const moved = (await db.characters.get(a.id))!
  assert.equal(moved.groupId, g)
  assert.equal(moved.updatedAt, before.updatedAt)
  assert.equal(moved.personality, '冷静')

  // 关闭再打开：分组、排序、归属都在
  db.close()
  await db.open()
  const s = await loadGroupSettings()
  assert.deepEqual(s.groups.map((x) => x.name), ['心上人'])
  assert.equal(s.sort, 'recent')
  assert.equal((await db.characters.get(a.id))!.groupId, g)

  // 删除分组：角色移入未分组，角色、记忆、聊天记录都还在
  assert.equal(await deleteGroup(g), 1)
  assert.equal((await db.characters.get(a.id))!.groupId, undefined)
  assert.equal(await db.characters.count(), 2)
  assert.equal(await db.memories.count(), 1)
  assert.equal(await db.messages.where('conversationId').equals(conv).count(), 1)
  assert.deepEqual((await loadGroupSettings()).groups, [])
  assert.ok(await db.characters.get(b.id))
})
