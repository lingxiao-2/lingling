import { useState } from 'react'
import { Check } from 'lucide-react'
import Avatar from './Avatar'

export interface PickerOption {
  id: string
  name: string
  avatar?: string
  hint?: string
}

/** 多选底部面板（选择联系人 / 世界书） */
export default function PickerSheet({
  title,
  options,
  initial = [],
  emptyText = '没有可选择的项目',
  confirmText = '确定',
  showAvatar = true,
  onConfirm,
  onClose,
}: {
  title: string
  options: PickerOption[]
  initial?: string[]
  emptyText?: string
  confirmText?: string
  showAvatar?: boolean
  onConfirm: (ids: string[]) => void
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial))
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-[#1b2a3c]/30" />
      <div
        className="relative w-full card rounded-b-none flex flex-col max-h-[75dvh]"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 shrink-0 flex items-center justify-between px-4 hairline-b">
          <button onClick={onClose} className="press text-[15px] text-[var(--c-text-2)]">
            取消
          </button>
          <div className="text-[15px] font-medium">{title}</div>
          <button
            onClick={() => {
              onConfirm([...picked])
              onClose()
            }}
            className="press text-[15px] text-[var(--c-accent-strong)]"
          >
            {confirmText}
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {options.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--c-text-3)]">{emptyText}</div>
          ) : (
            options.map((o) => {
              const on = picked.has(o.id)
              return (
                <button
                  key={o.id}
                  onClick={() => toggle(o.id)}
                  className="press w-full flex items-center gap-3 px-4 py-2.5 hairline-b text-left"
                >
                  {showAvatar && <Avatar name={o.name} src={o.avatar} size={38} rounded={10} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] truncate">{o.name}</div>
                    {o.hint && <div className="text-xs text-[var(--c-text-3)] truncate">{o.hint}</div>}
                  </div>
                  <span
                    className={`h-6 w-6 rounded-full flex items-center justify-center border ${
                      on ? 'bg-[var(--c-accent)] border-[var(--c-accent)] text-white' : 'border-[var(--c-text-3)]'
                    }`}
                  >
                    {on && <Check size={14} strokeWidth={2.2} />}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
