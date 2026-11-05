import type { ReactNode } from 'react'

export interface SheetAction {
  label: string
  onClick: () => void
  danger?: boolean
}

/** 底部操作菜单 */
export function ActionSheet({
  title,
  actions,
  onClose,
}: {
  title?: string
  actions: SheetAction[]
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-[#1b2a3c]/30" />
      <div
        className="relative w-full px-3"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card overflow-hidden">
          {title && (
            <div className="px-4 py-3 text-center text-xs text-[var(--c-text-3)] hairline-b truncate">
              {title}
            </div>
          )}
          {actions.map((a, i) => (
            <button
              key={a.label}
              onClick={() => {
                onClose()
                a.onClick()
              }}
              className={`press w-full h-12 text-[16px] ${i > 0 ? 'hairline-t' : ''} ${
                a.danger ? 'text-[var(--c-danger)]' : ''
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="press card w-full h-12 mt-2 text-[16px]">
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
      <div className="absolute inset-0 bg-[#1b2a3c]/35" />
      <div className="card relative w-full max-w-xs overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4 text-center">
          <div className="text-[16px] font-medium">{title}</div>
          {message && <div className="mt-2 text-sm text-[var(--c-text-2)] leading-relaxed">{message}</div>}
        </div>
        <div className="grid grid-cols-2 hairline-t">
          <button onClick={onCancel} className="press h-12 text-[16px] text-[var(--c-text-2)]">
            取消
          </button>
          <button
            onClick={onConfirm}
            className={`press h-12 text-[16px] border-l border-[var(--c-line)] ${
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
