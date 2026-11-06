/** 说话方式：重复句式提醒、区分设定 / 真实经历 / 推测、不同角色不同语气、记录本次用到的记忆与世界书：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Character, Lorebook, Message } from '../src/db/schema'
import { buildContext } from '../src/services/ai/context'
import { recentReplies, repetitionHint } from '../src/services/ai/voice'

let t = 0
const msg = (senderType: 'user' | 'character', content: string, extra: Partial<Message> = {}): Message => ({
  id: `m${++t}`, conversationId: 'v', senderType, senderId: 'x', kind: 'text', content, status: 'sent', createdAt: t, updatedAt: t, replyGroupId: senderType === 'character' ? `g${t}` : undefined, ...extra,
})
const base: Character = { id: 'c', name: '沈遥', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'w', permissions: { useStickers: true, postMoments: true }, createdAt: 0, updatedAt: 0 }

test('重复句式：反复出现的开头和片段会被指出；正常聊天不提示', () => {
  const rep = ['哈哈哈你真可爱，我会一直陪着你的', '哈哈哈今天也辛苦啦，我会一直陪着你的', '哈哈哈别担心，我会一直陪着你的', '哈哈哈晚安']
  const h = repetitionHint(rep)
  assert.match(h, /「哈哈」开头/)
  assert.match(h, /会一直陪着你/)
  assert.equal(repetitionHint(['早', '今天下雪了', '要不要出去走走', '我煮了姜茶']), '')
  assert.equal(repetitionHint(['好', '好']), '')
})

test('同一次回复的多条合并为一条回复来统计', () => {
  const xs = recentReplies([msg('user', '在吗'), msg('character', '在', { replyGroupId: 'r1' }), msg('character', '怎么了', { replyGroupId: 'r1' }), msg('character', '嗯', { replyGroupId: 'r2' })])
  assert.deepEqual(xs, ['在\n怎么了', '嗯'])
})

test('system：说话方式从人设来、不用客服口吻、区分设定 / 真实经历 / 推测；重复提醒进入上下文', () => {
  const history = [msg('user', '在吗'), ...['哈哈哈好呀我会一直陪着你的', '哈哈哈嗯嗯我会一直陪着你的', '哈哈哈知道啦我会一直陪着你的', '哈哈哈晚安'].flatMap((x) => [msg('character', x), msg('user', '嗯')])]
  const s = buildContext({ character: { ...base, personality: '嘴硬心软，话少' }, userName: '小雪', lorebooks: [], history }).messages[0].content as string
  assert.match(s, /【说话方式】/)
  assert.match(s, /不要用通用的客服/)
  assert.match(s, /推测时用「是不是」「可能」/)
  assert.match(s, /【避免重复】/)
  // 不同角色：人设不同，发给模型的说话依据不同
  const a = buildContext({ character: { ...base, personality: '冷淡寡言' }, userName: '小雪', lorebooks: [], history: [msg('user', '早')] }).messages[0].content as string
  const b = buildContext({ character: { ...base, personality: '活泼爱接梗' }, userName: '小雪', lorebooks: [], history: [msg('user', '早')] }).messages[0].content as string
  assert.match(a, /冷淡寡言/)
  assert.match(b, /活泼爱接梗/)
})

test('记录本次用到的记忆、世界书条目和关系', () => {
  const books = [{ id: 'b', name: '书', description: '', entries: [{ id: 'e', name: '钟楼', keys: ['钟楼'], secondaryKeys: [], content: '午夜敲十三下', enabled: true, constant: false, extensions: {} }], extensions: {}, createdAt: 0, updatedAt: 0 }] as unknown as Lorebook[]
  const ctx = buildContext({
    character: { ...base, relationToUser: '你的恋人' }, userName: '小雪', lorebooks: books, history: [msg('user', '钟楼响了')],
    memories: [{ id: 'k', characterId: 'c', kind: 'user-fact', content: '芒果过敏', sourceMessageIds: [], status: 'active', pinned: true, createdAt: 0 }],
  })
  assert.deepEqual(ctx.used.lore, ['钟楼'])
  assert.deepEqual(ctx.used.memories.map((m) => m.content), ['芒果过敏'])
  assert.equal(ctx.used.relationship, 'lover')
})
