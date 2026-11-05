import test from 'node:test'
import assert from 'node:assert/strict'
import { CANDIDATE_PLANS, MEMBERSHIP_ON_SALE, PLAN_DISCLAIMER, currentEntitlement, formatPrice } from '../src/services/membership/plans'
import { computeUsage } from '../src/services/membership/usage'
import { feedbackChannelOpen, feedbackSummary, isEmptyFeedback, type FeedbackEntry } from '../src/services/feedback'
import { findProvider, modelRenameHint, PROVIDERS } from '../src/services/ai/providers'

test('会员尚未开售：任何人都只能是免费版，不存在本地「开通」', () => {
  assert.equal(MEMBERSHIP_ON_SALE, false)
  const e = currentEntitlement()
  assert.equal(e.tier, 'free')
  assert.equal(e.source, 'none')
  assert.match(PLAN_DISCLAIMER, /尚未开售/)
  assert.match(PLAN_DISCLAIMER, /可能调整/)
})

test('候选方案：免费版 + ¥9.9 / ¥19.9 两档，免费版不含聆聆 AI 额度', () => {
  assert.deepEqual(
    CANDIDATE_PLANS.map((p) => p.priceMonthly),
    [0, 9.9, 19.9],
  )
  assert.equal(CANDIDATE_PLANS[0].hostedRepliesPerMonth, 0)
  assert.ok(CANDIDATE_PLANS[2].hostedRepliesPerMonth > CANDIDATE_PLANS[1].hostedRepliesPerMonth)
  assert.equal(formatPrice(9.9), '¥9.9/月')
  assert.equal(formatPrice(0), '免费')
})

test('本机用量：按今天 / 近 30 天统计 AI 回复与发出消息', () => {
  const now = new Date(2026, 10, 5, 22, 0).getTime()
  const day = 864e5
  const m = (senderType: 'user' | 'character' | 'system', createdAt: number, content = '好') => ({ senderType, createdAt, content })
  const u = computeUsage(
    [
      m('character', now - 1000, '今天的雪'),
      m('character', now - 2 * day),
      m('character', now - 40 * day), // 超出 30 天
      m('user', now - 3 * day),
      m('user', now - 1000),
      m('system', now - 1000),
    ],
    now,
  )
  assert.deepEqual(u, { repliesToday: 1, replies30d: 2, sent30d: 2, replyChars30d: 5 })
})

test('意向登记：匿名摘要只包含所选内容，空表单不能提交', () => {
  assert.ok(isEmptyFeedback({ perks: [], experience: '  ' }))
  assert.ok(!isEmptyFeedback({ perks: ['sync'], experience: '' }))
  const e: FeedbackEntry = {
    intent: 'lite',
    perks: ['no-key', 'sync'],
    price: '6-10',
    experience: '  API Key 不知道去哪复制 ',
    chatWorking: false,
    createdAt: new Date(2026, 10, 5).getTime(),
    appVersion: 'test',
  }
  const s = feedbackSummary(e)
  assert.match(s, /¥9\.9/)
  assert.match(s, /不用申请 API Key，直接聊；云端备份、多设备同步/)
  assert.match(s, /¥6–10/)
  assert.match(s, /已能正常聊天：否/)
  assert.match(s, /体验反馈：API Key 不知道去哪复制\n/)
  assert.match(s, /2026-11-05/)
  // 只有这些字段：没有姓名、联系方式、设备 ID
  assert.deepEqual(Object.keys(e).sort(), ['appVersion', 'chatWorking', 'createdAt', 'experience', 'intent', 'perks', 'price'])
})

test('反馈渠道：只有 https 链接才视为已开通', () => {
  assert.equal(feedbackChannelOpen(''), false)
  assert.equal(feedbackChannelOpen('http://x'), false)
  assert.equal(feedbackChannelOpen('https://wj.qq.com/s2/1/abc'), true)
})

test('服务商预设：DeepSeek 使用新模型名，旧名称给出提示', () => {
  const ds = PROVIDERS.find((p) => p.id === 'deepseek')!
  assert.equal(ds.model, 'deepseek-flash')
  assert.ok(PROVIDERS.every((p) => p.id === 'other' || p.baseUrl.startsWith('https://')))
  assert.ok(modelRenameHint('https://api.deepseek.com/v1', 'deepseek-chat'))
  assert.equal(modelRenameHint('https://api.deepseek.com', 'deepseek-flash'), null)
  assert.equal(findProvider('https://api.deepseek.com/v1/')?.id, 'deepseek')
  assert.equal(findProvider('https://api.moonshot.cn/v1')?.id, 'moonshot')
})
