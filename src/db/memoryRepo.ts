/** 长期记忆的读写（每个角色独立） */
import { db } from './db'
import type { Memory, MemoryKind, MemoryPrefs } from './schema'
import { uid } from '../lib/util'
import { findDuplicate, memoryCheck, mergedContent, type MemoryProposal } from '../services/ai/memory'

export class MemoryError extends Error {}

export async function listMemories(characterId: string): Promise<Memory[]> {
  return db.memories.where('characterId').equals(characterId).toArray()
}

export async function addMemory(characterId: string, input: { kind: MemoryKind; content: string; pinned?: boolean; priority?: 1 | 2 | 3 }): Promise<Memory> {
  const content = input.content.trim()
  if (!content) throw new MemoryError('内容不能为空')
  const check = memoryCheck(content)
  if (!check.ok) throw new MemoryError(check.reason)
  const dup = findDuplicate(content, await listMemories(characterId))
  if (dup) throw new MemoryError(`和已有的记忆「${dup.content.slice(0, 30)}」重复，可以直接编辑那一条`)
  const now = Date.now()
  const worldId = (await db.characters.get(characterId))?.worldId
  const m: Memory = { id: uid('mem'), characterId, kind: input.kind, content: content.slice(0, 300), sourceMessageIds: [], status: 'active', origin: 'manual', sensitive: check.sensitive, pinned: !!input.pinned && !check.sensitive, priority: input.priority ?? 2, worldId, createdAt: now, updatedAt: now }
  await db.memories.add(m)
  return m
}

/**
 * 保存提议：新的写入为记忆（status 由调用方决定，默认待确认）；与已有记忆重复的只合并依据（来源消息、提到次数），内容不变。
 * 返回新增与合并的条数。
 */
export async function addProposals(
  characterId: string,
  ps: MemoryProposal[],
  opts: { status?: (p: MemoryProposal) => Memory['status']; priority?: 1 | 2 | 3 } = {},
): Promise<{ added: Memory[]; merged: number }> {
  const now = Date.now()
  const worldId = (await db.characters.get(characterId))?.worldId
  const added: Memory[] = []
  let merged = 0
  await db.transaction('rw', [db.memories], async () => {
    for (const p of ps) {
      if (p.mergeInto) {
        const m = await db.memories.get(p.mergeInto)
        if (!m || m.characterId !== characterId) continue
        const ids = p.sourceMessageIds.filter((x) => !m.sourceMessageIds.includes(x))
        if (!ids.length) continue
        await db.memories.update(m.id, { sourceMessageIds: [...m.sourceMessageIds, ...ids], mentions: (m.mentions ?? 1) + ids.length, quote: m.quote || p.quote, updatedAt: now })
        merged++
        continue
      }
      const row: Memory = { id: uid('mem'), characterId, kind: p.kind, content: p.content, sourceMessageIds: p.sourceMessageIds, quote: p.quote, origin: p.origin, sensitive: p.sensitive, status: opts.status?.(p) ?? 'pending', priority: opts.priority ?? 1, worldId, mentions: p.sourceMessageIds.length, createdAt: now, updatedAt: now }
      await db.memories.add(row)
      added.push(row)
    }
  })
  return { added, merged }
}

/** 合并两条记忆：内容取较完整的一条（或两句都保留），依据、提到次数合并，重要程度取较高的；另一条删除 */
export async function mergeMemories(keepId: string, dropId: string): Promise<void> {
  await db.transaction('rw', [db.memories], async () => {
    const a = await db.memories.get(keepId)
    const b = await db.memories.get(dropId)
    if (!a || !b || a.characterId !== b.characterId || a.id === b.id) throw new MemoryError('只能合并同一个角色的两条记忆')
    await db.memories.update(a.id, {
      content: mergedContent(a.content, b.content),
      sourceMessageIds: [...new Set([...a.sourceMessageIds, ...b.sourceMessageIds])],
      mentions: (a.mentions ?? 1) + (b.mentions ?? 1),
      priority: Math.max(a.priority ?? 1, b.priority ?? 1) as 1 | 2 | 3,
      pinned: (!!a.pinned || !!b.pinned) && !a.sensitive && !b.sensitive,
      sensitive: !!a.sensitive || !!b.sensitive,
      updatedAt: Date.now(),
    })
    // 来自聊天的留下空记录，避免同一句话再次被提议
    if (b.sourceMessageIds.length) await db.memories.update(b.id, { status: 'invalidated', content: '', quote: '', sourceMessageIds: [], updatedAt: Date.now() })
    else await db.memories.delete(b.id)
  })
}

export async function getMemoryPrefs(characterId: string): Promise<MemoryPrefs> {
  return (await db.characters.get(characterId))?.memoryPrefs ?? {}
}

export async function setMemoryPrefs(characterId: string, patch: Partial<MemoryPrefs>): Promise<void> {
  await db.transaction('rw', [db.characters], async () => {
    const c = await db.characters.get(characterId)
    if (!c) return
    // 只改 memoryPrefs，不更新角色的 updatedAt（不影响联系人排序）
    await db.characters.update(characterId, { memoryPrefs: { ...(c.memoryPrefs ?? {}), ...patch } })
  })
}

/** 敏感的待确认记忆最多保留 7 天：用户一直没有确认就清除内容，不长期保存 */
export const SENSITIVE_PENDING_DAYS = 7

export async function purgeStalePending(characterId: string, now = Date.now()): Promise<number> {
  const stale = (await db.memories.where('characterId').equals(characterId).toArray()).filter(
    (m) => m.status === 'pending' && m.sensitive && now - m.createdAt > SENSITIVE_PENDING_DAYS * 86_400_000,
  )
  for (const m of stale) await removeMemory(m)
  return stale.length
}

export async function updateMemory(id: string, patch: Partial<Pick<Memory, 'content' | 'kind' | 'pinned' | 'priority' | 'status' | 'sensitive' | 'worldId'>>): Promise<void> {
  if (patch.content !== undefined) {
    const check = memoryCheck(patch.content)
    if (!check.ok) throw new MemoryError(check.reason)
    patch = { ...patch, content: patch.content.trim().slice(0, 300) }
  }
  await db.memories.update(id, { ...patch, updatedAt: Date.now() })
}

/** 删除：来自聊天的记忆留下一条空记录，避免同一句话被再次自动提议；手写的直接删除 */
export async function removeMemory(m: Memory): Promise<void> {
  if (m.sourceMessageIds?.length) await db.memories.update(m.id, { status: 'invalidated', content: '', quote: '', updatedAt: Date.now() })
  else await db.memories.delete(m.id)
}
