/** 计时结束的提示音（Web Audio 合成，不需要音频文件）。必须在用户点按时先 unlock，iOS 才允许出声。 */
let ctx: AudioContext | null = null

export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx ??= new AC()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    /* 不支持 */
  }
}

/** 三声柔和的铃音；返回是否真的播放了 */
export function chime(): boolean {
  if (!ctx || ctx.state !== 'running') return false
  const t0 = ctx.currentTime
  ;[0, 0.45, 0.9].forEach((d, i) => {
    const o = ctx!.createOscillator()
    const g = ctx!.createGain()
    o.type = 'sine'
    o.frequency.value = [880, 1175, 1568][i]
    g.gain.setValueAtTime(0.0001, t0 + d)
    g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.8)
    o.connect(g).connect(ctx!.destination)
    o.start(t0 + d)
    o.stop(t0 + d + 0.85)
  })
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch {
    /* iPhone 不支持震动 */
  }
  return true
}
