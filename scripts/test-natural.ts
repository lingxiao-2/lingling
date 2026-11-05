/** 自然多消息格式、角色表达偏好与表情包校验（纯函数）：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capParts, cleanText, parseReply, renderAssistantTurn } from '../src/services/ai/messageFormat'
import { closenessHint, formatSection, stickerFrequency, styleSection } from '../src/services/ai/style'
import { buildContext, offeredStickers } from '../src/services/ai/context'
import { checkStickerFile, dataUrlBytes, isSafeStickerSrc, sniffImageType, StickerError } from '../src/services/stickers'
import type { Character, Message, Sticker } from '../src/db/schema'

const none = new Map<string, string>()
const map = new Map([['k1', 'stk_happy']])

test('解析：多条消息与表情包，按顺序', () => {
  const r = parseReply('<msg>哈哈</msg>\n<msg>真的假的</msg>\n<sticker id="k1"/>', map, true)
  assert.equal(r.mode, 'tagged')
  assert.deepEqual(r.parts, [
    { type: 'text', text: '哈哈' },
    { type: 'text', text: '真的假的' },
    { type: 'sticker', stickerId: 'stk_happy' },
  ])
})

test('解析：流式过程中只返回已写完的消息，不显示半截标记', () => {
  const r1 = parseReply('<ms', map, false)
  assert.deepEqual([r1.parts, r1.current, r1.mode], [[], '', 'pending'])
  const r2 = parseReply('<msg>第一条</msg><msg>第二', map, false)
  assert.deepEqual(r2.parts, [{ type: 'text', text: '第一条' }])
  assert.equal(r2.current, '第二')
  const r3 = parseReply('<msg>第一条</msg><msg>第二条</m', map, false)
  assert.equal(r3.current, '第二条')
  const r4 = parseReply('<msg>好</msg><sticker id="k', map, false)
  assert.deepEqual(r4.parts, [{ type: 'text', text: '好' }])
  assert.equal(r4.current, '')
})

test('解析：编造或不在列表中的表情包被丢弃', () => {
  const r = parseReply('<msg>好</msg><sticker id="k7"/><sticker id="https://evil/x.png"/><sticker id=\'k1\'>', map, true)
  assert.deepEqual(r.parts.map((p) => p.type), ['text', 'sticker'])
  assert.deepEqual(r.rejectedStickers, ['k7', 'https'])
  // 没有提供任何表情包时，一律丢弃
  assert.deepEqual(parseReply('<sticker id="k1"/>', none, true).parts, [])
})

test('解析：容错——漏写结束标记、标记外的文字、名字前缀', () => {
  const r = parseReply('<msg>阿玲：早呀<msg>今天下雪了</msg>顺便说一句', none, true, '阿玲')
  assert.deepEqual(r.parts.map((p) => (p.type === 'text' ? p.text : '')), ['早呀', '今天下雪了', '顺便说一句'])
})

test('回退：完全没有格式时作为一条普通消息；流式中照常显示文字', () => {
  const r = parseReply('今天雪很大。\n\n\n\n记得多穿点', none, true)
  assert.equal(r.mode, 'plain')
  assert.deepEqual(r.parts, [{ type: 'text', text: '今天雪很大。\n\n记得多穿点' }])
  const s = parseReply('今天雪很', none, false)
  assert.deepEqual([s.mode, s.current, s.parts.length], ['plain', '今天雪很', 0])
})

test('长回答保留换行和列表', () => {
  const body = '可以这样做：\n1. 先备份\n2. 再升级\n\n注意：升级前关掉同步。'
  const r = parseReply(`<msg>${body}</msg>`, none, true)
  assert.deepEqual(r.parts, [{ type: 'text', text: body }])
})

test('最多 5 条：只合并第 5 条之后的内容，前 4 条不变', () => {
  const parts = Array.from({ length: 7 }, (_, i) => ({ type: 'text' as const, text: String(i + 1) }))
  assert.deepEqual(capParts(parts).map((p) => (p.type === 'text' ? p.text : '')), ['1', '2', '3', '4', '5\n6\n7'])
  const stickers = [...parts.slice(0, 4), { type: 'sticker' as const, stickerId: 'a' }, { type: 'sticker' as const, stickerId: 'b' }]
  assert.deepEqual(capParts(stickers).at(-1), { type: 'sticker', stickerId: 'a' })
})

test('历史写回格式；清理文字', () => {
  assert.equal(
    renderAssistantTurn([{ type: 'text', text: '早' }, { type: 'sticker', stickerId: 's1' }, { type: 'sticker', stickerId: 'gone' }], (id) => (id === 's1' ? 'k1' : undefined)),
    '<msg>早</msg>\n<sticker id="k1"/>',
  )
  assert.equal(cleanText('  </msg>你好<sticker>  '), '你好')
})

/* ---------------- 表达偏好 ---------------- */

const base: Character = {
  id: 'c', name: '阿玲', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '青梅竹马', worldId: 'w',
  permissions: { useStickers: true, postMoments: true }, createdAt: 0, updatedAt: 0,
}

test('不同性格设置生成不同的表达要求；未设置的项目不写入', () => {
  const quiet = styleSection({ ...base, chatStyle: { verbosity: 'low', tone: 'cool' } }, 10, '小雪')
  const lively = styleSection({ ...base, chatStyle: { verbosity: 'high', tone: 'lively', quirks: '句尾爱加「啦」' } }, 10, '小雪')
  assert.match(quiet, /话少/)
  assert.match(quiet, /冷淡/)
  assert.doesNotMatch(quiet, /活泼|话多/)
  assert.match(lively, /话多/)
  assert.match(lively, /活泼/)
  assert.match(lively, /句尾爱加「啦」/)
  const plain = styleSection(base, 10, '小雪')
  assert.doesNotMatch(plain, /话少|话多|简洁|活泼|温柔|冷淡|幽默/)
  assert.match(plain, /以人设为准/)
})

