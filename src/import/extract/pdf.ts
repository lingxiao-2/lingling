/**
 * PDF 文字提取（文字型 PDF）。pdf.js 由调用方注入，浏览器与测试使用同一套逻辑。
 * 扫描版 PDF（没有可提取的文字）会明确报错并提示需要 OCR，不会当作导入成功。
 */
import { ImportError } from './bytes'

/** 只声明用到的 pdf.js 接口 */
export interface PdfjsLike {
  getDocument(src: Record<string, unknown>): {
    promise: Promise<{
      numPages: number
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>
      destroy?: () => Promise<void>
    }>
    destroy?: () => Promise<void>
  }
}

export interface PdfText {
  pages: string[]
  pageCount: number
}

export const PDF_LIMITS = { maxPages: 300, timeoutMs: 45_000 }

function pageText(items: unknown[]): string {
  let out = ''
  for (const it of items) {
    const item = it as { str?: string; hasEOL?: boolean }
    if (typeof item.str !== 'string') continue
    out += item.str
    if (item.hasEOL) out += '\n'
  }
  // 许多 PDF 把常用汉字映射成外观相同的「康熙部首 / 部首补充」字符（如 ⼀ U+2F00 ≠ 一 U+4E00），
  // 只对这两个区段做兼容规范化，不影响中文全角标点
  return out
    .replace(/[\u2e80-\u2ef3\u2f00-\u2fd5]/g, (ch) => ch.normalize('NFKC'))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractPdf(data: Uint8Array, pdfjs: PdfjsLike, cMapUrl?: string): Promise<PdfText> {
  const task = pdfjs.getDocument({
    data: data.slice(), // pdf.js 会转移底层内存，传副本
    cMapUrl,
    cMapPacked: true,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ImportError('PDF 解析超时，文件可能过大或过于复杂')), PDF_LIMITS.timeoutMs)
  })
  try {
    const doc = await Promise.race([task.promise, timeout]).catch((e: unknown) => {
      if (e instanceof ImportError) throw e
      const name = (e as { name?: string })?.name ?? ''
      if (name === 'PasswordException') throw new ImportError('这个 PDF 设有密码，暂不支持')
      if (name === 'InvalidPDFException') throw new ImportError('PDF 文件已损坏或不是有效的 PDF')
      throw new ImportError(`PDF 无法打开：${(e as Error)?.message ?? String(e)}`)
    })
    const close = async () => {
      await (doc.destroy ? doc.destroy() : task.destroy?.())?.catch?.(() => undefined)
    }
    if (doc.numPages > PDF_LIMITS.maxPages) {
      await close()
      throw new ImportError(`PDF 共 ${doc.numPages} 页，超过 ${PDF_LIMITS.maxPages} 页的上限，请拆分后再导入`)
    }
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await Promise.race([doc.getPage(i), timeout])
      const content = await Promise.race([page.getTextContent(), timeout])
      pages.push(pageText(content.items))
    }
    await close()
    const chars = pages.join('').replace(/\s/g, '').length
    if (chars === 0) {
      throw new ImportError('这个 PDF 没有可提取的文字，可能是扫描件或图片。需要先做 OCR（文字识别），当前版本暂不支持')
    }
    if (chars < 8 * pages.length && chars < 40) {
      throw new ImportError('这个 PDF 几乎没有可提取的文字，可能是扫描件。需要先做 OCR，当前版本暂不支持')
    }
    return { pages, pageCount: pages.length }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const CHAPTER = /^(第[一二三四五六七八九十百千零〇\d]+[章节回部卷篇幕]|[一二三四五六七八九十]+、|序章|序言|楔子|尾声|后记|附录)/

/** 把常见的中文章节行转换为 Markdown 标题，便于按章节拆分（用户可在预览中改为整篇导入） */
export function pdfToMarkdown(pages: string[]): string {
  return pages
    .join('\n')
    .split('\n')
    .map((line) => {
      const t = line.trim()
      return t.length <= 30 && CHAPTER.test(t) ? `## ${t}` : line
    })
    .join('\n')
}

/** 原始文本：保留页码，供用户核对 */
export function pdfRawText(pages: string[]): string {
  return pages.map((t, i) => `—— 第 ${i + 1} 页 ——\n${t}`).join('\n\n')
}
