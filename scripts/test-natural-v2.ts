/** 自然聊天 V2（纯函数）：人设分寸、本轮分寸提示、关系去重与修改提醒、冲突优先级、调试信息：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Character, Message, Relationship } from '../src/db/schema'
import { buildContext } from '../src/services/ai/context'
import { personaVoice, turnGuidance } from '../src/services/ai/naturalness'
import { relationshipSection } from '../src/services/ai/relationship'

let t = 0
const msg = (senderType: 'user' | 'character', content: string, extra: Partial<Message> = {}): Message => ({
  id: `m${++t}`, conversationId: 'v', senderType, senderId: senderType === 'user' ? 'u' : 'c1', kind: 'text', content, status: 'sent', createdAt: t, updatedAt: t, ...extra,
})
const char = (extra: Partial<Character> = {}): Character => ({
  id: 'c1', name: '沈默', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', exampleDialogue: '', firstMessage: '', worldId: 'default', createdAt: 0, updatedAt: 0, ...extra,
} as Character)
/** n 轮对话：用户一句，角色一组 */
function rounds(n: number, reply: (i: number) => string[], user = (i: number) => `第${i}句`): Message[] {
  const out: Message[] = []
  for (let i = 0; i < n; i++) {
    out.push(msg('user', user(i)))
    const g = `g${i}`
    for (const r of reply(i)) out.push(msg('character', r, { replyGroupId: g }))
  }
  return out
}

test('人设分寸：只识别人设原文写明的特点，带否定的不算；没写就不输出（不套模板）', () => {
  assert.match(personaVoice({ personality: '寡言少语，内敛', speakingStyle: '', bio: '' }).join(''), /你话少/)
  assert.match(personaVoice({ personality: '寡言少语，内敛', speakingStyle: '', bio: '' }).join(''), /含蓄/)
  assert.match(personaVoice({ personality: '', speakingStyle: '说话懒洋洋的', bio: '' }).join(''), /松弛感/)
  assert.match(personaVoice({ personality: '活泼开朗，爱闹', speakingStyle: '', bio: '' }).join(''), /外向/)
  assert.match(personaVoice({ personality: '冷静理性', speakingStyle: '', bio: '' }).join(''), /稳定/)
  assert.deepEqual(personaVoice({ personality: '他并不寡言，也不冷静', speakingStyle: '', bio: '' }), [])
  assert.deepEqual(personaVoice({ personality: '图书管理员', speakingStyle: '', bio: '' }), [])
  // 背景故事里的「沉默」不当作性格
  assert.deepEqual(personaVoice({ personality: '', speakingStyle: '', bio: '' }), [])
})

test('不同性格的角色得到不同的分寸，不会是同一套话术', () => {
  const quiet = buildContext({ character: char({ personality: '寡言，冷静' }), userName: '小雪', lorebooks: [], history: [msg('user', '在吗')] })
  const lively = buildContext({ character: char({ personality: '活泼，话痨' }), userName: '小雪', lorebooks: [], history: [msg('user', '在吗')] })
  const sq = quiet.messages[0].content as string
  const sl = lively.messages[0].content as string
  assert.match(sq, /你话少/)
  assert.doesNotMatch(sq, /你比较外向/)
  assert.match(sl, /你比较外向/)
  assert.doesNotMatch(sl, /你话少/)
  // 人设原文完整保留，没有被模板覆盖
  assert.match(sq, /【性格】\n寡言，冷静/)
})

test('本轮分寸：随意短句 → 简短；认真问题 → 允许长；情绪 → 先接住、不给建议', () => {
  const casual = turnGuidance({ active: [msg('user', '哈哈哈')], charName: 'A', userName: '小雪', exchanges: 1 })
  assert.match(casual.join(''), /这句很随意/)
  const serious = turnGuidance({ active: [msg('user', '这个报错怎么办，帮我看看')], charName: 'A', userName: '小雪', exchanges: 1 })
  assert.match(serious.join(''), /可以写长一点/)
  const sad = turnGuidance({ active: [msg('user', '今天好累，想哭')], charName: 'A', userName: '小雪', exchanges: 1 })
  assert.match(sad.join(''), /不急着给建议/)
  assert.doesNotMatch(sad.join(''), /这句很随意/)
})

