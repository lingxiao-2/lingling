/**
 * 打开聆聆时处理外部传入的地址参数（在页面渲染之前）：
 *  - lingling_cb：快捷指令的回跳 → 更新对应运行的状态，然后跳到结果页
 *  - lingling_share：分享菜单传来的内容 → 暂存在当前页面，跳到预览页（不保存、不发给 AI）
 * 处理完立即从地址栏去掉这些参数，刷新页面不会重复处理。
 */
import { applyCallback, sweepRuns } from './runs'
import { parseCallback } from './shortcuts'
import { parseShare, stashShare } from './share'

export async function handleIncoming(loc: Location = location, hist: History = history): Promise<void> {
  const cb = parseCallback(loc.search)
  if (cb) {
    hist.replaceState(null, '', `${loc.pathname}${loc.hash}`)
    const r = await applyCallback(cb).catch(() => ({ ok: false, run: undefined, code: 'not_found' as const }))
    // 校验码不对：不透露这次运行的任何信息，只说明已忽略
    const target = r.run ? `#/me/iphone/run/${r.run.id}` : `#/me/iphone?callback=${r.code === 'bad_nonce' ? 'invalid' : 'unknown'}`
    hist.replaceState(null, '', `${loc.pathname}${target}`)
  }
  // 分享菜单传来的内容：只暂存，跳到预览页，由你决定怎么处理
  const fromHash = loc.hash.startsWith('#lingling_share=')
  const share = parseShare(fromHash ? loc.hash : loc.search)
  if (share || fromHash || /[?&]lingling_share=/.test(loc.search)) {
    if (share) stashShare(share)
    hist.replaceState(null, '', `${loc.pathname}#/share${share ? '' : '?empty=1'}`)
  }
  await sweepRuns().catch(() => {})
}

/**
 * 聆聆已经打开时，Safari 可能只改变当前页面 # 之后的内容而不重新加载：这时也要接住分享内容。
 * 返回取消监听的函数。
 */
export function watchIncomingShare(win: Window = window): () => void {
  const onHash = () => {
    if (!win.location.hash.startsWith('#lingling_share=')) return
    const share = parseShare(win.location.hash)
    if (share) stashShare(share)
    win.location.replace(`${win.location.pathname}#/share${share ? '' : '?empty=1'}`)
    win.dispatchEvent(new Event('lingling-share'))
  }
  // popstate 比 hashchange 先触发，而路由在 popstate 时就会把不认识的地址跳回首页，所以两个都要监听（在路由之前注册）
  win.addEventListener('popstate', onHash)
  win.addEventListener('hashchange', onHash)
  return () => {
    win.removeEventListener('popstate', onHash)
    win.removeEventListener('hashchange', onHash)
  }
}
