/**
 * 回复引擎集成测试（真实 Dexie + fake-indexeddb + 模拟 OpenAI 流式服务）：npm test
 * 覆盖：发送聚合、上下文内容、多条消息（结构化格式与回退）、逐条发出、表情包、未读、重新生成与版本切换、
 *       停止、失败与重试不重复、刷新后数据仍在、未配置。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { createCharacter, getOrCreateSingleConversation, saveImport, sendUserMessage, updateCharacter } from '../src/db/repo'
import { addSticker, sendUserSticker } from '../src/db/stickerRepo'
import { LinglingDB } from '../src/db/schema'
import { setVisionRendererForTesting } from '../src/services/vision/stickerVision'
import { getDeviceId, normalizeAIConfig } from '../src/services/ai/service'
import { setServiceUrlForTesting } from '../src/services/ai/serviceConfig'
import {
  AGGREGATE_MS,
  getReplyState,
  regenerate,
  runReply,
  savePart,
  scheduleReply,
  setPaceScaleForTesting,
  setViewing,
  stopReply,
  switchVersion,
  versionInfo,
} from '../src/services/ai/replyEngine'

type Call = { url: string; body: { messages: { role: string; content: string }[]; stream: boolean } }
let calls: Call[] = []
const TWO = '<msg>早呀</msg>\n<msg>今天也下雪了</msg>'
let reply = TWO
let mode: 'ok' | 'error' | 'slow' | 'cut' = 'ok'
/** cut 模式：发送到这个字符位置后网络中断 */
let cutAt = 0

let visionCalls: { url: string; body: { model: string; messages: { content: { type: string }[] }[] } }[] = []
let visionMode: 'ok' | 'error' = 'ok'
let visionReply = '{"summary":"一只猫翻白眼","text":"你看我信吗","emotion":"怀疑、阴阳怪气","scenes":["不相信"],"confidence":0.9}'

