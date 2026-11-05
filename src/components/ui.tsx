import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Icon, type IconName } from '../theme/icons'

export function SearchBox({
  value,
  onChange,
  placeholder = '搜索',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="px-3 py-2">
      <div className="glass-1 h-9 rounded-full flex items-center gap-2 px-3.5 text-[var(--c-text-3)]">
        <Icon name="search" size="sm" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-[var(--c-text)] placeholder:text-[var(--c-text-3)]"
        />
      </div>
    </div>
  )
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-10 py-16 gap-2">
      <div className="script-en text-[30px] text-[var(--c-brand-soft)]">Lingling</div>
      <div className="serif-zh text-[16px] tracking-[0.1em] text-[var(--c-brand)]">{title}</div>
      {hint && <div className="text-xs text-[var(--c-text-3)] leading-relaxed">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="press h-10 min-w-[120px] px-6 rounded-full bg-[var(--c-accent)] text-white text-[14px] tracking-[0.08em] shadow-[0_4px_14px_rgba(95,128,170,0.28)] disabled:opacity-40 disabled:shadow-none"
    >
      {children}
    </button>
  )
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mx-3 mt-4">
      {title && <div className="px-3 pb-1.5 text-[12px] tracking-wider text-[var(--c-text-2)]">{title}</div>}
      <div className="card overflow-hidden">{children}</div>
    </section>
  )
}

export function Row({
  label,
  value,
  onClick,
  right,
  icon,
}: {
  label: string
  value?: ReactNode
  onClick?: () => void
  right?: ReactNode
  /** 可选：左侧 16px 细线图标 */
  icon?: IconName
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`w-full min-h-[46px] px-4 py-2.5 flex items-center justify-between gap-3 text-left text-[14.5px] hairline-b last:border-b-0 ${
        onClick ? 'press' : ''
      }`}
    >
      <span className="flex items-center gap-2.5 min-w-0">
        {icon && <Icon name={icon} size="sm" className="shrink-0 text-[var(--c-accent-strong)]" />}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-1.5 text-[var(--c-text-3)] text-[13px] min-w-0 shrink-0">
        {value}
        {right}
      </span>
    </Tag>
  )
}

const fieldBase =
  'w-full rounded-[var(--radius-sm)] bg-[var(--c-bg-2)] px-3 py-2.5 text-[15px] outline-none border border-[var(--c-line)] focus:border-[var(--c-accent)] placeholder:text-[var(--c-text-3)]'

export function TextField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block px-4 py-3">
      <div className="text-[12px] tracking-wide text-[var(--c-text-2)] mb-1.5">{label}</div>
      <input {...props} className={fieldBase} />
      {hint && <div className="text-[11px] text-[var(--c-text-3)] mt-1.5 leading-relaxed">{hint}</div>}
    </label>
  )
}

export function AreaField({
  label,
  hint,
  rows = 3,
  ...props
}: { label: string; hint?: string; rows?: number } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block px-4 py-3">
      <div className="text-[12px] tracking-wide text-[var(--c-text-2)] mb-1.5">{label}</div>
      <textarea rows={rows} {...props} className={`${fieldBase} resize-none leading-relaxed`} />
      {hint && <div className="text-[11px] text-[var(--c-text-3)] mt-1.5 leading-relaxed">{hint}</div>}
    </label>
  )
}

/** 安静的空状态：英文小字 + 中文衬线标题 + 一行提示，不放大按钮 */
export function QuietEmpty({ eyebrow, title, hint }: { eyebrow: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center text-center px-10 pt-20 pb-16">
      <div className="eyebrow">{eyebrow}</div>
      <div className="serif-zh mt-3 text-[19px] tracking-[0.12em] text-[var(--c-brand)]">{title}</div>
      <div className="mt-4 h-px w-8 bg-[var(--c-brand-soft)]/60" />
      {hint && <div className="mt-4 text-xs leading-relaxed text-[var(--c-text-3)]">{hint}</div>}
    </div>
  )
}

/** 分组标题：英文小字 + 中文衬线，可带右侧文字操作 */
export function SectionTitle({
  en,
  zh,
  action,
}: {
  en: string
  zh: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex items-end justify-between px-5 pt-7 pb-2.5">
      <div>
        <div className="eyebrow">{en}</div>
        <div className="section-zh mt-1">{zh}</div>
      </div>
      {action && (
        <button onClick={action.onClick} className="press text-[13px] text-[var(--c-accent-strong)] px-1 pb-0.5">
          {action.label}
        </button>
      )}
    </div>
  )
}

/** 次要按钮：发丝描边胶囊 */
export function GhostButton({ children, onClick, danger }: { children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`press h-7 px-3 rounded-full border border-[var(--c-line)] bg-white/40 text-[12px] ${
        danger ? 'text-[var(--c-danger)]' : 'text-[var(--c-text-2)]'
      }`}
    >
      {children}
    </button>
  )
}
