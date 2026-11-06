/** 已有关系：识别、原文依据、否定、昵称、共同经历、上下文注入、用户修改优先：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Character, Relationship } from '../src/db/schema'
import { buildContext } from '../src/services/ai/context'
import { detectRelationship, effectiveRelationship, relationSources, relationshipSection } from '../src/services/ai/relationship'

const base: Character = {
  id: 'c', name: '沈遥', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'w',
  permissions: { useStickers: true, postMoments: true }, createdAt: 0, updatedAt: 0,
}
const detect = (c: Partial<Character>) => detectRelationship(relationSources({ ...base, ...c }), 1)
const system = (c: Character) => buildContext({ character: c, userName: '小雪', lorebooks: [], history: [] }).messages[0].content as string

test('识别：恋人、已婚、朋友、暧昧、陌生人；识别不到时为未识别，不猜', () => {
  assert.equal(detect({ relationToUser: '你的男朋友，在一起三年了' }).status, 'lover')
  assert.equal(detect({ backstory: '他和你结婚两年，是你的丈夫。' }).status, 'married')
  assert.equal(detect({ relationToUser: '青梅竹马的好友' }).status, 'friend')
  assert.equal(detect({ relationToUser: '和你互有好感，但都没有挑明' }).status, 'ambiguous')
  assert.equal(detect({ relationToUser: '和你是初次见面' }).status, 'stranger')
  assert.equal(detect({ personality: '冷静，话少，喜欢猫' }).status, 'unknown')
  // 只在别人身上出现的关系词不算
  assert.equal(detect({ backstory: '他的父母是一对恩爱的夫妻。' }).status, 'unknown')
})

test('否定与过去式：「还没在一起」「不是恋人」「前男友」不会被当成恋人', () => {
  assert.notEqual(detect({ relationToUser: '他想和你在一起，但你们还没在一起' }).status, 'lover')
  assert.notEqual(detect({ relationToUser: '你们不是恋人' }).status, 'lover')
  assert.notEqual(detect({ backstory: '他是你的前男友。' }).status, 'lover')
})

test('依据是原文摘句；昵称、共同经历、相处习惯都来自原文', () => {
  const r = detect({
    relationToUser: '你的恋人。他总是叫你「小满」。',
    backstory: '你们在大学图书馆相遇，后来一起去了海边旅行。他每天晚上都会和你说晚安。',
  })
  assert.equal(r.status, 'lover')
  assert.ok(r.evidence[0].quote.includes('你的恋人'))
  assert.equal(r.evidence[0].source, '与你的关系')
  assert.deepEqual(r.nicknames.forUser, ['小满'])
  assert.ok(r.sharedHistory.some((s) => s.includes('图书馆相遇')))
  assert.ok(r.habits.some((s) => s.includes('说晚安')))
  const all = [...r.evidence.map((e) => e.quote), ...r.sharedHistory, ...r.habits].join('')
  const src = '你的恋人。他总是叫你「小满」。你们在大学图书馆相遇，后来一起去了海边旅行。他每天晚上都会和你说晚安。'
  for (const s of [...r.sharedHistory, ...r.habits]) assert.ok(src.includes(s), `不是原文：${s}`)
  assert.ok(all.length > 0)
})

test('上下文：恋人关系从第一句话起进入 system，不再「刚开始聊、还在互相了解」，并约束话术与编造', () => {
  const s = system({ ...base, relationToUser: '你的女朋友，交往两年', personality: '嘴硬心软' })
  assert.match(s, /【你和小雪的关系】/)
  assert.match(s, /恋人/)
  assert.match(s, /不要再表白或询问对方是否愿意交往|不要再表白或询问小雪是否愿意交往/)
  assert.match(s, /由你自己的性格决定/)
  assert.match(s, /宝宝/)
  assert.match(s, /不要编造具体发生过的事件/)
  assert.doesNotMatch(s, /刚开始聊，还在互相了解/)
  // 没有关系信息的角色：不出现关系段，亲疏仍按轮数
  const plain = system({ ...base, personality: '安静' })
  assert.doesNotMatch(plain, /【你和小雪的关系】/)
  assert.match(plain, /刚开始聊/)
})

test('用户修改优先：确认过的关系立即用于上下文，不被自动识别覆盖', () => {
  const mine: Relationship = {
    status: 'custom', customLabel: '师徒', customNote: '他是你的剑术师父', evidence: [], nicknames: { forUser: ['徒儿'], forChar: [] },
    sharedHistory: [], habits: [], source: 'user', updatedAt: 1,
  }
  const c = { ...base, relationToUser: '你的男朋友', relationship: mine }
  assert.equal(effectiveRelationship(c).status, 'custom')
  const s = system(c)
  assert.match(s, /关系：师徒（小雪确认）/)
  assert.match(s, /徒儿/)
  assert.doesNotMatch(s, /恋人/)
  // 用户选择「不设定」：不发送关系段
  assert.equal(relationshipSection({ ...mine, status: 'unknown' }, '小雪'), '')
})
