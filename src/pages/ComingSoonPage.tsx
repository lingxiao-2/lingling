/** 尚未开发的桌面应用：如实说明计划内容，不伪造任何数据或可用的按钮 */
import { useParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { Icon } from '../theme/icons'
import { APPS, isAppId } from '../desktop/apps'

export default function ComingSoonPage() {
  const { id = '' } = useParams()
  const a = isAppId(id) ? APPS[id] : null
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={a?.name ?? '应用'} back="/" />
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-10 pb-24 text-center">
        {a && (
          <span className="desk-icon" style={{ ['--desk-icon' as string]: '76px' }}>
            <Icon name={a.icon} size="lg" stroke="bold" />
          </span>
        )}
        <div className="mt-5 font-[var(--font-serif-en)] italic text-[22px] tracking-[0.04em] text-[var(--c-brand)]">{a?.en ?? 'Coming soon'}</div>
        <div className="mt-2 serif-zh text-[16px] tracking-[0.08em] text-[var(--c-text)]">{a ? `「${a.name}」还在开发中` : '没有这个应用'}</div>
        {a?.plan && <p className="mt-3 text-[13px] leading-relaxed text-[var(--c-text-2)]">计划：{a.plan}</p>}
        <p className="mt-2 text-[11.5px] text-[var(--c-text-3)]">现在还不能使用，也没有保存任何数据。</p>
      </div>
    </div>
  )
}
