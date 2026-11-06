/**
 * 桌面装饰层：少量四角星光、雪晶与一条银白丝带，位于壁纸之上、图标之下，不接收点按。
 * 位置固定（不随机），低透明度，只是点缀，不影响阅读和触摸。
 */
const STARS: [number, number, number, number][] = [
  // x%, y%, 大小 px, 透明度
  [8, 7, 9, 0.75],
  [91, 5, 6, 0.6],
  [83, 31, 7, 0.5],
  [5, 46, 5, 0.45],
  [94, 58, 8, 0.55],
  [14, 71, 6, 0.4],
  [72, 78, 5, 0.45],
]

function Star({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden>
      <path d="M5 0 L5.9 4.1 L10 5 L5.9 5.9 L5 10 L4.1 5.9 L0 5 L4.1 4.1 Z" fill="#fff" />
    </svg>
  )
}

function Crystal({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1" strokeLinecap="round" aria-hidden>
      <path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10" />
      <path d="M12 5l-2-2M12 5l2-2M12 19l-2 2M12 19l2 2M5.5 8.2l-2.8-.2M5.5 8.2L4.3 5.6M18.5 15.8l2.8.2M18.5 15.8l1.2 2.6M5.5 15.8l-2.8.2M5.5 15.8l-1.2 2.6M18.5 8.2l2.8-.2M18.5 8.2l1.2-2.6" />
    </svg>
  )
}

export default function DeskOrnaments() {
  return (
    <div className="desk-ornaments pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {STARS.map(([x, y, s, o], i) => (
        <span key={i} className="absolute desk-twinkle" style={{ left: `${x}%`, top: `${y}%`, opacity: o, animationDelay: `${i * 0.7}s` }}>
          <Star size={s} />
        </span>
      ))}
      <span className="absolute" style={{ right: '7%', top: 'calc(var(--safe-top) + 2px)', opacity: 0.55 }}>
        <Crystal size={14} />
      </span>
      <span className="absolute" style={{ left: '3%', top: '38%', opacity: 0.35 }}>
        <Crystal size={10} />
      </span>
      {/* 顶部一条若隐若现的银白丝带 */}
      <svg className="absolute left-0 right-0" style={{ top: 'calc(var(--safe-top) + 6px)' }} width="100%" height="26" viewBox="0 0 390 26" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="desk-ribbon" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".35" stopColor="#fff" stopOpacity=".7" />
            <stop offset=".7" stopColor="#e3ecf6" stopOpacity=".55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 18 C 90 4, 170 26, 250 12 S 360 6, 390 14" stroke="url(#desk-ribbon)" strokeWidth="1.2" fill="none" />
        <path d="M0 21 C 100 9, 180 28, 260 15 S 365 10, 390 17" stroke="url(#desk-ribbon)" strokeWidth="0.6" fill="none" opacity=".7" />
      </svg>
    </div>
  )
}
