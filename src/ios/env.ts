/**
 * 运行环境检测。网页无法知道 iPhone 上是否装了「快捷指令」或某个快捷指令是否存在，
 * 这里只能判断「可能支持」，真正是否可用要靠「测试连接」。
 */
export interface IOSEnvironment {
  /** iPhone / iPad（含伪装成 Mac 的 iPadOS） */
  isIOS: boolean
  /** 系统版本（读不到时为 null） */
  iosVersion: number | null
  /** 从主屏幕打开的网页 App（与 Safari 的数据不共享） */
  standalone: boolean
  /** Safari（不是其他 App 里的内置浏览器） */
  safari: boolean
  /** 能否尝试 shortcuts:// 链接 */
  canTryShortcuts: boolean
  notes: string[]
}

export function detectEnvironment(nav: { userAgent: string; maxTouchPoints?: number; platform?: string; standalone?: boolean } = navigator as never, mql?: (q: string) => boolean): IOSEnvironment {
  const ua = nav.userAgent
  const iPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1
  const isIOS = /iPhone|iPad|iPod/.test(ua) || iPadOS
  const m = ua.match(/OS (\d+)[._]\d+/)
  const v = isIOS && m ? Number(m[1]) : isIOS && iPadOS ? Number(ua.match(/Version\/(\d+)/)?.[1] ?? NaN) || null : null
  const standalone = !!nav.standalone || !!mql?.('(display-mode: standalone)')
  const inApp = /(MicroMessenger|QQ\/|Weibo|FBAN|FBAV|Instagram|Line\/|DingTalk|AlipayClient)/i.test(ua)
  const safari = isIOS && !inApp && !/CriOS|FxiOS|EdgiOS/.test(ua)
  const notes: string[] = []
  if (!isIOS) notes.push('当前不是 iPhone / iPad，快捷指令链接无法使用（可以浏览设置，但测试需要在 iPhone 上进行）')
  if (isIOS && inApp) notes.push('当前在其他 App 的内置浏览器中，可能无法打开快捷指令，请用 Safari 打开聆聆')
  if (isIOS && v !== null && v < 14) notes.push('系统版本较旧，快捷指令的回跳可能不可用')
  if (standalone) notes.push('从主屏幕打开时，快捷指令完成后会回到 Safari 而不是这里，聆聆可能无法确认结果（会显示「无法验证」）')
  return { isIOS, iosVersion: v, standalone, safari, canTryShortcuts: isIOS && !inApp, notes }
}
