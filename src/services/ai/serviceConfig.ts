/**
 * 聆聆默认服务的公开地址（不依赖数据库，供请求层与测试使用）。
 * 地址在构建时通过 VITE_LINGLING_SERVICE_URL 注入；它是公开地址，不是密钥。
 */
const BUILD_URL: string = (((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_LINGLING_SERVICE_URL ?? '') as string)
  .trim()
  .replace(/\/+$/, '')

let override: string | null = null

export function getServiceUrl(): string {
  return override ?? BUILD_URL
}

/** 仅供测试使用 */
export function setServiceUrlForTesting(url: string | null) {
  override = url === null ? null : url.replace(/\/+$/, '')
}

export function serviceAvailable(url = getServiceUrl()): boolean {
  return /^https:\/\//i.test(url)
}

export const CLIENT_ID = 'lingling-web/0.2'

