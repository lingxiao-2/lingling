/**
 * 角色动态 PR B（真实 IndexedDB + 模拟模型）：npm test
 * 注意：模型是模拟的，只验证发送的内容、权限、可见范围、隔离与结果处理，不代表真实模型的文笔。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db, setSetting } from '../src/db/db'
import { createCharacter, getOrCreateSingleConversation, sendUserMessage } from '../src/db/repo'
import { addMemory } from '../src/db/memoryRepo'
import { addComment, createMoment } from '../src/db/momentRepo'
import { USER_ACTOR, visibleComments } from '../src/services/moments'
import { generateCharacterMoment, reactToMoment, replyToComment } from '../src/services/ai/momentEngine'
import { cleanLine, describeMoment, parseReaction, replyTarget, threadFor } from '../src/services/ai/momentsAI'
import type { Moment } from '../src/db/schema'

type Body = { messages: { role: string; content: string }[] }
let calls: Body[] = []
let answer: (b: Body) => string = () => '今天的雪下得很安静。'
const json = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } })
globalThis.fetch = (async (_u: string, init: RequestInit) => {
  const b = JSON.parse(String(init.body)) as Body
  calls.push(b)
  return json(answer(b))
}) as unknown as typeof fetch

const IMG = 'data:image/jpeg;base64,/9j/4AAQ'
let a = ''
let b = ''
const sys = (i = calls.length - 1) => calls[i].messages[0].content
const userMsg = (i = calls.length - 1) => calls[i].messages[1].content

beforeEach(async () => {
  await db.delete()
  await db.open()
  calls = []
  answer = () => '今天的雪下得很安静。'
  await setSetting('ai-config', { mode: 'direct', baseUrl: 'https://api.test/v1', apiKey: 'sk-test', proxyUrl: '', proxyToken: '', model: 'mock', temperature: 0.7, maxTokens: 200 })
  await setSetting('profile', { nickname: '小雪', signature: '' })
  a = (await createCharacter({ name: '沈遥', bio: '', personality: '寡言，内敛', speakingStyle: '短句', backstory: '', relationToUser: '你们是恋人' })).id
  b = (await createCharacter({ name: '阿玲', bio: '', personality: '活泼', speakingStyle: '', backstory: '', relationToUser: '' })).id
})

test('解析与清理：去掉名字前缀、引号、标记；点赞评论格式不对时报错，不编造结果', () => {
  assert.equal(cleanLine('沈遥：「今天下雪了」', '沈遥', 300), '今天下雪了')
  assert.equal(cleanLine('<msg>嗯</msg>', '沈遥', 300), '嗯')
  assert.equal(cleanLine('a'.repeat(10), 'x', 4), 'aaaa…')
  assert.deepEqual(parseReaction('好的 {"like": true, "comment": "沈遥：好看"}', '沈遥'), { like: true, comment: '好看' })
  assert.deepEqual(parseReaction('{"like": "yes"}', '沈遥'), { like: false, comment: '' })
  assert.throws(() => parseReaction('我觉得很好', '沈遥'), /没有按要求/)
})

test('配图如实说明看不到内容；评论区只显示用户和这个角色的评论（角色之间互相看不到）', () => {
  const m: Moment = { id: 'm', authorType: 'user', authorId: 'user', content: '', imageRefs: [IMG, IMG], visibility: 'all', createdAt: 0, comments: [
    { id: '1', author: { type: 'character', id: 'B' }, content: '阿玲的评论', createdAt: 1 },
    { id: '2', author: USER_ACTOR, content: '回阿玲', replyTo: { type: 'character', id: 'B' }, createdAt: 2 },
    { id: '3', author: USER_ACTOR, content: '大家好', createdAt: 3 },
    { id: '4', author: { type: 'character', id: 'A' }, content: '沈遥的评论', createdAt: 4 },
  ] }
  assert.match(describeMoment(m, '小雪'), /只有图片.*\n（配了 2 张图片。你看不到图片内容/)
  assert.deepEqual(threadFor(m, 'A').map((c) => c.id), ['3', '4'])
  // 回复目标：回复某个角色 → 那个角色；在角色的动态下直接评论 → 作者
  assert.equal(replyTarget(m, m.comments![1]), 'B')
  assert.equal(replyTarget(m, m.comments![2]), null)
  assert.equal(replyTarget({ ...m, authorType: 'character', authorId: 'A' }, m.comments![2]), 'A')
  assert.equal(replyTarget(m, m.comments![0]), null, '角色的评论不会触发回复')
})

test('角色发动态：一次请求；带人设、关系、记忆和自己的聊天；不带其他角色的内容；要求不编造、不发图', async () => {
  await addMemory(a, { kind: 'promise', content: '说好今年冬天一起去看极光', pinned: true })
  await addMemory(b, { kind: 'event', content: '阿玲的秘密基地', pinned: true })
  const ca = await getOrCreateSingleConversation(a)
  const cb = await getOrCreateSingleConversation(b)
  await sendUserMessage(ca, '今天加班到十点')
  await sendUserMessage(cb, '阿玲的私聊内容')
  answer = () => '沈遥：「雪停了。」'
  const m = await generateCharacterMoment(a)
  assert.equal(calls.length, 1)
  assert.equal(m.content, '雪停了。')
  assert.equal(m.authorType, 'character')
  assert.equal(m.authorId, a)
  assert.deepEqual(m.imageRefs, [])
  const s = sys()
  assert.match(s, /【性格】\n寡言，内敛/)
  assert.match(s, /关系：恋人/)
  assert.match(s, /说好今年冬天一起去看极光/)
  assert.match(s, /今天加班到十点/)
  assert.match(s, /不要编造你和小雪没有真实发生过的共同经历/)
  assert.match(s, /你不能发图片/)
  assert.doesNotMatch(s, /阿玲的秘密基地|阿玲的私聊内容/)
  assert.ok(!JSON.stringify(calls[0]).includes('sk-test'), '请求体里没有密钥')
})

test('没有开启「参与朋友圈」的角色：不请求、不发布；模型返回空内容不发布', async () => {
  await db.characters.update(a, { permissions: { useStickers: true, postMoments: false } })
  await assert.rejects(generateCharacterMoment(a), /没有开启参与朋友圈/)
  assert.equal(calls.length, 0)
  answer = () => '  '
  await assert.rejects(generateCharacterMoment(b), /空内容|没有返回内容/)
  assert.equal(await db.moments.count(), 0)
})

test('请角色来互动：只交给能看到的、开启了权限的角色；最多 3 个；按结果点赞评论；失败的不编造', async () => {
  const c3 = (await createCharacter({ name: '小三', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })).id
  const c4 = (await createCharacter({ name: '小四', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '' })).id
  const m = await createMoment({ content: '第一次自己做饭', images: [IMG], visibility: 'some', visibleTo: [a, c3, c4] })
  answer = (body) => (body.messages[0].content.includes('你是「沈遥」') ? '{"like": true, "comment": "看起来不错"}' : body.messages[0].content.includes('你是「小三」') ? '格式不对' : '{"like": false, "comment": ""}')
  const r = await reactToMoment(m.id, [a, b, c3, c4])
  // 最多 3 个：a、b、c3；b 看不到这条
  assert.deepEqual(r.map((x) => x.characterId), [a, b, c3])
  assert.match(r[1].error ?? '', /看不到/)
  assert.match(r[2].error ?? '', /没有按要求/)
  assert.equal(calls.length, 2, '看不到的角色不会产生请求')
  assert.match(userMsg(0), /第一次自己做饭/)
  assert.match(userMsg(0), /你看不到图片内容/)
  const after = (await db.moments.get(m.id))!
  assert.deepEqual(after.likes!.map((l) => l.id), [a])
  assert.deepEqual(visibleComments(after).map((c) => [c.author.id, c.content]), [[a, '看起来不错']])
})

test('仅自己可见的动态：不会交给任何角色', async () => {
  const m = await createMoment({ content: '秘密', images: [], visibility: 'private' })
  const r = await reactToMoment(m.id, [a, b])
  assert.equal(calls.length, 0)
  assert.ok(r.every((x) => x.error))
})

test('在角色动态下评论 → 作者回复；回复某个角色的评论 → 那个角色回复；角色看不到其他角色的评论', async () => {
  answer = () => '雪停了。'
  const post = await generateCharacterMoment(a)
  answer = () => '嗯，记得穿厚点'
  const c = await addComment(post.id, USER_ACTOR, '你那边也下雪了？')
  const reply = await replyToComment(post.id, c)
  assert.equal(reply?.author.id, a)
  assert.deepEqual(reply?.replyTo, USER_ACTOR)
  assert.match(userMsg(), /沈遥发了一条动态：「雪停了。」/)
  assert.match(userMsg(), /小雪：你那边也下雪了？/)

  const mine = await createMoment({ content: '今天好冷', images: [], visibility: 'all' })
  await addComment(mine.id, { type: 'character', id: b }, '阿玲说要喝热可可')
  await addComment(mine.id, { type: 'character', id: a }, '多穿点')
  const toA = await addComment(mine.id, USER_ACTOR, '知道啦', { type: 'character', id: a })
  answer = () => '嗯'
  const r2 = await replyToComment(mine.id, toA)
  assert.equal(r2?.author.id, a)
  assert.doesNotMatch(userMsg(), /热可可/)
  // 普通评论（不针对任何角色）在自己的动态下不会触发请求
  const n = calls.length
  const plain = await addComment(mine.id, USER_ACTOR, '自言自语')
  assert.equal(await replyToComment(mine.id, plain), null)
  assert.equal(calls.length, n)
})