test('亲疏：自动模式结合关系与聊天积累；手动设置优先', () => {
  assert.match(closenessHint(undefined, 2, '小雪'), /刚开始聊/)
  assert.match(closenessHint({ closeness: 'auto' }, 100, '小雪'), /聊了很久/)
  assert.match(closenessHint({ closeness: 'distant' }, 100, '小雪'), /还不太熟/)
})

test('表情包频率：沿用旧的权限开关；「从不」时提示词不提表情包', () => {
  assert.equal(stickerFrequency({ ...base, permissions: { useStickers: false, postMoments: true } }), 'never')
  assert.equal(stickerFrequency(base), 'sometimes')
  assert.equal(stickerFrequency({ ...base, chatStyle: { stickers: 'often' } }), 'often')
  assert.doesNotMatch(formatSection('never', [{ alias: 'k1', name: '开心' }]), /sticker/)
  assert.match(formatSection('often', [{ alias: 'k1', name: '开心' }]), /k1=开心/)
  assert.doesNotMatch(formatSection('often', []), /sticker/)
})

test('格式说明覆盖：简短寒暄、认真问题完整回答、不套模板', () => {
  const f = formatSection('sometimes', [])
  assert.match(f, /1～5 条/)
  assert.match(f, /认真提问.*完整回答/)
  assert.match(f, /不要套用固定的安慰模板或说教/)
})

test('系统提示：诚实说明是 AI、不诱导依赖', () => {
  const ctx = buildContext({ character: base, userName: '小雪', lorebooks: [], history: [] })
  assert.match(ctx.messages[0].content, /诚实说明你是 AI 扮演的角色/)
  assert.match(ctx.messages[0].content, /不要刻意让小雪依赖你/)
})

const sticker = (id: string, name: string, extra: Partial<Sticker> = {}): Sticker => ({
  id, packId: 'mine', name, thumbUrl: 'data:image/png;base64,AAAA', mime: 'image/png', width: 1, height: 1, bytes: 3,
  favorite: false, aiUsable: true, createdAt: 0, updatedAt: 0, ...extra,
})

test('提供给 AI 的表情包：需要含义且允许使用，常用优先，最多 24 个', () => {
  const list = [sticker('a', '开心', { createdAt: 1 }), sticker('b', ''), sticker('c', '哭', { aiUsable: false }), sticker('d', '晚安', { favorite: true })]
  const { options, map } = offeredStickers(list)
  assert.deepEqual(options, [{ alias: 'k1', name: '晚安' }, { alias: 'k2', name: '开心' }])
  assert.equal(map.get('k1'), 'd')
  const many = Array.from({ length: 40 }, (_, i) => sticker(`s${i}`, `表情${i}`, { createdAt: i }))
  assert.equal(offeredStickers(many).options.length, 24)
})

test('上下文：用户发的表情包以含义出现；角色发过的表情包写回编号', () => {
  let t = 0
  const m = (senderType: 'user' | 'character', extra: Partial<Message>): Message => ({
    id: `m${++t}`, conversationId: 'v', senderType, senderId: 'x', kind: 'text', content: '', status: 'sent', createdAt: t, updatedAt: t, ...extra,
  })
  const ctx = buildContext({
    character: base, userName: '小雪', lorebooks: [], stickers: [sticker('s1', '开心')],
    history: [m('user', { kind: 'sticker', stickerId: 's1', content: '[表情包] 开心' }), m('character', { content: '你也开心呀' }), m('character', { kind: 'sticker', stickerId: 's1', content: '[表情包] 开心' })],
  })
  assert.deepEqual(ctx.messages.slice(1), [
    { role: 'user', content: '[发来一个表情包：开心]' },
    { role: 'assistant', content: '<msg>你也开心呀</msg>\n<sticker id="k1"/>' },
  ])
  assert.equal(ctx.stickerMap.get('k1'), 's1')
})

/* ---------------- 表情包文件校验 ---------------- */

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)].slice(0, 16))

test('按文件头识别真实类型；SVG、HTML、伪装扩展名一律拒绝', () => {
  assert.equal(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png')
  assert.equal(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg')
  assert.equal(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), 'image/gif')
  assert.equal(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])), 'image/webp')
  const svg = new TextEncoder().encode('<svg xmlns="http')
  assert.equal(sniffImageType(svg), null)
  assert.throws(() => checkStickerFile(svg, 100), StickerError)
  assert.throws(() => checkStickerFile(bytes(0xff, 0xd8, 0xff), 6 * 1024 * 1024), /5 MB/)
  assert.throws(() => checkStickerFile(bytes(0xff, 0xd8, 0xff), 0), /空/)
  assert.equal(checkStickerFile(bytes(0xff, 0xd8, 0xff), 1000), 'image/jpeg')
})

test('只显示本机保存的图片 dataURL，外部网址和其他类型不显示', () => {
  assert.ok(isSafeStickerSrc('data:image/png;base64,iVBORw0KGgo='))
  assert.ok(!isSafeStickerSrc('https://example.com/a.png'))
  assert.ok(!isSafeStickerSrc('data:image/svg+xml;base64,PHN2Zz4='))
  assert.ok(!isSafeStickerSrc('data:text/html;base64,PGgxPg=='))
  assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3)
  assert.equal(dataUrlBytes('data:image/png;base64,AAA='), 2)
})
