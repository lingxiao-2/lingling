import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus } from 'lucide-react'

interface Props {
  title: ReactNode
  back?: boolean | string
  right?: ReactNode
  subtitle?: ReactNode
  /** 左右两侧的宽度（像素），右侧按钮较多时加宽，保持标题居中 */
  sideWidth?: number
}

export default function NavBar({ title, back, right, subtitle, sideWidth = 64 }: Props) {
  const nav = useNavigate()
  const goBack = () => (typeof back === 'string' ? nav(back) : nav(-1))
  return (
    <header
      className="glass hairline-b shrink-0 relative z-10"
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="h-12 flex items-center px-2 relative">
        <div className="flex items-center shrink-0" style={{ width: sideWidth }}>
          {back && (
            <button
              aria-label="返回"
              onClick={goBack}
              className="press h-10 w-10 flex items-center justify-center rounded-full"
            >
              <ChevronLeft size={24} strokeWidth={1.6} />
            </button>
          )}
        </div>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-[16px] font-medium truncate leading-tight">{title}</div>
          {subtitle && <div className="text-[11px] text-[var(--c-text-3)] truncate">{subtitle}</div>}
        </div>
        <div className="flex items-center justify-end shrink-0" style={{ width: sideWidth }}>
          {right}
        </div>
      </div>
    </header>
  )
}

export function NavButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="press h-10 w-10 flex items-center justify-center rounded-full"
    >
      {children}
    </button>
  )
}

/** 右上角精致的「+」入口：细线图标 + 发丝描边圆环 */
export function PlusButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="press h-10 w-10 flex items-center justify-center rounded-full"
    >
      <span className="h-[30px] w-[30px] rounded-full border border-[var(--c-accent)]/45 bg-white/60 flex items-center justify-center text-[var(--c-accent-strong)]">
        <Plus size={17} strokeWidth={1.4} />
      </span>
    </button>
  )
}
