/**
 * 打开聆聆时处理外部传入的地址参数（在页面渲染之前）：
 *  - lingling_cb：快捷指令的回跳 → 更新对应运行的状态，然后跳到结果页
 * 处理完立即从地址栏去掉这些参数，刷新页面不会重复处理。
 */
import { applyCallback, sweepRuns } from './runs'
import { parseCallback } from './shortcuts'

export async function handleIncoming(loc: Location = location, hist: History = history): Promise<void> {
  const cb = parseCallback(loc.search)
  if (cb) {
    hist.replaceState(null, '', `${loc.pathname}${loc.hash}`)
    const r = await applyCallback(cb).catch(() => ({ ok: false, run: undefined, code: 'not_found' as const }))
    // 校验码不对：不透露这次运行的任何信息，只说明已忽略
    const target = r.run ? `#/me/iphone/run/${r.run.id}` : `#/me/iphone?callback=${r.code === 'bad_nonce' ? 'invalid' : 'unknown'}`
    hist.replaceState(null, '', `${loc.pathname}${target}`)
  }
  await sweepRuns().catch(() => {})
}
