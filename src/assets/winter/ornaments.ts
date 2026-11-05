/**
 * Winter Letter 原创装饰素材（全部由代码生成，无外部图片、无第三方版权）。
 * 独立于页面与聊天数据，便于以后整体替换为设计师提供的素材。
 */

const r = (n: number) => Math.round(n * 100) / 100

/** 细线六角雪花（viewBox 0 0 24 24），可作为 CSS mask 或 background 使用 */
export function snowflakePath(): string {
  const c = 12
  let d = ''
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2
    const x = (len: number, da = 0) => r(c + Math.cos(a + da) * len)
    const y = (len: number, da = 0) => r(c + Math.sin(a + da) * len)
    d += `M${c} ${c}L${x(10.5)} ${y(10.5)}`
    for (const [at, l] of [
      [5.2, 3],
      [7.8, 2.2],
    ] as const) {
      const bx = c + Math.cos(a) * at
      const by = c + Math.sin(a) * at
      for (const s of [-1, 1]) {
        const ba = a + s * (Math.PI / 4)
        d += `M${r(bx)} ${r(by)}L${r(bx + Math.cos(ba) * l)} ${r(by + Math.sin(ba) * l)}`
      }
    }
  }
  return d
}

export function snowflakeSvg(color = '#ffffff', stroke = 1.15): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"><path d="${snowflakePath()}"/><circle cx="12" cy="12" r="1.1" fill="${color}" stroke="none"/></svg>`
}

/** 四角星光（viewBox 0 0 24 24） */
export function sparklePath(cx = 12, cy = 12, k = 10): string {
  const w = k * 0.18
  return `M${cx} ${cy - k}Q${cx + w} ${cy - w} ${cx + k} ${cy}Q${cx + w} ${cy + w} ${cx} ${cy + k}Q${cx - w} ${cy + w} ${cx - k} ${cy}Q${cx - w} ${cy - w} ${cx} ${cy - k}Z`
}

export const dataUri = (svg: string) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`

/** CSS 中使用的白色雪花（气泡角落、落款等） */
export const SNOWFLAKE_WHITE = dataUri(snowflakeSvg('#ffffff', 1.2))
export const SNOWFLAKE_SOFT = dataUri(snowflakeSvg('#8fa4c4', 1.1))

/** 原创丝带蝴蝶结（细线 + 半透明珍珠白），用于导航胶囊右上角 */
export const BOW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 44" fill="none">
<defs><linearGradient id="rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset="1" stop-color="#d9def2" stop-opacity=".85"/></linearGradient></defs>
<g stroke="#b9c3e0" stroke-width=".9" stroke-linejoin="round" fill="url(#rb)">
<path d="M31 18C24 7 11 4 7 9c-4 5 3 13 24 11z"/>
<path d="M33 18c7-11 20-14 24-9 4 5-3 13-24 11z"/>
<path d="M30 20c-5 6-11 14-15 21l5-1 2 3c3-7 7-14 11-21z" opacity=".95"/>
<path d="M34 20c5 6 10 13 13 20l-5-.5-2 3c-2-7-5-13-9-20z" opacity=".95"/>
<ellipse cx="32" cy="19" rx="3.6" ry="3.2"/>
</g>
<g stroke="#ffffff" stroke-width=".8" stroke-linecap="round" opacity=".9"><path d="M12 10c5-1 11 2 16 7M52 10c-5-1-11 2-16 7"/></g>
</svg>`
