/**
 * 桌面尺寸（纯函数，按真实 iPhone 桌面的比例计算，便于测试）。
 *
 *  - 图标：屏幕宽度的 13%，限制在 46–52px（390 宽约 51px，375 宽约 49px）；屏幕太矮时再缩小，保证 6 行放得下
 *  - 行距：图标 × 1.72～1.84（图标 + 名称 + 行间留白），内容从上往下排，不再把 6 行拉伸到整页高度
 *  - 列：4 列平分可用宽度，列间距 = 列宽 − 图标，左右留白与列间距接近
 *  - 小组件与图标共用网格：小号 = 2 个图标 + 1 个列间距宽、1 行 + 1 个图标高；中号 = 4 个图标 + 3 个列间距宽
 *  - Dock 图标与桌面图标同样大小
 */
export interface DeskMetrics {
  /** 桌面页左右内边距 */
  pad: number
  icon: number
  /** 一列的宽度 */
  col: number
  /** 两个图标之间的水平间距 */
  gap: number
  /** 行距 */
  row: number
  /** 小组件的宽高 */
  small: [number, number]
  medium: [number, number]
  /** Dock 高度 */
  dock: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function deskMetrics(width: number, height: number, rows = 6): DeskMetrics {
  const pad = width < 360 ? 14 : 18
  const byWidth = clamp(Math.round(width * 0.13), 46, 52)
  // 高度不够 6 行时（例如 iPhone SE 或编辑模式顶部多了按钮）按高度缩小，最小 40px
  const byHeight = Math.floor((height - 8) / rows / 1.72)
  const icon = Math.max(40, Math.min(byWidth, byHeight))
  const col = (width - pad * 2) / 4
  const gap = col - icon
  // 行距在 1.72～1.84 倍图标之间，按页面高度取值：既不拉得稀疏，也不留一大片空白
  const row = Math.round(Math.min(icon * 1.84, Math.max(icon * 1.72, (height - 8) / rows)))
  const r1 = (n: number) => Math.round(n * 10) / 10
  return {
    pad,
    icon,
    col: r1(col),
    gap: r1(gap),
    row,
    small: [r1(icon * 2 + gap), row + icon],
    medium: [r1(icon * 4 + gap * 3), row + icon],
    dock: icon + 24,
  }
}
