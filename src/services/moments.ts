/**
 * 动态（朋友圈）的纯函数：校验、可见范围、动态列表、点赞与评论的计算。不依赖 IndexedDB，便于测试。
 *
 *  - 动态、图片、点赞和评论都只保存在本机 IndexedDB，不上传
 *  - 可见范围只决定哪些角色能「看到」并互动：all 所有角色 · private 仅自己 · some 指定角色
 *  - 删除是软删除：隐藏后可以撤销，不会真正删除数据
 */
import type { Moment, MomentActor, MomentComment } from '../db/schema'

export const MOMENT_LIMITS = {
  /** 正文最多字数 */
  text: 2000,
  /** 最多配图张数 */
  images: 9,
  /** 评论最多字数 */
  comment: 300,
  /** 单张配图压缩后的最长边（像素） */
  imageSide: 1280,
  /** 单张配图压缩后的最大体积（字节，按 dataURL 估算） */
  imageBytes: 900_000,
}

export class MomentError extends Error {}

export const USER_ACTOR: MomentActor = { type: 'user', id: 'user' }

export function sameActor(a: MomentActor, b: MomentActor): boolean {
  return a.type === b.type && a.id === b.id
}

/** 只接受本机图片的 dataURL（与表情包相同的安全要求），拒绝网址和 SVG */
export function isSafeMomentImage(src: string): boolean {
  return /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)
}

export interface MomentDraft {
  content: string
  images: string[]
  visibility: Moment['visibility']
  visibleTo?: string[]
}

/** 发布前的校验与整理：返回可以直接保存的字段，问题会抛出 MomentError（中文说明） */
export function normalizeDraft(d: MomentDraft): Required<MomentDraft> {
  const content = d.content.replace(/\r\n/g, '\n').trim()
  const images = d.images.filter(Boolean)
  if (!content && !images.length) throw new MomentError('写点什么，或者配一张图片')
  if (content.length > MOMENT_LIMITS.text) throw new MomentError(`正文最多 ${MOMENT_LIMITS.text} 字，现在是 ${content.length} 字`)
  if (images.length > MOMENT_LIMITS.images) throw new MomentError(`最多 ${MOMENT_LIMITS.images} 张图片`)
  if (images.some((x) => !isSafeMomentImage(x))) throw new MomentError('图片格式不正确，请重新选择')
  const visibleTo = d.visibility === 'some' ? [...new Set(d.visibleTo ?? [])] : []
  if (d.visibility === 'some' && !visibleTo.length) throw new MomentError('「部分角色可见」至少要选择一个角色')
  return { content, images, visibility: d.visibility, visibleTo }
}

/** 某个角色能否看到这条动态（角色自己发的总能看到；用户的动态按可见范围） */
export function visibleToCharacter(m: Moment, characterId: string): boolean {
  if (m.deleted) return false
  if (m.authorType === 'character') return m.authorId === characterId || m.visibility !== 'private'
  if (m.visibility === 'all') return true
  if (m.visibility === 'some') return !!m.visibleTo?.includes(characterId)
  return false
}

/** 动态列表：隐藏已删除的，按时间从新到旧 */
export function feed(moments: Moment[]): Moment[] {
  return moments.filter((m) => !m.deleted).sort((a, b) => b.createdAt - a.createdAt)
}

export function hasLiked(m: Moment, actor: MomentActor): boolean {
  return !!m.likes?.some((l) => sameActor(l, actor))
}

/** 点赞 / 取消点赞后的点赞列表（同一人只算一次） */
export function toggledLikes(m: Moment, actor: MomentActor, now = Date.now()): NonNullable<Moment['likes']> {
  const likes = m.likes ?? []
  return hasLiked(m, actor) ? likes.filter((l) => !sameActor(l, actor)) : [...likes, { ...actor, at: now }]
}

/** 当前显示的评论（隐藏已删除的，按时间排序） */
export function visibleComments(m: Moment): MomentComment[] {
  return (m.comments ?? []).filter((c) => !c.deleted).sort((a, b) => a.createdAt - b.createdAt)
}

export function checkComment(text: string): string {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (!t) throw new MomentError('评论不能为空')
  if (t.length > MOMENT_LIMITS.comment) throw new MomentError(`评论最多 ${MOMENT_LIMITS.comment} 字`)
  return t
}

/** 可见范围的说明文字 */
export function visibilityLabel(m: Pick<Moment, 'visibility' | 'visibleTo'>, nameOf: (id: string) => string = (x) => x): string {
  if (m.visibility === 'private') return '仅自己可见'
  if (m.visibility === 'some') {
    const names = (m.visibleTo ?? []).map(nameOf).filter(Boolean)
    return names.length ? `${names.slice(0, 3).join('、')}${names.length > 3 ? ` 等 ${names.length} 个角色` : ''}可见` : '部分角色可见'
  }
  return '所有角色可见'
}

/** 动态的时间：刚刚 / x 分钟前 / x 小时前 / 昨天 / 日期 */
export function momentTime(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ts)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (ts >= startOfToday) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (ts >= startOfToday - 86_400_000) return '昨天'
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === today.getFullYear() ? md : `${d.getFullYear()}年${md}`
}
