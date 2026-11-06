/** 批量文本导入：真实样例 31 行的解析、链接清洗与候选、下载校验、去重、部分失败：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchBatch, fetchItem, parseBatchText, parseLine } from '../src/services/batchText'
import { LinkError, type Fetched } from '../src/services/linkImport'
import type { PreparedSticker } from '../src/services/stickers'

const SAMPLE = readFileSync('scripts/fixtures/stickers/batch-sample.txt', 'utf8')
const gif = new Uint8Array(readFileSync('scripts/fixtures/stickers/anim.gif'))

test('真实样例：31 行全部识别出名称和链接', () => {
  const lines = parseBatchText(SAMPLE)
  assert.equal(lines.length, 31)
  assert.ok(lines.every((l) => !l.error && l.candidates.length >= 1))
  const byLine = (n: number) => lines.find((l) => l.line === n)!
  assert.equal(byLine(1).name, '会不会有点营养不良了')
  assert.equal(byLine(2).name, '删掉，腰不想要了？')
  assert.equal(byLine(8).name, '去哪 和谁 回来还爱我不')
  // 没有冒号
  assert.equal(byLine(10).name, '我在你心里的重量（Okg）')
  assert.equal(byLine(10).candidates[0].url, 'https://i.imgant.com/v2/C6eN4c1.jpeg')
  assert.equal(byLine(30).name, '我草泥马，再发这个我打死你，我下手很重的')
  assert.equal(byLine(31).candidates[0].url, 'https://i.imgant.com/v2/itpBKTZ.jpeg')
})

test('异常链接：缺点号、空格、.peg 笔误给出修正候选并保留原链接；/V2/ 原样优先', () => {
  const lines = parseBatchText(SAMPLE)
  const l14 = lines.find((l) => l.line === 14)!
  assert.equal(l14.candidates[0].url, 'https://i.imgant.com/v2/LRiBynt.jpeg')
  assert.match(l14.candidates[0].fix!, /补上点号/)
  assert.equal(l14.candidates[1].url, 'https://i.imgant.com/v2/LRiByntjpeg')
  assert.match(l14.warning!, /缺少点号/)
  const l20 = lines.find((l) => l.line === 20)!
  assert.equal(l20.candidates[0].url, 'https://i.imgant.com/v2/hELc3LX.jpeg')
  assert.deepEqual(l20.cleaned, ['链接中有空格，已去掉'])
  const l25 = lines.find((l) => l.line === 25)!
  assert.equal(l25.candidates[0].url, 'https://i.imgant.com/v2/vitpp98.jpeg')
  assert.equal(l25.candidates[1].url, 'https://i.imgant.com/v2/vitpp98.peg')
  assert.match(l25.warning!, /无法确认/)
  const l2 = lines.find((l) => l.line === 2)!
  assert.equal(l2.candidates[0].url, 'https://i.imgant.com/V2/K893NeG.jpeg')
  assert.equal(l2.candidates[0].fix, undefined)
  assert.equal(l2.candidates[1].url, 'https://i.imgant.com/v2/K893NeG.jpeg')
})

test('各种分隔方式、空行、无效行', () => {
  const p = parseBatchText('开心：https://a.com/1.png\n\n  \n开心2: https://a.com/2.png\n开心3：  https://a.com/3.png\n开心4 https://a.com/4.png\n开心5https://a.com/5.png\n只有文字没有链接\n坏链接：https://\n12. 编号 https://a.com/6.png。')
  assert.deepEqual(p.map((x) => x.name), ['开心', '开心2', '开心3', '开心4', '开心5', '只有文字没有链接', '坏链接', '编号'])
  assert.deepEqual(p.map((x) => x.line), [1, 4, 5, 6, 7, 8, 9, 10])
  assert.match(p[5].error!, /没有找到链接/)
  assert.match(p[6].error!, /不是有效链接/)
  assert.equal(p[7].candidates[0].url, 'https://a.com/6.png')
  assert.ok(p[7].cleaned.some((c) => /标点/.test(c)))
  assert.equal(parseLine('名字：ftp://a.com/x.png', 1)!.error, '没有找到链接（需要以 http:// 或 https:// 开头）')
})

const prep = async (b: Uint8Array): Promise<PreparedSticker> => ({ hash: `h${b[0]}-${b.length}`, dataUrl: 'data:image/gif;base64,AA', thumbUrl: 'data:image/png;base64,AA', mime: 'image/gif', width: 1, height: 1, bytes: b.length } as PreparedSticker)

test('下载：默认只试原链接；原链接失败时给出修正建议，用户确认后才用修正链接；部分失败不影响其他行；去重', async () => {
  const lines = parseBatchText(SAMPLE)
  const other = new Uint8Array([...gif, 0, 0])
  const fetched: string[] = []
  const fake = async (url: string): Promise<Fetched> => {
    fetched.push(url)
    if (url.endsWith('LRiBynt.jpeg')) return { kind: 'image', bytes: other, finalUrl: url, contentType: 'image/jpeg' }
    if (url.endsWith('LRiByntjpeg')) throw new LinkError('链接指向的文件不存在或已被删除', 'notfound')
    if (url.includes('vitpp98')) throw new LinkError('链接指向的文件不存在或已被删除', 'notfound')
    if (url.includes('itpBKTZ')) throw new LinkError('图片可以显示，但这个网站没有允许其他网页读取图片内容（跨域限制 CORS）', 'cors')
    if (url.includes('Df5TH')) return { kind: 'html', bytes: new Uint8Array([60]), finalUrl: url, contentType: 'text/html' }
    return { kind: 'image', bytes: gif, finalUrl: url, contentType: 'image/gif' }
  }
  const seen = new Set<string>()
  const deps = { fetch: fake, prepare: prep, existingHashes: seen, concurrency: 4 }
  const items = await fetchBatch(lines, deps)
  const at = (n: number) => items.find((i) => i.line === n)!
  // 没有擅自修正：第 14 行只试了原链接，失败后给出建议
  assert.equal(at(14).status, 'failed')
  assert.ok(!fetched.includes('https://i.imgant.com/v2/LRiBynt.jpeg'))
  assert.match(at(14).suggestFix!.fix!, /补上点号/)
  // 用户确认后再试修正
  const fixed = await fetchItem({ ...at(14) }, deps, seen, true)
  assert.equal(fixed.status, 'ok')
  assert.match(fixed.appliedFix!, /补上点号/)
  const f25 = await fetchItem({ ...at(25) }, deps, seen, true)
  assert.equal(f25.status, 'failed')
  assert.match(f25.reason!, /修正后仍无效.*链接无法访问/)
  assert.equal(at(31).status, 'failed')
  assert.match(at(31).reason!, /^跨域限制/)
  assert.equal(at(31).suggestFix, undefined)
  assert.match(at(9).reason!, /不是图片/)
  // /V2/ 原链接成功，不会去试小写目录
  assert.equal(at(2).status === 'ok' || at(2).status === 'duplicate', true)
  assert.ok(!fetched.includes('https://i.imgant.com/v2/K893NeG.jpeg'))
  // 其余内容相同（同一张图）：一张可导入，其他标为重复
  assert.equal(items.filter((i) => i.status === 'ok').length, 1)
  assert.ok(items.filter((i) => i.status === 'duplicate').every((i) => i.reason === '该图片已存在'))

  // 已有收藏中存在 → 重复；图片无法解码 → 格式不支持
  const dup = await fetchBatch(parseBatchText('a：https://x.com/a.gif'), { fetch: async (u) => ({ kind: 'image', bytes: gif, finalUrl: u, contentType: '' }), prepare: prep, existingHashes: new Set([`h${gif[0]}-${gif.length}`]) })
  assert.equal(dup[0].status, 'duplicate')
  const bad = await fetchBatch(parseBatchText('a：https://x.com/a.gif'), { fetch: async (u) => ({ kind: 'image', bytes: gif, finalUrl: u, contentType: '' }), prepare: async () => { throw new Error('无法解码') }, existingHashes: new Set() })
  assert.match(bad[0].reason!, /图片格式不支持或已损坏/)
})

test('ZIP 链接：解压后逐张导入；没有解压能力时提示改用链接导入；带查询参数的链接保持原样', async () => {
  const zipLine = parseBatchText('表情合集：https://x.com/dl?id=12&type=zip')
  assert.equal(zipLine[0].candidates[0].url, 'https://x.com/dl?id=12&type=zip')
  const zipFetch = async (u: string): Promise<Fetched> => ({ kind: 'zip', bytes: new Uint8Array([80, 75, 3, 4]), finalUrl: u, contentType: 'application/zip' })
  const a = new Uint8Array([1, 2, 3])
  const b = new Uint8Array([4, 5, 6, 7])
  const r = await fetchBatch(zipLine, { fetch: zipFetch, prepare: prep, unzip: async () => [a, b, a], existingHashes: new Set() })
  assert.equal(r[0].status, 'ok')
  assert.equal(1 + (r[0].more?.length ?? 0), 2)
  assert.match(r[0].reason!, /ZIP：3 张图片，可导入 2 张，重复 1 张/)
  const r2 = await fetchBatch(zipLine, { fetch: zipFetch, prepare: prep, existingHashes: new Set() })
  assert.match(r2[0].reason!, /通过链接导入/)
  const q = parseBatchText('叹气：https://cdn.x.com/a.jpg?w=200&sign=Ab%2F')
  assert.equal(q[0].candidates[0].url, 'https://cdn.x.com/a.jpg?w=200&sign=Ab%2F')
  assert.equal(q[0].candidates.length, 1)
})

test('大量粘贴：300 行解析很快', () => {
  const big = Array.from({ length: 300 }, (_, i) => `表情${i}：https://i.imgant.com/v2/x${i}.jpeg`).join('\n')
  const t = Date.now()
  assert.equal(parseBatchText(big).length, 300)
  assert.ok(Date.now() - t < 200)
})
