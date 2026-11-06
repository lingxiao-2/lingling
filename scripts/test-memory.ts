/** 长期记忆：「记住」提议、敏感与禁止内容、去重、AI 提取只认用户原话、按话题挑选、角色隔离、进入上下文：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Character, Memory, Message } from '../src/db/schema'
import { buildContext } from '../src/services/ai/context'
import { extractWithAI, findDuplicate, memoryCheck, pickMemories, proposeFromRequests, validateExtracted } from '../src/services/ai/memory'

let t = 0
const msg = (senderType: 'user' | 'character', content: string, extra: Partial<Message> = {}): Message => ({
  id: `m${++t}`, conversationId: 'v', senderType, senderId: senderType === 'user' ? 'user' : 'c1', kind: 'text', content, status: 'sent', createdAt: t, updatedAt: t, ...extra,
})
const mem = (content: string, extra: Partial<Memory> = {}): Memory => ({ id: `x${++t}`, characterId: 'c1', kind: 'user-fact', content, sourceMessageIds: [], status: 'active', createdAt: t, ...extra })

test('聊天中的「记住……」原样成为提议；同一条消息不重复提议；角色说的不算', () => {
  const h = [msg('user', '你要记住，我对芒果过敏'), msg('character', '记住了，你喜欢芒果'), msg('user', '今天好冷')]
  const p = proposeFromRequests(h, [])
  assert.equal(p.length, 1)
  assert.equal(p[0].content, '我对芒果过敏')
  assert.equal(p[0].origin, 'user-request')
  assert.equal(p[0].sensitive, false)
  assert.equal(proposeFromRequests(h, [mem('我对芒果过敏', { sourceMessageIds: [h[0].id] })]).length, 0)
  // 删除后留下的空记录也会阻止再次提议
  assert.equal(proposeFromRequests(h, [mem('', { status: 'invalidated', sourceMessageIds: [h[0].id] })]).length, 0)
})

test('禁止保存证件号、银行卡、密码、密钥；健康财务等标记为敏感', () => {
  assert.equal(memoryCheck('我的身份证是 11010519491231002X').ok, false)
  assert.equal(memoryCheck('卡号 6222 0212 3456 7890 123').ok, false)
  assert.equal(memoryCheck('我的密码是 abc123').ok, false)
  assert.equal(memoryCheck('sk-abcdefghijklmnopqrstu').ok, false)
  assert.equal(memoryCheck('我最近在吃抗焦虑的药').sensitive, true)
  assert.equal(memoryCheck('我喜欢下雪天').sensitive, false)
  assert.equal(proposeFromRequests([msg('user', '记住我的银行卡号 6222021234567890123')], []).length, 0)
})

test('去重：意思相同的不重复保存', () => {
  const ex = [mem('我对芒果过敏')]
  assert.ok(findDuplicate('我对芒果过敏哦', ex))
  assert.equal(findDuplicate('我喜欢下雪天', ex), undefined)
})

test('AI 提取：只接受引用用户本人消息、摘录真实存在的候选；引用角色消息或编造的被丢弃', () => {
  const h = [msg('user', '下周三是我生日'), msg('character', '我们上次在巴黎看了铁塔'), msg('user', '晚安')]
  const r = validateExtracted(
    {
      memories: [
        { kind: 'user-fact', content: '生日在下周三', messageId: h[0].id, quote: '下周三是我生日' },
        { kind: 'event', content: '一起去过巴黎', messageId: h[1].id, quote: '在巴黎看了铁塔' },
        { kind: 'event', content: '一起去过冰岛', messageId: h[2].id, quote: '冰岛' },
        { kind: 'xx', content: 'x', messageId: h[0].id, quote: '下周三' },
      ],
    },
    h,
    [],
  )
  assert.deepEqual(r.proposals.map((p) => p.content), ['生日在下周三'])
  assert.equal(r.proposals[0].origin, 'suggested')
  assert.equal(r.dropped, 3)
})

test('AI 提取：模型返回不是 JSON 时报错，不产生记忆', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '好的' } }] }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
  const cfg = { service: 'custom', mode: 'direct', baseUrl: 'https://api.example.com/v1', apiKey: 'k', proxyUrl: '', proxyToken: '', model: 'm', temperature: 1, maxTokens: 500 } as never
  await assert.rejects(extractWithAI(cfg, '沈遥', '小雪', [msg('user', '我喜欢猫')], [], { fetchImpl }), /没有生成任何记忆/)
})

test('挑选：固定和非常重要的常驻；其余按话题；敏感的只在相关时发送；待确认和失效的不发送', () => {
  const all = [
    mem('我对芒果过敏', { pinned: true }),
    mem('我养了一只叫团子的猫'),
    mem('我最近在吃抗焦虑的药', { sensitive: true, pinned: true }),
    mem('我下周三过生日', { status: 'pending' }),
    mem('我讨厌香菜', { status: 'invalidated' }),
  ]
  const a = pickMemories(all, '今天天气不错').map((m) => m.content)
  assert.deepEqual(a, ['我对芒果过敏'])
  const b = pickMemories(all, '团子今天又抓沙发了，这只猫').map((m) => m.content)
  assert.ok(b.includes('我养了一只叫团子的猫'))
  const c = pickMemories(all, '最近焦虑，又去拿药了').map((m) => m.content)
  assert.ok(c.includes('我最近在吃抗焦虑的药'))
  assert.ok(!c.includes('我下周三过生日') && !c.includes('我讨厌香菜'))
})

test('上下文：记忆进入 system；其他角色的记忆不会串进来', () => {
  const ch: Character = { id: 'c1', name: '沈遥', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'w', permissions: { useStickers: true, postMoments: true }, createdAt: 0, updatedAt: 0 }
  const ctx = buildContext({ character: ch, userName: '小雪', lorebooks: [], history: [msg('user', '早')], memories: [mem('我对芒果过敏', { pinned: true }), mem('我是阿玲的同学', { characterId: 'c2', pinned: true })] })
  const s = ctx.messages[0].content as string
  assert.match(s, /【你记得的事】/)
  assert.match(s, /芒果过敏/)
  assert.doesNotMatch(s, /阿玲的同学/)
  assert.equal(ctx.usedMemoryIds.length, 1)
})
