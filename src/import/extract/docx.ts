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
    else if (outline !== undefined) map.set(id, Math.min(6, Number(outline) + 1))
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

export async function extractDocx(entries: ZipEntry[]): Promise<string> {
  const doc = entries.find((e) => e.name === 'word/document.xml')
  if (!doc) throw new ImportError('这个文件不是有效的 Word（.docx）文档')
  const styles = entries.find((e) => e.name === 'word/styles.xml')
  const td = new TextDecoder('utf-8')
  const styleMap = styles ? headingStyles(td.decode(await styles.read())) : new Map<string, number>()
  const xml = td.decode(await doc.read())
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml

  const lines: string[] = []
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const block = m[0]
    if (block.startsWith('<w:tbl')) {
      lines.push('')
      for (const row of block.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
        const cells = [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) =>
          [...c[1].matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
            .map((p) => paragraphText(p[0]).trim())
            .filter(Boolean)
            .join(' '),
        )
        if (cells.some(Boolean)) lines.push(cells.join(' | '))
      }
      lines.push('')
      continue
    }
    const text = paragraphText(block).trim()
    if (!text) {
      lines.push('')
      continue
    }
    const styleId = /<w:pStyle\s+w:val="([^"]+)"/.exec(block)?.[1]
    const outline = /<w:outlineLvl\s+w:val="(\d)"/.exec(block)?.[1]
    const level = (styleId && styleMap.get(styleId)) || (outline !== undefined ? Number(outline) + 1 : 0)
    if (level) {
      lines.push('', `${'#'.repeat(level)} ${text.replace(/\n/g, ' ')}`)
    } else if (/<w:numPr>/.test(block)) {
      const ilvl = Number(/<w:ilvl\s+w:val="(\d)"/.exec(block)?.[1] ?? 0)
      lines.push(`${'  '.repeat(ilvl)}- ${text}`)
    } else {
      lines.push(text)
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
