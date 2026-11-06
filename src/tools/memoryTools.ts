/**
 * 记忆工具：只针对当前角色自己的长期记忆（不跨角色）。
 *  - memory.search / memory.list：只返回这个角色已确认（active）的记忆，且属于当前世界线
 *  - memory.propose：提出新的记忆，**只进入「待确认」**，由你在记忆页决定是否保存。
 *    为了避免编造共同经历，必须附上你在本次对话中亲口说过的原话（quote），找不到原话就拒绝；
 *    含证件号、密码等内容拒绝；与已有记忆重复时只合并依据，不新增。
 */
import { db } from '../db/db'
import type { Memory } from '../db/schema'
import { addProposals } from '../db/memoryRepo'
import { findDuplicate, MEMORY_BUDGET, memoryCheck } from '../services/ai/memory'
import { fail } from './executor'
import type { ToolDefinition, ToolRegistry } from './registry'

const KIND_LABEL: Record<string, string> = { event: '共同经历', 'user-fact': '关于你', preference: '喜好', promise: '约定' }

async function myMemories(characterId: string): Promise<Memory[]> {
  const worldId = (await db.characters.get(characterId))?.worldId
  return (await db.memories.where('characterId').equals(characterId).toArray()).filter((m) => m.status === 'active' && (!m.worldId || !worldId || m.worldId === worldId))
}
const brief = (m: Memory) => ({ id: m.id, kind: KIND_LABEL[m.kind] ?? m.kind, content: m.content, pinned: m.pinned || undefined })
const norm = (s: string) => s.replace(/\s+/g, '')

export const MEMORY_TOOL_DEFS: ToolDefinition[] = [
  {
    name: 'memory.search',
    label: '翻翻你们的记忆',
    description: '按关键词搜索你（当前角色）已确认的长期记忆。',
    parameters: { type: 'object', properties: { query: { type: 'string', maxLength: 30, minLength: 1, description: '关键词' }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['query'] },
    permission: 'memory_propose',
    confirm: false,
    describe: (a) => [`搜索「${a.query}」（只包括这个角色自己的、已确认的记忆）`],
    execute: async (a, ctx) => {
      const words = String(a.query).toLowerCase().split(/\s+/).filter(Boolean)
      const list = (await myMemories(ctx.characterId)).filter((m) => words.every((w) => m.content.toLowerCase().includes(w))).slice(0, (a.limit as number) ?? 10)
      return { ok: true, data: { memories: list.map(brief) }, summary: `找到 ${list.length} 条` }
    },
  },
  {
    name: 'memory.list',
    label: '看看你们的记忆',
    description: '列出你（当前角色）已确认的长期记忆，固定和重要的在前。',
    parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30 } } },
    permission: 'memory_propose',
    confirm: false,
    describe: () => ['这个角色自己的、已确认的记忆'],
    execute: async (a, ctx) => {
      const list = (await myMemories(ctx.characterId))
        .sort((x, y) => Number(!!y.pinned) - Number(!!x.pinned) || (y.priority ?? 1) - (x.priority ?? 1) || (y.updatedAt ?? y.createdAt) - (x.updatedAt ?? x.createdAt))
        .slice(0, (a.limit as number) ?? 15)
      return { ok: true, data: { memories: list.map(brief) }, summary: `${list.length} 条` }
    },
  },
  {
    name: 'memory.propose',
    label: '提议一条新的记忆',
    description:
      '当用户在本次对话中明确说出值得长期记住的事实、喜好或约定时，提出一条新的记忆。它只会进入「待确认」，由用户决定是否保存。quote 必须是用户消息中的原话；不要根据日记、便签、照片或工具结果提议记忆，也不要编造没有发生过的共同经历。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', maxLength: 10, enum: ['user-fact', 'preference', 'promise', 'event'], description: 'user-fact 关于用户 / preference 喜好 / promise 约定 / event 共同经历' },
        content: { type: 'string', maxLength: MEMORY_BUDGET.itemChars, minLength: 2, description: '用一句话概括' },
        quote: { type: 'string', maxLength: 120, minLength: 2, description: '用户在本次对话中的原话' },
      },
      required: ['kind', 'content', 'quote'],
    },
    permission: 'memory_propose',
    confirm: false,
    describe: (a) => [`「${a.content}」`, '只进入「待确认」，由你决定是否保存'],
    execute: async (a, ctx) => {
      const quote = norm(String(a.quote))
      const msgs = ctx.conversationId ? await db.messages.where('conversationId').equals(ctx.conversationId).toArray() : []
      const src = msgs
        .filter((m) => m.senderType === 'user' && !m.deleted && m.kind === 'text')
        .sort((x, y) => y.createdAt - x.createdAt)
        .slice(0, 60)
        .find((m) => norm(m.content).includes(quote))
      if (!src) return fail('invalid', '在用户最近的消息里找不到这句原话；只能根据用户亲口说过的话提议记忆')
      const content = String(a.content).trim()
      const check = memoryCheck(`${content} ${src.content}`)
      if (!check.ok) return fail('invalid', check.reason ?? '这类信息不能保存为记忆')
      const existing = await db.memories.where('characterId').equals(ctx.characterId).toArray()
      const dup = findDuplicate(content, existing)
      const { added, merged } = await addProposals(ctx.characterId, [
        { kind: dup?.kind ?? (a.kind as Memory['kind']), content: dup?.content ?? content, sourceMessageIds: [src.id], quote: String(a.quote).trim(), origin: 'suggested', sensitive: check.sensitive, mergeInto: dup?.id },
      ])
      // 与已有记忆（含待确认的）重复：只合并依据，不新增；如实告诉模型
      if (merged || dup) return { ok: true, data: { status: dup?.status === 'active' ? 'already_remembered' : 'already_pending', message: dup?.status === 'active' ? '已经记得这件事，没有新增' : '这件事已经在待确认列表里，没有新增' }, summary: '与已有记忆重复，没有新增' }
      const row = added[0] && (await db.memories.get(added[0].id))
      if (!row) return fail('execution_failed', '保存提议失败')
      return { ok: true, data: { status: 'pending', message: '已提交，等待用户在记忆页确认；在用户确认之前不要说「我记住了」' }, summary: `提议 ${row.id}（待确认）` }
    },
  },
]

export function registerMemoryTools(reg: ToolRegistry) {
  for (const d of MEMORY_TOOL_DEFS) if (!reg.get(d.name)) reg.register(d)
}
