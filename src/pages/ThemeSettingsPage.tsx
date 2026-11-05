import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { chatWallpaperOf, wallpaperStyle } from '../components/Wallpaper'
import { GhostButton, Row, Section, SectionTitle } from '../components/ui'
import { Icon } from '../theme/icons'
import {
  CHAT_FONTS,
  type ChatFont,
  BUBBLE_COLORS,
  DEFAULT_BUBBLE,
  WALLPAPER_COLORS,
  rgba,
  updateThemeSettings,
  useThemeSettings,
  type BubbleStyle,
  type ThemeSettings,
  type WallpaperSetting,
} from '../theme/theme'
import { useProfile } from '../store/profile'

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
    <button onClick={onClick} className="press flex flex-col items-center gap-1.5">
      <span
        className={`relative h-[104px] w-[58px] rounded-[13px] overflow-hidden flex items-center justify-center ${
          active ? 'ring-[1.5px] ring-[var(--c-accent)] ring-offset-2 ring-offset-transparent' : 'ring-1 ring-white/80'
        }`}
        style={{ boxShadow: 'var(--shadow-soft)', ...style }}
      >
        {children}
        {active && (
          <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full bg-[var(--c-accent)] text-white flex items-center justify-center">
            <Icon name="check" size="xs" stroke="bold" />
          </span>
        )}
      </span>
      <span className={`text-[11px] ${active ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-text-2)]'}`}>{label}</span>
    </button>
  )
}

/** 壁纸选择：默认雪景 / 我的图片 / 纯色（聊天壁纸额外有「跟随应用」） */
function WallpaperPicker({
  value,
  inherit,
  inheritStyle,
  onChange,
}: {
  value: WallpaperSetting | { kind: 'inherit' }
  inherit?: boolean
  inheritStyle?: CSSProperties
  onChange: (v: WallpaperSetting | { kind: 'inherit' }) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const w = value.kind === 'inherit' ? undefined : value
  const image = w?.image

  const pick = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      onChange({ kind: 'image', image: await compressWallpaper(file), color: w?.color })
    } catch {
      alert('图片读取失败，请换一张试试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-4 card px-3 py-4">
      <div className="flex justify-around">
        {inherit && (
          <Swatch label="跟随应用" active={value.kind === 'inherit'} style={inheritStyle} onClick={() => onChange({ kind: 'inherit' })}>
            <span className="text-[10px] text-[var(--c-text-2)] bg-white/60 rounded-full px-1.5">同步</span>
          </Swatch>
        )}
        <Swatch label="默认雪景" active={value.kind === 'default'} style={wallpaperStyle({ kind: 'default' })} onClick={() => onChange({ kind: 'default' })} />
        <Swatch
          label={busy ? '处理中…' : image ? '我的图片' : '上传图片'}
          active={value.kind === 'image'}
          style={image ? wallpaperStyle({ kind: 'image', image }) : { background: 'var(--glass-2)' }}
          onClick={() => (image && value.kind !== 'image' ? onChange({ ...w!, kind: 'image' }) : fileRef.current?.click())}
        >
          {!image && <Icon name="image" size="lg" stroke="thin" className="text-[var(--c-text-3)]" />}
        </Swatch>
        <Swatch
          label="纯色"
          active={value.kind === 'color'}
          style={{ background: w?.color ?? WALLPAPER_COLORS[0] }}
          onClick={() => onChange({ kind: 'color', color: w?.color ?? WALLPAPER_COLORS[0], image })}
        />
      </div>
      {value.kind === 'color' && (
        <div className="mt-4 flex justify-center gap-3">
          {WALLPAPER_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`纯色 ${c}`}
              onClick={() => onChange({ kind: 'color', color: c, image })}
              className={`press h-6 w-6 rounded-full ${w?.color === c ? 'ring-[1.5px] ring-[var(--c-accent)] ring-offset-2' : 'ring-1 ring-white'}`}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
      {image && (
        <div className="mt-3 flex justify-center gap-3">
          <GhostButton onClick={() => fileRef.current?.click()}>更换图片</GhostButton>
          <GhostButton onClick={() => onChange({ kind: 'default' })}>删除我的图片</GhostButton>
        </div>
      )}
      {/* accept=image/*：iPhone 上会提供「照片图库 / 拍照 / 选取文件」 */}
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
  )
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-14 shrink-0 text-[13px] text-[var(--c-text-2)]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--c-accent)]"
      />
      <span className="w-10 text-right text-[12px] text-[var(--c-text-3)] tabular-nums">{format(value)}</span>
    </label>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-14 shrink-0 text-[13px] text-[var(--c-text-2)]">{label}</span>
      <div className="flex-1 flex flex-wrap items-center gap-2">
        {BUBBLE_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`${label} ${c}`}
            onClick={() => onChange(c)}
            className={`press h-6 w-6 rounded-full border border-[var(--c-line)] ${
              value.toLowerCase() === c ? 'ring-[1.5px] ring-[var(--c-accent)] ring-offset-1' : ''
            }`}
            style={{ background: c }}
          />
        ))}
        {/* 自定义颜色 */}
        <label className="relative h-6 w-6 rounded-full overflow-hidden border border-dashed border-[var(--c-accent)]/60 flex items-center justify-center text-[var(--c-accent-strong)]">
          <Icon name="plus" size="xs" />
          <input type="color" aria-label={`${label} 自定义颜色`} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0" />
        </label>
      </div>
    </div>
  )
}

