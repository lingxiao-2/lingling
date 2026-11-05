/**
 * 原创矢量壁纸「冬日窗景」（Winter Letter 聊天默认背景）。
 * 全部由代码生成：天空、远近雪松林、雾、窗框与窗台、纱帘、路灯暖光、雪丘、细雪与星光。
 * 构图参照聊天参考图的层次与色调，但没有复制任何图片或角色。
 * 用户可在「主题与壁纸」中替换为自己的高清图片。
 */
import { snowflakePath, sparklePath } from './ornaments'

const W = 390
const H = 844

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

const f = (n: number) => n.toFixed(1)

/** 雪松：由多层下垂的「裙摆」叠成，每层下沿带圆润的波浪，看起来像压着雪的枝条 */
function pine(x: number, base: number, h: number, w: number, tiers: number, r: () => number): string[] {
  const out: string[] = []
  let d = ''
  const step = h / tiers
  for (let i = 0; i < tiers; i++) {
    const t = (i + 1) / tiers // 0 顶 → 1 底
    const yTop = base - h + i * step - step * (i === 0 ? 0.9 : 0.55)
    const yBot = base - h + (i + 1) * step + step * 0.25
    const half = Math.max(2, (w / 2) * t ** 0.9 * (0.88 + r() * 0.24))
    const lean = (r() - 0.5) * half * 0.12
    const lx = x - half + lean
    const rx = x + half + lean
    const sag = step * (0.18 + r() * 0.18)
    d += `M${f(x)} ${f(yTop)}`
    d += `C${f(x - half * 0.55)} ${f(yTop + step * 0.08)} ${f(lx + half * 0.12)} ${f(yBot - step * 0.75)} ${f(lx)} ${f(yBot)}`
    // 下沿：三段向下的圆弧
    const k = 3
    for (let j = 1; j <= k; j++) {
      const x0 = lx + ((rx - lx) * (j - 1)) / k
      const x1 = lx + ((rx - lx) * j) / k
      const yEnd = j === k ? yBot : yBot - step * (0.12 + r() * 0.1)
      d += `Q${f((x0 + x1) / 2)} ${f(yBot + sag * (j === 2 ? 0.6 : 1))} ${f(x1)} ${f(yEnd)}`
    }
    d += `C${f(rx - half * 0.12)} ${f(yBot - step * 0.75)} ${f(x + half * 0.55)} ${f(yTop + step * 0.08)} ${f(x)} ${f(yTop)}Z`
    out.push(d)
    d = ''
  }
  out.push(`M${f(x - 2.5)} ${f(base - step)}L${f(x + 2.5)} ${f(base - step)}L${f(x + 3)} ${f(base + 4)}L${f(x - 3)} ${f(base + 4)}Z`)
  return out
}

/** 一片树林：返回每棵树的分层路径（自上而下），按由远到近排序 */
function trees(seed: number, n: number, baseMin: number, baseMax: number, hMin: number, hMax: number, xs?: number[]): string[][] {
  const r = rng(seed)
  const list: { base: number; tiers: string[] }[] = []
  for (let i = 0; i < n; i++) {
    const x = xs ? xs[i] : -20 + r() * (W + 40)
    const base = baseMin + r() * (baseMax - baseMin)
    const h = hMin + r() * (hMax - hMin)
    list.push({ base, tiers: pine(x, base, h, h * (0.36 + r() * 0.1), 9 + Math.floor(r() * 4), r) })
  }
  return list.sort((a, b) => a.base - b.base).map((t) => t.tiers)
}

function forest(...args: Parameters<typeof trees>): string {
  return trees(...args)
    .map((t) => t.join(''))
    .join('')
}

function drift(seed: number, y: number, amp: number): string {
  const r = rng(seed)
  let d = `M0 ${y}`
  const step = 65
  for (let x = 0; x < W; x += step) {
    d += `Q${f(x + step / 2)} ${f(y - amp * (0.3 + r() * 0.9))} ${f(x + step)} ${f(y - amp * r() * 0.35)}`
  }
  return `${d}L${W} ${H}L0 ${H}Z`
}

/** 纱帘：从上方垂下，在下方被束起 */
function curtain(side: 'left' | 'right'): string {
  const m = (x: number) => (side === 'left' ? x : W - x)
  const body = `M${m(0)} 0L${m(54)} 0C${m(50)} 160 ${m(40)} 330 ${m(30)} 520C${m(26)} 600 ${m(30)} 680 ${m(40)} 760L${m(0)} 760Z`
  let folds = ''
  for (const [x0, x1] of [
    [12, 8],
    [24, 15],
    [36, 21],
    [48, 26],
  ]) {
    folds += `M${m(x0)} 0C${m(x0 - 2)} 200 ${m(x1 + 4)} 380 ${m(x1)} 560C${m(x1 - 2)} 640 ${m(x1 + 2)} 700 ${m(x1 + 6)} 760`
  }
  return `<path d="${body}" fill="url(#curtain-${side})"/><path d="${folds}" stroke="#fff" stroke-opacity=".35" stroke-width=".7" fill="none"/>`
}

