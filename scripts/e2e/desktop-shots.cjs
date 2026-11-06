/**
 * 桌面实际运行截图与尺寸测量（本地运行）：
 *   npm run build && npx vite preview --port 4173 & node scripts/e2e/desktop-shots.cjs <输出目录> <前缀>
 * 390×844 与 375×812 两种尺寸，三屏各一张；同时输出图标、Dock、小组件的实际像素尺寸。
 */
const { chromium } = require('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const out = process.argv[2] || '.'
const prefix = process.argv[3] || 'shot'

;(async () => {
  const browser = await chromium.launch()
  const report = {}
  for (const [w, h] of [[390, 844], [375, 812]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto(BASE + '#/')
    await page.waitForSelector('[aria-label="Dock"]')
    await page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('lingling-ai')
      r.onsuccess = () => {
        const tx = r.result.transaction(['characters', 'conversations', 'settings'], 'readwrite')
        tx.objectStore('characters').put({ id: 'c1', name: '沈遥', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'default', permissions: { useStickers: true, postMoments: true }, createdAt: 1, updatedAt: 1 })
        tx.objectStore('conversations').put({ id: 'v1', type: 'single', characterIds: ['c1'], pinned: false, unread: 2, draft: '', lastMessagePreview: '在吗', lastMessageAt: Date.now(), createdAt: 1 })
        tx.objectStore('settings').put({ key: 'desktop-note', value: { text: '周五记得给沈遥写一封信\n买一束白色洋桔梗', updatedAt: Date.now() } })
        const s = tx.objectStore('settings')
        const g = s.get('desktop-layout')
        g.onsuccess = () => {
          const l = g.result?.value
          if (l) {
            for (const p of l.pages) for (const it of p) if (it.kind === 'widget' && it.widget === 'character') it.characterId = 'c1'
            s.put({ key: 'desktop-layout', value: l })
          }
        }
        tx.oncomplete = res
      }
    }))
    await page.reload()
    await page.waitForSelector('[aria-label="Dock"]')
    await page.waitForTimeout(1200)
    const m = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)] }
      const icon = document.querySelector('section[aria-label="第 1 页"] .desk-icon')
      const label = document.querySelector('section[aria-label="第 1 页"] .desk-label')
      const widgets = {}
      for (const el of document.querySelectorAll('section [role=group][aria-label]')) widgets[el.getAttribute('aria-label')] = r(el)
      const icons = [...document.querySelectorAll('section[aria-label="第 1 页"] .desk-icon')].map((e) => e.getBoundingClientRect())
      const gapX = icons.length > 1 ? Math.round(icons[1].left - icons[0].right) : null
      const rowsY = [...new Set(icons.map((b) => Math.round(b.top)))]
      return {
        icon: r(icon),
        iconRadius: icon ? getComputedStyle(icon).borderRadius : null,
        glyph: r(icon?.querySelector('svg')),
        label: label ? getComputedStyle(label).fontSize : null,
        iconGapX: gapX,
        rowPitch: rowsY.length > 1 ? rowsY[1] - rowsY[0] : null,
        sideMargin: icons.length ? Math.round(icons[0].left) : null,
        dock: r(document.querySelector('[aria-label="Dock"] > div')),
        dockIcon: r(document.querySelector('[aria-label="Dock"] .desk-icon')),
        widgets,
      }
    })
    report[`${w}x${h}`] = m
    for (let i = 0; i < 3; i++) {
      await page.locator('[role=tab]').nth(i).click()
      await page.waitForTimeout(700)
      await page.screenshot({ path: `${out}/${prefix}-${w}x${h}-p${i + 1}.png` })
    }
    await ctx.close()
  }
  console.log(JSON.stringify(report, null, 1))
  await browser.close()
})()
