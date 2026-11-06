/** 备份与恢复（IndexedDB，fake-indexeddb）：导出 → 清空 → 恢复后数据一致；失败整体回滚：npm test */
import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { buildBackup, parseBackup, planRestore, rowsToWrite } from '../src/services/backup'
import { applyRestore, CURRENT_SCHEMA, dumpAll } from '../src/services/backupDb'

test('导出 → 完全替换恢复：角色、聊天、表情包、设置一致；API Key 默认不导出但本机保留', async () => {
  const c = await createCharacter({ name: '沈遥', bio: '', personality: '冷静', speakingStyle: '', backstory: '', relationToUser: '恋人' } as never)
  const conv = await getOrCreateSingleConversation(c.id)
  await sendUserMessage(conv, '今天下雪了')
  await db.stickers.put({ id: 'st1', packId: 'mine', name: '叹气', thumbUrl: 'data:image/png;base64,AA', hash: 'H', mime: 'image/png', width: 1, height: 1, bytes: 1, favorite: false, aiUsable: true, createdAt: 1, updatedAt: 1 })
  await db.stickerImages.put({ id: 'st1', dataUrl: 'data:image/png;base64,AA' })
  await db.settings.put({ key: 'ai-config', value: { service: 'custom', mode: 'direct', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-keep', proxyUrl: '', proxyToken: '', model: 'deepseek-chat', temperature: 0.8, maxTokens: 1024 } })

  const before = await dumpAll()
  const file = parseBackup(JSON.stringify(buildBackup(before, { schemaVersion: CURRENT_SCHEMA })), CURRENT_SCHEMA)
  assert.ok(!JSON.stringify(file).includes('sk-keep'))

  // 恢复到「另一台设备」：本机已有新的 API Key
  for (const t of db.tables) await t.clear()
  await db.settings.put({ key: 'ai-config', value: { service: 'custom', apiKey: 'sk-other-device', proxyToken: '' } })
  const local = await dumpAll()
  await applyRestore(rowsToWrite(file, local, planRestore(file, local), 'replace'), 'replace')
  const after = await dumpAll()
  assert.equal(after.characters!.length, before.characters!.length)
  assert.equal(after.messages!.length, before.messages!.length)
  assert.equal(after.stickerImages!.length, 1)
  assert.equal(((after.settings!.find((s) => s.key === 'ai-config')!.value) as { apiKey: string }).apiKey, 'sk-other-device')

  // 关闭再打开：数据仍在
  db.close()
  await db.open()
  assert.equal(await db.characters.count(), before.characters!.length)
})

test('恢复中途失败：整体回滚，本机数据不变', async () => {
  const count = await db.characters.count()
  await assert.rejects(applyRestore({ characters: [{ id: 'new1', name: 'x' }], messages: [{ notAnId: 1 }] } as never, 'replace'))
  assert.equal(await db.characters.count(), count)
  assert.equal(await db.characters.get('new1'), undefined)
})
