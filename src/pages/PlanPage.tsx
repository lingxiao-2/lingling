import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import { db } from '../db/db'
import { configProblem } from '../services/ai/openai'
import { CANDIDATE_PLANS, MEMBERSHIP_ON_SALE, PLAN_DISCLAIMER, currentEntitlement, formatPrice } from '../services/membership/plans'
import { computeUsage, type LocalUsage } from '../services/membership/usage'
import { useAIConfig } from '../store/profile'
import { Icon } from '../theme/icons'

const EMPTY: LocalUsage = { repliesToday: 0, replies30d: 0, sent30d: 0, replyChars30d: 0 }

/**
 * 会员计划（商业验证页）。
 * 只展示候选方案、当前状态和本机用量，并引导自愿登记意向；
 * 没有购买按钮、订单或任何「已开通」状态。
 */
export default function PlanPage() {
  const nav = useNavigate()
  const ai = useAIConfig()
  const ent = currentEntitlement()
  const usage = useLiveQuery(
    async () => computeUsage(await db.messages.where('createdAt').above(Date.now() - 31 * 864e5).toArray()),
    [],
    EMPTY,
  )
  const aiProblem = configProblem(ai)
  const aiLabel = aiProblem ? '未连接' : ai.service === 'custom' ? `自己的 API · ${ai.model}` : '聆聆 AI'

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="会员计划" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <div className="px-7 pt-4 text-center">
          <div className="eyebrow">Membership</div>
          <div className="serif-zh mt-1.5 text-[19px] tracking-[0.12em] text-[var(--c-brand)]">聆聆会员计划</div>
          <span className="mt-2.5 inline-flex items-center h-[22px] px-3 rounded-full border border-[var(--c-accent)]/40 bg-white/45 text-[11px] tracking-[0.1em] text-[var(--c-accent-strong)]">
            {MEMBERSHIP_ON_SALE ? '已开售' : '尚未开售'}
          </span>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
            下面是正在考虑的候选方案，用来了解大家真正需要什么。{PLAN_DISCLAIMER}。现在没有任何付费入口，也不会向你收取任何费用。
          </p>
        </div>

        {/* 当前状态：会员系统上线前永远是免费版 */}
        <section className="mx-4 mt-5">
          <div className="eyebrow px-1 pb-1.5">Now</div>
          <div className="glass rounded-[var(--radius-card)] overflow-hidden text-[14px]">
            <div className="flex items-center justify-between px-4 min-h-[44px] hairline-b">
              <span>当前版本</span>
              <span className="text-[13px] text-[var(--c-text-3)]">{ent.tier === 'member' ? '会员' : '免费版'}</span>
            </div>
            <button onClick={() => nav(aiProblem ? '/setup' : '/me/api')} className="press w-full flex items-center justify-between gap-3 px-4 min-h-[44px] hairline-b text-left">
              <span>AI 服务</span>
              <span className="flex items-center gap-1 min-w-0 text-[13px] text-[var(--c-text-3)]">
                <span className="truncate">{aiLabel}</span>
                <Icon name="forward" size="sm" />
              </span>
            </button>
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <span>本机用量</span>
                <span className="text-[12px] text-[var(--c-text-3)]">仅统计这台设备</span>
              </div>
              <div className="mt-2.5 grid grid-cols-3 text-center">
                {[
                  ['今日 AI 回复', usage.repliesToday],
                  ['近 30 天回复', usage.replies30d],
                  ['近 30 天发出', usage.sent30d],
                ].map(([l, n]) => (
                  <div key={l as string}>
                    <div className="serif-zh text-[17px] text-[var(--c-text)]">{n}</div>
                    <div className="mt-0.5 text-[10.5px] tracking-wider text-[var(--c-text-3)]">{l}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--c-text-3)]">
                使用自己的 API 时，聆聆不限制聊天条数，费用由你的服务商结算。用量只在本机计算，不会上传。
              </p>
            </div>
          </div>
        </section>

        <section className="mx-4 mt-5">
          <div className="eyebrow px-1 pb-1.5">Plans · 候选方案</div>
          <div className="space-y-2.5">
            {CANDIDATE_PLANS.map((p) => (
              <div key={p.id} className="glass rounded-[var(--radius-card)] px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="serif-zh text-[16px] tracking-[0.08em] text-[var(--c-brand)]">{p.name}</span>
                  <span className="text-[13px] text-[var(--c-text-2)]">
                    {formatPrice(p.priceMonthly)}
                    {p.priceMonthly > 0 && <span className="ml-1 text-[11px] text-[var(--c-text-3)]">候选</span>}
                    {p.id === 'free' && ent.tier === 'free' && <span className="ml-1.5 text-[11px] text-[var(--c-accent-strong)]">当前</span>}
                  </span>
                </div>
                <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
                  {p.perks.map((perk) => (
                    <li key={perk} className="flex gap-1.5">
                      <Icon name="check" size="xs" className="shrink-0 mt-[5px] text-[var(--c-accent)]" />
                      <span>{perk}</span>
                    </li>
                  ))}
                  {p.hostedRepliesPerMonth > 0 && (
                    <li className="flex gap-1.5">
                      <Icon name="check" size="xs" className="shrink-0 mt-[5px] text-[var(--c-accent)]" />
                      <span>聆聆 AI 每月约 {p.hostedRepliesPerMonth} 条回复</span>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2.5 px-1 text-[11px] leading-relaxed text-[var(--c-text-3)]">
            {PLAN_DISCLAIMER}。标注「计划中」的功能还没有开发。开售前会另行说明续费、取消和退款规则。
          </p>
        </section>

        <section className="mx-4 mt-6 text-center">
          <p className="text-[12.5px] leading-relaxed text-[var(--c-text-2)]">愿意的话，告诉我们你的想法：完全匿名，可以只选一项。</p>
          <button
            onClick={() => nav('/me/feedback')}
            className="press mt-3 inline-flex items-center gap-1.5 h-10 px-6 rounded-full glass-1 text-[14px] tracking-[0.08em] text-[var(--c-accent-strong)]"
          >
            <Icon name="feedback" size="sm" />
            参与意向登记
          </button>
        </section>

        <section className="mx-6 mt-7 space-y-3 text-[12px] leading-relaxed text-[var(--c-text-3)]">
          <div>
            <div className="text-[var(--c-text-2)]">为什么还不开售？</div>
            <p className="mt-0.5">我们想先确认大家需要什么，再确保在这个价格下 AI 回复能长期稳定提供，而不是先收费再说。</p>
          </div>
          <div>
            <div className="text-[var(--c-text-2)]">以后会员变化会影响聊天记录吗？</div>
            <p className="mt-0.5">不会。开通、到期或取消会员都只影响是否能使用聆聆 AI，不会删除你的角色、世界书和聊天记录。</p>
          </div>
        </section>
      </div>
    </div>
  )
}
