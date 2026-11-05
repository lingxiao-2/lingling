/**
 * 浏览器端 pdf.js：按需加载（只有导入 PDF 时才下载），使用兼容旧版 Safari 的 legacy 构建。
 * worker 与中文字符映射表（cmaps）随应用一起部署，不依赖外部 CDN。
 */
import type { PdfjsLike } from './extract/pdf'

export async function loadPdfjsBrowser(): Promise<PdfjsLike> {
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  lib.GlobalWorkerOptions.workerSrc = worker.default
  return lib as unknown as PdfjsLike
}

/** 绝对地址：worker 中也能正确解析 */
export function browserCMapUrl(): string {
  return new URL('pdfjs/cmaps/', document.baseURI).href
}