test('本轮分寸：连续追问、固定条数、重复开头、口头禅、昵称、emoji、建议都会被提醒', () => {
  const h = rounds(4, (i) => [`宝宝今天怎么样${i}`, `我会一直陪着你哦${i}`, `宝宝吃饭了吗😊${i}？`])
  h.push(msg('user', '嗯'))
  const g = turnGuidance({ active: h, charName: 'A', userName: '小雪', nicknames: [], exchanges: 5 }).join('\n')
  assert.match(g, /以提问结尾/)
  assert.match(g, /发了 3 条/)
  assert.match(g, /「宝宝」开头/)
  assert.match(g, /「一直陪着」|「会一直陪」|「我会一直」/)
  assert.match(g, /「宝宝」最近叫得太频繁/)
  assert.match(g, /emoji/)
  const adv = rounds(3, (i) => [`建议你早点睡${i}`])
  adv.push(msg('user', '嗯嗯'))
  assert.match(turnGuidance({ active: adv, charName: 'A', userName: '小雪', exchanges: 4 }).join(''), /不要再提建议/)
  // 正常、多样的聊天不产生多余提示
  const ok = [msg('user', '我回来了'), msg('character', '嗯，路上冷吗', { replyGroupId: 'a' }), msg('user', '还行'), msg('character', '那就好', { replyGroupId: 'b' }), msg('user', '晚饭吃了面')]
  const okG = turnGuidance({ active: ok, charName: 'A', userName: '小雪', exchanges: 3 })
  assert.ok(okG.every((l) => !/提问结尾|开头|用得太多|太频繁|emoji|建议/.test(l)), okG.join('\n'))
})

test('恋人关系：第一轮就延续；不重复询问交往；不编造共同经历；允许撒娇吃醋但按性格', () => {
  const c = char({ personality: '内敛', relationToUser: '你是他交往三年的女朋友。' })
  const ctx = buildContext({ character: c, userName: '小雪', lorebooks: [], history: [msg('user', '在干嘛')] })
  const s = ctx.messages[0].content as string
  assert.match(s, /你们已经是恋人/)
  assert.match(s, /不要再表白或询问小雪是否愿意交往/)
  assert.match(s, /不要编造具体发生过的事件/)
  assert.match(s, /吃醋/)
  assert.match(s, /含蓄/)
  assert.match(s, /亲疏：以上面写明的你和小雪的关系为准/)
  assert.equal(ctx.debug.relationship.status, '恋人')
  assert.equal(ctx.debug.relationship.source, 'auto')
})

test('关系原文摘句已在人设中出现时不重复发送；共同经历也不重复', () => {
  const c = char({ relationToUser: '你们是恋人，已经在一起三年了。去年冬天你们一起去看了初雪。' })
  const ctx = buildContext({ character: c, userName: '小雪', lorebooks: [], history: [msg('user', '嗨')] })
  const s = ctx.messages[0].content as string
  assert.equal(s.split('你们是恋人，已经在一起三年了').length - 1, 1, '依据只出现一次')
  assert.equal(s.split('去年冬天你们一起去看了初雪').length - 1, 1, '共同经历只出现一次')
  assert.match(s, /共同经历写在上面的人设里/)
  assert.ok(ctx.debug.relationship.dedupedQuotes >= 1)
  assert.ok(ctx.report.omitted.some((o) => o.label.startsWith('关系原文摘句')))
})

test('用户修改关系后：下一次构建立即使用新关系，并提醒以新关系为准；之后聊多了不再提醒', () => {
  const h = [msg('user', '你好'), msg('character', '你好呀', { replyGroupId: 'a' })]
  const rel: Relationship = { status: 'married', evidence: [], nicknames: { forUser: ['阿雪'], forChar: [] }, sharedHistory: [], habits: [], source: 'user', updatedAt: t + 1 }
  t += 2
  const ctx = buildContext({ character: char({ relationship: rel }), userName: '小雪', lorebooks: [], history: [...h, msg('user', '老公')] })
  const s = ctx.messages[0].content as string
  assert.match(s, /关系：已婚 \/ 伴侣（小雪确认）/)
  assert.match(s, /从现在起以它为准/)
  assert.match(s, /阿雪/)
  assert.equal(ctx.debug.relationship.changedAfterChat, true)
  const later = [...h, ...rounds(25, () => ['嗯'])]
  const ctx2 = buildContext({ character: char({ relationship: rel }), userName: '小雪', lorebooks: [], history: later })
  assert.doesNotMatch(ctx2.messages[0].content as string, /从现在起以它为准/)
  // 没有聊天记录时修改关系：不需要提醒
  const ctx3 = buildContext({ character: char({ relationship: rel }), userName: '小雪', lorebooks: [], history: [msg('user', '嗨')] })
  assert.doesNotMatch(ctx3.messages[0].content as string, /从现在起以它为准/)
})

