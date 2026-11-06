/**
 * 批量文本导入：每行「名称 + 图片链接」。
 *
 *  解析（纯函数）：
 *   - 名称：URL 前面的文字，去掉末尾的中英文冒号和空白；支持「名称：url」「名称:url」「名称 url」「名称url」
 *   - 空行忽略；没有 URL 的行标记失败，不影响其他行
 *  链接清洗（不默默改错）：
 *   - 去掉首尾空白、URL 中混入的空格、末尾的中文标点
 *   - 扩展名缺少点号（…/LRiByntjpeg）、扩展名笔误（.peg）：生成「候选链接」，下载时先试修正后的，
 *     失败再试原链接；只有真实下载并解析成功的图片才算成功，并在预览中标明「已自动修正」
 *   - 不改动路径的大小写（服务器通常区分大小写），只在原链接失败时才尝试统一大小写的版本
 *  下载与校验：真实请求每个链接，按文件内容判断图片类型，解码生成缩略图，按内容哈希去重。
 */
import type { PreparedSticker } from './stickers'
import { LinkError, type Fetched } from './linkImport'

export interface Candidate {
  url: string
  /** 相对原链接做了什么修正；空表示原样 */
  fix?: string
}

export interface ParsedLine {
  /** 原文中的行号（从 1 开始） */
  line: number
  raw: string
  name: string
  /** 原始链接文字 */
  rawUrl: string
  /** 依次尝试的链接；为空表示无法识别 */
  candidates: Candidate[]
  /** 已做的清理（空格、标点） */
  cleaned: string[]
  /** 可能有问题、但仍会尝试的提示 */
  warning?: string
  /** 无法导入的原因 */
  error?: string
}

const EXT = /^(jpe?g|png|webp|gif)$/i
const URL_START = /h\s*t\s*t\s*p\s*s?\s*[:：]\s*\/\s*\//i

/** 名称末尾的分隔符与包裹 */
function cleanName(s: string): string {
  return s
    .replace(/[\s:：\-—–|｜>》→=]+$/u, '')
    .replace(/^\s*\d{1,3}[.、)）]\s*(?=\S)/u, '')
    .trim()
    .slice(0, 40)
}

