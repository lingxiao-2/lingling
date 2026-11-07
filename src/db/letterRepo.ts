/**
 * 信件：草稿、寄出、收到、收藏、已读、删除与恢复。每封信只属于一个角色；查询都按角色或方向过滤。
 */
import { db } from './db'
import type { Letter, PaperId } from './schema'
import { uid } from '../lib/util'

export const LETTER_LIMITS = { subject: 40, body: 4000 }
export const PAPERS: { id: PaperId; name: string }[] = [
  { id: 'snow', name: '初雪' },
  { id: 'starlight', name: '星光' },
  { id: 'parchment', name: '旧信笺' },
  { id: 'night', name: '夜空' },
  { id: 'blossom', name: '早樱' },
]
export const isPaper = (p: unknown): p is PaperId => PAPERS.some((x) => x.id === p)

export class LetterError extends Error {}

export async function saveDraft(id: string | null, patch: { characterId: string; subject?: string; body?: string; paper?: PaperId; replyToId?: string }): Promise<string> {
  const now = Date.now()
  const clean = {
    characterId: patch.characterId,
    subject: (patch.subject ?? '').slice(0, LETTER_LIMITS.subject),
    body: (patch.body ?? '').slice(0, LETTER_LIMITS.body),
    paper: isPaper(patch.paper) ? patch.paper : 'snow',
    ...(patch.replyToId ? { replyToId: patch.replyToId } : {}),
  }
  if (id) {
    const cur = await db.letters.get(id)
    if (!cur || cur.status !== 'draft') throw new LetterError('草稿不存在或已经寄出')
    await db.letters.update(id, { ...clean, updatedAt: now })
    return id
  }
  const l: Letter = { id: uid('ltr'), direction: 'from_user', status: 'draft', read: true, starred: false, createdAt: now, updatedAt: now, ...clean }
  await db.letters.add(l)
  return l.id
}

/** 寄出草稿：标题或正文不能为空 */
export async function sendDraft(id: string): Promise<Letter> {
  return db.transaction('rw', db.letters, async () => {
    const l = await db.letters.get(id)
    if (!l || l.status !== 'draft') throw new LetterError('草稿不存在或已经寄出')
    if (!l.body.trim()) throw new LetterError('信的内容不能为空')
    const now = Date.now()
    const next: Letter = { ...l, subject: l.subject.trim() || '无题', status: 'sent', sentAt: now, updatedAt: now }
    await db.letters.put(next)
    return next
  })
}

/** 保存一封角色来信（只由生成流程调用，内容来自真实的模型输出） */
export async function receiveLetter(o: { characterId: string; subject: string; body: string; paper: PaperId; model: string; replyToId?: string; prompt?: string }): Promise<Letter> {
  const now = Date.now()
  const l: Letter = { id: uid('ltr'), characterId: o.characterId, direction: 'from_character', status: 'received', subject: o.subject.slice(0, LETTER_LIMITS.subject) || '无题', body: o.body.slice(0, LETTER_LIMITS.body), paper: o.paper, read: false, starred: false, model: o.model, replyToId: o.replyToId, prompt: o.prompt, createdAt: now, updatedAt: now, sentAt: now }
  await db.letters.add(l)
  return l
}

export async function markRead(id: string) {
  const l = await db.letters.get(id)
  if (l && !l.read) await db.letters.update(id, { read: true })
}
export async function toggleStar(id: string): Promise<boolean> {
  const l = await db.letters.get(id)
  if (!l) return false
  await db.letters.update(id, { starred: !l.starred })
  return !l.starred
}
export async function trashLetter(id: string) {
  await db.letters.update(id, { deletedAt: Date.now() })
}
export async function restoreLetter(id: string) {
  await db.letters.update(id, { deletedAt: undefined })
}
/** 彻底删除：只允许已经在「最近删除」里的 */
export async function purgeLetter(id: string): Promise<boolean> {
  const l = await db.letters.get(id)
  if (!l?.deletedAt) return false
  await db.letters.delete(id)
  return true
}

export type Folder = 'inbox' | 'sent' | 'drafts' | 'starred' | 'trash'

export function inFolder(l: Letter, f: Folder): boolean {
  if (f === 'trash') return !!l.deletedAt
  if (l.deletedAt) return false
  if (f === 'inbox') return l.direction === 'from_character'
  if (f === 'sent') return l.direction === 'from_user' && l.status === 'sent'
  if (f === 'drafts') return l.status === 'draft'
  return l.starred
}

export function searchLetters(list: Letter[], q: string, names: Map<string, string> = new Map()): Letter[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return list
  return list.filter((l) => {
    const hay = `${l.subject}\n${l.body}\n${names.get(l.characterId) ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** 和某个角色之间的往来（只包括这个角色的，按时间） */
export async function correspondence(characterId: string): Promise<Letter[]> {
  return (await db.letters.where('characterId').equals(characterId).sortBy('createdAt')).filter((l) => !l.deletedAt && l.status !== 'draft')
}
