/**
 * 生成导入测试用的真实文件（只需在开发机上运行一次，生成结果已提交到 files/）。
 * 依赖开发机上的 jszip、docx、pdf-lib、sharp、playwright 与系统中文字体，不属于项目运行依赖。
 *   NODE_PATH=<含上述包的 node_modules> node scripts/fixtures/make-fixtures.cjs
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { execFileSync } = require('child_process')
const JSZip = require('jszip')
const docx = require('docx')
const { PDFDocument } = require('pdf-lib')
const sharp = require('sharp')
const { chromium } = require('playwright')

const OUT = path.join(__dirname, 'files')
const w = (name, data) => fs.writeFileSync(path.join(OUT, name), data)

/* ---------- 文本 ---------- */
const zhTxt = '名称：林晚\n简介：雪城图书馆的管理员\n性格：温柔、安静，偶尔毒舌\n\n她在雪城长大。\n每年初雪，她都会在窗台点一盏小灯。\n说话风格：轻声细语，爱用省略号……\n'
w('zh.txt', zhTxt)
w('gb18030.txt', execFileSync('python3', ['-c', 'import sys;sys.stdout.buffer.write(sys.stdin.read().encode("gb18030"))'], { input: '名称：沈清\n性格：克制、温柔\n背景故事：生于江南水乡，后迁居北方雪城。\n' }))
w('empty.txt', '')
w('multi-level.md', `# 雪城纪事

关于雪城的一切。

## 地理

北方高原上的城市。

### 钟楼

- 午夜敲十三下
- 楼顶积雪终年不化

## 历史

建城三百年。
`)
w('card.yaml', `spec: chara_card_v2
spec_version: "2.0"
data:
  name: 白露
  description: 雪国少女，住在冰湖旁。
  personality: 好奇、开朗
  first_mes: 你也是来看冰湖的吗？
  mes_example: ""
  scenario: ""
  tags: [雪, 少女]
`)
w('world.yml', `world:
  name: 浮岛群
  tagline: 漂在云上的群岛
  description: 岛屿之间靠风帆往来。
`)
w('fake.pdf', '这其实是一个文本文件\n')
w('fake.docx', 'not a word file')
w('old.doc', Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]))

/* ---------- PNG 角色卡 ---------- */
function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function insertChunks(png, chunks) {
  const iend = png.length - 12
  return Buffer.concat([png.subarray(0, iend), ...chunks, png.subarray(iend)])
}
const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
const v2 = {
  spec: 'chara_card_v2', spec_version: '2.0',
  data: {
    name: '阿玲', description: '住在雪城的女孩。', personality: '温柔', scenario: '冬夜', first_mes: '今天窗外下雪了。',
    mes_example: '<START>\n{{char}}: 要一起去看雪吗？', creator_notes: '原创测试角色', tags: ['冬日'],
    character_book: { name: '雪城设定', entries: [{ keys: ['钟楼'], content: '午夜敲十三下', enabled: true }] },
    extensions: {},
  },
}
const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data: { ...v2.data, name: '阿玲（V3）', group_only_greetings: [] } }

