import { useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { applyThemeVars, themeVars, useThemeSettings, type ThemeSettings, type WallpaperSetting } from '../theme/theme'
import { applyCustomIcons } from '../theme/icons'

/**
 * 原创的默认雪景壁纸（程序生成，不使用任何外部素材）：
 * 冰蓝渐变天空、右上角柔光、远近两层雪丘、细雪与少量四角星光。
 */
function defaultScene(): string {
  let s = 20261105
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const W = 390
  const H = 844
  const hill = (base: number, amp: number, step: number) => {
    let d = `M0 ${base}`
    for (let x = 0; x < W; x += step) {
      d += ` Q${x + step / 2} ${base - amp * (0.3 + rnd() * 0.9)} ${x + step} ${base - amp * rnd() * 0.5}`
    }
    return `${d} L${W} ${H} L0 ${H} Z`
  }
  let snow = ''
  for (let i = 0; i < 90; i++) {
    const r = 0.4 + rnd() * 1.2
    snow += `<circle cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H * 0.92).toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" fill-opacity="${(0.35 + rnd() * 0.55).toFixed(2)}"/>`
  }
  let stars = ''
  for (let i = 0; i < 9; i++) {
    const x = rnd() * W
    const y = rnd() * H * 0.7
    const k = 2.5 + rnd() * 3.5
    stars += `<path d="M${x} ${y - k}L${x + k * 0.22} ${y - k * 0.22}L${x + k} ${y}L${x + k * 0.22} ${y + k * 0.22}L${x} ${y + k}L${x - k * 0.22} ${y + k * 0.22}L${x - k} ${y}L${x - k * 0.22} ${y - k * 0.22}Z" fill="#fff" fill-opacity="${(0.55 + rnd() * 0.4).toFixed(2)}"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6e3f1"/><stop offset=".55" stop-color="#e6eef7"/><stop offset="1" stop-color="#f3f6fa"/></linearGradient>
<radialGradient id="glow" cx=".82" cy=".14" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<path d="${hill(H * 0.8, 46, 65)}" fill="#fff" fill-opacity=".45"/>
<path d="${hill(H * 0.87, 34, 78)}" fill="#fff" fill-opacity=".7"/>
${snow}${stars}</svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
}

let cachedScene: string | null = null

export function wallpaperStyle(w: WallpaperSetting): CSSProperties {
  if (w.kind === 'image' && w.image) {
    return { backgroundImage: `url("${w.image}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  if (w.kind === 'color') return { background: w.color || 'var(--c-bg)' }
  cachedScene ??= defaultScene()
  return { backgroundImage: cachedScene, backgroundSize: 'cover', backgroundPosition: 'center bottom' }
}

/**
 * 全局背景层：固定在最底层，所有页面共用。
 * veil 为一层薄雾，列表页用 'list'（更浓，保证文字可读），聊天页（第二阶段）用 'chat'。
 */
export default function Wallpaper({ veil = 'list' }: { veil?: 'list' | 'chat' | 'none' }) {
  const theme = useThemeSettings()
  const vars = useMemo(() => themeVars(theme), [theme])
  useEffect(() => applyThemeVars(vars), [vars])
  useEffect(() => applyCustomIcons(theme.customIcons), [theme.customIcons])
  const style = useMemo(() => wallpaperStyle(theme.wallpaper), [theme.wallpaper])
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 pointer-events-none" style={style}>
      {veil !== 'none' && (
        <div className="absolute inset-0" style={{ background: veil === 'chat' ? 'var(--veil-chat)' : 'var(--veil-list)' }} />
      )}
    </div>
  )
}

/** 聊天页使用的壁纸：单独设置的聊天壁纸，或跟随应用壁纸 */
export function chatWallpaperOf(t: ThemeSettings): WallpaperSetting {
  return t.chatWallpaper.kind === 'inherit' ? t.wallpaper : t.chatWallpaper
}

/**
 * 聊天背景层：覆盖在全局壁纸之上（同样不接收点击），薄雾更淡，让壁纸更清晰。
 * 文字可读性由毛玻璃气泡与输入栏保证；壁纸永远在最底层，不会遮挡文字或按钮。
 */
export function ChatWallpaper() {
  const theme = useThemeSettings()
  const style = useMemo(() => wallpaperStyle(chatWallpaperOf(theme)), [theme])
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-[5] pointer-events-none" style={style}>
      <div className="absolute inset-0" style={{ background: 'var(--veil-chat)' }} />
    </div>
  )
}