/** 解析一行；空行返回 null */
export function parseLine(raw: string, line: number): ParsedLine | null {
  const text = raw.replace(/​|﻿/g, '')
  if (!text.trim()) return null
  const m = URL_START.exec(text)
  if (!m) {
    return { line, raw, name: cleanName(text), rawUrl: '', candidates: [], cleaned: [], error: '没有找到链接（需要以 http:// 或 https:// 开头）' }
  }
  const name = cleanName(text.slice(0, m.index))
  const rawUrl = text.slice(m.index).trim()
  const cleaned: string[] = []

  let u = rawUrl
  if (/\s/.test(u)) {
    u = u.replace(/\s+/g, '')
    cleaned.push('链接中有空格，已去掉')
  }
  if (/：/.test(u.slice(0, 8))) {
    u = u.replace('：', ':')
    cleaned.push('协议中的中文冒号已改为英文冒号')
  }
  const trail = /[，。；、！？,;!?)）」』】>》"'”’]+$/u.exec(u)
  if (trail) {
    u = u.slice(0, trail.index)
    cleaned.push('去掉了链接末尾的标点')
  }

  let parsed: URL
  try {
    parsed = new URL(u)
  } catch {
    return { line, raw, name, rawUrl, candidates: [], cleaned, error: cleaned.length ? '清理后仍不是有效链接' : '不是有效链接' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { line, raw, name, rawUrl, candidates: [], cleaned, error: '只支持 http / https 链接' }
  }

  const candidates: Candidate[] = []
  let warning: string | undefined
  const seg = parsed.pathname.split('/').pop() ?? ''
  const dot = seg.lastIndexOf('.')
  const ext = dot >= 0 ? seg.slice(dot + 1) : ''
  const withSeg = (newSeg: string) => {
    const v = new URL(parsed.href)
    v.pathname = parsed.pathname.slice(0, parsed.pathname.length - seg.length) + newSeg
    return v.href
  }

  if (dot < 0) {
    // 没有扩展名：结尾恰好是 jpeg / jpg / png / webp / gif，很可能是漏了点号
    const miss = /^(.{3,}?)(jpeg|jpg|png|webp|gif)$/i.exec(seg)
    if (miss) {
      candidates.push({ url: withSeg(`${miss[1]}.${miss[2]}`), fix: `疑似缺少点号，已改为「.${miss[2]}」` })
      warning = `链接结尾「${miss[2]}」前疑似缺少点号，会先尝试「${miss[1]}.${miss[2]}」`
    }
    candidates.push({ url: parsed.href })
  } else if (!EXT.test(ext) && /^(peg|jgp|jpe|jepg|jpge|pgn|npg|pnj|wepb|webm?p|gfi|igf)$/i.test(ext)) {
    // 常见笔误：不能确定，先试最可能的写法，再试原链接
    const guess = /^(pn|np|pg)/i.test(ext) ? 'png' : /^w/i.test(ext) ? 'webp' : /^[gi]/i.test(ext) && ext.length === 3 && /f/i.test(ext) ? 'gif' : 'jpeg'
    const base = seg.slice(0, dot)
    candidates.push({ url: withSeg(`${base}.${guess}`), fix: `扩展名「.${ext}」疑似笔误，已改为「.${guess}」` })
    candidates.push({ url: parsed.href })
    warning = `扩展名「.${ext}」无法确认是否有效，会先尝试「.${guess}」，再尝试原链接`
  } else {
    candidates.push({ url: parsed.href })
    if (ext && EXT.test(ext) && ext !== ext.toLowerCase()) {
      candidates.push({ url: withSeg(`${seg.slice(0, dot)}.${ext.toLowerCase()}`), fix: '扩展名改为小写' })
    }
  }
  // 路径中的大小写（例如 /V2/ 与 /v2/）：原链接优先；失败时再试小写目录
  const dirs = parsed.pathname.slice(0, parsed.pathname.length - seg.length)
  if (dirs !== dirs.toLowerCase()) {
    for (const c of [...candidates]) {
      const v = new URL(c.url)
      const s2 = v.pathname.split('/').pop() ?? ''
      v.pathname = v.pathname.slice(0, v.pathname.length - s2.length).toLowerCase() + s2
      if (!candidates.some((x) => x.url === v.href)) candidates.push({ url: v.href, fix: [c.fix, '目录改为小写'].filter(Boolean).join('；') })
    }
  }
  return { line, raw, name, rawUrl, candidates, cleaned, warning }
}

export function parseBatchText(text: string): ParsedLine[] {
  const out: ParsedLine[] = []
  text.replace(/\r\n?/g, '\n').split('\n').forEach((l, i) => {
    const p = parseLine(l, i + 1)
    if (p) out.push(p)
  })
  return out
}

export type BatchStatus = 'pending' | 'fetching' | 'ok' | 'duplicate' | 'failed'

export interface BatchItem extends ParsedLine {
  status: BatchStatus
  reason?: string
  /** 实际成功的链接 */
  finalUrl?: string
  /** 成功时使用的修正说明 */
  appliedFix?: string
  prepared?: PreparedSticker
}

export interface BatchDeps {
  fetch: (url: string, signal?: AbortSignal) => Promise<Fetched>
  prepare: (bytes: Uint8Array) => Promise<PreparedSticker>
  existingHashes: Set<string>
  onUpdate?: (item: BatchItem) => void
  /** 同时下载的数量 */
  concurrency?: number
  signal?: AbortSignal
}

function reasonOf(e: unknown): string {
  if (e instanceof LinkError) {
    switch (e.kind) {
      case 'cors':
        return '跨域限制：图片能显示，但网站不允许聆聆读取（可在「表情包与识图」配置图片代理）'
      case 'network':
        return '链接无法访问：链接失效、防盗链、跨域限制或网络不通'
      case 'mixed':
        return '链接无法访问：http 链接被浏览器拦截'
      case 'auth':
      case 'notfound':
      case 'http':
      case 'ratelimit':
        return `链接无法访问：${e.message}`
      case 'timeout':
      case 'toolarge':
      case 'empty':
        return `图片下载失败：${e.message}`
      case 'unsupported':
        return `链接内容不是图片：${e.message}`
      case 'invalid':
      case 'blocked':
        return `不是有效链接：${e.message}`
      case 'proxy':
        return `图片代理出错：${e.message}`
    }
  }
  return e instanceof Error ? e.message : String(e)
}

/** 下载、校验并去重；每一项的结果通过 onUpdate 实时返回。某一项失败不影响其他项 */
export async function fetchBatch(lines: ParsedLine[], deps: BatchDeps): Promise<BatchItem[]> {
  const items: BatchItem[] = lines.map((l) => ({ ...l, status: l.error ? 'failed' : 'pending', reason: l.error }))
  const seen = new Set(deps.existingHashes)
  const queue = items.filter((i) => i.status === 'pending')
  const emit = (i: BatchItem) => deps.onUpdate?.({ ...i })

  const work = async (it: BatchItem) => {
    it.status = 'fetching'
    emit(it)
    let lastErr: unknown = null
    let firstErr: unknown = null
    for (const c of it.candidates) {
      if (deps.signal?.aborted) break
      try {
        const f = await deps.fetch(c.url, deps.signal)
        if (f.kind === 'zip') throw new LinkError('链接是 ZIP 压缩包，请用「通过链接导入」导入整套', 'unsupported')
        if (f.kind !== 'image') throw new LinkError('链接打开的是网页，不是图片', 'unsupported')
        let p: PreparedSticker
        try {
          p = await deps.prepare(f.bytes)
        } catch (e) {
          throw new LinkError(`图片格式不支持或已损坏（${e instanceof Error ? e.message : '无法解析'}）`, 'unsupported')
        }
        it.finalUrl = f.finalUrl || c.url
        it.appliedFix = c.fix
        if (seen.has(p.hash)) {
          it.status = 'duplicate'
          it.reason = '该图片已存在'
        } else {
          seen.add(p.hash)
          it.status = 'ok'
          it.prepared = p
          it.reason = undefined
        }
        emit(it)
        return
      } catch (e) {
        firstErr ??= e
        lastErr = e
      }
    }
    it.status = 'failed'
    const tried = it.candidates.length > 1
    // 优先报告第一个（修正后的）链接的原因；若都失败，说明修正后仍无效
    const base = reasonOf(firstErr ?? lastErr ?? new Error('已取消'))
    it.reason = tried && it.candidates[0].fix ? `自动修正后仍无效。${base}` : base
    emit(it)
  }

  const n = Math.max(1, deps.concurrency ?? 3)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (next < queue.length && !deps.signal?.aborted) await work(queue[next++])
    }),
  )
  return items
}
