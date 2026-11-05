import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

interface Props {
  title: ReactNode
  back?: boolean | string
  right?: ReactNode
  subtitle?: ReactNode
}

export default function NavBar({ title, back, right, subtitle }: Props) {
  const nav = useNavigate()
  const goBack = () => (typeof back === 'string' ? nav(back) : nav(-1))
  return (
    <header
      className="glass hairline-b shrink-0 relative z-10"
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="h-12 flex items-center px-2 relative">
        <div className="w-16 flex items-center">
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
        <div className="w-16 flex items-center justify-end gap-1">{right}</div>
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
