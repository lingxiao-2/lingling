/**
 * 关系连续性与长会话（真实回复引擎 + Dexie + 模拟流式模型）：npm test
 * 注意：这里的模型是模拟的，只验证「发给模型的内容」是否正确、稳定，不代表真实模型（如 DeepSeek）的回复表现。
 *  - 已是恋人的角色：第一轮请求就带上恋人关系，不会询问是否交往
 *  - 同一角色连续 70 轮：每一轮请求里的人设原文和关系都完整、一致；请求长度有上限，不会无限增长
 *  - 用户修改关系：下一次请求立即使用新关系
 *  - 停止生成、重新生成仍然正常
 *  - 回归：AI 回复和用户的下一条消息落在同一毫秒（时钟不前进）时，用户的新消息仍排在最后，请求以它结尾
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { addSticker, sendUserSticker } from '../src/db/stickerRepo'
import { saveRelationship } from '../src/components/RelationshipCard'
import { getReplyState, regenerate, runReply, setPaceScaleForTesting, stopReply } from '../src/services/ai/replyEngine'
import type { Relationship } from '../src/db/schema'

type Call = { messages: { role: string; content: string }[] }
let calls: Call[] = []
let replies: string[] = []
let slow = false

globalThis.fetch = (async (_url: string, init: RequestInit) => {
  calls.push(JSON.parse(String(init.body)))
  const text = replies.length ? replies[(calls.length - 1) % replies.length] : '<msg>嗯</msg>'
  const enc = new TextEncoder()
  const body = new ReadableStream({
    async start(c) {
      for (const ch of [...text]) {
        if (init.signal?.aborted) return c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`))
        if (slow) await new Promise((r) => setTimeout(r, 15))
      }
      c.enqueue(enc.encode('data: [DONE]\n\n'))
      c.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}) as unknown as typeof fetch

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
let convId = ''
let charId = ''
const PERSONALITY = '寡言，内敛，嘴硬心软。不喜欢说情话，关心都藏在行动里。'

beforeEach(async () => {
  await db.delete()
  await db.open()
  calls = []
  replies = []
  slow = false
  setPaceScaleForTesting(0)
  await setSetting('ai-config', { mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-test', proxyUrl: '', proxyToken: '', model: 'mock', temperature: 0.7, maxTokens: 200 })
  await setSetting('profile', { nickname: '小雪', signature: '' })
  const c = await createCharacter({ name: '沈默', bio: '', personality: PERSONALITY, speakingStyle: '短句，偶尔一个字', backstory: '', relationToUser: '你是他交往三年的女朋友，他叫你「阿雪」。' })
  charId = c.id
  convId = await getOrCreateSingleConversation(c.id)
})

async function round(text: string) {
  await sendUserMessage(convId, text)
  await runReply(convId)
  assert.equal(getReplyState(convId).status, 'idle', getReplyState(convId).error)
}

test('已是恋人的角色：第一轮请求就以恋人关系相处，不询问交往，带上习惯称呼', async () => {
  replies = ['<msg>嗯，刚下班</msg>']
  await round('在干嘛')
  assert.equal(calls.length, 1)
  const sys = calls[0].messages[0].content
  assert.match(sys, /关系：恋人/)
  assert.match(sys, /从第一句话起就以恋人的身份自然相处/)
  assert.match(sys, /不要再表白或询问小雪是否愿意交往/)
  assert.match(sys, /阿雪/)
  assert.match(sys, /你话少/)
  assert.match(sys, /含蓄/)
  assert.doesNotMatch(sys, /刚开始聊，还在互相了解/)
})

test('同一角色连续 70 轮：人设与关系每轮完整一致；请求长度有上限', async () => {
  replies = ['<msg>嗯</msg>', '<msg>知道了</msg><msg>早点睡</msg>', '<msg>又熬夜？</msg>', '<msg>……行吧</msg>']
  const topics = ['今天加班到好晚', '楼下的猫又来了', '我想吃火锅', '你猜我今天遇到谁了', '明天要下雨', '好困啊']
  for (let i = 0; i < 70; i++) await round(`${topics[i % topics.length]}，这是第 ${i + 1} 轮，顺便多说几句话占一点长度，看看长聊天会不会越来越长。今天路上人很多，地铁挤得要命，旁边的人一直在打电话，我听了一路别人家的八卦，下车的时候差点坐过站，还好反应快，出站以后又发现忘带伞`)
  assert.equal(calls.length, 70)
  const sizes = calls.map((c) => c.messages.reduce((n, m) => n + m.content.length, 0))
  for (const [i, c] of calls.entries()) {
    const sys = c.messages[0].content
    assert.ok(sys.includes(`【性格】\n${PERSONALITY}`), `第 ${i + 1} 轮缺少完整人设`)
    assert.match(sys, /关系：恋人/, `第 ${i + 1} 轮缺少关系`)
    assert.equal(sys.split(PERSONALITY).length - 1, 1, `第 ${i + 1} 轮人设被重复注入`)
    assert.equal(c.messages[c.messages.length - 1].role, 'user')
  }
  assert.match(calls[69].messages[0].content, /已经聊了 70 轮/)
  // 历史有字数上限：后期请求长度基本稳定，不随轮数增长
  const late = sizes.slice(55)
  assert.ok(Math.max(...late) < 6000 + 5000, `请求长度应有上限：${Math.max(...late)}`)
  assert.ok(Math.max(...late) - Math.min(...late) < 800, `后期长度应稳定：${Math.min(...late)}～${Math.max(...late)}`)
  assert.ok(calls[69].messages.length < 70 * 2, '较早的聊天不会全部发送')
})

test('用户修改关系后：下一次请求立即使用新关系', async () => {
  replies = ['<msg>嗯</msg>']
  await round('在吗')
  const c = (await db.characters.get(charId))!
  const rel: Relationship = { status: 'married', evidence: [], nicknames: { forUser: ['老婆'], forChar: [] }, sharedHistory: ['去年春天在海边办了婚礼'], habits: [], source: 'user', updatedAt: Date.now() + 1 }
  await wait(5)
  await saveRelationship(c.id, rel)
  await round('晚上回来吃饭吗')
  const sys = calls[1].messages[0].content
  assert.match(sys, /关系：已婚 \/ 伴侣（小雪确认）/)
  assert.match(sys, /从现在起以它为准/)
  assert.match(sys, /去年春天在海边办了婚礼/)
  assert.doesNotMatch(sys, /关系：恋人/)
})

test('停止生成保留已写完的内容；重新生成仍然可用', async () => {
  replies = ['<msg>第一条</msg><msg>第二条很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长</msg>']
  slow = true
  await sendUserMessage(convId, '说点什么')
  const p = runReply(convId)
  await wait(250)
  stopReply(convId)
  await p
  assert.equal(getReplyState(convId).status, 'idle')
  const kept = (await db.messages.where('conversationId').equals(convId).toArray()).filter((m) => m.senderType === 'character')
  assert.ok(kept.length >= 1 && kept[0].content === '第一条')
  slow = false
  replies = ['<msg>重新说一遍</msg>']
  await regenerate(convId)
  const after = (await db.messages.where('conversationId').equals(convId).sortBy('createdAt')).filter((m) => m.senderType === 'character' && !m.superseded)
  assert.deepEqual(after.map((m) => m.content), ['重新说一遍'])
})

/** 冻结时钟：模拟回复写完后用户立刻发送（或设备时间被往回调），Date.now() 不再前进 */
async function withFrozenClock(fn: () => Promise<void>) {
  const real = Date.now
  const frozen = real()
  Date.now = () => frozen
  try {
    await fn()
  } finally {
    Date.now = real
  }
}

