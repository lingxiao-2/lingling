import type { ReactNode } from 'react'
import { hashString } from '../lib/util'

const PALETTES = [
  ['#e2ecf6', '#a9c3dc', '#6f8fb2'],
  ['#e8eef6', '#b9c8de', '#8197bb'],
  ['#e0ebf1', '#a6c5d3', '#6c97ad'],
  ['#ebedf5', '#c2c7de', '#868fbb'],
  ['#e3edf3', '#b1cddb', '#7ea4bb'],
  ['#eef1f6', '#c6d2e2', '#93a7c2'],
]

/** 由名称生成固定的冬日插画：渐变天空、远山剪影、细雪 */
function sceneSvg(seed: number): string {
  let s = seed || 1
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const h1 = 110 + rnd() * 25
  const h2 = 125 + rnd() * 25
  const ridge = (base: number, amp: number) => {
    let d = `M0 ${base}`
    for (let x = 0; x <= 320; x += 40) d += ` Q${x + 20} ${base - amp * (0.4 + rnd())} ${x + 40} ${base - amp * rnd() * 0.6}`
    return `${d} L320 180 L0 180 Z`
  }
  let snow = ''
  for (let i = 0; i < 46; i++) {
    const r = 0.5 + rnd() * 1.3
    snow += `<circle cx="${(rnd() * 320).toFixed(1)}" cy="${(rnd() * 180).toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" fill-opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`
  }
  const moonX = 40 + rnd() * 240
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
<circle cx="${moonX.toFixed(0)}" cy="44" r="16" fill="#fff" fill-opacity="0.55"/>
<path d="${ridge(h1, 34)}" fill="#fff" fill-opacity="0.28"/>
<path d="${ridge(h2, 22)}" fill="#fff" fill-opacity="0.42"/>
${snow}</svg>`
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
}

export default function WorldCover({
  name,
  cover,
  className = '',
  children,
}: {
  name: string
  cover?: string
  className?: string
  children?: ReactNode
}) {
  const seed = hashString(name || 'world')
  const [a, b, c] = PALETTES[seed % PALETTES.length]
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {cover ? (
        <img src={cover} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `${sceneSvg(seed)}, linear-gradient(165deg, ${a} 0%, ${b} 58%, ${c} 100%)`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      {children}
    </div>
  )
}
