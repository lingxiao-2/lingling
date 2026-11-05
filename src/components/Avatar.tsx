import { hashString } from '../lib/util'
import { AVATAR, type AvatarSize } from '../theme/tokens'
import { snowflakePath, sparklePath } from '../assets/winter/ornaments'

/** 冰蓝色系渐变，用于原创默认头像 */
const TINTS = [
  ['#f4f8fe', '#c6d6ec'],
  ['#f5f6fc', '#cdd2ea'],
  ['#f2f8fb', '#c1d7e4'],
  ['#f6f7fb', '#d0d8e8'],
  ['#f3f7fd', '#c4d3ea'],
]

/** 原创细线图案：雪花 / 星光 / 月牙（按名字固定选择） */
const MOTIFS = [
  `<path d="${snowflakePath()}" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,
  `<path d="${sparklePath(12, 12, 9)}" fill="#fff"/><path d="${sparklePath(18.5, 5.5, 2.6)}" fill="#fff" opacity=".85"/>`,
  `<path d="M15.5 4.5a8 8 0 1 0 4 12.6A6.5 6.5 0 0 1 15.5 4.5z" fill="#fff"/><path d="${sparklePath(6.5, 6.5, 2.4)}" fill="#fff" opacity=".85"/>`,
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
 * 没有图片时显示原创默认头像：冰蓝珠光渐变 + 白色细线图案（不使用文字方块）。头像图片可随时替换。
 */
export default function Avatar({ name, src, size = 'list' }: Props) {
  const px = typeof size === 'number' ? size : AVATAR[size]
  const style = {
    width: px,
    height: px,
    boxShadow: '0 0 0 1px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.45), 0 2px 6px rgba(80,105,150,0.14)',
  }
  if (src) {
    return <img src={src} alt={name} draggable={false} className="shrink-0 rounded-full object-cover" style={style} />
  }
  const h = hashString(name || '?')
  const [a, b] = TINTS[h % TINTS.length]
  const motif = MOTIFS[h % MOTIFS.length]
  return (
    <div
      role="img"
      aria-label={name}
      className="shrink-0 rounded-full flex items-center justify-center select-none"
      style={{ ...style, background: `radial-gradient(circle at 34% 28%, ${a} 0%, ${b} 100%)` }}
    >
      <svg
        viewBox="0 0 24 24"
        width={Math.round(px * 0.56)}
        height={Math.round(px * 0.56)}
        style={{ filter: 'drop-shadow(0 0 1.5px rgba(110,140,190,0.7))' }}
        dangerouslySetInnerHTML={{ __html: motif }}
      />
    </div>
  )
}
