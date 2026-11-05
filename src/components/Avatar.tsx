import { hashString } from '../lib/util'

const TINTS = [
  ['#cfe1f2', '#9bbbdc'],
  ['#dfe9f3', '#a8bfd6'],
  ['#d8e6f0', '#8fb0cc'],
  ['#e4ecf6', '#b3c6df'],
  ['#d3e3ee', '#94b5c9'],
]

interface Props {
  name: string
  src?: string
  size?: number
  rounded?: number
}

export default function Avatar({ name, src, size = 44, rounded = 12 }: Props) {
  const style = { width: size, height: size, borderRadius: rounded }
  if (src) {
    return <img src={src} alt={name} draggable={false} className="shrink-0 object-cover" style={style} />
  }
  const [a, b] = TINTS[hashString(name || '?') % TINTS.length]
  const ch = Array.from(name.trim())[0] ?? '?'
  return (
    <div
      className="shrink-0 flex items-center justify-center text-white select-none"
      style={{ ...style, background: `linear-gradient(145deg, ${a}, ${b})`, fontSize: size * 0.42 }}
    >
      {ch.toUpperCase()}
    </div>
  )
}