;(async () => {
  const base = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 214, g: 228, b: 244, alpha: 1 } } }).png().toBuffer()
  const tEXt = (k, v) => chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'latin1')]))
  const zTXt = (k, v) => chunk('zTXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(Buffer.from(v, 'latin1'))]))
  w('card-v2.png', insertChunks(base, [tEXt('chara', b64(v2))]))
  w('card-v3.png', insertChunks(base, [tEXt('chara', b64(v2)), tEXt('ccv3', b64(v3))]))
  w('card-ztxt.png', insertChunks(base, [zTXt('chara', b64(v2))]))
  w('plain.png', base)

  /* ---------- CharX ---------- */
  const charx = new JSZip()
  charx.file('card.json', JSON.stringify({
    spec: 'chara_card_v3', spec_version: '3.0',
    data: { ...v2.data, name: '雪见', assets: [
      { type: 'icon', uri: 'embeded://assets/icon/images/main.png', name: 'main', ext: 'png' },
      { type: 'emotion', uri: 'embeded://assets/emotion/images/smile.png', name: 'smile', ext: 'png' },
    ] },
  }))
  charx.file('assets/icon/images/main.png', base)
  charx.file('assets/emotion/images/smile.png', base)
  w('card.charx', await charx.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

  /* ---------- ZIP ---------- */
  const bundle = new JSZip()
  bundle.file('角色/甲.json', JSON.stringify({ name: '甲', personality: '冷静' }))
  bundle.file('worlds/雪城.json', JSON.stringify({ name: '雪城地理', entries: [{ keys: ['冰湖'], content: '冬天可以滑冰' }] }))
  bundle.file('cards/阿玲.png', insertChunks(base, [tEXt('chara', b64(v2))]))
  bundle.file('readme.txt', '说明文件')
  bundle.file('__MACOSX/._甲.json', 'junk')
  bundle.file('../evil.json', JSON.stringify({ name: '越界', personality: 'x' }))
  w('bundle.zip', await bundle.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

  const onlyText = new JSZip()
  onlyText.file('notes.txt', '只是笔记')
  w('no-cards.zip', await onlyText.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

  const bomb = new JSZip()
  bomb.file('big.json', Buffer.alloc(30 * 1024 * 1024, 0x20))
  w('bomb.zip', await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }))

  const enc = Buffer.from(await bundle.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  // 设置「已加密」标志位（本地头与中央目录）
  for (let i = 0; i < enc.length - 4; i++) {
    const sig = enc.readUInt32LE(i)
    if (sig === 0x04034b50) enc.writeUInt16LE(enc.readUInt16LE(i + 6) | 1, i + 6)
    if (sig === 0x02014b50) enc.writeUInt16LE(enc.readUInt16LE(i + 8) | 1, i + 8)
  }
  w('encrypted.zip', enc)

  /* ---------- DOCX ---------- */
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } = docx
  const p = (t, o = {}) => new Paragraph({ children: [new TextRun(t)], ...o })
  const zhDoc = new Document({ sections: [{ children: [
    p('雪城设定集', { heading: HeadingLevel.HEADING_1 }),
    p('这是一份中文 Word 文档。'),
    p('地理', { heading: HeadingLevel.HEADING_2 }),
    p('雪城位于北方高原。'),
    p('冰湖终年结冰', { bullet: { level: 0 } }),
    p('钟楼午夜敲十三下', { bullet: { level: 0 } }),
    p('历史', { heading: HeadingLevel.HEADING_2 }),
    p('建城三百年，& 符号与 <尖括号> 应正确显示。'),
  ] }] })
  const zhBuf = await Packer.toBuffer(zhDoc)
  // 模拟中文版 Word：样式 ID 为「1」「2」，样式名为 heading 1 / heading 2
  const zz = await JSZip.loadAsync(zhBuf)
  let styles = await zz.file('word/styles.xml').async('string')
  let body = await zz.file('word/document.xml').async('string')
  styles = styles.replace(/w:styleId="Heading1"/g, 'w:styleId="1"').replace(/w:styleId="Heading2"/g, 'w:styleId="2"')
  body = body.replace(/w:val="Heading1"/g, 'w:val="1"').replace(/w:val="Heading2"/g, 'w:val="2"')
  zz.file('word/styles.xml', styles)
  zz.file('word/document.xml', body)
  w('zh.docx', await zz.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

  const cell = (t) => new TableCell({ children: [p(t)] })
  const tableDoc = new Document({ sections: [{ children: [
    p('角色关系表', { heading: HeadingLevel.HEADING_1 }),
    new Table({ rows: [
      new TableRow({ children: [cell('角色'), cell('关系'), cell('备注')] }),
      new TableRow({ children: [cell('林晚'), cell('青梅竹马'), cell('图书管理员')] }),
      new TableRow({ children: [cell('沈清'), cell('旧友'), cell('')] }),
    ] }),
    p('表格后的正文。'),
  ] }] })
  w('table.docx', await Packer.toBuffer(tableDoc))

  /* ---------- PDF ---------- */
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(`<html><body style="font-family:'Noto Serif CJK SC';font-size:16px">
    <h2>第一章 初雪</h2><p>雪城的初雪总在十一月落下。林晚在窗台点了一盏小灯。</p>
    <div style="page-break-after:always"></div>
    <h2>第二章 钟楼</h2><p>午夜，钟楼敲了十三下。没有人知道最后一声是为谁而敲。</p>
    <div style="page-break-after:always"></div>
    <h2>第三章 冰湖</h2><p>冰湖上，有人留下了一行脚印，通向湖心。</p>
  </body></html>`)
  w('multipage-zh.pdf', await page.pdf({ format: 'A5' }))
  const shot = await page.screenshot({ type: 'png' })
  await browser.close()
  const scan = await PDFDocument.create()
  const img = await scan.embedPng(shot)
  const pg = scan.addPage([img.width / 2, img.height / 2])
  pg.drawImage(img, { x: 0, y: 0, width: img.width / 2, height: img.height / 2 })
  w('scanned.pdf', Buffer.from(await scan.save()))

  for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(20), fs.statSync(path.join(OUT, f)).size)
})()
