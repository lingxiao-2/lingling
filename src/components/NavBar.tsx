import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, type IconName } from '../theme/icons'

interface Props {
  title: ReactNode
  back?: boolean | string
  right?: ReactNode
  subtitle?: ReactNode
  /** 左右两侧的宽度（像素），右侧按钮较多时加宽，保持标题居中 */
  sideWidth?: number
  /** 标题使用中文衬线（默认），品牌标题等自定义节点不受影响 */
  serifTitle?: boolean
}

/**
 * 顶部导航：悬浮的毛玻璃胶囊。左右是 30px 小圆钮，中间标题 + 可选副标题。
 */
export default function NavBar({ title, back, right, subtitle, sideWidth = 56, serifTitle = true }: Props) {
  const nav = useNavigate()
  const goBack = () => (typeof back === 'string' ? nav(back) : nav(-1))
  return (
    <header className="shrink-0 relative z-10 px-3 pb-1.5" style={{ paddingTop: 'calc(var(--safe-top) + 6px)' }}>
      <div className="glass-1 h-11 rounded-full flex items-center px-1 shadow-[var(--shadow-soft)]">
        <div className="flex items-center shrink-0" style={{ width: sideWidth }}>
          {back && <NavButton label="返回" icon="back" onClick={goBack} />}
        </div>
        <div className="flex-1 min-w-0 text-center">
          <div
            className={`truncate leading-tight text-[var(--c-text)] ${
              serifTitle && typeof title === 'string' ? 'serif-zh text-[17px] tracking-[0.06em]' : 'text-[16px]'
            }`}
          >
            {title}
          </div>
          {subtitle && <div className="mt-0.5 text-[11px] text-[var(--c-text-2)] truncate tracking-wide">{subtitle}</div>}
        </div>
        <div className="flex items-center justify-end shrink-0" style={{ width: sideWidth }}>
          {right}
        </div>
      </div>
    </header>
  )
}

/** 导航栏小圆钮：视觉 30px，点击区域 40px */
export function NavButton({
  label,
  onClick,
  icon,
  children,
}: {
  label: string
  onClick: () => void
  icon?: IconName
  children?: ReactNode
}) {
  return (
    <button aria-label={label} onClick={onClick} className="press h-10 w-10 shrink-0 flex items-center justify-center">
      <span className="h-[28px] w-[28px] rounded-full bg-white/45 border border-[var(--glass-border)] flex items-center justify-center text-[var(--c-text)]">
        {icon ? <Icon name={icon} size="sm" /> : children}
      </span>
    </button>
  )
}

/** 右上角「＋」入口 */
export function PlusButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <NavButton label={label} icon="plus" onClick={onClick} />
}
