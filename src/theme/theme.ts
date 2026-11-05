/**
 * 主题与壁纸配置。保存在 IndexedDB 的 settings 表（key = 'theme'），刷新后保留。
 * 目前只有 Winter Letter 一套主题；themeId 与 overrides 为以后的自定义主题预留。
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setSetting } from '../db/db'

export type WallpaperKind = 'default' | 'image' | 'color'

export interface WallpaperSetting {
  kind: WallpaperKind
  /** kind = image：用户上传的图片（压缩后的 dataURL，只存在本设备） */
  image?: string
  /** kind = color：纯色 */
  color?: string
}

export interface ThemeSettings {
  themeId: 'winter-letter'
  wallpaper: WallpaperSetting
  /** 预留：覆盖部分 CSS 变量，例如 { '--c-accent': '#8aa6c9' } */
  overrides?: Record<string, string>
}

export const DEFAULT_THEME: ThemeSettings = {
  themeId: 'winter-letter',
  wallpaper: { kind: 'default' },
}

export const WALLPAPER_COLORS = ['#e9f0f7', '#eef1f6', '#e6eef2', '#f2f4f8']

export function useThemeSettings(): ThemeSettings {
  return useLiveQuery(
    async () => ({ ...DEFAULT_THEME, ...(((await db.settings.get('theme'))?.value as Partial<ThemeSettings>) ?? {}) }),
    [],
    DEFAULT_THEME,
  )
}

export async function saveThemeSettings(next: ThemeSettings): Promise<void> {
  await setSetting('theme', next)
}

/** 把 overrides 写到 :root；没有覆盖时不做任何事 */
export function applyThemeOverrides(overrides: Record<string, string> | undefined) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (k.startsWith('--')) root.style.setProperty(k, v)
  }
}
