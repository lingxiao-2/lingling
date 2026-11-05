/**
 * 真实文件导入测试：npm test
 * 每个测试读取 scripts/fixtures/files 中真实生成的文件，经过与浏览器相同的 importFile() 管线。
 * PDF 使用 pdf.js 的 legacy 构建（与浏览器端相同的构建）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { importFile, type PipelineDeps } from '../src/import/pipeline'
import { readZip, isUnsafePath } from '../src/import/extract/zip'
import { decodeText } from '../src/import/extract/bytes'
import type { ImportKind, ParsedFile, ParseOutcome } from '../src/import/types'

const here = path.dirname(fileURLToPath(import.meta.url))
const FILES = path.join(here, 'fixtures/files')
const read = (name: string) => new Uint8Array(readFileSync(path.join(FILES, name)))

const pdfjsDir = path.join(here, '../node_modules/pdfjs-dist')
const deps: PipelineDeps = {
  loadPdfjs: async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as never,
  cMapUrl: path.join(pdfjsDir, 'cmaps') + path.sep,
}

async function run(name: string, kind: ImportKind = 'character', opts = {}, bytes?: Uint8Array): Promise<ParseOutcome[]> {
  return importFile(name, bytes ?? read(name), kind, deps, opts)
}
async function ok(name: string, kind: ImportKind = 'character', opts = {}): Promise<ParsedFile> {
  const [r] = await run(name, kind, opts)
  if (!r.ok) assert.fail(`${name} 期望成功，实际：${r.error}`)
  return r.file
}
async function err(name: string, kind: ImportKind = 'character', bytes?: Uint8Array): Promise<string> {
  const [r] = await run(name, kind, {}, bytes)
  assert.equal(r.ok, false, `${name} 期望失败`)
  return r.ok ? '' : r.error
}

/* ---------------- TXT ---------------- */

test('中文 TXT（UTF-8）：按「字段：」行拆段', async () => {
  const f = await ok('zh.txt')
  assert.equal(f.container, 'txt')
  assert.equal(f.doc?.encoding, 'utf-8')
  const c = f.characters[0]
  assert.equal(c.name, '林晚')
  assert.equal(c.bio, '雪城图书馆的管理员')
  assert.match(c.personality, /温柔、安静/)
  assert.match(c.personality, /窗台点一盏小灯/)
  assert.equal(c.speakingStyle, '轻声细语，爱用省略号……')
})

test('GB18030 编码 TXT：自动识别，可指定编码重新解析', async () => {
  const f = await ok('gb18030.txt')
  assert.equal(f.doc?.encoding, 'gb18030')
  assert.equal(f.characters[0].name, '沈清')
  assert.match(f.characters[0].backstory, /江南水乡/)
  // 强制按 UTF-8 解析会出现乱码并给出提示
  const bad = await ok('gb18030.txt', 'character', { encoding: 'utf-8' })
  assert.ok(bad.warnings.some((w) => w.includes('乱码')))
  assert.equal(decodeText(read('gb18030.txt'), 'gb18030').suspicious, false)
})

test('空文件：明确失败，不产生任何草稿', async () => {
  assert.match(await err('empty.txt'), /文件为空/)
  assert.match(await err('blank.txt', 'character', new TextEncoder().encode('  \n\n ')), /文件为空/)
})

/* ---------------- Markdown ---------------- */

test('多级标题 Markdown：世界书按章节拆分，不编造关键词', async () => {
  const f = await ok('multi-level.md', 'lorebook')
  const b = f.lorebooks[0]
  assert.equal(b.name, '雪城纪事')
  assert.deepEqual(b.entries.map((e) => e.name), ['地理', '钟楼', '历史'])
  assert.ok(b.entries.every((e) => e.keys.length === 0))
  assert.match(b.entries[1].content, /- 午夜敲十三下/)
  assert.ok(f.warnings.some((w) => w.includes('没有关键词')))
  assert.ok(f.doc?.rawText.includes('### 钟楼'))
})