/** 纱帘内侧的雪花蕾丝 */
function lace(side: 'left' | 'right'): string {
  const out: string[] = []
  const path = snowflakePath()
  for (let i = 0; i < 9; i++) {
    const y = 200 + i * 42
    const t = (y - 0) / 520
    const x = 64 - 30 * Math.min(1, t) - 4
    const xx = side === 'left' ? x : W - x
    const s = 0.42 + (i % 3) * 0.08
    out.push(
      `<path d="${path}" transform="translate(${f(xx - 12 * s)} ${f(y - 12 * s)}) scale(${s})" stroke="#fff" stroke-opacity=".75" stroke-width="1.4" fill="none"/>`,
    )
  }
  return out.join('')
}

/** 带积雪的树林：每层枝条先画白色，再把深色枝条向下错开几像素，于是每层上沿都覆着一道雪；从下往上画，上层压住下层 */
function snowyForest(list: string[][], body: string, snow: string, dy: number, extra = '', shade = ''): string {
  let g = ''
  const fill = shade ? `url(#${shade})` : body
  for (const tiers of list) {
    const trunk = tiers[tiers.length - 1]
    g += `<path d="${trunk}" fill="${body}"/>`
    for (let i = tiers.length - 2; i >= 0; i--) {
      g += `<path d="${tiers[i]}" fill="${snow}"/><path d="${tiers[i]}" fill="${fill}" transform="translate(0 ${dy})"/>`
    }
  }
  return `<g ${extra}>${g}</g>`
}

let cache: string | null = null

