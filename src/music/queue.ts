/** 播放队列的纯逻辑（便于测试）：下一首 / 上一首 / 循环 / 随机 */
export type Repeat = 'off' | 'all' | 'one'

export interface QueueState {
  queue: string[]
  index: number
  repeat: Repeat
  shuffle: boolean
  /** 随机播放时的播放顺序（queue 的下标） */
  order: number[]
}

export function shuffledOrder(n: number, first: number, rand: () => number = Math.random): number[] {
  const rest = [...Array(n).keys()].filter((i) => i !== first)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return first >= 0 && first < n ? [first, ...rest] : rest
}

/**
 * 下一首的下标；没有下一首时返回 -1。
 * auto：一首播完自动切换（单曲循环时重复当前）；manual：点「下一首」（单曲循环时也换歌）
 */
export function nextIndex(s: QueueState, mode: 'auto' | 'manual'): number {
  const n = s.queue.length
  if (!n) return -1
  if (mode === 'auto' && s.repeat === 'one') return s.index
  if (s.shuffle && s.order.length === n) {
    const pos = s.order.indexOf(s.index)
    if (pos >= 0 && pos < n - 1) return s.order[pos + 1]
    return s.repeat === 'off' && mode === 'auto' ? -1 : s.order[0]
  }
  if (s.index < n - 1) return s.index + 1
  return s.repeat === 'off' && mode === 'auto' ? -1 : 0
}

export function prevIndex(s: QueueState): number {
  const n = s.queue.length
  if (!n) return -1
  if (s.shuffle && s.order.length === n) {
    const pos = s.order.indexOf(s.index)
    return pos > 0 ? s.order[pos - 1] : s.order[n - 1]
  }
  return s.index > 0 ? s.index - 1 : n - 1
}
