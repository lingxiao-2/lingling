import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchAll, snippetAround } from '../src/lib/search'
import type { Character, Conversation, Message } from '../src/db/schema'

const ch = (id: string, name: string, bio = ''): Character => ({ id, name, bio, personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'w', permissions: { useStickers: true, postMoments: true }, createdAt: 0, updatedAt: 0 })
const cv = (id: string, cid: string, at: number): Conversation => ({ id, type: 'single', characterIds: [cid], pinned: false, unread: 0, draft: '', lastMessagePreview: '', lastMessageAt: at, createdAt: 0 })
let t = 0
const msg = (conv: string, content: string, extra: Partial<Message> = {}): Message => ({ id: `m${++t}`, conversationId: conv, senderType: 'user', senderId: 'u', kind: 'text', content, status: 'sent', createdAt: ++t, updatedAt: t, ...extra })

test('搜索：联系人（名称 / 简介）、会话、聊天记录关键词', () => {
  const chars = [ch('a', '阿玲', '雪城图书馆管理员'), ch('b', '沈星回')]
  const convs = [cv('v1', 'a', 1), cv('v2', 'b', 2)]
  const msgs = [
    msg('v1', '明天一起去图书馆吗'),
    msg('v2', '图书馆关门了'),
    msg('v2', '图书馆', { deleted: true }),
    msg('v2', '图书馆', { superseded: true }),
    msg('v2', '[表情包] 图书馆', { kind: 'sticker' }),
    msg('gone', '图书馆'),
  ]
  const r = searchAll('图书馆', chars, convs, msgs)
  assert.deepEqual(r.characters.map((c) => c.id), ['a'])
  assert.deepEqual(r.messages.map((h) => h.conversation.id), ['v2', 'v1'])
  assert.deepEqual(searchAll('星回', chars, convs, msgs).conversations.map((c) => c.id), ['v2'])
  assert.deepEqual(searchAll('  ', chars, convs, msgs).messages, [])
})

test('片段以关键词为中心', () => {
  const s = snippetAround('很久很久以前有一座雪城，城里有一座很高的钟楼，钟楼里住着一只猫头鹰', '钟楼', 4)
  assert.equal(s, '…座很高的钟楼，钟楼里…')
})
