/** 动态（朋友圈）的读写。删除均为软删除，可以撤销，不会真正删除数据。 */
import { db } from './db'
import type { Moment, MomentActor, MomentComment } from './schema'
import { uid } from '../lib/util'
import { checkComment, MomentError, normalizeDraft, toggledLikes, type MomentDraft } from '../services/moments'

/** 用户发布一条动态 */
export async function createMoment(draft: MomentDraft, author: MomentActor = { type: 'user', id: 'user' }): Promise<Moment> {
  const d = normalizeDraft(draft)
  const now = Date.now()
  const m: Moment = {
    id: uid('mom'),
    authorType: author.type,
    authorId: author.id,
    content: d.content,
    imageRefs: d.images,
    visibility: d.visibility,
    visibleTo: d.visibility === 'some' ? d.visibleTo : undefined,
    likes: [],
    comments: [],
    createdAt: now,
    updatedAt: now,
  }
  await db.moments.add(m)
  return m
}

async function mutate(id: string, fn: (m: Moment) => Partial<Moment>): Promise<Moment> {
  return db.transaction('rw', [db.moments], async () => {
    const m = await db.moments.get(id)
    if (!m) throw new MomentError('这条动态不存在了')
    const patch = { ...fn(m), updatedAt: Date.now() }
    await db.moments.update(id, patch)
    return { ...m, ...patch }
  })
}

/** 删除（软删除）：从列表中隐藏，可以用 restoreMoment 撤销 */
export function deleteMoment(id: string): Promise<Moment> {
  return mutate(id, () => ({ deleted: true }))
}

export function restoreMoment(id: string): Promise<Moment> {
  return mutate(id, () => ({ deleted: false }))
}

export function toggleLike(id: string, actor: MomentActor): Promise<Moment> {
  return mutate(id, (m) => ({ likes: toggledLikes(m, actor) }))
}

export async function addComment(id: string, author: MomentActor, text: string, replyTo?: MomentActor): Promise<MomentComment> {
  const content = checkComment(text)
  const c: MomentComment = { id: uid('cmt'), author, content, replyTo, createdAt: Date.now() }
  await mutate(id, (m) => {
    if (m.deleted) throw new MomentError('这条动态已经删除')
    return { comments: [...(m.comments ?? []), c] }
  })
  return c
}

/** 删除评论（软删除，可撤销） */
export function deleteComment(id: string, commentId: string, deleted = true): Promise<Moment> {
  return mutate(id, (m) => ({ comments: (m.comments ?? []).map((c) => (c.id === commentId ? { ...c, deleted } : c)) }))
}
