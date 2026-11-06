/** 备份与恢复（纯逻辑）：默认去掉密钥、单角色挑选、预览、三种方式、表情包同图去重、拒绝新版本备份：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBackup, parseBackup, pickCharacter, planRestore, rowsToWrite, type Dump } from '../src/services/backup'

const dump = (): Dump => ({
  characters: [
    { id: 'c1', name: '沈遥', worldId: 'w1' },
    { id: 'c2', name: '阿玲', worldId: 'world-default' },
  ],
  conversations: [
    { id: 'v1', type: 'single', characterIds: ['c1'] },
    { id: 'v2', type: 'single', characterIds: ['c2'] },
  ],
  messages: [
    { id: 'm1', conversationId: 'v1', content: '早', kind: 'text' },
    { id: 'm2', conversationId: 'v1', content: '[表情包]', kind: 'sticker', stickerId: 's1' },
    { id: 'm3', conversationId: 'v2', content: '嗨', kind: 'text' },
  ],
  memories: [{ id: 'mem1', characterId: 'c1', text: '喜欢下雪' }, { id: 'mem2', characterId: 'c2', text: '怕黑' }],
  worlds: [{ id: 'w1', name: '雪国' }, { id: 'world-default', name: '默认世界' }],
  worldLorebooks: [{ id: 'wl1', worldId: 'w1', lorebookId: 'b2' }],
  characterLorebooks: [{ id: 'cl1', characterId: 'c1', lorebookId: 'b1' }],
  lorebooks: [{ id: 'b1', name: '设定' }, { id: 'b2', name: '雪国志' }, { id: 'b3', name: '无关' }],
  stickers: [{ id: 's1', hash: 'H1', name: '叹气' }, { id: 's2', hash: 'H2', name: '开心' }],
  stickerImages: [{ id: 's1', dataUrl: 'data:image/png;base64,AA' }, { id: 's2', dataUrl: 'data:image/png;base64,BB' }],
  stickerAnalyses: [{ hash: 'H1', summary: '叹气' }],
  settings: [
    { key: 'ai-config', value: { service: 'custom', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-secret', proxyToken: 'tok', model: 'deepseek-chat' } },
    { key: 'link-proxy', value: { url: 'https://p.dev', token: 'ptok' } },
    { key: 'theme', value: { wallpaper: 'snow' } },
  ],
})

test('导出全部：默认不含 API Key / 口令，其他设置保留；勾选后才包含', () => {
  const b = buildBackup(dump(), { schemaVersion: 4, now: 1 })
  const s = JSON.stringify(b)
  assert.ok(!s.includes('sk-secret') && !s.includes('"tok"') && !s.includes('ptok'))
  assert.ok(s.includes('deepseek-chat') && s.includes('snow'))
  assert.equal(b.includesSecrets, false)
  assert.ok(JSON.stringify(buildBackup(dump(), { schemaVersion: 4, includeSecrets: true })).includes('sk-secret'))
})

test('单角色导出：只含该角色的会话、消息、记忆、世界、世界书和用到的表情包', () => {
  const b = pickCharacter(dump(), 'c1', { schemaVersion: 4 })
  assert.deepEqual(b.tables.messages!.map((m) => m.id), ['m1', 'm2'])
  assert.deepEqual(b.tables.memories!.map((m) => m.id), ['mem1'])
  assert.deepEqual(b.tables.lorebooks!.map((m) => m.id).sort(), ['b1', 'b2'])
  assert.deepEqual(b.tables.stickers!.map((m) => m.id), ['s1'])
  assert.deepEqual(b.tables.stickerAnalyses!.map((m) => m.hash), ['H1'])
  assert.equal(b.tables.settings, undefined)
  assert.ok(!JSON.stringify(b).includes('sk-secret'))
})

test('读取：拒绝非备份文件、损坏记录和来自更新版本的备份', () => {
  assert.throws(() => parseBackup('hello', 4), /不是聆聆备份/)
  assert.throws(() => parseBackup('{"format":"x"}', 4), /不是聆聆备份/)
  const ok = buildBackup(dump(), { schemaVersion: 4 })
  assert.equal(parseBackup(JSON.stringify(ok), 4).tables.characters!.length, 2)
  assert.throws(() => parseBackup(JSON.stringify({ ...ok, schemaVersion: 9 }), 4), /更新版本/)
  assert.throws(() => parseBackup(JSON.stringify({ ...ok, tables: { characters: [{ name: '无 id' }] } }), 4), /损坏/)
})

test('恢复预览与三种方式；表情包同图去重并改写消息引用；不会用空密钥覆盖本机密钥', () => {
  const backup = parseBackup(JSON.stringify(buildBackup(dump(), { schemaVersion: 4 })), 4)
  const local: Dump = {
    characters: [{ id: 'c1', name: '沈遥（本机改过）', worldId: 'w1' }],
    stickers: [{ id: 'sLocal', hash: 'H1', name: '本机叹气' }],
    stickerImages: [{ id: 'sLocal', dataUrl: 'x' }],
    settings: [{ key: 'ai-config', value: { service: 'custom', apiKey: 'sk-local', proxyToken: '', model: 'deepseek-chat' } }],
  }
  const plan = planRestore(backup, local)
  const ch = plan.tables.find((t) => t.table === 'characters')!
  assert.deepEqual([ch.added, ch.conflicts], [1, 1])
  assert.equal(plan.tables.find((t) => t.table === 'stickers')!.dedup, 1)
  assert.equal(plan.stickerRemap.get('s1'), 'sLocal')

  const keep = rowsToWrite(backup, local, plan, 'merge-keep')
  assert.deepEqual(keep.characters!.map((c) => c.id), ['c2'])
  assert.equal(keep.messages!.find((m) => m.id === 'm2')!.stickerId, 'sLocal')
  assert.deepEqual(keep.stickers!.map((s) => s.id), ['s2'])
  assert.equal(keep.settings!.some((s) => s.key === 'ai-config'), false)

  const over = rowsToWrite(backup, local, plan, 'merge-overwrite')
  assert.equal(over.characters!.find((c) => c.id === 'c1')!.name, '沈遥')
  const ai = over.settings!.find((s) => s.key === 'ai-config')!.value as Record<string, string>
  assert.equal(ai.apiKey, 'sk-local')
  assert.equal(ai.model, 'deepseek-chat')

  const rep = rowsToWrite(backup, {}, planRestore(backup, {}), 'replace')
  assert.equal(rep.characters!.length, 2)
  assert.equal(rep.messages!.length, 3)
})
