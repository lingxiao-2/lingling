/**
 * 音乐数据：曲目（元数据）、音频文件、歌单。全部保存在本机 IndexedDB，不上传。
 * 删除曲目时同时删除音频文件，并从所有歌单中移除。
 */
import { db } from './db'
import type { Playlist, Track } from './schema'
import { uid } from '../lib/util'

export const MUSIC_LIMITS = { fileBytes: 80 * 1024 * 1024, batch: 30, title: 120, playlistName: 40 }
export const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|caf|aiff?)$/i

export class MusicError extends Error {}

export async function addTrack(meta: Omit<Track, 'id' | 'createdAt' | 'favorite'>, blob: Blob): Promise<Track> {
  const t: Track = { ...meta, title: (meta.title || meta.fileName).slice(0, MUSIC_LIMITS.title), artist: meta.artist.slice(0, MUSIC_LIMITS.title), album: meta.album.slice(0, MUSIC_LIMITS.title), id: uid('trk'), favorite: false, createdAt: Date.now() }
  await db.transaction('rw', [db.tracks, db.trackBlobs], async () => {
    await db.trackBlobs.add({ id: t.id, blob })
    await db.tracks.add(t)
  })
  return t
}

export async function getTrackBlob(id: string): Promise<Blob | undefined> {
  return (await db.trackBlobs.get(id))?.blob
}

export async function updateTrack(id: string, patch: Partial<Pick<Track, 'title' | 'artist' | 'album' | 'duration'>>): Promise<void> {
  const clean: Partial<Track> = {}
  if (patch.title !== undefined) clean.title = patch.title.trim().slice(0, MUSIC_LIMITS.title) || '未命名'
  if (patch.artist !== undefined) clean.artist = patch.artist.trim().slice(0, MUSIC_LIMITS.title)
  if (patch.album !== undefined) clean.album = patch.album.trim().slice(0, MUSIC_LIMITS.title)
  if (patch.duration !== undefined && Number.isFinite(patch.duration)) clean.duration = patch.duration
  await db.tracks.update(id, clean)
}

export async function toggleFavorite(id: string): Promise<boolean> {
  const t = await db.tracks.get(id)
  if (!t) return false
  await db.tracks.update(id, { favorite: !t.favorite })
  return !t.favorite
}

export async function deleteTracks(ids: string[]): Promise<void> {
  await db.transaction('rw', [db.tracks, db.trackBlobs, db.playlists], async () => {
    await db.tracks.bulkDelete(ids)
    await db.trackBlobs.bulkDelete(ids)
    const del = new Set(ids)
    for (const p of await db.playlists.toArray()) {
      if (p.trackIds.some((x) => del.has(x))) await db.playlists.update(p.id, { trackIds: p.trackIds.filter((x) => !del.has(x)), updatedAt: Date.now() })
    }
  })
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const n = name.trim().slice(0, MUSIC_LIMITS.playlistName)
  if (!n) throw new MusicError('歌单名称不能为空')
  const p: Playlist = { id: uid('pl'), name: n, trackIds: [], createdAt: Date.now(), updatedAt: Date.now() }
  await db.playlists.add(p)
  return p
}

export async function renamePlaylist(id: string, name: string): Promise<void> {
  const n = name.trim().slice(0, MUSIC_LIMITS.playlistName)
  if (!n) throw new MusicError('歌单名称不能为空')
  await db.playlists.update(id, { name: n, updatedAt: Date.now() })
}

export async function deletePlaylist(id: string): Promise<void> {
  await db.playlists.delete(id)
}

/** 加入歌单（已在歌单里的不重复加入）；返回实际加入的数量 */
export async function addToPlaylist(id: string, trackIds: string[]): Promise<number> {
  return db.transaction('rw', db.playlists, async () => {
    const p = await db.playlists.get(id)
    if (!p) throw new MusicError('歌单不存在')
    const add = trackIds.filter((t, i) => !p.trackIds.includes(t) && trackIds.indexOf(t) === i)
    await db.playlists.update(id, { trackIds: [...p.trackIds, ...add], updatedAt: Date.now() })
    return add.length
  })
}

export async function removeFromPlaylist(id: string, trackId: string): Promise<void> {
  const p = await db.playlists.get(id)
  if (p) await db.playlists.update(id, { trackIds: p.trackIds.filter((x) => x !== trackId), updatedAt: Date.now() })
}

/** 调整歌单内顺序 */
export async function moveInPlaylist(id: string, from: number, to: number): Promise<void> {
  const p = await db.playlists.get(id)
  if (!p || from < 0 || from >= p.trackIds.length || to < 0 || to >= p.trackIds.length) return
  const list = [...p.trackIds]
  const [x] = list.splice(from, 1)
  list.splice(to, 0, x)
  await db.playlists.update(id, { trackIds: list, updatedAt: Date.now() })
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '--:--'
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
