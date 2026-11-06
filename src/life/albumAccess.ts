/**
 * 为下一阶段（AI 工具调用）预留的相册访问接口。本阶段没有任何 AI 调用这些函数。
 *
 *  - 只返回元数据（名称、备注、日期、尺寸、所在相册），不含缩略图和原图
 *  - 原图只能通过 getGrantedPhoto 获取，并且照片 ID 必须在用户明确授权的列表里
 *  - 最近删除中的照片不会出现在任何结果里
 *  - 不声称文本模型能看懂图片：是否、以及如何把图片交给支持识图的模型，由下一阶段在用户同意后决定
 */
import { db } from '../db/db'

export interface AlbumMeta {
  id: string
  name: string
  photoCount: number
}

export interface PhotoMeta {
  id: string
  name: string
  note: string
  albumId?: string
  albumName?: string
  importedAt: string
  width: number
  height: number
}

/** 用户对某些照片的明确授权（例如在对话中逐张选择） */
export interface PhotoGrant {
  photoIds: string[]
}

const iso = (ts: number) => new Date(ts).toISOString()

export async function listAlbumsMeta(): Promise<AlbumMeta[]> {
  const [albums, photos] = await Promise.all([db.albums.toArray(), db.photos.toArray()])
  const live = photos.filter((p) => !p.deletedAt)
  return [
    { id: 'all', name: '全部照片', photoCount: live.length },
    ...albums.map((a) => ({ id: a.id, name: a.name, photoCount: live.filter((p) => p.albumId === a.id).length })),
  ]
}

export async function listPhotoMeta(opts: { albumId?: string; query?: string; limit?: number } = {}): Promise<PhotoMeta[]> {
  const albums = new Map((await db.albums.toArray()).map((a) => [a.id, a.name]))
  const q = opts.query?.trim().toLowerCase()
  return (await db.photos.orderBy('createdAt').reverse().toArray())
    .filter((p) => !p.deletedAt && (!opts.albumId || opts.albumId === 'all' || p.albumId === opts.albumId))
    .filter((p) => !q || `${p.name}\n${p.note}`.toLowerCase().includes(q))
    .slice(0, Math.min(opts.limit ?? 50, 200))
    .map((p) => ({ id: p.id, name: p.name, note: p.note, albumId: p.albumId, albumName: p.albumId ? albums.get(p.albumId) : undefined, importedAt: iso(p.createdAt), width: p.width, height: p.height }))
}

/** 获取用户明确授权的一张照片的原图；没有授权、已删除或不存在时返回 null */
export async function getGrantedPhoto(id: string, grant: PhotoGrant): Promise<{ meta: PhotoMeta; blob: Blob } | null> {
  if (!grant.photoIds.includes(id)) return null
  const p = await db.photos.get(id)
  if (!p || p.deletedAt) return null
  const blob = (await db.photoBlobs.get(id))?.blob
  if (!blob) return null
  const albumName = p.albumId ? (await db.albums.get(p.albumId))?.name : undefined
  return { meta: { id: p.id, name: p.name, note: p.note, albumId: p.albumId, albumName, importedAt: iso(p.createdAt), width: p.width, height: p.height }, blob }
}
