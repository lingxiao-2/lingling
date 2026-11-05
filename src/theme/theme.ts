/**
 * 主题与壁纸配置。保存在 IndexedDB 的 settings 表（key = 'theme'），刷新后保留。
 * 目前只有 Winter Letter 一套主题；themeId 与 overrides 为以后的自定义主题预留。
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setSetting } from '../db/db'
import { SNOWFLAKE_WHITE } from '../assets/winter/ornaments'

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

export type ChatFont = 'sans' | 'serif' | 'kai'

export interface ChatTextStyle {
  font: ChatFont
  /** 聊天文字大小（px） */
  size: number
  /** 聊天头像尺寸（px，24 – 34） */
  avatar: number
}

/** 聊天字体：优先使用 iPhone 自带字体，末尾附表情符号字体，保证中英文与 emoji 都能显示 */
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"'
export const CHAT_FONTS: Record<ChatFont, { label: string; stack: string }> = {
  sans: { label: '苹方', stack: `-apple-system, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif, ${EMOJI}` },
  serif: { label: '宋体', stack: `"Songti SC", "Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", serif, ${EMOJI}` },
  kai: { label: '楷体', stack: `"Kaiti SC", "STKaiti", "KaiTi", "BiauKai", "Songti SC", serif, ${EMOJI}` },
}

export const DEFAULT_CHAT_TEXT: ChatTextStyle = { font: 'sans', size: 14, avatar: 26 }

export interface ThemeSettings {
  themeId: 'winter-letter'
  /** 应用（列表页）壁纸 */
  wallpaper: WallpaperSetting
  /** 聊天壁纸：跟随应用壁纸，或单独设置 */
  chatWallpaper: { kind: 'inherit' } | WallpaperSetting
  bubble: BubbleStyle
  chatText: ChatTextStyle
  /** 预留：自定义图标图片（图标名 → 图片 dataURL），后续版本开放 */
  customIcons?: Record<string, string>
  /** 预留：自定义字体（CSS font-family），后续版本开放 */
  fonts?: { body?: string; serifZh?: string; script?: string }
  /** 预留：覆盖部分 CSS 变量，例如 { '--c-accent': '#8aa6c9' } */
  overrides?: Record<string, string>
}

/** 默认气泡：参照冬日来信母版的半透明冰蓝玻璃 */
export const DEFAULT_BUBBLE: BubbleStyle = {
  them: '#e6edf9',
  me: '#dde6f6',
  opacity: 0.4,
  border: 0.74,
  ornament: true,
}

export const DEFAULT_THEME: ThemeSettings = {
  themeId: 'winter-letter',
  wallpaper: { kind: 'default' },
  chatWallpaper: { kind: 'inherit' },
  bubble: DEFAULT_BUBBLE,
  chatText: DEFAULT_CHAT_TEXT,
}

/** 气泡预设颜色（冰蓝色系为主） */
export const BUBBLE_COLORS = ['#ffffff', '#dceaf8', '#e6eef9', '#e9e6f6', '#e3f1f1', '#f6ecef', '#eef2f7']

export const WALLPAPER_COLORS = ['#e9f0f7', '#eef1f6', '#e6eef2', '#f2f4f8']

export function useThemeSettings(): ThemeSettings {
  return useLiveQuery(
    async () => {
      const saved = ((await db.settings.get('theme'))?.value as Partial<ThemeSettings>) ?? {}
      return {
        ...DEFAULT_THEME,
        ...saved,
        bubble: { ...DEFAULT_BUBBLE, ...(saved.bubble ?? {}) },
        chatText: { ...DEFAULT_CHAT_TEXT, ...(saved.chatText ?? {}) },
      }
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
    '--chat-font': (CHAT_FONTS[t.chatText.font] ?? CHAT_FONTS.sans).stack,
    '--chat-font-size': `${Math.min(20, Math.max(13, t.chatText.size))}px`,
    '--ornament-snowflake': SNOWFLAKE_WHITE,
  }
  if (t.fonts?.body) vars['--font-sans'] = t.fonts.body
  if (t.fonts?.serifZh) vars['--font-serif-zh'] = t.fonts.serifZh
  if (t.fonts?.script) vars['--font-script'] = t.fonts.script
  return { ...vars, ...(t.overrides ?? {}) }
}

export async function saveThemeSettings(next: ThemeSettings): Promise<void> {
  await setSetting('theme', next)
}

/** 只修改部分设置：先读取已保存的最新值再合并，避免页面尚未读完时用默认值覆盖用户的壁纸等设置 */
export async function updateThemeSettings(patch: Partial<ThemeSettings>): Promise<void> {
  const saved = ((await db.settings.get('theme'))?.value as Partial<ThemeSettings>) ?? {}
  await setSetting('theme', { ...DEFAULT_THEME, ...saved, ...patch })
}

/** 把主题变量写到 :root */
export function applyThemeVars(vars: Record<string, string>) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) {
    if (k.startsWith('--')) root.style.setProperty(k, v)
  }
}
