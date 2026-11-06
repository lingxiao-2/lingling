/** 相册 PR A：格式预检、尺寸、搜索、存储提醒；相册与照片的增删改移、最近删除与恢复、彻底删除；v4→v5 迁移保留旧数据：npm test */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Dexie from 'dexie'
import { db } from '../src/db/db'
import { DB_SCHEMA_VERSION, type Photo } from '../src/db/schema'
import { addPhoto, createAlbum, deleteAlbum, getPhotoBlob, movePhotos, photoUsage, purgePhotos, renameAlbum, restorePhotos, trashPhotos, updatePhoto } from '../src/db/photoRepo'
import { defaultName, fitSize, isHeic, precheck, searchPhotos, storageWarning, type PreparedPhoto } from '../src/life/photos'

const prepared = (name = '雪', bytes = 1000): PreparedPhoto => ({
  name,
  blob: new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
  mime: 'image/jpeg',
  width: 2048,
  height: 1536,
  thumb: 'data:image/jpeg;base64,/9j/AAAA',
  originalBytes: bytes * 3,
  originalType: 'image/heic',
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

test('格式预检：支持 JPEG / PNG / HEIC 等；不支持的类型、过大、空文件明确拒绝；iPhone「文件」没有类型时看扩展名', () => {
  assert.equal(precheck({ name: 'a.jpg', type: 'image/jpeg', size: 10 }), null)
  assert.equal(precheck({ name: 'IMG_0001.HEIC', type: '', size: 10 }), null)
  assert.equal(precheck({ name: 'b.png', type: 'image/png', size: 10 }), null)
  assert.match(precheck({ name: 'x.pdf', type: 'application/pdf', size: 10 })!, /不是支持的图片格式/)
  assert.match(precheck({ name: 'big.jpg', type: 'image/jpeg', size: 50 * 1048576 })!, /太大/)
  assert.match(precheck({ name: 'e.jpg', type: 'image/jpeg', size: 0 })!, /空/)
  assert.ok(isHeic({ name: 'a.heif', type: '' }))
  assert.deepEqual(fitSize(4032, 3024, 2048), { width: 2048, height: 1536 })
  assert.deepEqual(fitSize(800, 600, 2048), { width: 800, height: 600 }, '不放大')
  assert.equal(defaultName('IMG_2024.HEIC'), 'IMG_2024')
})

test('搜索名称与备注；存储提醒', () => {
  const p = (name: string, note: string) => ({ name, note }) as Photo
  const list = [p('初雪', '和沈遥一起'), p('IMG_1', '咖啡店的窗'), p('海边', '')]
  assert.deepEqual(searchPhotos(list, '沈遥').map((x) => x.name), ['初雪'])
  assert.deepEqual(searchPhotos(list, 'img 窗').map((x) => x.name), ['IMG_1'])
  assert.equal(searchPhotos(list, '').length, 3)
  assert.match(storageWarning(90, 100, 0)!, /已用 90%/)
  assert.match(storageWarning(10, 100, 600 * 1048576)!, /600\.0 MB/)
  assert.equal(storageWarning(10, 100, 1000), null)
})

test('导入：信息与原图分开保存；改名、备注；移动到相册；删除相册不删除照片', async () => {
  const a = await createAlbum('  冬天  ')
  assert.equal(a.name, '冬天')
  await assert.rejects(createAlbum('  '), /不能为空/)
  const p1 = await addPhoto(prepared('第一张'), a.id)
  const p2 = await addPhoto(prepared('第二张'))
  assert.equal((await getPhotoBlob(p1.id))?.size, 1000)
  assert.equal((await db.photos.get(p1.id))!.albumId, a.id)
  await updatePhoto(p2.id, { name: '  ', note: '窗外的雪' })
  assert.equal((await db.photos.get(p2.id))!.name, '照片')
  assert.equal((await db.photos.get(p2.id))!.note, '窗外的雪')
  await movePhotos([p2.id], a.id)
  assert.equal((await db.photos.where('albumId').equals(a.id).count()), 2)
  await assert.rejects(movePhotos([p2.id], 'nope'), /不存在/)
  await renameAlbum(a.id, '初雪')
  assert.equal((await db.albums.get(a.id))!.name, '初雪')
  await deleteAlbum(a.id)
  assert.equal(await db.albums.count(), 0)
  assert.equal(await db.photos.count(), 2, '照片还在')
  assert.equal((await db.photos.get(p1.id))!.albumId, undefined)
  assert.deepEqual(await photoUsage(), { count: 2, bytes: 2000 + 2 * Math.round('data:image/jpeg;base64,/9j/AAAA'.length * 0.75) })
})

test('删除进入最近删除，可以恢复；只有最近删除中的照片才能彻底删除，原图一起删除', async () => {
  const p = await addPhoto(prepared())
  const q = await addPhoto(prepared())
  await trashPhotos([p.id])
  assert.ok((await db.photos.get(p.id))!.deletedAt)
  assert.equal(await purgePhotos([q.id]), 0, '没有在最近删除中的照片不会被彻底删除')
  assert.ok(await db.photos.get(q.id))
  await restorePhotos([p.id])
  assert.equal((await db.photos.get(p.id))!.deletedAt, undefined)
  await trashPhotos([p.id])
  assert.equal(await purgePhotos([p.id]), 1)
  assert.equal(await db.photos.get(p.id), undefined)
  assert.equal(await getPhotoBlob(p.id), undefined)
})

test('数据库 v4 → v5：已有的角色、聊天、设置原样保留，新增相册表', async () => {
  db.close()
  await Dexie.delete('lingling-ai')
  // 用 v4 的表结构建一个旧数据库
  const old = new Dexie('lingling-ai')
  old.version(1).stores({ characters: 'id, name, updatedAt', conversations: 'id, type, pinned, lastMessageAt', messages: 'id, conversationId, createdAt, [conversationId+createdAt]', messageVersions: 'id, messageId', memories: 'id, characterId, status, createdAt', moments: 'id, authorId, createdAt', stickers: 'id, packId', worlds: 'id', settings: 'key' })
  old.version(2).stores({ lorebooks: 'id, name, updatedAt', characterLorebooks: 'id, characterId, lorebookId, &[characterId+lorebookId]' })
  old.version(3).stores({ characters: 'id, name, updatedAt, worldId', worldLorebooks: 'id, worldId, lorebookId, &[worldId+lorebookId]' })
  old.version(4).stores({ stickers: 'id, packId, hash, createdAt', stickerImages: 'id', stickerAnalyses: 'hash' })
  await old.open()
  await old.table('characters').put({ id: 'c1', name: '沈遥', updatedAt: 1 })
  await old.table('messages').put({ id: 'm1', conversationId: 'v1', createdAt: 1, content: '你好' })
  await old.table('settings').put({ key: 'ai-config', value: { apiKey: 'sk-keep' } })
  old.close()
  await db.open()
  assert.equal(db.verno, DB_SCHEMA_VERSION)
  assert.ok(DB_SCHEMA_VERSION >= 5)
  assert.equal((await db.characters.get('c1'))!.name, '沈遥')
  assert.equal((await db.messages.get('m1'))!.content, '你好')
  assert.equal(((await db.settings.get('ai-config'))!.value as { apiKey: string }).apiKey, 'sk-keep', 'API Key 不变')
  assert.equal(await db.photos.count(), 0)
  await addPhoto(prepared())
  assert.equal(await db.photos.count(), 1)
})

test('预留的 AI 访问接口：只给元数据；原图必须明确授权；最近删除的不出现', async () => {
  const { listAlbumsMeta, listPhotoMeta, getGrantedPhoto } = await import('../src/life/albumAccess')
  const a = await createAlbum('冬天')
  const p1 = await addPhoto(prepared('初雪'), a.id)
  const p2 = await addPhoto(prepared('秘密'))
  await updatePhoto(p1.id, { note: '和沈遥' })
  await trashPhotos([p2.id])
  assert.deepEqual((await listAlbumsMeta()).map((x) => [x.name, x.photoCount]), [['全部照片', 1], ['冬天', 1]])
  const meta = await listPhotoMeta({ query: '沈遥' })
  assert.equal(meta.length, 1)
  assert.equal(meta[0].albumName, '冬天')
  assert.ok(!('thumb' in meta[0]) && !('blob' in meta[0]), '元数据里没有图片内容')
  assert.equal((await listPhotoMeta()).some((m) => m.id === p2.id), false, '最近删除的不出现')
  assert.equal(await getGrantedPhoto(p1.id, { photoIds: [] }), null, '没有授权拿不到原图')
  assert.equal((await getGrantedPhoto(p1.id, { photoIds: [p1.id] }))?.blob.size, 1000)
  assert.equal(await getGrantedPhoto(p2.id, { photoIds: [p2.id] }), null, '已删除的即使授权也拿不到')
})
