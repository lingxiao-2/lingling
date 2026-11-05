import { useRef } from 'react'
import type { PointerEvent } from 'react'

/** 长按触发 onLong；移动超过阈值或提前抬起则取消。短按通过 onClick 正常触发。 */
export function useLongPress(onLong: () => void, ms = 480) {
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = window.setTimeout(() => {
        fired.current = true
        onLong()
      }, ms)
    },
    onPointerMove: (e: PointerEvent) => {
      if (!start.current) return
      if (Math.abs(e.clientX - start.current.x) > 8 || Math.abs(e.clientY - start.current.y) > 8) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: { preventDefault: () => void }) => {
      e.preventDefault()
      clear()
      if (!fired.current) onLong()
    },
    /** 长按已触发时，用来吞掉随后的 click */
    consumeClick: () => {
      const f = fired.current
      fired.current = false
      return f
    },
  }
}
