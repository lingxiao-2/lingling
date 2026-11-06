/** 桌面 UI 精修：图标、行距、列间距、Dock、小组件尺寸按屏幕计算并共用同一网格：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deskMetrics } from '../src/desktop/metrics'

test('图标 46–52px，随屏幕宽度变化；Dock 图标与桌面同样大小', () => {
  const a = deskMetrics(390, 640)
  const b = deskMetrics(375, 610)
  assert.equal(a.icon, 51)
  assert.equal(b.icon, 49)
  for (const w of [360, 375, 390, 393, 414, 430]) {
    const m = deskMetrics(w, 680)
    assert.ok(m.icon >= 46 && m.icon <= 52, `${w}px 宽：图标 ${m.icon}`)
    assert.equal(m.dock, m.icon + 24)
  }
})

test('左右留白与列间距接近；行距在 1.72～1.84 倍图标之间，不再按整页高度拉伸', () => {
  const m = deskMetrics(390, 640)
  const sideMargin = m.pad + m.gap / 2
  assert.ok(Math.abs(sideMargin - m.gap) < 2, `左右留白 ${sideMargin} 与列间距 ${m.gap}`)
  assert.ok(m.row >= Math.round(m.icon * 1.72) && m.row <= Math.round(m.icon * 1.84))
  // 很高的屏幕也不会把行距拉到 118px 那样稀疏
  assert.ok(deskMetrics(390, 1000).row <= Math.round(51 * 1.84))
})

test('小组件与图标共用网格：宽度对齐图标边缘，高度对齐第二行图标底部', () => {
  const m = deskMetrics(390, 640)
  assert.equal(m.small[0], Math.round((m.icon * 2 + m.gap) * 10) / 10)
  assert.equal(m.medium[0], Math.round((m.icon * 4 + m.gap * 3) * 10) / 10)
  assert.equal(m.small[1], m.row + m.icon)
  assert.ok(m.small[0] < 150 && m.medium[1] < 150, '小组件不再是 220px 高的大卡片')
})

test('屏幕太矮时按高度缩小，6 行一定放得下（iPhone SE、编辑模式）', () => {
  const m = deskMetrics(320, 420)
  assert.ok(m.row * 6 <= 420, `${m.row} × 6`)
  assert.ok(m.icon >= 40)
})