export function windowSceneSvg(): string {
  if (cache) return cache
  const r = rng(20261105)

  let snow = ''
  for (let i = 0; i < 230; i++) {
    const rad = 0.4 + r() * 1.3
    snow += `<circle cx="${f(r() * W)}" cy="${f(r() * H * 0.92)}" r="${rad.toFixed(2)}" fill="#fff" fill-opacity="${(0.4 + r() * 0.55).toFixed(2)}"/>`
  }
  let bokeh = ''
  for (let i = 0; i < 26; i++) {
    bokeh += `<circle cx="${f(r() * W)}" cy="${f(80 + r() * 600)}" r="${f(3 + r() * 6)}" fill="#fff" fill-opacity="${(0.12 + r() * 0.2).toFixed(2)}"/>`
  }
  let stars = ''
  for (let i = 0; i < 18; i++) {
    const x = 20 + r() * (W - 40)
    const y = 60 + r() * 640
    const k = 2.5 + r() * 5.5
    stars += `<path d="${sparklePath(x, y, k)}" fill="#fff" fill-opacity="${(0.7 + r() * 0.3).toFixed(2)}"/>`
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#9eb0cd"/><stop offset=".38" stop-color="#adbdd8"/><stop offset=".7" stop-color="#c3d0e6"/><stop offset="1" stop-color="#dde6f5"/>
</linearGradient>
<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#eef3fb" stop-opacity="0"/><stop offset=".7" stop-color="#eef3fb" stop-opacity=".28"/><stop offset="1" stop-color="#eef3fb" stop-opacity=".18"/>
</linearGradient>
<radialGradient id="skyglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f4f7fd" stop-opacity=".75"/><stop offset="1" stop-color="#f4f7fd" stop-opacity="0"/></radialGradient>
<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3eaf6" stop-opacity="0"/><stop offset=".5" stop-color="#e3eaf6" stop-opacity=".42"/><stop offset="1" stop-color="#e3eaf6" stop-opacity=".1"/></linearGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9eef8" stop-opacity=".45"/><stop offset="1" stop-color="#e9eef8" stop-opacity="0"/></linearGradient>
<linearGradient id="curtain-left" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f6f8fe" stop-opacity=".8"/><stop offset=".6" stop-color="#eef2fb" stop-opacity=".42"/><stop offset="1" stop-color="#e8eef9" stop-opacity=".2"/></linearGradient>
<linearGradient id="curtain-right" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#f6f8fe" stop-opacity=".8"/><stop offset=".6" stop-color="#eef2fb" stop-opacity=".42"/><stop offset="1" stop-color="#e8eef9" stop-opacity=".2"/></linearGradient>
<linearGradient id="post" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b4c3dc" stop-opacity=".85"/><stop offset=".35" stop-color="#e9eff9" stop-opacity=".9"/><stop offset="1" stop-color="#a9b9d4" stop-opacity=".85"/></linearGradient>
<linearGradient id="shade-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d3ddee"/><stop offset=".55" stop-color="#a9bad5"/><stop offset="1" stop-color="#93a7c7"/></linearGradient>
<linearGradient id="shade-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9e2f1"/><stop offset=".5" stop-color="#9fb2cf"/><stop offset="1" stop-color="#7b91b6"/></linearGradient>
<linearGradient id="sill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f9fe" stop-opacity=".9"/><stop offset="1" stop-color="#b3c2db" stop-opacity=".8"/></linearGradient>
<radialGradient id="lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff4dc" stop-opacity=".95"/><stop offset=".35" stop-color="#ffe7c0" stop-opacity=".45"/><stop offset="1" stop-color="#ffe7c0" stop-opacity="0"/></radialGradient>
<filter id="b3" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="b1" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.1"/></filter>
<filter id="b6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="frost" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/>
<feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 3.2 -1.55" result="speck"/>
<feComposite in="speck" in2="SourceAlpha" operator="in" result="snow"/>
<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="snow"/></feMerge>
<feGaussianBlur stdDeviation=".45"/>
</filter>
<filter id="frost-far" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="3" result="n"/>
<feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 3 -1.45" result="speck"/>
<feComposite in="speck" in2="SourceAlpha" operator="in" result="snow"/>
<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="snow"/></feMerge>
<feGaussianBlur stdDeviation="1"/>
</filter>
<filter id="soft" x="0" y="0" width="100%" height="100%"><feGaussianBlur stdDeviation="1.1"/></filter>
<filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.6" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<ellipse cx="190" cy="250" rx="150" ry="210" fill="url(#skyglow)"/>
<g filter="url(#b3)"><path d="${forest(11, 30, 430, 520, 330, 470)}" fill="#b6c5dd"/></g>
${snowyForest(trees(15, 18, 560, 640, 400, 560), '#a3b5d1', '#eef3fb', 3, 'filter="url(#b1)"', 'shade-mid')}
<rect y="240" width="${W}" height="420" fill="url(#mist)"/>
${snowyForest(trees(21, 8, 700, 770, 470, 640, [-30, 22, 66, 106, 290, 332, 372, 412]), '#8ea3c4', '#f5f8fd', 4.2, 'filter="url(#soft)"', 'shade-near')}
<rect y="330" width="${W}" height="470" fill="url(#fog)"/>
${bokeh.replace(/<circle/g, '<circle filter="url(#b6)"')}
<g>
<rect x="126" y="0" width="15" height="690" fill="url(#post)" filter="url(#b1)"/>
<rect x="208" y="0" width="15" height="690" fill="url(#post)" filter="url(#b1)"/>
<path d="M126.5 0V690M140.5 0V690M208.5 0V690M222.5 0V690" stroke="#fff" stroke-opacity=".35" stroke-width=".6"/>
<rect x="0" y="680" width="${W}" height="14" fill="url(#sill)" filter="url(#b1)"/>
<path d="M0 688Q195 674 ${W} 688" stroke="#fff" stroke-opacity=".8" stroke-width="2.5" fill="none"/>
</g>
<g>
<circle cx="352" cy="436" r="118" fill="url(#lamp)"/>
<rect x="349" y="470" width="6" height="218" rx="2" fill="#8193b3" fill-opacity=".75"/>
<path d="M345 690h14v-6h-14z" fill="#8193b3" fill-opacity=".6"/>
<g transform="translate(352 436) scale(1.38) translate(-352 -436)">
<path d="M338 414h28l-3 40h-22z" fill="#fff3d9" stroke="#7f91b1" stroke-opacity=".8" stroke-width="1.2"/>
<path d="M352 414v40M344 434h16" stroke="#7f91b1" stroke-opacity=".45" stroke-width=".8"/>
<path d="M341 454h22l-2 8h-18z" fill="#8193b3" fill-opacity=".8"/>
<path d="M333 416q19-24 38 0q-3 4-19 4t-19-4z" fill="#ffffff"/>
<circle cx="352" cy="400" r="3" fill="#ffffff"/>
<circle cx="352" cy="434" r="16" fill="url(#lamp)"/>
</g>
</g>
${curtain('left')}${curtain('right')}${lace('left')}${lace('right')}
<path d="M0 640Q60 610 120 660T250 700T${W} 650L${W} ${H}L0 ${H}Z" fill="#e6edf8" fill-opacity=".8" filter="url(#b1)"/>
<path d="${drift(31, 760, 44)}" fill="#eef3fb" fill-opacity=".92"/>
<path d="${drift(32, 808, 30)}" fill="#f2f6fc" filter="url(#frost)"/>
<rect width="${W}" height="110" fill="url(#haze)"/>
${snow}
<g filter="url(#glow)">${stars}</g>
</svg>`
  cache = svg
  return svg
}

export function windowSceneBackground(): string {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(windowSceneSvg())}")`
}
