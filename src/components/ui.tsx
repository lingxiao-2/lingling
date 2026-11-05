import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Search } from 'lucide-react'

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
      <div className="h-9 rounded-xl bg-white/80 flex items-center gap-2 px-3 text-[var(--c-text-3)]">
        <Search size={16} strokeWidth={1.6} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-[var(--c-text)] placeholder:text-[var(--c-text-3)]"
        />
      </div>
    </div>
  )
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-10 py-16 gap-2">
      <div className="title-en text-3xl text-[var(--c-accent)] opacity-70">Lingling</div>
      <div className="text-[15px] text-[var(--c-text-2)]">{title}</div>
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
      className="press h-11 px-6 rounded-full bg-[var(--c-accent)] text-white text-[15px] disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mx-3 mt-4">
      {title && <div className="px-2 pb-1.5 text-xs text-[var(--c-text-3)]">{title}</div>}
      <div className="card overflow-hidden">{children}</div>
    </section>
  )
}

export function Row({
  label,
  value,
  onClick,
  right,
}: {
  label: string
  value?: ReactNode
  onClick?: () => void
  right?: ReactNode
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`w-full min-h-12 px-4 py-3 flex items-center justify-between gap-3 text-left text-[15px] hairline-b last:border-b-0 ${
        onClick ? 'press' : ''
      }`}
    >
      <span>{label}</span>
      <span className="flex items-center gap-2 text-[var(--c-text-3)] text-sm min-w-0">
        {value}
        {right}
      </span>
    </Tag>
  )
}

const fieldBase =
  'w-full rounded-xl bg-[var(--c-bg-2)] px-3 py-2.5 text-[15px] outline-none border border-transparent focus:border-[var(--c-accent)] placeholder:text-[var(--c-text-3)]'

export function TextField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block px-4 py-3">
      <div className="text-xs text-[var(--c-text-2)] mb-1.5">{label}</div>
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
      <div className="text-xs text-[var(--c-text-2)] mb-1.5">{label}</div>
      <textarea rows={rows} {...props} className={`${fieldBase} resize-none leading-relaxed`} />
      {hint && <div className="text-[11px] text-[var(--c-text-3)] mt-1.5 leading-relaxed">{hint}</div>}
    </label>
  )
}
