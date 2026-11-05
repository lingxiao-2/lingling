import { hashString } from '../lib/util'
import { AVATAR, type AvatarSize } from '../theme/tokens'

/** 冰蓝色系渐变，用于原创默认头像 */
const TINTS = [
  ['#eef4fb', '#c9daee'],
  ['#f0f3f9', '#cfd6ea'],
  ['#edf5f8', '#c4dbe6'],
  ['#f2f4f9', '#d3dbe9'],
  ['#eef3fa', '#c6d6ea'],
]

interface Props {
  name: string
  src?: string
  /** 档位（推荐）或像素值 */
  size?: AvatarSize | number
  /** 兼容旧调用，已统一为圆形，忽略 */
  rounded?: number
}

/**
 * 统一圆形头像，外圈 1px 珍珠白描边。
 * 没有图片时显示原创默认头像：冰蓝渐变底 + 衬线首字。头像图片可由用户随时替换。
 */
export default function Avatar({ name, src, size = 'list' }: Props) {
  const px = typeof size === 'number' ? size : AVATAR[size]
  const style = {
    width: px,
    height: px,
    boxShadow: '0 0 0 1px rgba(255,255,255,0.85), 0 2px 6px rgba(90,120,165,0.12)',
  }
  if (src) {
    return <img src={src} alt={name} draggable={false} className="shrink-0 rounded-full object-cover" style={style} />
  }
  const [a, b] = TINTS[hashString(name || '?') % TINTS.length]
  const ch = Array.from(name.trim())[0] ?? '?'
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center select-none serif-zh text-[var(--c-brand)]"
      style={{ ...style, background: `radial-gradient(circle at 32% 28%, ${a} 0%, ${b} 100%)`, fontSize: Math.round(px * 0.42) }}
    >
      {/^[a-z]$/i.test(ch) ? ch.toUpperCase() : ch}
    </div>
  )
}
