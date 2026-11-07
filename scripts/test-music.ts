/**
 * 第八阶段 PR A：音乐（ID3 标签、文件名、曲目与歌单、删除清理、播放队列逻辑）：npm test
 * Node 自动测试；真实播放需要浏览器（scripts/e2e/music.cjs）与 iPhone 真机验证。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { addToPlaylist, addTrack, createPlaylist, deletePlaylist, deleteTracks, formatDuration, getTrackBlob, moveInPlaylist, removeFromPlaylist, renamePlaylist, toggleFavorite, updateTrack } from '../src/db/musicRepo'
import { readId3, titleFromFile } from '../src/music/id3'
import { nextIndex, prevIndex, shuffledOrder, type QueueState } from '../src/music/queue'
import { mimeOf } from '../src/music/importAudio'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

/** 构造一个 ID3v2.3 标签 */
function id3(frames: [string, Uint8Array][]): Uint8Array {
  const body = frames.map(([id, data]) => {
    const h = new Uint8Array(10)
    h.set([...id].map((c) => c.charCodeAt(0)), 0)
    new DataView(h.buffer).setUint32(4, data.length)
    return [h, data]
  }).flat()
  const size = body.reduce((n, b) => n + b.length, 0)
  const head = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f])
  const out = new Uint8Array(10 + size)
  out.set(head)
  let o = 10
  for (const b of body) { out.set(b, o); o += b.length }
  return out
}
const utf8 = (s: string) => new Uint8Array([3, ...new TextEncoder().encode(s)])
const utf16 = (s: string) => { const b = [1, 0xff, 0xfe]; for (const c of s) { const x = c.charCodeAt(0); b.push(x & 0xff, x >> 8) } return new Uint8Array(b) }

test('ID3：读取标题、歌手、专辑（UTF-8 / UTF-16）与封面；不是 ID3 的返回空', () => {
  const cover = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  const apic = new Uint8Array([0, ...new TextEncoder().encode('image/jpeg'), 0, 3, 0, ...cover])
  const t = readId3(id3([['TIT2', utf8('初雪')], ['TPE1', utf16('银河乐队')], ['TALB', utf8('冬日来信')], ['APIC', apic]]))
  assert.equal(t.title, '初雪')
  assert.equal(t.artist, '银河乐队')
  assert.equal(t.album, '冬日来信')
  assert.equal(t.cover!.mime, 'image/jpeg')
  assert.deepEqual([...t.cover!.data], [...cover])
  assert.deepEqual(readId3(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])), {})
  assert.deepEqual(readId3(new Uint8Array(4)), {})
})

test('文件名：去扩展名；「歌手 - 标题」拆开；格式识别', () => {
  assert.deepEqual(titleFromFile('银河乐队 - 初雪.mp3'), { artist: '银河乐队', title: '初雪' })
  assert.deepEqual(titleFromFile('voice memo.m4a'), { title: 'voice memo' })
  assert.equal(mimeOf({ name: 'a.M4A', type: '' }), 'audio/mp4')
  assert.equal(mimeOf({ name: 'a.wav', type: 'audio/x-wav' }), 'audio/x-wav')
  assert.equal(mimeOf({ name: 'a.txt', type: 'text/plain' }), '')
  assert.equal(formatDuration(185.4), '3:05')
  assert.equal(formatDuration(0), '--:--')
})

const meta = (title: string) => ({ title, artist: '歌手', album: '', duration: 120, mime: 'audio/mpeg', bytes: 3, fileName: `${title}.mp3` })

test('曲目：保存元数据与音频文件；收藏；编辑；删除时同时删除文件并从所有歌单移除', async () => {
  const a = await addTrack(meta('一'), new Blob([new Uint8Array([1, 2, 3])]))
  const b = await addTrack(meta('二'), new Blob([new Uint8Array([4])]))
  assert.equal((await getTrackBlob(a.id))!.size, 3)
  assert.equal(await toggleFavorite(a.id), true)
  assert.equal((await db.tracks.get(a.id))!.favorite, true)
  await updateTrack(a.id, { title: '  ', artist: '新歌手' })
  assert.deepEqual([(await db.tracks.get(a.id))!.title, (await db.tracks.get(a.id))!.artist], ['未命名', '新歌手'])
  const p1 = await createPlaylist('冬天')
  const p2 = await createPlaylist('夜晚')
  await addToPlaylist(p1.id, [a.id, b.id])
  await addToPlaylist(p2.id, [a.id])
  await deleteTracks([a.id])
  assert.equal(await db.tracks.get(a.id), undefined)
  assert.equal(await getTrackBlob(a.id), undefined)
  assert.deepEqual((await db.playlists.get(p1.id))!.trackIds, [b.id])
  assert.deepEqual((await db.playlists.get(p2.id))!.trackIds, [])
})

test('歌单：创建、重命名、不重复加入、调整顺序、移出、删除歌单不删歌曲', async () => {
  const ids = await Promise.all(['一', '二', '三'].map(async (x) => (await addTrack(meta(x), new Blob([]))).id))
  await assert.rejects(createPlaylist('  '), /不能为空/)
  const p = await createPlaylist('冬天')
  assert.equal(await addToPlaylist(p.id, [ids[0], ids[1], ids[0]]), 2)
  assert.equal(await addToPlaylist(p.id, [ids[1], ids[2]]), 1)
  await moveInPlaylist(p.id, 2, 0)
  assert.deepEqual((await db.playlists.get(p.id))!.trackIds, [ids[2], ids[0], ids[1]])
  await moveInPlaylist(p.id, 0, 9)
  assert.deepEqual((await db.playlists.get(p.id))!.trackIds, [ids[2], ids[0], ids[1]], '越界不动')
  await removeFromPlaylist(p.id, ids[0])
  await renamePlaylist(p.id, '下雪天')
  assert.deepEqual([(await db.playlists.get(p.id))!.name, (await db.playlists.get(p.id))!.trackIds], ['下雪天', [ids[2], ids[1]]])
  await deletePlaylist(p.id)
  assert.equal(await db.tracks.count(), 3)
})

const q = (o: Partial<QueueState>): QueueState => ({ queue: ['a', 'b', 'c'], index: 0, repeat: 'off', shuffle: false, order: [], ...o })
test('播放队列：顺序播放、列表循环、单曲循环（自动重复，手动换歌）、上一首、随机播放每首只出现一次', () => {
  assert.equal(nextIndex(q({ index: 1 }), 'auto'), 2)
  assert.equal(nextIndex(q({ index: 2 }), 'auto'), -1, '最后一首播完停止')
  assert.equal(nextIndex(q({ index: 2 }), 'manual'), 0)
  assert.equal(nextIndex(q({ index: 2, repeat: 'all' }), 'auto'), 0)
  assert.equal(nextIndex(q({ index: 1, repeat: 'one' }), 'auto'), 1)
  assert.equal(nextIndex(q({ index: 1, repeat: 'one' }), 'manual'), 2)
  assert.equal(prevIndex(q({ index: 0 })), 2)
  const order = shuffledOrder(10, 3, () => 0.42)
  assert.equal(order[0], 3)
  assert.deepEqual([...order].sort((x, y) => x - y), [...Array(10).keys()])
  const s = q({ shuffle: true, order: [1, 2, 0], index: 1 })
  assert.equal(nextIndex(s, 'auto'), 2)
  assert.equal(nextIndex({ ...s, index: 0 }, 'auto'), -1)
  assert.equal(prevIndex({ ...s, index: 2 }), 1)
  assert.equal(nextIndex(q({ queue: [] }), 'auto'), -1)
})
