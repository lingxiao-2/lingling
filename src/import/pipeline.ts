/**
 * 统一的本地文件导入管线：字节 → 格式检测 → 对应解析器 → ParsedFile。
 * 全部在浏览器本地完成，不上传任何文件；只读取内容，不执行其中的脚本或 HTML。
 *
 * 支持：JSON、YAML、TXT（UTF-8 / GB18030 / Big5 / UTF-16）、Markdown、
 *      PNG 角色卡（chara / ccv3）、CharX、ZIP（内含角色卡或世界书）、DOCX、文字型 PDF。
 */
import { CONTAINER_LABELS, type Container, type ImportKind, type ParseOutcome } from './types'
import { parseStructured, parseTextDocument } from './parse'
import { ImportError, decodeText, sniff, type EncodingId } from './extract/bytes'
import { readPngCard } from './extract/png'
import { readZip, type ZipEntry } from './extract/zip'
import { extractDocx, type DocxStats } from './extract/docx'
import { extractPdf, pdfRawText, pdfToMarkdown, type PdfjsLike } from './extract/pdf'

export interface PipelineDeps {
  /** 按需加载 pdf.js（浏览器与测试注入不同的实现） */
  loadPdfjs?: () => Promise<PdfjsLike>
  cMapUrl?: string
}

export interface ImportOptions {
  /** TXT：指定编码重新解码 */
  encoding?: EncodingId
  /** 世界书：按章节拆分或整篇一个条目 */
  split?: 'sections' | 'whole'
}

/** 文件选择器：扩展名 + MIME，覆盖所有实际支持的格式（iOS 会据此在「文件」App 中筛选） */
export const FILE_ACCEPT = [
  '.json', '.yaml', '.yml', '.txt', '.md', '.markdown', '.png', '.charx', '.zip', '.docx', '.pdf',
  'application/json', 'text/plain', 'text/markdown', 'text/yaml', 'application/yaml', 'image/png',
  'application/zip', 'application/x-zip-compressed', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',')

const MB = 1024 * 1024
export const SIZE_LIMITS: Record<string, number> = {
  text: 5 * MB,
  png: 20 * MB,
  zip: 30 * MB,
  docx: 20 * MB,
  pdf: 30 * MB,
}

const TEXT_EXT = ['txt', 'text', 'md', 'markdown', 'json', 'yaml', 'yml']
const KNOWN_EXT = [...TEXT_EXT, 'png', 'charx', 'zip', 'docx', 'pdf']

const UNSUPPORTED: Record<string, string> = {
  doc: '旧版 Word（.doc）暂不支持，请在 Word 或 Pages 中另存为 .docx 后再导入',
  pages: 'Apple Pages 文件暂不支持，请在 Pages 中导出为 .docx 或 PDF',
  rtf: 'RTF 暂不支持，请另存为 .docx 或 .txt',
  webp: 'WebP 图片角色卡暂不支持，请使用 PNG 角色卡或 JSON',
  jpg: '普通照片不包含角色卡数据。PNG 角色卡请使用原始 .png 文件',
  jpeg: '普通照片不包含角色卡数据。PNG 角色卡请使用原始 .png 文件',
  heic: '普通照片不包含角色卡数据。PNG 角色卡请使用原始 .png 文件',
  gif: '普通图片不包含角色卡数据',
  rar: 'RAR 压缩包暂不支持，请改用 ZIP',
  '7z': '7z 压缩包暂不支持，请改用 ZIP',
  epub: 'EPUB 暂不支持，请导出为 TXT、DOCX 或 PDF',
  xlsx: '表格文件暂不支持',
  pptx: '演示文稿暂不支持',
}

export function extOf(name: string): string {
  return (name.match(/\.([^./\\]+)$/)?.[1] ?? '').toLowerCase()
}

const fail = (fileName: string, error: string): ParseOutcome => ({ ok: false, fileName, error })

function withMeta(o: ParseOutcome, container: Container, extra?: Partial<Extract<ParseOutcome, { ok: true }>['file']>): ParseOutcome {
  if (!o.ok) return o
  Object.assign(o.file, { container }, extra)
  return o
}

async function parseYaml(fileName: string, text: string, kind: ImportKind): Promise<ParseOutcome> {
  const { parse } = await import('yaml')
  let root: unknown
  try {
    root = parse(text, { maxAliasCount: 50 })
  } catch (e) {
    return fail(fileName, `YAML 格式错误，无法解析（${(e as Error).message.split('\n')[0]}）`)
  }
  if (root === null || typeof root !== 'object') {
    // 纯文本形式的 YAML：作为可编辑文本导入
    return withMeta(parseTextDocument(fileName, text, kind, { markdown: false }), 'yaml', {
      doc: { text, markdown: false, rawText: text },
    })
  }
  return withMeta(parseStructured(fileName, root, kind), 'yaml')
}

