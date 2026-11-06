/**
 * 桌面应用图标：60px 圆角方块（接近 iPhone 的比例），半透明珍珠白底、柔和白色内描边、1.5px 细线图标，下方 11px 名称。
 * 只负责外观；点按 / 长按 / 拖动由桌面统一处理。
 */
import { Icon } from '../theme/icons'
import { APPS, type AppId } from './apps'

export function Badge({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span className="absolute -top-1.5 -right-1.5 min-w-[19px] h-[19px] px-1.5 rounded-full bg-[var(--c-danger)] text-white text-[11px] leading-[19px] text-center shadow-[0_1px_3px_rgba(0,0,0,0.15)]">
      {n > 99 ? '99+' : n}
    </span>
  )
}

export default function AppIcon({ id, badge = 0, showLabel = true }: { id: AppId; badge?: number; showLabel?: boolean }) {
  const a = APPS[id]
  return (
    <span className="flex flex-col items-center gap-[5px] select-none">
      <span className="desk-icon relative">
        <Icon name={a.icon} size="lg" stroke="bold" />
        {!a.route && <span className="desk-icon-soon" aria-hidden />}
        <Badge n={badge} />
      </span>
      {showLabel && <span className="desk-label">{a.name}</span>}
    </span>
  )
}
