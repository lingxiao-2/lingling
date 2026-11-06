/** 一次回复调用了哪些记忆、世界书和扩展资料（记录在回复上，只读） */
import { createPortal } from 'react-dom'
import type { Message } from '../db/schema'
import { RELATION_LABEL } from '../services/ai/relationship'

type Used = NonNullable<Message['contextUsed']>

export default function ContextUsedSheet({ used, onClose, onOpenFull }: { used: Used; onClose: () => void; onOpenFull?: () => void }) {
  const rel = used.relationship ? (RELATION_LABEL as Record<string, string>)[used.relationship] ?? used.relationship : ''
  const block = (title: string, items: string[], empty: string) => (
    <div className="mt-3">
      <div className="text-[12px] text-[var(--c-text-3)]">{title}</div>
      {items.length ? items.map((x, i) => <div key={i} className="mt-0.5 text-[13px] text-[var(--c-text)]">· {x}</div>) : <div className="mt-0.5 text-[12.5px] text-[var(--c-text-3)]">{empty}</div>}
    </div>
  )
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 sheet-overlay sheet-fade" />
      <div className="relative w-full max-w-[480px] card rounded-b-none px-5 pt-4 sheet-rise max-h-[80dvh] overflow-y-auto" style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }} onClick={(e) => e.stopPropagation()}>
        <div className="serif-zh text-[16px] text-[var(--c-brand)]">这次用到的记忆与设定</div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--c-text-3)]">生成这次回复时，除了角色的核心人设和最近的聊天，还带上了下面这些内容。</p>
        {block('长期记忆', used.memories.map((m) => m.content), '没有用到记忆（没有固定的记忆，也没有与话题相关的）')}
        {block('世界书条目', used.lore, '没有被触发的条目')}
        {block('扩展人设（按话题挑选）', used.profile, '没有用到扩展资料')}
        <div className="mt-3 text-[12.5px] text-[var(--c-text-2)]">
          关系：{rel || '未设定'} · 资料要点：{used.organized ? '已使用' : '未整理或未使用'}
        </div>
        {onOpenFull && (
          <button onClick={onOpenFull} className="press mt-4 h-9 px-4 rounded-full border border-[var(--c-line)] bg-white/45 text-[13px] text-[var(--c-accent-strong)]">
            查看完整的设定
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