globalThis.fetch = (async (url: string, init: RequestInit) => {
  if (url.startsWith('https://vision.test')) {
    visionCalls.push({ url, body: JSON.parse(String(init.body)) })
    if (visionMode === 'error') return new Response('{"error":{"message":"invalid api key"}}', { status: 401 })
    return new Response(JSON.stringify({ choices: [{ message: { content: visionReply } }], usage: { prompt_tokens: 800, completion_tokens: 50 } }), { headers: { 'content-type': 'application/json' } })
  }
  calls.push({ url, body: JSON.parse(String(init.body)) })
  if (mode === 'error') return new Response('{"error":{"message":"bad key"}}', { status: 401 })
  const enc = new TextEncoder()
  const chunks = [...reply].map((ch) => `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`)
  const body = new ReadableStream({
    async start(c) {
      for (const [i, ch] of chunks.entries()) {
        if (init.signal?.aborted) return c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (mode === 'cut' && i === cutAt) {
          // 先让读取方取走已经发出的数据（error() 会丢弃队列中尚未读取的部分），再模拟断网
          await new Promise((r) => setTimeout(r, 60))
          return c.error(new TypeError('network down'))
        }
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
  reply = TWO
  mode = 'ok'
  setPaceScaleForTesting(0)
  visionCalls = []
  visionMode = 'ok'
  setVisionRendererForTesting(async () => ({ dataUrl: 'data:image/jpeg;base64,AAAA', coverage: 'static', frames: 1 }))
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
  assert.deepEqual(last.map((m) => m.content), ['你好', '<msg>早呀</msg>\n<msg>今天也下雪了</msg>', '然后呢'])
})

test('停止生成：保留已生成的部分；什么都没生成则不写入', async () => {
  reply = '<msg>这是一段比较长的回复用来测试停止'
  mode = 'slow'
  await sendUserMessage(convId, '说点什么')
  const p = runReply(convId)
  await wait(320)
  stopReply(convId)
  await p
  const msgs = await active()
  const ai = msgs.filter((m) => m.senderType === 'character')
  assert.equal(ai.length, 1)
  assert.ok(ai[0].content.length > 0 && ai[0].content.length < reply.length - 5)
  assert.ok(!ai[0].content.includes('<msg'))
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
  assert.equal(normalizeAIConfig(undefined).service, 'lingling')
  assert.equal(normalizeAIConfig({ apiKey: 'sk', service: 'lingling' }).service, 'lingling')
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

/* ---------------- 自然多消息 ---------------- */

test('模型没有按格式输出：回退为一条普通文字消息（不拆分、不丢内容）', async () => {
  reply = '阿玲：今天雪很大。\n\n记得多穿一点。'
  await sendUserMessage(convId, '外面冷吗')
  await runReply(convId)
  const ai = (await active()).filter((m) => m.senderType === 'character')
  assert.deepEqual(ai.map((m) => m.content), ['今天雪很大。\n\n记得多穿一点。'])
})

test('逐条发出：第一条写完就先保存，不必等整段生成结束；节奏按长度等待', async () => {
  setPaceScaleForTesting(0.05)
  mode = 'slow'
  reply = '<msg>哈哈哈</msg><msg>真的吗！</msg><msg>太好了</msg>'
  await sendUserMessage(convId, '我考过啦')
  const p = runReply(convId)
  // 第一条 "<msg>哈哈哈</msg>" 共 14 个字符，约 0.42 秒后写完；整段约 1.4 秒
  await wait(640)
  const early = (await active()).filter((m) => m.senderType === 'character')
  assert.equal(early.length, 1)
  assert.equal(early[0].content, '哈哈哈')
  assert.equal(getReplyState(convId).status, 'generating')
  await p
  const ai = (await active()).filter((m) => m.senderType === 'character')
  assert.deepEqual(ai.map((m) => m.content), ['哈哈哈', '真的吗！', '太好了'])
  // 时间依次递增，同一组
  assert.ok(ai[0].createdAt < ai[1].createdAt && ai[1].createdAt < ai[2].createdAt)
  assert.equal(new Set(ai.map((m) => m.replyGroupId)).size, 1)
})

test('最多 5 条：多出的文字并入第 5 条', async () => {
  reply = Array.from({ length: 7 }, (_, i) => `<msg>${i + 1}</msg>`).join('')
  await sendUserMessage(convId, '数数')
  await runReply(convId)
  const ai = (await active()).filter((m) => m.senderType === 'character')
  assert.deepEqual(ai.map((m) => m.content), ['1', '2', '3', '4', '5\n6\n7'])
})

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
let prepN = 0
const prep = () => ({ dataUrl: PNG, thumbUrl: PNG, hash: `hash-${++prepN}`, mime: 'image/png' as const, width: 1, height: 1, bytes: 68 })

test('表情包：AI 只能发送已注册的表情包；编造的编号被丢弃', async () => {
  const happy = await addSticker(prep(), '开心转圈')
  await addSticker(prep(), '') // 没有含义：不提供给 AI
  reply = '<msg>太棒了</msg><sticker id="k1"/><sticker id="k9"/><sticker id="stk_fake"/>'
  await sendUserMessage(convId, '我拿到 offer 了')
  await runReply(convId)
  const sys = calls[0].body.messages[0].content
  assert.match(sys, /可用表情包：k1=开心转圈$/m)
  const ai = (await active()).filter((m) => m.senderType === 'character')
  assert.deepEqual(ai.map((m) => [m.kind, m.stickerId ?? m.content]), [
    ['text', '太棒了'],
    ['sticker', happy.id],
  ])
  assert.equal((await db.conversations.get(convId))!.lastMessagePreview, '[表情包]')
})

test('表情包频率「从不」：不向模型提供表情包，输出中的表情包标记一律丢弃', async () => {
  await addSticker(prep(), '开心')
  await updateCharacter(charId, { ...(await db.characters.get(charId))!, chatStyle: { stickers: 'never' } })
  reply = '<msg>嗯</msg><sticker id="k1"/>'
  await sendUserMessage(convId, '你好')
  await runReply(convId)
  assert.doesNotMatch(calls[0].body.messages[0].content, /表情包/)
  const ai = (await active()).filter((m) => m.senderType === 'character')
  assert.deepEqual(ai.map((m) => m.kind), ['text'])
})

test('用户发送的表情包：保存为表情包消息，并以含义进入上下文', async () => {
  const st = await addSticker(prep(), '委屈')
  await sendUserSticker(convId, st)
  await runReply(convId)
  const msgs = await active()
  assert.equal(msgs[0].kind, 'sticker')
  assert.equal(msgs[0].stickerId, st.id)
  assert.deepEqual(calls[0].body.messages.slice(1), [{ role: 'user', content: '[发来一个表情包，名称是「委屈」（没有识别图片，只知道名称；不要描述画面）]' }])
})

test('中途断网：已写完的消息保留；重试不会重复保存，模型能看到已发出的内容', async () => {
  reply = '<msg>第一条</msg><msg>第二条还没写完'
  mode = 'cut'
  cutAt = 20
  await sendUserMessage(convId, '在吗')
  await runReply(convId)
  assert.equal(getReplyState(convId).status, 'error')
  assert.equal(getReplyState(convId).errorKind, 'network')
  let ai = (await active()).filter((m) => m.senderType === 'character')
  assert.deepEqual(ai.map((m) => m.content), ['第一条'])
  // 重试
  mode = 'ok'
  reply = '<msg>刚才断了一下</msg>'
  await runReply(convId)
  ai = (await active()).filter((m) => m.senderType === 'character')
  assert.deepEqual(ai.map((m) => m.content), ['第一条', '刚才断了一下'])
  assert.equal(new Set(ai.map((m) => m.id)).size, ai.length)
  assert.match(calls[1].body.messages.at(-1)!.content, /<msg>第一条<\/msg>/)
})

test('同一条回复重复保存只会有一条（ID 由回复 ID + 序号决定）', async () => {
  const part = { type: 'text' as const, text: '你好' }
  await savePart({ convId, runId: 'grp_x', index: 0, part, characterId: charId, model: 'm' })
  await savePart({ convId, runId: 'grp_x', index: 0, part, characterId: charId, model: 'm' })
  const ai = (await db.messages.where('conversationId').equals(convId).toArray()).filter((m) => m.senderType === 'character')
  assert.equal(ai.length, 1)
  assert.equal(ai[0].id, 'grp_x-0')
  assert.equal((await db.conversations.get(convId))!.unread, 1)
})

test('「刷新」后（重新打开数据库）消息与表情包仍然存在', async () => {
  const st = await addSticker(prep(), '晚安')
  await sendUserSticker(convId, st)
  reply = '<msg>晚安</msg><sticker id="k1"/>'
  await runReply(convId)
  const fresh = new LinglingDB()
  await fresh.open()
  const msgs = (await fresh.messages.where('conversationId').equals(convId).sortBy('createdAt')).filter((m) => !m.deleted && !m.superseded)
  assert.deepEqual(msgs.map((m) => m.kind), ['sticker', 'text', 'sticker'])
  const saved = await fresh.stickers.get(st.id)
  assert.equal(saved?.thumbUrl, PNG)
  assert.equal(saved?.name, '晚安')
  assert.equal((await fresh.stickerImages.get(st.id))?.dataUrl, PNG)
  fresh.close()
})

/* ---------------- 表情包 V2：识图与主动斗图 ---------------- */

const VISION = { enabled: true, consentAt: 1, mode: 'separate', baseUrl: 'https://vision.test/v1', apiKey: 'sk-vision', model: 'vl-model', attachToChat: true }

test('识图：用户发来的表情包先识别再回复；同一张图只识别一次；识别结果进入上下文', async () => {
  await setSetting('vision-config', VISION)
  const st = await addSticker(prep(), '') // 不填名称
  await sendUserSticker(convId, st)
  await runReply(convId)
  assert.equal(visionCalls.length, 1)
  assert.equal(visionCalls[0].body.model, 'vl-model')
  assert.equal(visionCalls[0].body.messages[0].content[1].type, 'image_url')
  const userTurn = calls[0].body.messages.at(-1)!.content
  assert.match(userTurn, /一只猫翻白眼；图上文字「你看我信吗」；情绪：怀疑、阴阳怪气/)
  // 聊天模型只收到文字描述（不是视觉模型），不会被塞进它看不懂的图片
  assert.equal(typeof userTurn, 'string')
  const cached = await db.stickerAnalyses.get(st.hash!)
  assert.equal(cached?.status, 'done')
  const usage = (await db.settings.get('vision-usage'))?.value as { calls: number; promptTokens: number }
  assert.equal(usage.calls, 1)
  assert.equal(usage.promptTokens, 800)
  // 再发一次同一张：不再识别
  await sendUserSticker(convId, st)
  await runReply(convId)
  assert.equal(visionCalls.length, 1)
})

test('主动斗图：识别过的表情包（没有名称）可以被 AI 选用，并作为真实图片消息保存；未识别的不会提供', async () => {
  await setSetting('vision-config', VISION)
  const known = await addSticker(prep(), '')
  await addSticker(prep(), '') // 从未识别
  await db.stickerAnalyses.put({ hash: known.hash!, status: 'done', summary: '小狗拍手', text: '', emotion: '开心、鼓掌', scenes: ['庆祝'], confidence: 0.9, coverage: 'static', frames: 1, model: 'vl', analyzedAt: 1 })
  reply = '<msg>太好了！</msg><sticker id="k1"/><sticker id="k2"/>'
  await sendUserMessage(convId, '我考过了')
  await runReply(convId)
  assert.match(calls[0].body.messages[0].content, /可用表情包：k1=开心、鼓掌·小狗拍手·适合庆祝$/m)
  const ai = (await active()).filter((m) => m.senderType === 'character')
  assert.deepEqual(ai.map((m) => [m.kind, m.stickerId ?? m.content]), [['text', '太好了！'], ['sticker', known.id]])
  assert.equal(visionCalls.length, 0) // 收藏夹不会被自动上传识别
})

test('识图失败（密钥无效）：不卡住聊天，回复照常生成，并明确告诉模型没看懂图片', async () => {
  await setSetting('vision-config', VISION)
  visionMode = 'error'
  const st = await addSticker(prep(), '')
  await sendUserSticker(convId, st)
  await runReply(convId)
  assert.equal(getReplyState(convId).status, 'idle')
  assert.match(getReplyState(convId).visionNote ?? '', /没有识别成功/)
  assert.match(calls[0].body.messages.at(-1)!.content, /没有识别图片内容.*不要假装/)
  assert.equal((await active()).filter((m) => m.senderType === 'character').length, 2)
  assert.equal((await db.stickerAnalyses.get(st.hash!))?.status, 'failed')
})

test('识图未开启：不发送任何图片，也不编造识别结果', async () => {
  const st = await addSticker(prep(), '')
  await sendUserSticker(convId, st)
  await runReply(convId)
  assert.equal(visionCalls.length, 0)
  assert.match(calls[0].body.messages.at(-1)!.content, /没有识别图片内容/)
})

test('数据库升级（v3 → v4）：旧表情包与聊天记录完整保留，原图移到单独的表', async () => {
  const { default: Dexie } = await import('dexie')
  db.close()
  await Dexie.delete('lingling-ai')
  const old = new Dexie('lingling-ai')
  old.version(3).stores({
    characters: 'id, name, updatedAt, worldId', conversations: 'id, type, pinned, lastMessageAt', messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
    messageVersions: 'id, messageId', memories: 'id, characterId, status, createdAt', moments: 'id, authorId, createdAt', stickers: 'id, packId', worlds: 'id', settings: 'key',
    lorebooks: 'id, name, updatedAt', characterLorebooks: 'id, characterId, lorebookId, &[characterId+lorebookId]', worldLorebooks: 'id, worldId, lorebookId, &[worldId+lorebookId]',
  })
  await old.open()
  await old.table('stickers').add({ id: 'stk_old', packId: 'mine', name: '旧的', dataUrl: PNG, mime: 'image/png', width: 1, height: 1, bytes: 68, favorite: true, aiUsable: true, createdAt: 1, updatedAt: 1 })
  await old.table('messages').add({ id: 'm_old', conversationId: 'v_old', senderType: 'user', senderId: 'user', kind: 'sticker', stickerId: 'stk_old', content: '[表情包] 旧的', status: 'sent', createdAt: 1, updatedAt: 1 })
  old.close()
  await db.open()
  const s = await db.stickers.get('stk_old')
  assert.equal(s?.thumbUrl, PNG)
  assert.equal((s as unknown as { dataUrl?: string }).dataUrl, undefined)
  assert.equal(s?.favorite, true)
  assert.equal((await db.stickerImages.get('stk_old'))?.dataUrl, PNG)
  assert.equal((await db.messages.get('m_old'))?.stickerId, 'stk_old')
})

/* ---------------- 长篇人设 DOCX：导入 → 保存 → 刷新 → 上下文 ---------------- */

test('长篇人设 DOCX 端到端：全部资料写入 IndexedDB，重新打开后完整，AI 上下文包含核心人设', async () => {
  const { readFileSync } = await import('node:fs')
  const { importFile } = await import('../src/import/pipeline')
  const { buildContext } = await import('../src/services/ai/context')
  const { characterTextChars } = await import('../src/db/repo')
  const bytes = new Uint8Array(readFileSync('scripts/fixtures/files/long-persona.docx'))
  const [r] = await importFile('林晚prompt.docx', bytes, 'character', {})
  assert.ok(r.ok)
  if (!r.ok) return
  const d = r.file.characters[0]
  const before = (await db.characters.toArray()).map((c) => c.id)
  const res = await saveImport(
    [{ key: 'k', draft: d, source: { fileName: '林晚prompt.docx', format: r.file.format }, sourceDoc: { fileName: '林晚prompt.docx', text: r.file.doc!.text, chars: 1, paragraphs: r.file.doc!.paragraphs } }],
    [],
  )
  // 已有角色不受影响
  for (const id of before) assert.ok(await db.characters.get(id))
  const fresh = new LinglingDB()
  await fresh.open()
  const saved = await fresh.characters.get(res.characterIds[0])
  fresh.close()
  assert.ok(saved)
  assert.equal(saved!.name, '林晚')
  assert.equal(saved!.personality, d.personality.trim())
  assert.equal(saved!.speakingStyle, d.speakingStyle.trim())
  assert.equal(saved!.backstory, d.backstory.trim())
  assert.equal(saved!.relationToUser, d.relationToUser.trim())
  assert.equal(saved!.exampleDialogue, d.exampleDialogue.trim())
  assert.deepEqual(saved!.profileExtras!.map((e) => e.label), ['核心任务', '特别说明'])
  assert.equal(saved!.sourceDoc?.text, r.file.doc!.text)
  assert.ok(characterTextChars(saved!) > 7500)
  const ctx = buildContext({ character: saved!, userName: '我', lorebooks: [], history: [] })
  const sys = ctx.messages[0].content
  assert.ok(sys.includes(saved!.personality.slice(0, 40)))
  assert.ok(sys.includes(saved!.speakingStyle.slice(0, 40)))
  assert.ok(sys.includes('【核心任务】'))
})

test('保存后读回的资料明显变少：整个导入回滚并报错，不显示成功', async () => {
  const { ImportIntegrityError } = await import('../src/db/repo')
  const d = { name: '测试', bio: '', personality: '温柔'.repeat(200), speakingStyle: '', backstory: '雪'.repeat(500), relationToUser: '', greeting: '', exampleDialogue: '', extensions: {}, extras: [] }
  const count = await db.characters.count()
  // 模拟写入后读回时内容被截断
  const hook = (obj: { backstory?: string }) => ({ ...obj, backstory: (obj.backstory ?? '').slice(0, 10) })
  db.characters.hook('reading', hook)
  try {
    await assert.rejects(saveImport([{ key: 'k', draft: d, source: { fileName: 'x.docx', format: 'text' } }], []), ImportIntegrityError)
  } finally {
    db.characters.hook('reading').unsubscribe(hook)
  }
  assert.equal(await db.characters.count(), count)
})

test('「查看发送给 AI 的设定」与实际请求的 system 完全一致（含关系、整理要点、记忆、世界书、长篇人设）', async () => {
  const { previewContext } = await import('../src/services/ai/contextInput')
  const long = Array.from({ length: 40 }, (_, i) => `第${i}段背景：雪城的往事${'细节'.repeat(40)}`).join('\n\n')
  await db.characters.update(charId, {
    backstory: long,
    relationToUser: '你的恋人，交往两年',
    organized: { method: 'rule', createdAt: 1, sourceChars: 10, skippedChars: 0, dropped: 0, items: [{ cat: 'personality', point: '温柔但嘴硬', quote: '温柔' }], conflicts: [] },
  })
  await db.memories.add({ id: 'mem1', characterId: charId, kind: 'user-fact', content: '小雪对芒果过敏', sourceMessageIds: [], status: 'active', pinned: true, createdAt: 1 })
  await sendUserMessage(convId, '钟楼今天响了吗')
  const preview = await previewContext((await db.characters.get(charId))!)
  await runReply(convId)
  const sent = calls[0].body.messages[0].content
  assert.equal(preview.messages[0].content, sent)
  assert.match(sent, /芒果过敏/)
  assert.match(sent, /温柔但嘴硬/)
  assert.match(sent, /午夜敲十三下/)
  assert.ok(preview.report.omitted.some((o) => o.label.startsWith('扩展资料')))
  assert.equal(preview.report.sections.reduce((n, s) => n + s.chars, 0) + (preview.report.sections.length - 1) * 2, sent.length)
})

test('撤销整理只恢复整理结果：人设、关系、记忆、聊天记录都不变', async () => {
  const before = (await db.characters.get(charId))!
  await db.memories.add({ id: 'mem2', characterId: charId, kind: 'event', content: '一起看过初雪', sourceMessageIds: [], status: 'active', createdAt: 1 })
  await sendUserMessage(convId, '早')
  const v1 = { method: 'rule' as const, createdAt: 1, sourceChars: 1, skippedChars: 0, dropped: 0, items: [{ cat: 'identity' as const, point: '旧版', quote: '图书管理员' }], conflicts: [] }
  const v2 = { ...v1, createdAt: 2, items: [{ cat: 'identity' as const, point: '新版', quote: '图书管理员' }] }
  await db.characters.update(charId, { organized: v1, organizedUndo: { prev: null, savedAt: 1 } })
  await db.characters.update(charId, { organized: v2, organizedUndo: { prev: v1, savedAt: 2 } })
  // 撤销（与界面相同的写法）
  const c = (await db.characters.get(charId))!
  await db.characters.update(charId, { organized: c.organizedUndo?.prev ?? undefined, organizedUndo: undefined })
  const after = (await db.characters.get(charId))!
  assert.equal(after.organized?.items[0].point, '旧版')
  assert.equal(after.organizedUndo, undefined)
  for (const k of ['name', 'bio', 'personality', 'speakingStyle', 'backstory', 'relationToUser'] as const) assert.equal(after[k], before[k])
  assert.equal(await db.memories.where('characterId').equals(charId).count(), 1)
  assert.equal(await db.messages.where('conversationId').equals(convId).count(), 1)
  // 再撤销到「未整理」
  await db.characters.update(charId, { organized: v1, organizedUndo: { prev: null, savedAt: 3 } })
  const c2 = (await db.characters.get(charId))!
  await db.characters.update(charId, { organized: c2.organizedUndo?.prev ?? undefined, organizedUndo: undefined })
  assert.equal((await db.characters.get(charId))!.organized, undefined)
})
