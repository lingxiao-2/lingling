/**
 * DOCX 正文提取（不依赖 DOM / Node）。DOCX 是 ZIP + XML：
 *  - 读取 word/styles.xml，识别标题样式（含中文 Word 的样式 ID「1」「2」= 标题 1、标题 2，以及 outlineLvl）
 *  - 读取 word/document.xml，按顺序输出段落、列表项、表格行
 * 输出近似 Markdown（# 标题、- 列表、表格「单元格 | 单元格」），供后续按章节拆分。
 * 不还原排版；不执行任何内容；修订中被删除的文字（w:delText）不会被提取。
 */
import { ImportError } from './bytes'
import type { ZipEntry } from './zip'

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')

function headingStyles(stylesXml: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const id = m[1]
    const body = m[2]
    const name = /<w:name\s+w:val="([^"]+)"/.exec(body)?.[1]?.toLowerCase() ?? ''
    const outline = /<w:outlineLvl\s+w:val="(\d)"/.exec(body)?.[1]
    const byName = /^(?:heading|标题)\s*(\d)$/.exec(name)?.[1]
    if (name === 'title' || name === '标题') map.set(id, 1)
    else if (byName) map.set(id, Math.min(6, Number(byName)))
    // outlineLvl 0–8 才是标题；9 表示「正文文本」（中文 Word / Pages 导出的「正文」样式常带这一项），不能当标题
    else if (outline !== undefined && Number(outline) < 9) map.set(id, Math.min(6, Number(outline) + 1))
  }
  return map
}

function paragraphText(p: string): string {
  let out = ''
  for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>/g)) {
    if (m[1] !== undefined) out += decode(m[1])
    else if (m[0].startsWith('<w:tab')) out += '\t'
    else out += '\n'
  }
  return out
}

export interface DocxStats {
  /** 输出的段落数（不含空段落） */
  paragraphs: number
  /** 提取出的字符数（不含空白） */
  chars: number
}

const MAIN_NS = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']

/**
 * 统一命名空间前缀：个别软件导出的 DOCX 不用 w: 前缀（如 ns0:、默认命名空间或 Strict OOXML），
 * 统一改写成 w: 再解析，避免整篇文字提取不到。
 */
export function normalizeWordXml(xml: string): string {
  let out = xml
  for (const ns of MAIN_NS) {
    const esc = ns.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    const m = new RegExp(`xmlns:([A-Za-z_][\\w.-]*)="${esc}"`).exec(out)
    if (m && m[1] !== 'w') out = out.replace(new RegExp(`<(/?)${m[1]}:`, 'g'), '<$1w:').replace(new RegExp(`\\s${m[1]}:`, 'g'), ' w:')
    else if (!m && new RegExp(`xmlns="${esc}"`).test(out)) out = out.replace(/<(\/?)(?![\w.-]+:)([A-Za-z])/g, '<$1w:$2')
  }
  // 兼容内容（mc:AlternateContent）里 Choice 与 Fallback 是同一段内容的两种写法，只保留一份
  return out.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '')
}

/** 按嵌套深度切出 body 下的顶层段落与表格（文本框里的段落嵌在外层段落中，不能用非贪婪正则直接切） */
export function topLevelBlocks(body: string): string[] {
  const blocks: string[] = []
  const re = /<(\/?)w:(p|tbl)\b[^>]*?(\/?)>/g
  let depth = 0
  let start = -1
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const closing = m[1] === '/'
    const selfClosing = m[3] === '/'
    if (selfClosing) {
      if (depth === 0) blocks.push(m[0])
      continue
    }
    if (!closing) {
      if (depth === 0) start = m.index
      depth++
    } else if (depth > 0) {
      depth--
      if (depth === 0 && start >= 0) {
        blocks.push(body.slice(start, re.lastIndex))
        start = -1
      }
    }
  }
  return blocks
}

export async function extractDocx(entries: ZipEntry[], stats?: DocxStats): Promise<string> {
  const doc = entries.find((e) => e.name === 'word/document.xml') ?? entries.find((e) => /^word\/document\d*\.xml$/.test(e.name))
  if (!doc) throw new ImportError('这个文件不是有效的 Word（.docx）文档')
  const styles = entries.find((e) => e.name === 'word/styles.xml')
  const td = new TextDecoder('utf-8')
  const styleMap = styles ? headingStyles(normalizeWordXml(td.decode(await styles.read()))) : new Map<string, number>()
  const xml = normalizeWordXml(td.decode(await doc.read()))
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml

  const lines: string[] = []
  let paragraphs = 0
  for (const block of topLevelBlocks(body)) {
    if (block.startsWith('<w:tbl')) {
      lines.push('')
      for (const row of block.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
        const cells = [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) =>
          [...c[1].matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
            .map((p) => paragraphText(p[0]).trim())
            .filter(Boolean)
            .join(' '),
        )
        if (cells.some(Boolean)) {
          lines.push(cells.join(' | '))
          paragraphs++
        }
      }
      lines.push('')
      continue
    }
    const text = paragraphText(block).trim()
    if (!text) {
      lines.push('')
      continue
    }
    paragraphs++
    const styleId = /<w:pStyle\s+w:val="([^"]+)"/.exec(block)?.[1]
    const outline = /<w:outlineLvl\s+w:val="(\d)"/.exec(block)?.[1]
    const level = (styleId && styleMap.get(styleId)) || (outline !== undefined && Number(outline) < 9 ? Math.min(6, Number(outline) + 1) : 0)
    if (level && !/^#{1,6}\s*\S/.test(text)) {
      lines.push('', `${'#'.repeat(level)} ${text.replace(/\n/g, ' ')}`)
    } else if (/<w:numPr>/.test(block) && !/^#{1,6}\s*\S/.test(text)) {
      const ilvl = Number(/<w:ilvl\s+w:val="(\d)"/.exec(block)?.[1] ?? 0)
      lines.push(`${'  '.repeat(ilvl)}- ${text}`)
    } else {
      lines.push(text)
    }
  }
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (stats) {
    stats.paragraphs = paragraphs
    stats.chars = out.replace(/\s/g, '').length
  }
  return out
}
