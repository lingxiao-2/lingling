/** 用户自己部署的「表情包链接导入」图片代理设置（只保存在本机浏览器，不写入仓库或构建产物） */
import { getSetting, setSetting } from '../db/db'
import type { LinkProxy } from './linkImport'

const KEY = 'link-proxy'

export async function loadLinkProxy(): Promise<LinkProxy | null> {
  const p = await getSetting<LinkProxy | null>(KEY, null)
  return p?.url ? p : null
}

export async function saveLinkProxy(p: LinkProxy | null): Promise<void> {
  await setSetting(KEY, p && p.url.trim() ? { url: p.url.trim(), token: p.token } : null)
}

/** 代理地址只接受 https（本机调试除外） */
export function checkProxyUrl(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol === 'https:') return null
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return null
    return '代理地址必须是 https:// 开头'
  } catch {
    return '代理地址格式不正确'
  }
}