test('回归：时钟不前进时，用户的新消息仍排在上一组回复之后；每次请求都以最新的用户消息结尾', async () => {
  replies = ['<msg>第一条</msg><msg>第二条</msg><msg>第三条</msg>']
  await withFrozenClock(async () => {
    for (let i = 0; i < 12; i++) await round(`第 ${i + 1} 句，用户最新的话`)
  })
  const all = await db.messages.where('conversationId').equals(convId).sortBy('createdAt')
  // createdAt 严格递增，顺序与发送顺序一致：用户 1 条、角色 3 条，循环
  for (let i = 1; i < all.length; i++) assert.ok(all[i].createdAt > all[i - 1].createdAt, `第 ${i} 条时间没有递增`)
  assert.deepEqual(all.map((m) => m.senderType), Array.from({ length: 12 }, () => ['user', 'character', 'character', 'character']).flat())
  for (const [i, c] of calls.entries()) {
    const last = c.messages[c.messages.length - 1]
    assert.equal(last.role, 'user', `第 ${i + 1} 次请求没有以用户消息结尾`)
    assert.match(last.content, new RegExp(`第 ${i + 1} 句，用户最新的话$`))
    assert.match(c.messages[0].content, /关系：恋人/)
    assert.ok(c.messages[0].content.includes(`【性格】\n${PERSONALITY}`))
  }
  const conv = await db.conversations.get(convId)
  assert.equal(conv!.lastMessageAt, all[all.length - 1].createdAt)
})

test('回归：时钟不前进时，用户发的表情包同样排在上一组回复之后', async () => {
  replies = ['<msg>嗯</msg><msg>好</msg>']
  const st = await addSticker({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', thumbUrl: 'data:image/png;base64,iVBORw0KGgo=', hash: 'h1', mime: 'image/png', bytes: 8, width: 1, height: 1 } as never, '晚安')
  await withFrozenClock(async () => {
    await round('在吗')
    await sendUserSticker(convId, st)
  })
  const all = await db.messages.where('conversationId').equals(convId).sortBy('createdAt')
  assert.deepEqual(all.map((m) => [m.senderType, m.kind]), [['user', 'text'], ['character', 'text'], ['character', 'text'], ['user', 'sticker']])
})
