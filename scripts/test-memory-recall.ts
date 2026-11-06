/** 长期记忆 V2（纯函数）：分类、否定不算重复、合并、相关性检索（关键词 / 时间 / 重要程度 / 固定 / 最近共同经历 / 关系）、世界线隔离：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Character, Memory, Message } from '../src/db/schema'
import { buildContext } from '../src/services/ai/context'
import { findDuplicate, guessKind, mergedContent, proposeFromRequests, recallMemories, relatedPairs, similarity, validateExtracted } from '../src/services/ai/memory'

const NOW = Date.UTC(2026, 10, 6)
const DAY = 86_400_000
let t = 0
const msg = (senderType: 'user' | 'character', content: string, extra: Partial<Message> = {}): Message => ({
  id: `m${++t}`, conversationId: 'v', senderType, senderId: senderType === 'user' ? 'u' : 'c1', kind: 'text', content, status: 'sent', createdAt: t, updatedAt: t, ...extra,
})
const mem = (content: string, extra: Partial<Memory> = {}): Memory => ({ id: `x${++t}`, characterId: 'c1', kind: 'user-fact', content, sourceMessageIds: [], status: 'active', createdAt: NOW - 100 * DAY, ...extra })

test('分类：偏好、约定、共同经历、其他事实', () => {
  assert.equal(guessKind('我不吃香菜'), 'preference')
  assert.equal(guessKind('说好今年冬天一起去北海道'), 'promise')
  assert.equal(guessKind('我们第一次一起看了海'), 'event')
  assert.equal(guessKind('我在杭州上班'), 'user-fact')
  const p = proposeFromRequests([msg('user', '记住，我讨厌下雨天')], [])
  assert.equal(p[0].kind, 'preference')
})

test('去重：意思相反的不算重复；标点和语气词不同算同一条', () => {
  assert.ok(similarity('我喜欢猫', '我喜欢猫！') === 1)
  assert.ok(similarity('我喜欢吃香菜', '我不喜欢吃香菜') <= 0.5)
  assert.equal(findDuplicate('我不喜欢吃香菜', [mem('我喜欢吃香菜')]), undefined)
  assert.ok(findDuplicate('我对芒果过敏呀', [mem('我对芒果过敏')]))
})

test('重复说「记住」：不新增，只把新消息作为依据合并进已有记忆（内容不变）', () => {
  const existing = [mem('我对芒果过敏', { sourceMessageIds: ['old'] })]
  const h = [msg('user', '记住我对芒果过敏'), msg('user', '别忘了我对芒果过敏哦')]
  const p = proposeFromRequests(h, existing)
  assert.equal(p.length, 2)
  assert.ok(p.every((x) => x.mergeInto === existing[0].id && x.content === '我对芒果过敏'))
  // 同一批里重复的两句只产生一条新记忆
  const q = proposeFromRequests([msg('user', '记住我喜欢下雪'), msg('user', '记住，我喜欢下雪！')], [])
  assert.equal(q.filter((x) => !x.mergeInto).length, 1)
  assert.equal(q[0].sourceMessageIds.length, 2)
})

test('AI 提取：重复的合并依据；新增类别被接受；角色说的经历不算', () => {
  const h = [msg('user', '我不吃香菜'), msg('user', '说好了周末一起去爬山'), msg('character', '我们去年一起去过冰岛')]
  const existing = [mem('我不吃香菜')]
  const r = validateExtracted(
    {
      memories: [
        { kind: 'preference', content: '不吃香菜', messageId: h[0].id, quote: '我不吃香菜' },
        { kind: 'promise', content: '约好周末一起去爬山', messageId: h[1].id, quote: '周末一起去爬山' },
        { kind: 'event', content: '一起去过冰岛', messageId: h[2].id, quote: '一起去过冰岛' },
      ],
    },
    h,
    existing,
  )
  assert.equal(r.merged, 1)
  assert.equal(r.proposals.find((p) => p.mergeInto)?.mergeInto, existing[0].id)
  assert.deepEqual(r.proposals.filter((p) => !p.mergeInto).map((p) => [p.kind, p.content]), [['promise', '约好周末一起去爬山']])
  assert.equal(r.dropped, 1)
})

test('合并内容不改写原意；可能重复的成对列出', () => {
  assert.equal(mergedContent('我喜欢猫', '我喜欢猫，尤其是橘猫'), '我喜欢猫，尤其是橘猫')
  assert.equal(mergedContent('我在杭州上班', '我住在西湖边'), '我在杭州上班；我住在西湖边')
  const pairs = relatedPairs([mem('我养了一只叫团子的橘猫'), mem('团子是我养的橘猫'), mem('我在杭州上班')])
  assert.equal(pairs.length, 1)
})

test('检索：固定常驻；关键词相关；无关的不发送；不把全部记忆都塞进去', () => {
  const all = [
    mem('我对芒果过敏', { pinned: true }),
    mem('我养了一只叫团子的猫'),
    mem('我在准备雅思考试'),
    mem('我喜欢周杰伦的歌'),
    ...Array.from({ length: 40 }, (_, i) => mem(`第${i}条无关记忆：关于某件事情${i}的细节描述`)),
  ]
  const r = recallMemories(all, '团子今天又抓沙发了', { now: NOW })
  assert.equal(r[0].memory.content, '我对芒果过敏')
  assert.equal(r[0].reason, 'pinned')
  assert.ok(r.some((x) => x.memory.content.includes('团子') && x.reason === 'topic' && x.hits.includes('团子')))
  assert.ok(!r.some((x) => x.memory.content.includes('雅思')))
  assert.ok(r.length < 5)
})

test('检索：越新越优先、重要程度加权；最近 3 天的共同经历在新会话也会带上', () => {
  const old = mem('我们一起去看了雪', { kind: 'event', createdAt: NOW - 200 * DAY })
  const fresh = mem('我们一起去看了雪山日出', { kind: 'event', createdAt: NOW - 1 * DAY })
  const r = recallMemories([old, fresh], '雪', { now: NOW })
  assert.equal(r[0].memory.id, fresh.id)
  // 新会话第一句话「早」：没有关键词，但昨天的共同经历仍会带上
  const r2 = recallMemories([old, fresh], '早', { now: NOW })
  assert.deepEqual(r2.map((x) => [x.memory.id, x.reason]), [[fresh.id, 'recent-event']])
  const a = mem('我喜欢喝拿铁', { priority: 1 })
  const b = mem('我喜欢喝美式', { priority: 3 })
  const r3 = recallMemories([a, { ...b, priority: 2 }], '喝咖啡，拿铁还是美式', { now: NOW })
  assert.equal(r3[0].memory.id, b.id)
})

test('检索：聊到「还记得吗」时带上共同经历；已确立的关系中共同经历更靠前', () => {
  const ev = mem('我们在海边放了烟花', { kind: 'event', createdAt: NOW - 60 * DAY })
  const fact = mem('我在杭州上班')
  const r = recallMemories([ev, fact], '你还记得吗', { now: NOW })
  assert.deepEqual(r.map((x) => [x.memory.id, x.reason]), [[ev.id, 'time-cue']])
  const ev2 = mem('我们一起吃了火锅', { kind: 'event', createdAt: NOW - 90 * DAY })
  const f2 = mem('我爱吃火锅', { kind: 'preference', createdAt: NOW - 90 * DAY })
  const lover = recallMemories([f2, ev2], '火锅', { now: NOW, relation: 'lover' })
  assert.equal(lover[0].memory.id, ev2.id)
})

test('隔离：待确认、已删除（空内容）、已失效、其他世界线的记忆一律不召回', () => {
  const all = [
    mem('我喜欢猫', { status: 'pending' }),
    mem('', { status: 'invalidated' }),
    mem('我喜欢猫咪', { status: 'invalidated' }),
    mem('猫是魔法世界的信使', { worldId: 'w-magic', pinned: true }),
    mem('我养了猫', { worldId: 'w-city' }),
    mem('我也喜欢小猫', { pinned: true }),
  ]
  const r = recallMemories(all, '你知道我养了猫吗', { now: NOW, worldId: 'w-city' }).map((x) => x.memory.content)
  assert.deepEqual(r.sort(), ['我也喜欢小猫', '我养了猫'].sort())
})

test('上下文：按角色世界与关系召回；其他角色、其他世界线的不进入；删除后不再注入', () => {
  const ch = { id: 'c1', name: '沈遥', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '你们是恋人', worldId: 'w1', permissions: { useStickers: true, postMoments: true }, createdAt: 0, updatedAt: 0 } as Character
  const mine = mem('我们约好冬天去看极光', { kind: 'promise', pinned: true, worldId: 'w1' })
  const other = mem('我是阿玲的同学', { characterId: 'c2', pinned: true })
  const otherWorld = mem('我们在龙骑士学院相遇', { kind: 'event', pinned: true, worldId: 'w2' })
  const ctx = buildContext({ character: ch, userName: '小雪', lorebooks: [], history: [msg('user', '早')], memories: [mine, other, otherWorld] })
  const s = ctx.messages[0].content as string
  assert.match(s, /（重要约定）我们约好冬天去看极光/)
  assert.doesNotMatch(s, /阿玲的同学|龙骑士/)
  const deleted = { ...mine, status: 'invalidated' as const, content: '' }
  const ctx2 = buildContext({ character: ch, userName: '小雪', lorebooks: [], history: [msg('user', '早')], memories: [deleted] })
  assert.doesNotMatch(ctx2.messages[0].content as string, /极光|【你记得的事】/)
})
