/**
 * 会员计划（商业验证阶段）。
 *
 * 重要：会员尚未开售。这里只有「候选」方案用于展示和收集意向，
 * 没有任何支付、订单或开通逻辑。会员权益未来必须由服务端验证，
 * 浏览器本地的任何数据都不能把用户变成会员。
 */

export type Tier = 'free' | 'member'

export interface CandidatePlan {
  id: 'free' | 'lite' | 'plus'
  name: string
  /** 候选月价（元）；免费版为 0 */
  priceMonthly: number
  /** 候选权益 */
  perks: string[]
  /** 聆聆提供的 AI（无需自己的 Key）每月回复条数上限（候选）；0 表示不提供 */
  hostedRepliesPerMonth: number
}

/** 会员是否已开售。开售前必须保持 false —— 页面据此显示「尚未开售」，且不提供任何购买入口 */
export const MEMBERSHIP_ON_SALE = false

export const PLAN_DISCLAIMER = '尚未开售，权益与价格可能调整'

export const CANDIDATE_PLANS: CandidatePlan[] = [
  {
    id: 'free',
    name: '免费版',
    priceMonthly: 0,
    perks: ['使用自己的 API 聊天，不限条数', '角色、世界、世界书全部可用', 'Winter Letter 主题与自定义壁纸'],
    hostedRepliesPerMonth: 0,
  },
  {
    id: 'lite',
    name: '轻享会员',
    priceMonthly: 9.9,
    perks: ['包含免费版全部功能', '无需 API Key，直接使用聆聆提供的 AI', '云端备份与多设备同步（计划中）'],
    hostedRepliesPerMonth: 500,
  },
  {
    id: 'plus',
    name: '畅聊会员',
    priceMonthly: 19.9,
    perks: ['包含轻享会员全部权益', '更多 AI 回复额度', '长期记忆增强、会员专属主题（计划中）'],
    hostedRepliesPerMonth: 1200,
  },
]

/**
 * 当前用户的会员状态。
 * source = 'none'：没有服务端凭证（现阶段所有用户都是这样），只能是免费版。
 * 未来接入账号后，只有服务端签发并验证过的权益才会返回 member。
 */
export interface Entitlement {
  tier: Tier
  source: 'none' | 'server'
  planId?: CandidatePlan['id']
  /** 权益生效 / 到期时间（毫秒时间戳），由服务端给出 */
  startsAt?: number
  expiresAt?: number
}

export function currentEntitlement(): Entitlement {
  // 会员系统尚未上线：不读取任何本地字段，避免本地数据被改成「会员」
  return { tier: 'free', source: 'none' }
}

export function formatPrice(p: number): string {
  return p === 0 ? '免费' : `¥${p.toFixed(1)}/月`
}