export default function ThemeSettingsPage() {
  const nav = useNavigate()
  const theme = useThemeSettings()
  const profile = useProfile()
  const save = (patch: Partial<ThemeSettings>) => void updateThemeSettings(patch)
  const setBubble = (p: Partial<BubbleStyle>) => save({ bubble: { ...theme.bubble, ...p } })
  const b = theme.bubble

  const bubblePreview = (mine: boolean, text: string) => (
    <div className={`flex ${mine ? 'justify-end' : 'items-start gap-2'}`}>
      {!mine && <Avatar name="阿玲" size="chat" />}
      <div
        className={`bubble ${b.ornament ? 'bubble-ornament' : ''}`}
        style={{ background: rgba(mine ? b.me : b.them, b.opacity), borderColor: `rgba(255,255,255,${b.border})` }}
      >
        {text}
      </div>
    </div>
  )

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="主题与壁纸" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-12">
        <div className="pt-5 pb-1 text-center">
          <div className="script-en text-[26px] text-[var(--c-brand-soft)]">Winter Letter</div>
          <div className="serif-zh mt-0.5 text-[14px] tracking-[0.24em] text-[var(--c-brand)]">冬日来信</div>
        </div>

        <SectionTitle en="Chat" zh="聊天外观" />
        {/* 实时预览：使用聊天壁纸 + 当前气泡设置 */}
        <div
          className="mx-4 rounded-[var(--radius-lg)] overflow-hidden border border-white/70 shadow-[var(--shadow-soft)]"
          style={wallpaperStyle(chatWallpaperOf(theme))}
        >
          <div className="px-3.5 py-5 space-y-4" style={{ background: 'var(--veil-chat)' }}>
            {bubblePreview(false, '今天窗外下雪了。')}
            {bubblePreview(true, '那你要牵好我的手哦')}
          </div>
        </div>

        <div className="px-6 pt-4 pb-2 text-[12px] tracking-wider text-[var(--c-text-2)]">聊天文字</div>
        <div className="mx-4 card py-1.5">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-14 shrink-0 text-[13px] text-[var(--c-text-2)]">字体</span>
            <div className="flex-1 p-0.5 rounded-full bg-[var(--c-bg-2)] border border-[var(--c-line)] grid grid-cols-3">
              {(Object.keys(CHAT_FONTS) as ChatFont[]).map((f) => (
                <button
                  key={f}
                  onClick={() => save({ chatText: { ...theme.chatText, font: f } })}
                  className={`press h-8 rounded-full text-[14px] ${
                    theme.chatText.font === f ? 'bg-white shadow-[var(--shadow-soft)] text-[var(--c-brand)]' : 'text-[var(--c-text-2)]'
                  }`}
                  style={{ fontFamily: CHAT_FONTS[f].stack }}
                >
                  {CHAT_FONTS[f].label}
                </button>
              ))}
            </div>
          </div>
          <Slider
            label="字号"
            value={theme.chatText.size}
            min={13}
            max={20}
            step={1}
            format={(v) => `${v}px`}
            onChange={(v) => save({ chatText: { ...theme.chatText, size: v } })}
          />
          <p className="px-4 pb-2 text-[11px] leading-relaxed text-[var(--c-text-3)]">
            字体使用 iPhone 自带的中文字体；设备没有楷体时会自动改用宋体。表情符号始终使用系统彩色表情。
          </p>
        </div>

        <div className="px-6 pt-4 pb-2 text-[12px] tracking-wider text-[var(--c-text-2)]">聊天壁纸</div>
        <WallpaperPicker
          value={theme.chatWallpaper}
          inherit
          inheritStyle={wallpaperStyle(theme.wallpaper)}
          onChange={(v) => save({ chatWallpaper: v })}
        />

        <div className="px-6 pt-4 pb-2 text-[12px] tracking-wider text-[var(--c-text-2)]">聊天气泡</div>
        <div className="mx-4 card py-1.5">
          <ColorRow label="对方" value={b.them} onChange={(v) => setBubble({ them: v })} />
          <ColorRow label="我" value={b.me} onChange={(v) => setBubble({ me: v })} />
          <Slider label="透明度" value={b.opacity} min={0.3} max={0.95} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setBubble({ opacity: v })} />
          <Slider label="细边框" value={b.border} min={0} max={1} step={0.05} format={(v) => (v === 0 ? '无' : `${Math.round(v * 100)}%`)} onChange={(v) => setBubble({ border: v })} />
          <label className="flex items-center justify-between px-4 py-2.5 text-[13px] text-[var(--c-text-2)]">
            雪花点缀
            <input type="checkbox" checked={b.ornament} onChange={(e) => setBubble({ ornament: e.target.checked })} className="accent-[var(--c-accent)]" />
          </label>
          <div className="flex justify-end px-4 pb-1.5">
            <GhostButton onClick={() => save({ bubble: DEFAULT_BUBBLE })}>恢复默认</GhostButton>
          </div>
        </div>

        <SectionTitle en="Wallpaper" zh="应用壁纸" />
        <WallpaperPicker value={theme.wallpaper} onChange={(v) => save({ wallpaper: v.kind === 'inherit' ? { kind: 'default' } : v })} />
        <p className="mx-6 mt-2.5 text-[11px] leading-relaxed text-[var(--c-text-3)]">
          壁纸只保存在本设备，会自动压缩。壁纸始终在最底层，列表页加一层薄雾，聊天文字与按钮都在其上方。
        </p>

        <SectionTitle en="Avatars" zh="头像" />
        <div className="mx-4 card overflow-hidden">
          <Row
            label="我的头像"
            onClick={() => nav('/me/profile')}
            right={
              <span className="flex items-center gap-2">
                <Avatar name={profile.nickname} src={profile.avatar} size="chat" />
                <Icon name="forward" size="sm" />
              </span>
            }
          />
          <Row label="角色头像" value="在角色资料 → 编辑中更换" onClick={() => nav('/contacts')} right={<Icon name="forward" size="sm" />} />
        </div>

        <Section title="即将开放">
          <Row label="自定义图标图片" value="后续版本" />
          <Row label="自定义字体" value="后续版本" />
          <Row label="更多主题" value="后续版本" />
        </Section>
      </div>
    </div>
  )
}
