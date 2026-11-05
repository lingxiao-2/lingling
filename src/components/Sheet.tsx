import type { ReactNode } from 'react'

export interface SheetAction {
  label: string
  onClick: () => void
  danger?: boolean
  /** 可选：左侧细线图标 */
  icon?: ReactNode
  /** 可选：标签下方的一行说明 */
  hint?: string
}

/** 底部操作菜单。带 icon / hint 的选项以左对齐的列表样式呈现 */
export function ActionSheet({
  title,
  subtitle,
  actions,
  onClose,
}: {
  title?: string
  subtitle?: string
  actions: SheetAction[]
  onClose: () => void
}) {
  const rich = actions.some((a) => a.icon || a.hint)
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 sheet-overlay sheet-fade" />
      <div
        className="relative w-full px-3 sheet-rise"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card overflow-hidden">
          {title && (
            <div className={`px-5 hairline-b ${rich ? 'pt-4 pb-3 text-left' : 'py-3 text-center'}`}>
              <div className={rich ? 'sheet-title' : 'text-xs text-[var(--c-text-3)] truncate'}>{title}</div>
              {subtitle && <div className="mt-1 text-xs text-[var(--c-text-3)]">{subtitle}</div>}
            </div>
          )}
          {actions.map((a, i) =>
            rich ? (
              <button
                key={a.label}
                onClick={() => {
                  onClose()
                  a.onClick()
                }}
                className={`press w-full flex items-center gap-3.5 px-5 py-3 text-left ${i > 0 ? 'hairline-t' : ''}`}
              >
                {a.icon && (
                  <span className="h-8 w-8 shrink-0 rounded-full bg-[var(--c-accent-soft)] text-[var(--c-accent-strong)] flex items-center justify-center">
                    {a.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={`block text-[15px] ${a.danger ? 'text-[var(--c-danger)]' : ''}`}>{a.label}</span>
                  {a.hint && <span className="block mt-0.5 text-xs text-[var(--c-text-3)] truncate">{a.hint}</span>}
                </span>
              </button>
            ) : (
              <button
                key={a.label}
                onClick={() => {
                  onClose()
                  a.onClick()
                }}
                className={`press w-full h-12 text-[15px] ${i > 0 ? 'hairline-t' : ''} ${
                  a.danger ? 'text-[var(--c-danger)]' : ''
                }`}
              >
                {a.label}
              </button>
            ),
          )}
        </div>
        <button onClick={onClose} className="press card w-full h-12 mt-2 text-[15px] text-[var(--c-text-2)]">
          取消
        </button>
      </div>
    </div>
  )
}

/** 确认对话框（用于删除等不可撤销操作） */
export function ConfirmDialog({
  title,
  message,
  confirmText = '确定',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  message?: ReactNode
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-8" onClick={onCancel}>
      <div className="absolute inset-0 sheet-overlay sheet-fade" />
      <div className="card relative w-full max-w-xs overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4 text-center">
          <div className="serif-zh text-[16px] tracking-[0.06em] text-[var(--c-brand)]">{title}</div>
          {message && <div className="mt-2 text-sm text-[var(--c-text-2)] leading-relaxed">{message}</div>}
        </div>
        <div className="grid grid-cols-2 hairline-t">
          <button onClick={onCancel} className="press h-12 text-[15px] text-[var(--c-text-2)]">
            取消
          </button>
          <button
            onClick={onConfirm}
            className={`press h-12 text-[15px] border-l border-[var(--c-line)] ${
              danger ? 'text-[var(--c-danger)]' : 'text-[var(--c-accent-strong)]'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
