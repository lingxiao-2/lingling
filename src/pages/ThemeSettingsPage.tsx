import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import NavBar from '../components/NavBar'
import { wallpaperStyle } from '../components/Wallpaper'
import { Section, SectionTitle } from '../components/ui'
import { Icon } from '../theme/icons'
import { saveThemeSettings, useThemeSettings, WALLPAPER_COLORS, type WallpaperSetting } from '../theme/theme'

/** 压缩用户上传的壁纸：长边不超过 1600px，JPEG 0.82，只保存在本设备 */
function compressWallpaper(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      URL.revokeObjectURL(url)
      if (!ctx) return reject(new Error('无法处理图片'))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

function Swatch({
  label,
  active,
  style,
  onClick,
  children,
}: {
  label: string
  active: boolean
  style?: CSSProperties
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button onClick={onClick} className="press flex flex-col items-center gap-2">
      <span
        className={`relative h-[132px] w-[74px] rounded-[16px] overflow-hidden flex items-center justify-center ${
          active ? 'ring-[1.5px] ring-[var(--c-accent)] ring-offset-2 ring-offset-transparent' : 'ring-1 ring-white/80'
        }`}
        style={{ boxShadow: 'var(--shadow-soft)', ...style }}
      >
        {children}
        {active && (
          <span className="absolute bottom-1.5 right-1.5 h-4 w-4 rounded-full bg-[var(--c-accent)] text-white flex items-center justify-center">
            <Icon name="check" size="xs" stroke="bold" />
          </span>
        )}
      </span>
      <span className={`text-[12px] ${active ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-text-2)]'}`}>{label}</span>
    </button>
  )
}

export default function ThemeSettingsPage() {
  const theme = useThemeSettings()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const w = theme.wallpaper

  const setWallpaper = (wallpaper: WallpaperSetting) => void saveThemeSettings({ ...theme, wallpaper })

  const pick = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const image = await compressWallpaper(file)
      await saveThemeSettings({ ...theme, wallpaper: { kind: 'image', image } })
    } catch {
      alert('图片读取失败，请换一张试试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="主题与壁纸" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-12">
        <div className="pt-6 pb-2 text-center">
          <div className="script-en text-[28px] text-[var(--c-brand-soft)]">Winter Letter</div>
          <div className="serif-zh mt-1 text-[15px] tracking-[0.2em] text-[var(--c-brand)]">冬日来信</div>
          <div className="mt-1.5 text-[11px] text-[var(--c-text-3)]">当前主题</div>
        </div>

        <SectionTitle en="Wallpaper" zh="壁纸" />
        <div className="mx-4 card px-4 py-5">
          <div className="flex justify-between">
            <Swatch label="默认雪景" active={w.kind === 'default'} style={wallpaperStyle({ kind: 'default' })} onClick={() => setWallpaper({ kind: 'default' })} />
            <Swatch
              label={busy ? '处理中…' : w.image ? '我的图片' : '上传图片'}
              active={w.kind === 'image'}
              style={w.image ? wallpaperStyle({ kind: 'image', image: w.image }) : { background: 'var(--glass-2)' }}
              onClick={() => (w.image && w.kind !== 'image' ? setWallpaper({ ...w, kind: 'image' }) : fileRef.current?.click())}
            >
              {!w.image && <Icon name="image" size="lg" stroke="thin" className="text-[var(--c-text-3)]" />}
            </Swatch>
            <Swatch
              label="纯色"
              active={w.kind === 'color'}
              style={{ background: w.color ?? WALLPAPER_COLORS[0] }}
              onClick={() => setWallpaper({ ...w, kind: 'color', color: w.color ?? WALLPAPER_COLORS[0] })}
            />
          </div>

          {w.kind === 'color' && (
            <div className="mt-5 flex justify-center gap-3">
              {WALLPAPER_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`纯色 ${c}`}
                  onClick={() => setWallpaper({ ...w, kind: 'color', color: c })}
                  className={`press h-7 w-7 rounded-full ${w.color === c ? 'ring-[1.5px] ring-[var(--c-accent)] ring-offset-2' : 'ring-1 ring-white'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
          {w.image && (
            <div className="mt-4 flex justify-center gap-5 text-[12px]">
              <button onClick={() => fileRef.current?.click()} className="press text-[var(--c-accent-strong)]">
                更换图片
              </button>
              <button onClick={() => setWallpaper({ kind: w.kind === 'image' ? 'default' : w.kind, color: w.color })} className="press text-[var(--c-text-3)]">
                删除我的图片
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
        <p className="mx-6 mt-3 text-[11px] leading-relaxed text-[var(--c-text-3)]">
          壁纸只保存在本设备，会自动压缩。列表页会加一层薄雾，保证文字清晰。
        </p>

        <Section title="即将开放">
          <div className="px-4 py-3 text-[13px] text-[var(--c-text-2)] leading-relaxed">
            更多主题、自定义图标、单个聊天的独立背景将在后续版本加入，当前设置会被保留。
          </div>
        </Section>
      </div>
    </div>
  )
}