test('Markdown 世界书：可选整篇导入为一个条目', async () => {
  const f = await ok('multi-level.md', 'lorebook', { split: 'whole' })
  assert.equal(f.lorebooks[0].entries.length, 1)
  assert.match(f.lorebooks[0].entries[0].content, /## 地理[\s\S]*### 钟楼[\s\S]*## 历史/)
})

/* ---------------- DOCX ---------------- */

test('中文 DOCX：识别中文 Word 的标题样式、列表和特殊字符', async () => {
  const f = await ok('zh.docx', 'lorebook')
  assert.equal(f.container, 'docx')
  const text = f.doc!.text
  assert.match(text, /^# 雪城设定集/m)
  assert.match(text, /^## 地理/m)
  assert.match(text, /^- 冰湖终年结冰/m)
  assert.match(text, /& 符号与 <尖括号> 应正确显示/)
  const b = f.lorebooks[0]
  assert.equal(b.name, '雪城设定集')
  assert.deepEqual(b.entries.map((e) => e.name), ['地理', '历史'])
})

test('含表格的 DOCX：表格文字按行保留', async () => {
  const f = await ok('table.docx', 'world')
  const text = f.doc!.text
  assert.match(text, /角色 \| 关系 \| 备注/)
  assert.match(text, /林晚 \| 青梅竹马 \| 图书管理员/)
  assert.match(text, /表格后的正文/)
  assert.equal(f.world?.name, '角色关系表')
})

test('DOCX 作为角色资料：标题段落可分配字段', async () => {
  const f = await ok('zh.docx', 'character')
  assert.ok(f.sections && f.sections.length >= 3)
  assert.equal(f.characters[0].name, '雪城设定集')
})

/* ---------------- PDF ---------------- */

test('多页中文文字型 PDF：保留页码与章节', async () => {
  const f = await ok('multipage-zh.pdf', 'lorebook')
  assert.equal(f.container, 'pdf')
  assert.equal(f.doc?.pages, 3)
  assert.match(f.doc!.rawText, /—— 第 1 页 ——[\s\S]*初雪[\s\S]*—— 第 2 页 ——[\s\S]*钟楼[\s\S]*—— 第 3 页 ——[\s\S]*冰湖/)
  const names = f.lorebooks[0].entries.map((e) => e.name)
  assert.deepEqual(names, ['第一章 初雪', '第二章 钟楼', '第三章 冰湖'])
  assert.match(f.lorebooks[0].entries[1].content, /午夜，钟楼敲了十三下/)
})

test('扫描版 PDF：没有文字时提示需要 OCR，不算导入成功', async () => {
  assert.match(await err('scanned.pdf', 'lorebook'), /OCR/)
})

/* ---------------- PNG / CharX ---------------- */

test('PNG 角色卡（tEXt chara）：读取元数据并以图片作头像', async () => {
  const f = await ok('card-v2.png')
  assert.equal(f.container, 'png')
  assert.equal(f.characters[0].name, '阿玲')
  assert.equal(f.characters[0].greeting, '今天窗外下雪了。')
  assert.equal(f.lorebooks[0].name, '雪城设定')
  assert.deepEqual(f.links, [{ character: 0, lorebook: 0 }])
  assert.equal(f.avatar?.mime, 'image/png')
  assert.ok(f.avatar!.bytes.length > 100)
})

test('PNG 角色卡：ccv3 优先于 chara', async () => {
  const f = await ok('card-v3.png')
  assert.equal(f.characters[0].name, '阿玲（V3）')
})

test('PNG 角色卡（zTXt 压缩块）', async () => {
  const f = await ok('card-ztxt.png')
  assert.equal(f.characters[0].name, '阿玲')
})

test('普通 PNG：说明没有角色卡数据', async () => {
  assert.match(await err('plain.png'), /没有角色卡数据/)
})

test('CharX：card.json + 主图标作为头像，其余资源提示未导入', async () => {
  const f = await ok('card.charx')
  assert.equal(f.container, 'charx')
  assert.equal(f.characters[0].name, '雪见')
  assert.equal(f.avatar?.mime, 'image/png')
  assert.ok(f.warnings.some((w) => w.includes('1 个资源')))
})

/* ---------------- YAML ---------------- */

test('YAML 角色卡与 YAML 世界设定', async () => {
  const c = await ok('card.yaml')
  assert.equal(c.container, 'yaml')
  assert.equal(c.characters[0].name, '白露')
  assert.equal(c.characters[0].greeting, '你也是来看冰湖的吗？')
  const w = await ok('world.yml', 'world')
  assert.equal(w.world?.name, '浮岛群')
})

/* ---------------- ZIP 与安全 ---------------- */

test('ZIP：导入其中可识别的角色卡与世界书，忽略路径穿越与无关文件', async () => {
  const rs = await run('bundle.zip', 'character')
  const okNames = rs.flatMap((r) => (r.ok ? [r.file.fileName] : [])).sort()
  assert.deepEqual(okNames, ['bundle.zip › cards/阿玲.png', 'bundle.zip › worlds/雪城.json', 'bundle.zip › 角色/甲.json'].sort())
  const allNames = rs.map((r) => (r.ok ? r.file.fileName : r.fileName))
  assert.ok(!allNames.some((n) => n.includes('evil')))
  assert.ok(!allNames.some((n) => n.includes('__MACOSX') || n.includes('readme')))
  const names = readZip(read('bundle.zip')).map((e) => e.name)
  assert.ok(!names.includes('../evil.json'))
  assert.equal(isUnsafePath('a/../../etc/passwd'), true)
  assert.equal(isUnsafePath('/abs.json'), true)
})

test('ZIP：没有角色卡或世界书时给出具体原因', async () => {
  assert.match(await err('no-cards.zip'), /没有可识别的角色卡或世界书[\s\S]*notes\.txt/)
})

test('ZIP 压缩炸弹：按压缩比拒绝', async () => {
  assert.match(await err('bomb.zip'), /压缩炸弹/)
})

test('加密 ZIP：明确拒绝', async () => {
  assert.match(await err('encrypted.zip'), /已加密/)
})

/* ---------------- 格式不匹配与不支持 ---------------- */

test('扩展名与内容不符', async () => {
  assert.match(await err('fake.pdf'), /文件内容不是 PDF/)
  assert.match(await err('fake.docx'), /文件内容不是 Word 文档/)
  assert.match(await err('renamed.png', 'character', read('zh.txt')), /文件内容不是 PNG/)
  assert.match(await err('renamed.txt', 'character', read('multipage-zh.pdf')), /文件内容不是 文本/)
})

test('不支持的格式给出具体原因', async () => {
  assert.match(await err('old.doc'), /另存为 \.docx/)
  assert.match(await err('photo.jpg', 'character', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])), /普通照片/)
  assert.match(await err('a.pages', 'character', read('no-cards.zip')), /Pages/)
  assert.match(await err('a.rar', 'character', new Uint8Array([0x52, 0x61, 0x72, 0x21])), /RAR/)
})

test('超过大小上限', async () => {
  const big = new Uint8Array(6 * 1024 * 1024).fill(0x61)
  assert.match(await err('big.txt', 'character', big), /上限/)
})
