/** 角色分组（纯逻辑）：名称校验、分组归属、未分组、排序、手动排序、搜索：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Character } from '../src/db/schema'
import { checkGroupName, matches, moveInOrder, normalizeGroupSettings, sectionize, sortCharacters, UNGROUPED } from '../src/lib/characterGroups'

const ch = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
  id, name, bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'w', permissions: { useStickers: true, postMoments: true }, createdAt: 0, updatedAt: 0, ...extra,
})
const chars = [ch('a', '沈遥', { groupId: 'g1', createdAt: 3 }), ch('b', '阿玲', { createdAt: 1 }), ch('c', '白鹭', { groupId: 'gone', createdAt: 2 }), ch('d', 'Echo', { groupId: 'g1', bio: '音乐人', createdAt: 4 })]
const gs = normalizeGroupSettings({ groups: [{ id: 'g1', name: '恋人' }, { id: 'g2', name: '朋友' }] })

test('旧数据：没有分组设置时默认按名称、全部在未分组；损坏的设置被修正', () => {
  const d = normalizeGroupSettings(undefined)
  assert.deepEqual(d, { groups: [], sort: 'name', order: [], collapsed: [] })
  const s = sectionize(chars, d, new Map())
  assert.equal(s.length, 1)
  assert.equal(s[0].id, UNGROUPED)
  assert.equal(s[0].characters.length, 4)
  assert.equal(normalizeGroupSettings({ sort: 'bad' as never, groups: [{ id: 1 } as never] }).groups.length, 0)
})

test('分组：属于已删除分组的角色进入未分组；空分组也列出', () => {
  const s = sectionize(chars, gs, new Map())
  assert.deepEqual(s.map((x) => [x.name, x.characters.map((c) => c.id).sort()]), [
    ['恋人', ['a', 'd']],
    ['朋友', []],
    ['未分组', ['b', 'c']],
  ])
})

test('排序：名称 / 最近聊天 / 添加时间 / 手动', () => {
  assert.deepEqual(sortCharacters(chars, 'recent', new Map([['c', 10], ['a', 5]])).map((c) => c.id).slice(0, 2), ['c', 'a'])
  assert.deepEqual(sortCharacters(chars, 'created', new Map()).map((c) => c.id), ['d', 'a', 'c', 'b'])
  assert.deepEqual(sortCharacters(chars, 'manual', new Map(), ['c', 'a']).map((c) => c.id).slice(0, 2), ['c', 'a'])
  // 手动排序：在分组内下移一位
  const m = { ...gs, sort: 'manual' as const, order: ['d', 'a', 'b', 'c'] }
  const sec = sectionize(chars, m, new Map())[0]
  assert.deepEqual(sec.characters.map((c) => c.id), ['d', 'a'])
  const order = moveInOrder(sec.characters, 'd', 1, chars, m, new Map())
  assert.deepEqual(sectionize(chars, { ...m, order }, new Map())[0].characters.map((c) => c.id), ['a', 'd'])
})

test('名称校验与搜索', () => {
  assert.equal(checkGroupName(' ', []), '请输入分组名称')
  assert.equal(checkGroupName('恋人', gs.groups), '已经有同名的分组')
  assert.equal(checkGroupName('恋人', gs.groups, 'g1'), null)
  assert.equal(checkGroupName('未分组', []), '「未分组」是保留名称')
  assert.ok(checkGroupName('x'.repeat(21), []))
  assert.ok(matches(chars[3], '音乐'))
  assert.ok(!matches(chars[1], '音乐'))
})
