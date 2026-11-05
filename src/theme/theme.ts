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

export interface BubbleStyle {
  /** 对方气泡颜色（十六进制） */
  them: string
  /** 自己气泡颜色 */
  me: string
  /** 气泡不透明度 0.3 – 0.95 */
  opacity: number
  /** 细边框（白色）不透明度 0 – 1，0 为无边框 */
  border: number
  /** 气泡角落的小雪花点缀 */
  ornament: boolean
}

export interface ThemeSettings {
  themeId: 'winter-letter'
  /** 应用（列表页）壁纸 */
  wallpaper: WallpaperSetting
  /** 聊天壁纸：跟随应用壁纸，或单独设置 */
  chatWallpaper: { kind: 'inherit' } | WallpaperSetting
  bubble: BubbleStyle
  /** 预留：自定义图标图片（图标名 → 图片 dataURL），后续版本开放 */
  customIcons?: Record<string, string>
  /** 预留：自定义字体（CSS font-family），后续版本开放 */
  fonts?: { body?: string; serifZh?: string; script?: string }
  /** 预留：覆盖部分 CSS 变量，例如 { '--c-accent': '#8aa6c9' } */
  overrides?: Record<string, string>
}

export const DEFAULT_BUBBLE: BubbleStyle = {
  them: '#ffffff',
  me: '#dceaf8',
  opacity: 0.58,
  border: 0.75,
  ornament: true,
}

export const DEFAULT_THEME: ThemeSettings = {
  themeId: 'winter-letter',
  wallpaper: { kind: 'default' },
  chatWallpaper: { kind: 'inherit' },
  bubble: DEFAULT_BUBBLE,
}

/** 气泡预设颜色（冰蓝色系为主） */
export const BUBBLE_COLORS = ['#ffffff', '#dceaf8', '#e6eef9', '#e9e6f6', '#e3f1f1', '#f6ecef', '#eef2f7']

export const WALLPAPER_COLORS = ['#e9f0f7', '#eef1f6', '#e6eef2', '#f2f4f8']

export function useThemeSettings(): ThemeSettings {
  return useLiveQuery(
    async () => {
      const saved = ((await db.settings.get('theme'))?.value as Partial<ThemeSettings>) ?? {}
      return { ...DEFAULT_THEME, ...saved, bubble: { ...DEFAULT_BUBBLE, ...(saved.bubble ?? {}) } }
    },
    [],
    DEFAULT_THEME,
  )
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0xffffff
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(2)})`
}

/** 主题设置 → CSS 变量（气泡、字体与覆盖项） */
export function themeVars(t: ThemeSettings): Record<string, string> {
  const b = t.bubble
  const vars: Record<string, string> = {
    '--c-bubble-them': rgba(b.them, b.opacity),
    '--c-bubble-me': rgba(b.me, b.opacity),
    '--bubble-border': `rgba(255, 255, 255, ${b.border.toFixed(2)})`,
  }
  if (t.fonts?.body) vars['--font-sans'] = t.fonts.body
  if (t.fonts?.serifZh) vars['--font-serif-zh'] = t.fonts.serifZh
  if (t.fonts?.script) vars['--font-script'] = t.fonts.script
  return { ...vars, ...(t.overrides ?? {}) }
}

export async function saveThemeSettings(next: ThemeSettings): Promise<void> {
  await setSetting('theme', next)
}

/** 把主题变量写到 :root */
export function applyThemeVars(vars: Record<string, string>) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) {
    if (k.startsWith('--')) root.style.setProperty(k, v)
  }
}
