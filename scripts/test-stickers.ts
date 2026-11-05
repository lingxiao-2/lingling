/** 表情包 V2：GIF 解码、批量导入、识图请求与解析、提供给 AI 的表情包（纯函数 + 模拟网络）：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeGif, pickKeyframes } from '../src/services/vision/gif'
import { expandInputs, importStickers } from '../src/services/stickerImport'
import { sha256Hex, type PreparedSticker } from '../src/services/stickers'
import { parseAnalysis, requestAnalysis, visionTarget, DEFAULT_VISION_CONFIG, describeAnalysis } from '../src/services/vision/vision'
import { offeredStickers, userStickerText } from '../src/services/ai/context'
import type { AIConfig, Sticker, StickerAnalysis } from '../src/db/schema'

const fx = (f: string) => new Uint8Array(readFileSync(`scripts/fixtures/stickers/${f}`))

test('GIF 解码：多帧合成、帧时长、隔行扫描与透明色；按时间抽取关键帧', () => {
  const g = decodeGif(fx('anim.gif'))
  assert.deepEqual([g.width, g.height, g.frames.length], [40, 30, 6])
  const px = (k: number, x: number, y: number) => [...g.frames[k].rgba.slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 4)]
  assert.deepEqual(px(0, 6, 12), [255, 0, 0, 255])
  assert.deepEqual(px(2, 16, 12), [0, 0, 255, 255])
  assert.deepEqual(px(5, 31, 12), [0, 200, 200, 255])
  assert.deepEqual(g.frames.map((f) => f.delay), [100, 100, 300, 100, 100, 100])
  const keys = pickKeyframes(g.frames, 4)
  assert.equal(keys[0], g.frames[0])
  assert.ok(keys.length >= 3 && keys.length <= 4)
  const i = decodeGif(fx('interlaced.gif'))
  const ip = (x: number, y: number) => [...i.frames[0].rgba.slice((y * i.width + x) * 4, (y * i.width + x) * 4 + 4)]
  assert.deepEqual(ip(10, 10), [255, 0, 0, 255])
  assert.deepEqual(ip(1, 1), [0, 0, 0, 0]) // 透明
  assert.throws(() => decodeGif(new Uint8Array([1, 2, 3])))
})

const fakePrepare = async (bytes: Uint8Array): Promise<PreparedSticker> => {
  if (bytes.length < 40) throw new Error('图片无法打开，文件可能已损坏')
  return { dataUrl: 'data:image/png;base64,AA==', thumbUrl: 'data:image/png;base64,AA==', hash: await sha256Hex(bytes), mime: 'image/png', width: 1, height: 1, bytes: bytes.length }
}

test('ZIP 合集：只取图片，忽略 __MACOSX 与非图片文件，合集名取自文件名', async () => {
  const { items, failed } = await expandInputs([{ name: '猫猫合集.zip', bytes: fx('pack.zip') }])
  assert.deepEqual(items.map((x) => x.name.split(' › ')[1]).sort(), ['动起来.gif', '坏图.png', '开心.png', '蓝.jpg', '重复.png'].sort())
  assert.ok(items.every((x) => x.packId === '猫猫合集'))
  assert.match(failed[0].reason, /1 个非图片文件/)
})

test('批量导入：去重（批内与已有收藏）、单张失败不影响其他、显示进度与结果', async () => {
  const saved: string[] = []
  const progress: number[] = []
  const gif = fx('anim.gif')
  const existing = new Set([await sha256Hex(gif)])
  const r = await importStickers(
    [
      { name: '猫猫合集.zip', bytes: fx('pack.zip') },
      { name: 'again.gif', bytes: gif },
      { name: 'note.svg', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>') },
    ],
    { prepare: fakePrepare, existingHashes: existing, save: async (p) => void saved.push(p.hash), onProgress: (d) => progress.push(d) },
  )
  // 开心.png + 蓝.jpg 成功；重复.png 与 开心.png 相同、两张 GIF 已在收藏中 → 重复；坏图与 SVG 失败
  assert.equal(r.added, 2)
  assert.equal(r.duplicates, 3)
  assert.deepEqual(r.failed.map((f) => f.name.split(' › ').pop()).sort(), ['坏图.png', 'note.svg', '猫猫合集.zip'].sort())
  assert.match(r.failed.find((f) => f.name === 'note.svg')!.reason, /不是支持的图片格式/)
  assert.equal(progress.at(-1), 7)
  assert.equal(new Set(saved).size, saved.length)
})

test('ZIP 炸弹与损坏的压缩包会被拒绝，不影响同批次其他图片', async () => {
  const bomb = new Uint8Array(readFileSync('scripts/fixtures/files/bomb.zip'))
  const r = await importStickers([{ name: 'bomb.zip', bytes: bomb }, { name: 'ok.gif', bytes: fx('anim.gif') }], { prepare: fakePrepare, existingHashes: new Set(), save: async () => {} })
  assert.equal(r.added, 1)
  assert.match(r.failed[0].reason, /压缩|上限|过大|异常/)
})

const chat: AIConfig = { service: 'custom', mode: 'direct', baseUrl: 'https://chat.test/v1', apiKey: 'sk-c', proxyUrl: '', proxyToken: '', model: 'text-only', temperature: 0.8, maxTokens: 500 }

test('识图配置：未同意不发送；默认服务不支持；单独视觉模型需要完整配置', () => {
  assert.ok('problem' in visionTarget({ ...DEFAULT_VISION_CONFIG, enabled: true }, chat))
  assert.match((visionTarget({ ...DEFAULT_VISION_CONFIG, enabled: true, consentAt: 1, mode: 'chat' }, { ...chat, service: 'lingling' }) as { problem: string }).problem, /默认服务暂不支持识图/)
  assert.ok('problem' in visionTarget({ ...DEFAULT_VISION_CONFIG, enabled: true, consentAt: 1 }, chat))
  const t = visionTarget({ ...DEFAULT_VISION_CONFIG, enabled: true, consentAt: 1, baseUrl: 'https://vl.test/v1/', apiKey: 'sk-v', model: 'qwen-vl' }, chat)
  assert.ok('config' in t && t.config.baseUrl === 'https://vl.test/v1' && t.config.model === 'qwen-vl')
  const c = visionTarget({ ...DEFAULT_VISION_CONFIG, enabled: true, consentAt: 1, mode: 'chat' }, chat)
  assert.ok('config' in c && c.config.model === 'text-only')
})

const vcfg: AIConfig = { ...chat, baseUrl: 'https://vl.test/v1', apiKey: 'sk-v', model: 'qwen-vl' }

test('识图请求：使用官方多模态格式；解析 JSON（含代码块）；记录用量', async () => {
  let body: { model: string; messages: { content: { type: string; image_url?: { url: string } }[] }[] } | null = null
  let url = ''
  const f = (async (u: string, init: RequestInit) => {
    url = u
    body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"summary":"一只猫翻白眼","text":"你看我信吗","emotion":"怀疑、阴阳怪气","scenes":["不相信对方","调侃"],"confidence":0.86}\n```' } }], usage: { prompt_tokens: 812, completion_tokens: 60 } }), { headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  const out = await requestAnalysis(vcfg, { dataUrl: 'data:image/jpeg;base64,AAAA', coverage: 'keyframes', frames: 4 }, { fetchImpl: f })
  assert.equal(url, 'https://vl.test/v1/chat/completions')
  assert.equal(body!.model, 'qwen-vl')
  const parts = body!.messages[0].content
  assert.equal(parts[1].type, 'image_url')
  assert.equal(parts[1].image_url!.url, 'data:image/jpeg;base64,AAAA')
  assert.match(JSON.stringify(parts[0]), /按时间顺序抽取了 4 帧/)
  assert.equal(out.analysis.text, '你看我信吗')
  assert.equal(out.analysis.coverage, 'keyframes')
  assert.deepEqual(out.usage, { prompt: 812, completion: 60 })
  assert.match(describeAnalysis(out.analysis), /一只猫翻白眼；图上文字「你看我信吗」；情绪：怀疑、阴阳怪气/)
})

test('识图失败：模型不支持图片、密钥无效、余额不足、返回格式不对，都给出明确原因', async () => {
  const resp = (status: number, msg: string) => (async () => new Response(JSON.stringify({ error: { message: msg } }), { status })) as unknown as typeof fetch
  const img = { dataUrl: 'data:image/jpeg;base64,AA==', coverage: 'static' as const, frames: 1 }
  await assert.rejects(requestAnalysis(vcfg, img, { fetchImpl: resp(400, 'Model does not support image input') }), /不支持图片输入/)
  await assert.rejects(requestAnalysis(vcfg, img, { fetchImpl: resp(401, 'invalid key') }), (e: { kind: string }) => e.kind === 'auth')
  await assert.rejects(requestAnalysis(vcfg, img, { fetchImpl: resp(402, 'Insufficient Balance') }), (e: { kind: string }) => e.kind === 'quota')
  assert.throws(() => parseAnalysis('我看不清'), /格式不正确/)
  assert.throws(() => parseAnalysis('{"summary":"","emotion":""}'), /为空/)
})

const st = (id: string, extra: Partial<Sticker> = {}): Sticker => ({
  id, packId: 'mine', name: '', thumbUrl: 'data:image/png;base64,AA==', hash: `h-${id}`, mime: 'image/png', width: 1, height: 1, bytes: 1,
  favorite: false, aiUsable: true, createdAt: 0, updatedAt: 0, ...extra,
})
const an = (hash: string, extra: Partial<StickerAnalysis> = {}): StickerAnalysis => ({
  hash, status: 'done', summary: '', text: '', emotion: '', scenes: [], confidence: 0.9, coverage: 'static', frames: 1, model: 'm', analyzedAt: 0, ...extra,
})

test('提供给 AI 的表情包：只有识别过（或写了含义）的；与话题相关的排在前面；不认识的不提供', () => {
  const list = [st('roll'), st('cry'), st('unknown'), st('low'), st('banned', { aiUsable: false })]
  const analyses = new Map([
    ['h-roll', an('h-roll', { summary: '猫咪翻白眼', emotion: '无语', scenes: ['被气到', '吐槽'] })],
    ['h-cry', an('h-cry', { summary: '小狗大哭', emotion: '委屈', scenes: ['被欺负'] })],
    ['h-low', an('h-low', { summary: '看不清', confidence: 0.1 })],
    ['h-banned', an('h-banned', { summary: '笑' })],
  ])
  const { options, map } = offeredStickers(list, analyses, '你又在吐槽我了，真无语')
  assert.deepEqual([...map.values()], ['roll', 'cry'])
  assert.match(options[0].name, /无语·猫咪翻白眼/)
  assert.equal(offeredStickers([st('unknown')], new Map()).options.length, 0)
})

test('用户发来的表情包：识别了就带上内容；没识别时明确告诉模型不要猜', () => {
  const a = new Map([['h-x', an('h-x', { summary: '熊猫叉腰', text: '你看我信吗', emotion: '怀疑' })]])
  assert.match(userStickerText(st('x'), a), /熊猫叉腰；图上文字「你看我信吗」；情绪：怀疑/)
  assert.match(userStickerText(st('y'), a), /没有识别图片内容.*不要假装/)
  assert.match(userStickerText(undefined, a), /已被删除/)
  assert.match(userStickerText(st('z', { name: '摸鱼' }), a), /摸鱼/)
})
