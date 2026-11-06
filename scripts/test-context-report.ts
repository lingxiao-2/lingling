/** 资料使用情况：报告与实际 system 一致，长篇人设、世界书、记忆、说话示例、聊天记录的未发送部分都被列出：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Character, Lorebook, Message } from '../src/db/schema'
import { buildContext } from '../src/services/ai/context'

const base: Character = {
  id: 'c', name: '沈遥', bio: '医生', personality: '冷静', speakingStyle: '', backstory: '', relationToUser: '恋人', worldId: 'w',
  permissions: { useStickers: true, postMoments: true }, createdAt: 0, updatedAt: 0,
}
let t = 0
const msg = (content: string): Message => ({ id: `m${++t}`, conversationId: 'v', senderType: t % 2 ? 'user' : 'character', senderId: 'x', kind: 'text', content, status: 'sent', createdAt: t, updatedAt: t })

test('各段长度之和与实际 system 一致；未发送内容带原因', () => {
  const long = Array.from({ length: 30 }, (_, i) => `第${i}段：关于医院夜班的经历${'细节'.repeat(60)}`).join('\n\n')
  const books: Lorebook[] = [{ id: 'b', name: '书', description: '', entries: [
    { id: 'e1', name: '钟楼', keys: ['钟楼'], secondaryKeys: [], content: '午夜敲十三下', enabled: true, constant: false, extensions: {} },
    { id: 'e2', name: '湖', keys: ['湖'], secondaryKeys: [], content: '冬天结冰', enabled: true, constant: false, extensions: {} },
  ], extensions: {}, createdAt: 0, updatedAt: 0 } as unknown as Lorebook]
  const history = Array.from({ length: 300 }, (_, i) => msg(`第${i}条消息${'嗯'.repeat(30)}`))
  history.push(msg('钟楼响了'))
  const ctx = buildContext({
    character: { ...base, backstory: long, exampleDialogue: '示例'.repeat(1000), sourceDoc: { fileName: 'a.docx', text: 'x'.repeat(5000), chars: 5000 } },
    userName: '小雪', lorebooks: books, history,
    memories: [{ id: 'k', characterId: 'c', kind: 'user-fact', content: '喜欢猫', sourceMessageIds: [], status: 'active', createdAt: 0 }],
  })
  const system = ctx.messages[0].content as string
  const sum = ctx.report.sections.reduce((n, s) => n + s.chars, 0) + (ctx.report.sections.length - 1) * 2
  assert.equal(sum, system.length)
  const labels = ctx.report.omitted.map((o) => o.label)
  assert.ok(labels.some((l) => l.startsWith('扩展资料：背景故事')))
  assert.ok(labels.some((l) => /世界书条目 1 条/.test(l)))
  assert.ok(labels.some((l) => /长期记忆 1 条/.test(l)))
  assert.ok(labels.includes('说话示例'))
  assert.ok(labels.includes('导入原文全文'))
  assert.ok(ctx.report.sections.some((s) => s.label === '世界书（被关键词触发）'))
  assert.ok(ctx.report.sections.some((s) => s.label === '关系'))
  assert.equal(ctx.report.history.total, 301)
  assert.ok(ctx.report.history.sent < 301)
})