test('冲突优先级写明：用户确认 > 人设 > 世界书；角色自己说过的不算事实', () => {
  const s = buildContext({ character: char(), userName: '小雪', lorebooks: [], history: [msg('user', '嗨')] }).messages[0].content as string
  assert.match(s, /小雪确认过的关系和记忆优先，其次是角色人设，再次是世界设定和世界书/)
  assert.match(s, /你自己说过、但设定中没有的内容，不算事实/)
})

test('消息格式：不复述、不总结、不强制提问和建议，emoji 不必每条都带', () => {
  const s = buildContext({ character: char(), userName: '小雪', lorebooks: [], history: [msg('user', '嗨')] }).messages[0].content as string
  assert.match(s, /不复述对方的话，不在结尾做总结/)
  assert.match(s, /不需要每条都带/)
  assert.match(s, /一次 1～5 条/)
})

test('长会话：80 轮后人设与关系原样保留，长度有上限，不随聊天无限增长；加入保持人设提醒', () => {
  const c = char({ personality: '寡言，冷静', speakingStyle: '短句', relationToUser: '你们是恋人' })
  const sizes: number[] = []
  let h: Message[] = []
  for (let i = 0; i < 200; i++) {
    h = [...h, msg('user', `今天第${i}件事，说说我遇到的事情，比较长的一段话用来占用字数，下班路上看到一只猫蹲在便利店门口，店员给它倒了一碗水，它喝完就走了，我站着看了好久`), msg('character', `嗯，知道了，第${i}次`, { replyGroupId: `r${i}` })]
    const ctx = buildContext({ character: c, userName: '小雪', lorebooks: [], history: [...h, msg('user', '在吗')] })
    sizes.push(ctx.messages.reduce((n, m) => n + String(m.content).length, 0))
    if (i === 80) {
      const s = ctx.messages[0].content as string
      assert.match(s, /【性格】\n寡言，冷静/)
      assert.match(s, /【说话风格】\n短句/)
      assert.match(s, /你们已经是恋人/)
      assert.match(s, /已经聊了 8\d 轮/)
      assert.ok(ctx.debug.history.sent < ctx.debug.history.total)
    }
  }
  const late = sizes.slice(100)
  assert.ok(Math.max(...late) - Math.min(...late) < 400, `后期长度应基本稳定：${Math.min(...late)}～${Math.max(...late)}`)
  assert.ok(Math.max(...sizes) < 6000 + 4000, `总长度有上限：${Math.max(...sizes)}`)
})

test('调试信息：核心人设、关系、召回记忆、世界书（含所属书名）、聊天记录数量、预算；不含任何密钥', () => {
  const c = char({ personality: '温柔', relationToUser: '朋友' })
  const ctx = buildContext({
    character: c,
    userName: '小雪',
    lorebooks: [{ id: 'b1', name: '雪城', description: '', entries: [{ id: 'e1', name: '钟楼', keys: ['钟楼'], secondaryKeys: [], content: '午夜敲十三下', enabled: true, constant: false, extensions: {} }], extensions: {}, createdAt: 0, updatedAt: 0 } as never],
    history: [msg('user', '钟楼今晚会响吗')],
    memories: [{ id: 'mm', characterId: 'c1', kind: 'user-fact', content: '小雪怕冷', sourceMessageIds: [], status: 'active', pinned: true, createdAt: 0 }],
  })
  const d = ctx.debug
  assert.deepEqual(d.persona.map((p) => p.label), ['性格', '与小雪的关系'])
  assert.equal(d.relationship.status, '朋友')
  assert.deepEqual(d.memories.map((x) => x.content), ['小雪怕冷'])
  assert.deepEqual(d.lore, [{ name: '钟楼', book: '雪城', constant: false }])
  assert.equal(d.history.sent, 1)
  assert.ok(d.budget.some((b) => b.label === '聊天记录' && b.limit === 6000))
  assert.doesNotMatch(JSON.stringify(d), /sk-|apiKey|baseUrl/)
})

test('没有识图时：用户发来的表情包如实写明未识别，不假装看懂', () => {
  const st = { id: 's1', name: '', aiUsable: true, createdAt: 0 } as never
  const ctx = buildContext({ character: char(), userName: '小雪', lorebooks: [], history: [msg('user', '[表情包]', { kind: 'sticker', stickerId: 's1' })], stickers: [st] })
  assert.match(ctx.messages[1].content as string, /没有识别图片内容/)
  assert.match(ctx.messages[0].content as string, /只发了一个表情包/)
})
