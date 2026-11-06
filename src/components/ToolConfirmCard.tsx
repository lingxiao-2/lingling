/**
 * 聊天中的工具确认卡片：
 *  - 读取（每次询问）：「沈星回想查看你明天的日程」 允许本次 / 拒绝
 *  - 写入 / 删除 / 持久化创建 / 私人图片：显示草稿预览，确认后才执行
 */
import { useState } from 'react'
import { Icon } from '../theme/icons'
import { resolveConfirmation, type ConfirmRequest } from '../tools/confirm'

export default function ToolConfirmCard({ req }: { req: ConfirmRequest }) {
  const [busy, setBusy] = useState(false)
  const act = (ok: boolean) => {
    if (busy) return
    setBusy(true)
    resolveConfirmation(req.id, ok)
  }
  return (
    <div className="mx-6 my-2 ice rounded-[18px] px-4 py-3 text-[13px] leading-relaxed" role="dialog" aria-label="工具确认">
      <div className="flex items-start gap-2 text-[var(--c-text)]">
        <Icon name="lock" size="sm" stroke="thin" className="shrink-0 mt-0.5 text-[var(--c-accent-strong)]" />
        <span className="font-medium">{req.title}</span>
      </div>
      {req.lines.length > 0 && (
        <div className={`mt-2 rounded-[12px] px-3 py-2 text-[12.5px] ${req.kind === 'write' ? 'bg-white/60 border border-[var(--c-line)]' : 'text-[var(--c-text-2)]'}`}>
          {req.kind === 'write' && <div className="mb-1 text-[11px] tracking-[0.1em] text-[var(--c-text-3)]">{req.danger ? '将要删除' : '草稿预览'}</div>}
          {req.lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">{l}</div>
          ))}
        </div>
      )}
      <div className="mt-1.5 text-[11px] text-[var(--c-text-3)]">
        {req.kind === 'write' ? '确认之前不会保存或修改任何内容。' : '只允许这一次；可以在「我的 → AI 工具权限」中修改。'}
      </div>
      <div className="mt-2.5 flex justify-end gap-2">
        <button disabled={busy} onClick={() => act(false)} className="press h-8 px-3.5 rounded-full text-[12.5px] text-[#5a6a86] disabled:opacity-50">
          {req.kind === 'write' ? '取消' : '拒绝'}
        </button>
        <button
          disabled={busy}
          onClick={() => act(true)}
          className={`press h-8 px-4 rounded-full text-white text-[12.5px] disabled:opacity-50 ${req.danger ? 'bg-[var(--c-danger)]' : 'bg-[var(--c-accent)]'}`}
        >
          {req.confirmText}
        </button>
      </div>
    </div>
  )
}
