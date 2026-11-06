/** 长期记忆的读写（每个角色独立） */
import { db } from './db'
import type { Memory, MemoryKind } from './schema'
import { uid } from '../lib/util'
import { findDuplicate, memoryCheck, type MemoryProposal } from '../services/ai/memory'

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
  const m: Memory = { id: uid('mem'), characterId, kind: input.kind, content: content.slice(0, 300), sourceMessageIds: [], status: 'active', origin: 'manual', sensitive: check.sensitive, pinned: !!input.pinned && !check.sensitive, priority: input.priority ?? 2, createdAt: now, updatedAt: now }
  await db.memories.add(m)
  return m
}

export async function addProposals(characterId: string, ps: MemoryProposal[]): Promise<number> {
  const now = Date.now()
  const rows: Memory[] = ps.map((p) => ({ id: uid('mem'), characterId, kind: p.kind, content: p.content, sourceMessageIds: p.sourceMessageIds, quote: p.quote, origin: p.origin, sensitive: p.sensitive, status: 'pending', priority: 1, createdAt: now, updatedAt: now }))
  await db.memories.bulkAdd(rows)
  return rows.length
}

export async function updateMemory(id: string, patch: Partial<Pick<Memory, 'content' | 'kind' | 'pinned' | 'priority' | 'status' | 'sensitive'>>): Promise<void> {
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