function parseJsonText(fileName: string, text: string, kind: ImportKind): ParseOutcome {
  try {
    return parseStructured(fileName, JSON.parse(text), kind)
  } catch (e) {
    return fail(fileName, `JSON 格式错误，无法解析（${(e as Error).message}）`)
  }
}

/** CharX：ZIP 根目录的 card.json + assets/ 资源；主图标作为角色头像 */
async function parseCharx(fileName: string, entries: ZipEntry[], kind: ImportKind): Promise<ParseOutcome> {
  const card = entries.find((e) => e.name === 'card.json')
  if (!card) return fail(fileName, 'CharX 文件中缺少 card.json')
  let root: unknown
  try {
    root = JSON.parse(new TextDecoder().decode(await card.read()))
  } catch {
    return fail(fileName, 'CharX 中的 card.json 不是有效的 JSON')
  }
  const out = withMeta(parseStructured(fileName, root, kind), 'charx')
  if (!out.ok) return out
  // 资源：data.assets[{ type: 'icon', uri: 'embeded://assets/icon/images/1.png', name: 'main' }]
  const assets = ((root as { data?: { assets?: unknown } })?.data?.assets ?? []) as { type?: string; uri?: string; name?: string; ext?: string }[]
  const icons = Array.isArray(assets) ? assets.filter((a) => a?.type === 'icon' && typeof a.uri === 'string') : []
  const icon = icons.find((a) => a.name === 'main') ?? icons[0]
  const path = icon?.uri?.replace(/^embedd?ed:\/\//, '')
  const entry = path ? entries.find((e) => e.name === path) : undefined
  if (entry && out.file.characters.length) {
    const ext = extOf(entry.name)
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ''
    if (mime && entry.size <= 8 * MB) out.file.avatar = { bytes: await entry.read(), mime }
  }
  const others = (Array.isArray(assets) ? assets.length : 0) - (entry ? 1 : 0)
  if (others > 0) out.file.warnings.push(`CharX 中另有 ${others} 个资源（表情、背景等）暂未导入`)
  return out
}

/** ZIP：只导入能识别结构的角色卡 / 世界书（JSON、YAML、PNG 卡、CharX）；不递归解压嵌套 ZIP */
async function parseZip(fileName: string, entries: ZipEntry[], kind: ImportKind, deps: PipelineDeps): Promise<ParseOutcome[]> {
  if (entries.some((e) => e.name === 'card.json')) return [await parseCharx(fileName, entries, kind)]
  const candidates = entries.filter((e) => {
    const base = e.name.split('/').pop() ?? ''
    return !e.name.startsWith('__MACOSX/') && !base.startsWith('.') && ['json', 'yaml', 'yml', 'png', 'charx'].includes(extOf(base))
  })
  if (candidates.length === 0) {
    const names = entries.slice(0, 5).map((e) => e.name).join('、')
    return [fail(fileName, `压缩包中没有可识别的角色卡或世界书（JSON / YAML / PNG 卡 / CharX）。包含：${names || '无文件'}`)]
  }
  const results: ParseOutcome[] = []
  for (const e of candidates) {
    const label = `${fileName} › ${e.name}`
    try {
      const bytes = await e.read()
      const ext = extOf(e.name)
      if (ext === 'charx') {
        if (sniff(bytes) !== 'zip') results.push(fail(label, '不是有效的 CharX'))
        else results.push(await parseCharx(label, readZip(bytes), kind))
        continue
      }
      results.push(...(await importBytes(label, bytes, kind, deps, {}, true)))
    } catch (err) {
      results.push(fail(label, err instanceof ImportError ? err.message : `读取失败：${(err as Error).message}`))
    }
  }
  // 压缩包里识别不了的单个文件不算失败，只要至少有一个成功
  const ok = results.filter((r) => r.ok)
  if (ok.length === 0) return results
  return results.filter((r) => r.ok || !/没有可导入|无法识别/.test(r.error))
}

async function importBytes(
  fileName: string,
  bytes: Uint8Array,
  kind: ImportKind,
  deps: PipelineDeps,
  opts: ImportOptions,
  insideZip = false,
): Promise<ParseOutcome[]> {
  const ext = extOf(fileName)
  if (bytes.length === 0) return [fail(fileName, '文件为空')]
  if (UNSUPPORTED[ext]) return [fail(fileName, UNSUPPORTED[ext])]

  const type = sniff(bytes)
  const mismatch = (expected: string) =>
    fail(fileName, `扩展名是 .${ext}，但文件内容不是 ${expected}。文件可能已损坏，或被改了扩展名`)

  // —— 扩展名与真实内容必须一致 ——
  if (ext === 'png' && type !== 'png') return [mismatch('PNG 图片')]
  if (ext === 'pdf' && type !== 'pdf') return [mismatch('PDF')]
  if ((ext === 'docx' || ext === 'zip' || ext === 'charx') && type !== 'zip') return [mismatch(ext === 'docx' ? 'Word 文档' : 'ZIP 压缩包')]
  if (TEXT_EXT.includes(ext) && type !== 'text') {
    if (type === 'ole') return [fail(fileName, UNSUPPORTED.doc)]
    return [mismatch('文本')]
  }
  if (type === 'ole') return [fail(fileName, UNSUPPORTED.doc)]
  if (type === 'rtf') return [fail(fileName, UNSUPPORTED.rtf)]
  if (type === 'jpeg' || type === 'gif' || type === 'webp') return [fail(fileName, UNSUPPORTED[type === 'jpeg' ? 'jpg' : type])]
  if (!KNOWN_EXT.includes(ext) && ext && type === 'binary') {
    return [fail(fileName, `暂不支持 .${ext} 文件。支持：JSON、YAML、TXT、Markdown、PNG 角色卡、CharX、ZIP、DOCX、PDF`)]
  }

  const limitKey = type === 'png' ? 'png' : type === 'pdf' ? 'pdf' : type === 'zip' ? (ext === 'docx' ? 'docx' : 'zip') : 'text'
  if (bytes.length > SIZE_LIMITS[limitKey]) {
    return [fail(fileName, `文件超过 ${Math.round(SIZE_LIMITS[limitKey] / MB)} MB 的上限`)]
  }

  try {
    if (type === 'png') {
      const card = await readPngCard(bytes)
      const out = withMeta(parseStructured(fileName, card.json, kind), 'png')
      if (out.ok && out.file.characters.length) out.file.avatar = { bytes, mime: 'image/png' }
      return [out]
    }

    if (type === 'pdf') {
      if (!deps.loadPdfjs) return [fail(fileName, 'PDF 解析组件未加载')]
      const pdf = await extractPdf(bytes, await deps.loadPdfjs(), deps.cMapUrl)
      const text = pdfToMarkdown(pdf.pages)
      const out = parseTextDocument(fileName, text, kind, { markdown: true, split: opts.split })
      return [withMeta(out, 'pdf', { doc: { text, markdown: true, rawText: pdfRawText(pdf.pages), pages: pdf.pageCount } })]
    }

    if (type === 'zip') {
      const entries = readZip(bytes)
      if (entries.some((e) => e.name === 'word/document.xml')) {
        const stats: DocxStats = { paragraphs: 0, chars: 0 }
        const text = await extractDocx(entries, stats)
        if (!text.trim()) return [fail(fileName, 'Word 文档中没有可提取的文字')]
        const out = parseTextDocument(fileName, text, kind, { markdown: true, split: opts.split })
        return [withMeta(out, 'docx', { doc: { text, markdown: true, rawText: text, paragraphs: stats.paragraphs } })]
      }
      if (entries.some((e) => e.name === 'index.xml' && entries.some((x) => x.name.startsWith('Index/')))) {
        return [fail(fileName, UNSUPPORTED.pages)]
      }
      if (insideZip) return [fail(fileName, '不支持嵌套的压缩包')]
      if (ext === 'docx') return [fail(fileName, '这个文件不是有效的 Word（.docx）文档')]
      const results = await parseZip(fileName, entries, kind, deps)
      return results.map((r) => (r.ok && !r.file.container ? withMeta(r, 'zip') : r))
    }

    if (type === 'binary') return [fail(fileName, '无法识别的二进制文件')]

    // —— 文本 ——
    const decoded = decodeText(bytes, opts.encoding)
    const text = decoded.text
    if (!text.trim()) return [fail(fileName, '文件为空')]
    const isJson = ext === 'json' || (!ext && /^\s*[[{]/.test(text))
    if (isJson) return [withMeta(parseJsonText(fileName, text, kind), 'json')]
    if (ext === 'yaml' || ext === 'yml') return [await parseYaml(fileName, text, kind)]
    const markdown = ext === 'md' || ext === 'markdown'
    const out = parseTextDocument(fileName, text, kind, { markdown, split: opts.split })
    if (out.ok && decoded.suspicious) {
      out.file.warnings.push(`按 ${decoded.encoding.toUpperCase()} 解码后出现乱码字符，可在预览中切换编码重新解析`)
    }
    return [withMeta(out, markdown ? 'md' : 'txt', { doc: { text, markdown, rawText: text, encoding: decoded.encoding } })]
  } catch (e) {
    if (e instanceof ImportError) return [fail(fileName, e.message)]
    return [fail(fileName, `解析失败：${(e as Error)?.message ?? String(e)}`)]
  }
}

/** 入口：一个本地文件可能产出多个结果（例如 ZIP 内含多张角色卡） */
export function importFile(
  fileName: string,
  bytes: Uint8Array,
  kind: ImportKind,
  deps: PipelineDeps = {},
  opts: ImportOptions = {},
): Promise<ParseOutcome[]> {
  return importBytes(fileName, bytes, kind, deps, opts)
}

export function containerLabel(c?: Container): string {
  return c ? CONTAINER_LABELS[c] : ''
}
