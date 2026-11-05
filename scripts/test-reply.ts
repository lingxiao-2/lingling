/**
 * 回复引擎集成测试（真实 Dexie + fake-indexeddb + 模拟 OpenAI 流式服务）：npm test
 * 覆盖：发送聚合、上下文内容、多条消息拆分、未读、重新生成与版本切换、停止、失败、未配置。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { createCharacter, getOrCreateSingleConversation, saveImport, sendUserMessage } from '../src/db/repo'
import { getDeviceId, normalizeAIConfig } from '../src/services/ai/service'
import { setServiceUrlForTesting } from '../src/services/ai/serviceConfig'
import {
  AGGREGATE_MS,
  getReplyState,
  regenerate,
  runReply,
  scheduleReply,
  setViewing,
  stopReply,
  switchVersion,
  versionInfo,
} from '../src/services/ai/replyEngine'

type Call = { url: string; body: { messages: { role: string; content: string }[]; stream: boolean } }
let calls: Call[] = []
let reply = '早呀\n\n今天也下雪了'
let mode: 'ok' | 'error' | 'slow' = 'ok'

globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, body: JSON.parse(String(init.body)) })
  if (mode === 'error') return new Response('{"error":{"message":"bad key"}}', { status: 401 })
  const enc = new TextEncoder()
  const chunks = [...reply].map((ch) => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`)
  const body = new ReadableStream({
    async start(c) {
      for (const ch of chunks) {
        if (init.signal?.aborted) return c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        c.enqueue(enc.encode(ch))
        if (mode === 'slow') await new Promise((r) => setTimeout(r, 30))
      }
      c.enqueue(enc.encode('data: [DONE]\n\n'))
      c.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}) as unknown as typeof fetch

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function settle(convId: string) {
  for (let i = 0; i < 200; i++) {
    const s = getReplyState(convId).status
    if (s === 'idle' || s === 'error') return
    await wait(20)
  }
  throw new Error('回复未完成')
}

let convId = ''
let charId = ''

beforeEach(async () => {
  await db.delete()
  await db.open()
  calls = []
  reply = '早呀\n\n今天也下雪了'
  mode = 'ok'
  setViewing(null)
  await setSetting('ai-config', { mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', proxyUrl: '', proxyToken: '', model: 'test-model', temperature: 0.7, maxTokens: 200 })
  await setSetting('profile', { nickname: '小雪', signature: '' })
  const c = await createCharacter({ name: '阿玲', bio: '图书管理员', personality: '温柔', speakingStyle: '轻声', backstory: '', relationToUser: '青梅竹马' })
  charId = c.id
  convId = await getOrCreateSingleConversation(c.id)
  // 关联一本世界书
  await saveImport([], [
    {
      key: 'b',
      draft: { name: '雪城', description: '', extensions: {}, entries: [{ name: '钟楼', keys: ['钟楼'], secondaryKeys: [], content: '午夜敲十三下', enabled: true, constant: false, extensions: {} }] },
      source: { fileName: 't', format: 'generic-json' },
      linkNewCharacters: [],
      linkExistingCharacters: [c.id],
    },
  ])
})

const active = async () => (await db.messages.where('conversationId').equals(convId).sortBy('createdAt')).filter((m) => !m.deleted && !m.superseded)

test('连续发送在 0.8 秒内聚合为一次请求；上下文含人设与触发的世界书；回复拆成多条', async () => {
  await sendUserMessage(convId, '在吗')
  scheduleReply(convId)
  await wait(200)
  await sendUserMessage(convId, '今晚钟楼会响吗')
  scheduleReply(convId)
  assert.equal(getReplyState(convId).status, 'waiting')
  await wait(AGGREGATE_MS + 100)
  await settle(convId)
  assert.equal(calls.length, 1)
  const sent = calls[0].body.messages
  assert.equal(calls[0].url, 'https://api.test/v1/chat/completions')
  assert.equal(calls[0].body.stream, true)
  assert.match(sent[0].content, /你是「阿玲」/)
  assert.match(sent[0].content, /钟楼：午夜敲十三下/)
  assert.deepEqual(sent.slice(1), [{ role: 'user', content: '在吗\n\n今晚钟楼会响吗' }])
  const msgs = await active()
  assert.deepEqual(msgs.map((m) => [m.senderType, m.content]), [
    ['user', '在吗'],
    ['user', '今晚钟楼会响吗'],
    ['character', '早呀'],
    ['character', '今天也下雪了'],
  ])
  assert.equal(msgs[2].replyGroupId, msgs[3].replyGroupId)
  assert.equal(msgs[2].model, 'test-model')
  const conv = await db.conversations.get(convId)
  assert.equal(conv!.lastMessagePreview, '今天也下雪了')
  assert.equal(conv!.unread, 2)
})

test('正在查看会话时不计未读', async () => {
  setViewing(convId)
  await sendUserMessage(convId, '你好')
  await runReply(convId)
  assert.equal((await db.conversations.get(convId))!.unread, 0)
})

test('重新生成：保留旧版本、上下文排除旧版本、可切换版本', async () => {
  await sendUserMessage(convId, '你好')
  await runReply(convId)
  reply = '新的回答'
  await regenerate(convId)
  await settle(convId)
  // 重新生成的请求不包含旧回复
  const ctx = calls[1].body.messages.map((m) => m.content).join('|')
  assert.ok(!ctx.includes('早呀'))
  let msgs = await active()
  assert.deepEqual(msgs.map((m) => m.content), ['你好', '新的回答'])
  const all = await db.messages.where('conversationId').equals(convId).sortBy('createdAt')
  const family = msgs[1].versionFamily!
  assert.deepEqual(versionInfo(all, family), { count: 2, index: 2, groups: versionInfo(all, family).groups })
  // 切回第 1 版
  await switchVersion(convId, family, -1)
  msgs = await active()
  assert.deepEqual(msgs.map((m) => m.content), ['你好', '早呀', '今天也下雪了'])
  // 后续上下文只使用当前版本
  await sendUserMessage(convId, '然后呢')
  await runReply(convId)
  const last = calls[calls.length - 1].body.messages.slice(1)
  assert.deepEqual(last.map((m) => m.content), ['你好', '早呀\n\n今天也下雪了', '然后呢'])
})

test('停止生成：保留已生成的部分；什么都没生成则不写入', async () => {
  reply = '这是一段比较长的回复用来测试停止'
  mode = 'slow'
  await sendUserMessage(convId, '说点什么')
  const p = runReply(convId)
  await wait(200)
  stopReply(convId)
  await p
  const msgs = await active()
  const ai = msgs.filter((m) => m.senderType === 'character')
  assert.equal(ai.length, 1)
  assert.ok(ai[0].content.length > 0 && ai[0].content.length < reply.length)
  assert.equal(getReplyState(convId).status, 'idle')
})

test('失败：显示错误、不写入任何 AI 消息，可重试', async () => {
  mode = 'error'
  await sendUserMessage(convId, '你好')
  await runReply(convId)
  const s = getReplyState(convId)
  assert.equal(s.status, 'error')
  assert.equal(s.errorKind, 'auth')
  assert.equal((await active()).filter((m) => m.senderType === 'character').length, 0)
  mode = 'ok'
  await runReply(convId)
  assert.equal((await active()).filter((m) => m.senderType === 'character').length, 2)
})

test('未配置任何服务：默认服务未开通时给出提示，不发请求，不生成假回复', async () => {
  await setSetting('ai-config', { mode: 'direct', baseUrl: '', apiKey: '', proxyUrl: '', proxyToken: '', model: '', temperature: 0.7, maxTokens: 200 })
  await sendUserMessage(convId, '你好')
  await runReply(convId)
  assert.equal(getReplyState(convId).errorKind, 'unavailable')
  assert.match(getReplyState(convId).error!, /尚未开通/)
  assert.equal(calls.length, 0)
  assert.equal((await active()).length, 1)
  void charId
})

test('配置迁移：旧版已填写 API Key / 代理的用户自动视为「自己的 API」，聊天不中断', () => {
  assert.equal(normalizeAIConfig({ apiKey: 'sk-old', baseUrl: 'https://a/v1', model: 'm' }).service, 'custom')
  assert.equal(normalizeAIConfig({ mode: 'proxy', proxyUrl: 'https://p' }).service, 'custom')
  // 新用户：默认服务已开通才默认使用它；未开通时引导使用自己的 API
  assert.equal(normalizeAIConfig(undefined, 'https://svc.example.com').service, 'lingling')
  assert.equal(normalizeAIConfig(undefined, '').service, 'custom')
  assert.equal(normalizeAIConfig({}, '').service, 'custom')
  // 已经保存过的选择永远不变
  assert.equal(normalizeAIConfig({ apiKey: 'sk', service: 'lingling' }, '').service, 'lingling')
  assert.equal(normalizeAIConfig({ service: 'custom' }, 'https://svc.example.com').service, 'custom')
  // 已保存的模型名不会被新默认值覆盖
  assert.equal(normalizeAIConfig({ apiKey: 'sk', model: 'deepseek-chat' }).model, 'deepseek-chat')
})

test('默认服务：携带匿名设备 ID、不带密钥；回复走同一套上下文与消息处理', async () => {
  setServiceUrlForTesting('https://svc.example.com')
  try {
    await setSetting('ai-config', { service: 'lingling', mode: 'direct', baseUrl: '', apiKey: 'sk-should-not-be-sent', proxyUrl: '', proxyToken: '', model: '', temperature: 0.7, maxTokens: 200 })
    await sendUserMessage(convId, '今晚钟楼会响吗')
    await runReply(convId)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://svc.example.com/v1/chat/completions')
    assert.match(calls[0].body.messages[0].content, /钟楼：午夜敲十三下/)
    assert.ok(!('model' in calls[0].body))
    const ai = (await active()).filter((m) => m.senderType === 'character')
    assert.deepEqual(ai.map((m) => m.content), ['早呀', '今天也下雪了'])
    const id = await getDeviceId()
    assert.match(id, /^[A-Za-z0-9_-]{8,80}$/)
    assert.equal(await getDeviceId(), id)
  } finally {
    setServiceUrlForTesting(null)
  }
})

test('切换服务不会删除聊天记录', async () => {
  await sendUserMessage(convId, '你好')
  await runReply(convId)
  const before = (await active()).length
  await setSetting('ai-config', { service: 'lingling' })
  await setSetting('ai-config', { service: 'custom', mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-x', proxyUrl: '', proxyToken: '', model: 'test-model', temperature: 0.7, maxTokens: 200 })
  assert.equal((await active()).length, before)
})
