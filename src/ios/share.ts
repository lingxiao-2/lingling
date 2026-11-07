/**
 * 从 iPhone 分享菜单把内容交给聆聆：iOS 分享菜单 → 你创建的「分享到聆聆」快捷指令 → 打开聆聆网页（带参数）。
 * 网页不能注册成原生的分享扩展，这里不假装是。
 *  - 文字 / 链接：经过 URL 编码放在地址的 # 之后（不会发送到服务器），最多 MAX_TEXT 字（超出的截断并告诉你）
 *  - 图片：不放进地址。快捷指令把图片拷贝到剪贴板，聆聆打开后由你点「粘贴图片」读取（只在本机处理）
 *  - 文件：只传文件名、大小等信息
 * 收到的内容只暂存在当前页面（sessionStorage），显示预览，你选择保存或发给角色之前什么都不会发生；不会自动发给 AI。
 */
import { memoryCheck } from '../services/ai/memory'

export const MAX_TEXT = 4000
export const SHARE_KEY = 'll-share-pending'

export interface SharedItem {
  kind: 'text' | 'url' | 'image' | 'file'
  text: string
  /** 文字是一个网址时 */
  url?: string
  truncated: boolean
  receivedAt: number
}

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g

/** 支持 `?lingling_share=1&t=…` 与 `#lingling_share=1&t=…`（推荐：# 后面的内容不会发送到服务器，也没有服务器的长度限制） */
export function parseShare(search: string, now = Date.now()): SharedItem | null {
  const q = new URLSearchParams(search.replace(/^[?#]/, ''))
  if (q.get('lingling_share') !== '1') return null
  const kindRaw = q.get('kind')
  let text = (q.get('t') ?? '').replace(CTRL, '').trim()
  const truncated = text.length > MAX_TEXT
  if (truncated) text = text.slice(0, MAX_TEXT)
  let url: string | undefined
  if (/^https?:\/\/\S+$/i.test(text) && text.length <= 2000) {
    try {
      const u = new URL(text)
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password) url = u.toString()
    } catch {
      /* 不是网址 */
    }
  }
  const kind: SharedItem['kind'] = kindRaw === 'image' ? 'image' : kindRaw === 'file' ? 'file' : url ? 'url' : 'text'
  if ((kind === 'text' || kind === 'url') && !text) return null
  return { kind, text, url, truncated, receivedAt: now }
}

/** 看起来含有证件号、银行卡号、密码、密钥或健康财务等敏感信息 */
export function sensitivity(text: string): 'forbidden' | 'sensitive' | null {
  const c = memoryCheck(text)
  return !c.ok ? 'forbidden' : c.sensitive ? 'sensitive' : null
}

const ss = () => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}
let memory: SharedItem | null = null

export function stashShare(item: SharedItem) {
  memory = item
  try {
    ss()?.setItem(SHARE_KEY, JSON.stringify(item))
  } catch {
    /* 无痕模式：只保存在内存里 */
  }
}

export function pendingShare(): SharedItem | null {
  if (memory) return memory
  try {
    const v = ss()?.getItem(SHARE_KEY)
    return v ? (JSON.parse(v) as SharedItem) : null
  } catch {
    return null
  }
}

export function clearShare() {
  memory = null
  try {
    ss()?.removeItem(SHARE_KEY)
  } catch {
    /* ignore */
  }
}

/** 「分享到聆聆」快捷指令最后打开的地址前缀 */
export function shareUrlPrefix(base: string, kind?: 'image' | 'file'): string {
  return `${base}#lingling_share=1${kind ? `&kind=${kind}` : ''}&t=`
}
