/**
 * 相册数据读写。原图（Blob）与信息分表存放；删除先进入「最近删除」，可以恢复，彻底删除需要在「最近删除」中确认。
 * 删除相册不会删除照片：照片回到「全部照片」。
 */
import { db } from './db'
import type { Album, Photo } from './schema'
import { uid } from '../lib/util'
import { PHOTO_LIMITS, PhotoError, type PreparedPhoto } from '../life/photos'

export async function createAlbum(name: string): Promise<Album> {
  const n = name.trim().slice(0, 30)
  if (!n) throw new PhotoError('相册名称不能为空')
  const now = Date.now()
  const a: Album = { id: uid('alb'), name: n, createdAt: now, updatedAt: now }
  await db.albums.add(a)
  return a
}

export async function renameAlbum(id: string, name: string): Promise<void> {
  const n = name.trim().slice(0, 30)
  if (!n) throw new PhotoError('相册名称不能为空')
  await db.albums.update(id, { name: n, updatedAt: Date.now() })
}

/** 删除相册：照片不删除，只是不再属于这个相册 */
export async function deleteAlbum(id: string): Promise<void> {
  await db.transaction('rw', [db.albums, db.photos], async () => {
    await db.photos.where('albumId').equals(id).modify({ albumId: undefined, updatedAt: Date.now() })
    await db.albums.delete(id)
  })
}

/** 保存一张已处理好的照片（信息与原图在同一个事务中写入） */
export async function addPhoto(p: PreparedPhoto, albumId?: string): Promise<Photo> {
  const now = Date.now()
  const photo: Photo = {
    id: uid('pho'),
    albumId,
    name: p.name,
    note: '',
    width: p.width,
    height: p.height,
    mime: p.mime,
    bytes: p.blob.size,
    originalBytes: p.originalBytes,
    originalType: p.originalType,
    thumb: p.thumb,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', [db.photos, db.photoBlobs], async () => {
    await db.photoBlobs.put({ id: photo.id, blob: p.blob })
    await db.photos.add(photo)
  })
  return photo
}

export async function updatePhoto(id: string, patch: Partial<Pick<Photo, 'name' | 'note'>>): Promise<void> {
  const clean: Partial<Photo> = { updatedAt: Date.now() }
  if (patch.name !== undefined) clean.name = patch.name.trim().slice(0, PHOTO_LIMITS.name) || '照片'
  if (patch.note !== undefined) clean.note = patch.note.slice(0, PHOTO_LIMITS.note)
  await db.photos.update(id, clean)
}

export async function movePhotos(ids: string[], albumId: string | undefined): Promise<void> {
  if (albumId && !(await db.albums.get(albumId))) throw new PhotoError('相册不存在')
  await db.photos.where('id').anyOf(ids).modify({ albumId, updatedAt: Date.now() })
}

/** 移到「最近删除」（可恢复） */
export async function trashPhotos(ids: string[]): Promise<void> {
  await db.photos.where('id').anyOf(ids).modify({ deletedAt: Date.now() })
}

export async function restorePhotos(ids: string[]): Promise<void> {
  await db.photos.where('id').anyOf(ids).modify((p) => {
    delete p.deletedAt
    p.updatedAt = Date.now()
  })
}

/** 彻底删除（只允许已在「最近删除」中的照片） */
export async function purgePhotos(ids: string[]): Promise<number> {
  return db.transaction('rw', [db.photos, db.photoBlobs], async () => {
    const list = (await db.photos.bulkGet(ids)).filter((p): p is Photo => !!p && !!p.deletedAt)
    await db.photoBlobs.bulkDelete(list.map((p) => p.id))
    await db.photos.bulkDelete(list.map((p) => p.id))
    return list.length
  })
}

export async function getPhotoBlob(id: string): Promise<Blob | undefined> {
  return (await db.photoBlobs.get(id))?.blob
}

/** 照片占用的空间（显示图 + 缩略图的估算） */
export async function photoUsage(): Promise<{ count: number; bytes: number }> {
  const all = await db.photos.toArray()
  return { count: all.length, bytes: all.reduce((n, p) => n + p.bytes + Math.round(p.thumb.length * 0.75), 0) }
}
