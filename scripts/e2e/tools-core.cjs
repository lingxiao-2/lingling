/**
 * AI 工具调用 PR A 的浏览器测试（本地运行，不在 CI 中；【模拟模型】聊天接口由 page.route 模拟）：
 *   OLD_DIST=<main 分支的构建目录> node scripts/e2e/tools-core.cjs
 * 覆盖：旧版本（v8）数据在升级到 v9 后完整保留、刷新后仍在；没有可用工具时聊天请求不带 tools，回复正常。
 */
const { chromium, devices } = require('playwright')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const PORT = 4181
const BASE = `http://localhost:${PORT}/`
let failed = 0
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++ }
const idb = (page, fn, arg) => page.evaluate(([src, a]) => new Promise((res, rej) => { const r = indexedDB.open('lingling-ai'); r.onsuccess = () => { try { new Function('db', 'a', 'res', src)(r.result, a, res) } catch (e) { rej(e) } } }), [fn, arg])
const serve = async (dir) => {
  const p = spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true })
  p.stop = () => { try { process.kill(-p.pid) } catch {} }
  for (let i = 0; i < 50; i++) { try { await fetch(BASE); return p } catch { await new Promise((r) => setTimeout(r, 200)) } }
  throw new Error('preview 没有启动')
}

;(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'll-e2e-'))
  const opts = { ...devices['iPhone 13'] }
  // 1. 旧版本：写入角色、会话、便签、日程、日记、设置
  let srv = await serve(process.env.OLD_DIST)
  let ctx = await chromium.launchPersistentContext(userDir, opts)
  let page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(BASE + '#/me')
  await page.waitForTimeout(1200)
  const before = await idb(page, `
    const t = db.transaction(['characters','conversations','notes','events','diaries','settings'], 'readwrite')
    const now = Date.now()
    t.objectStore('characters').put({ id: 'c1', name: '沈星回', avatar: '', bio: '', personality: '', speakingStyle: '', backstory: '', relationToUser: '', worldId: 'world-default', createdAt: now, updatedAt: now, permissions: { useStickers: true, postMoments: false } })
    t.objectStore('conversations').put({ id: 'cv1', type: 'single', characterIds: ['c1'], title: '沈星回', lastMessageAt: now, lastMessagePreview: '', draft: '', unread: 0, pinned: false, createdAt: now })
    t.objectStore('notes').put({ id: 'n1', title: '旧便签', kind: 'text', text: '保留我', items: [], pinned: false, color: 'snow', createdAt: now, updatedAt: now })
    t.objectStore('events').put({ id: 'e1', title: '旧日程', kind: 'event', allDay: true, date: '2026-11-08', location: '', note: '', repeat: 'none', diaryIds: [], source: 'local', createdAt: now, updatedAt: now })
    t.objectStore('diaries').put({ id: 'd1', date: '2026-11-06', title: '旧日记', content: '私密', mood: '', weather: '', tags: [], photoIds: [], aiReadable: false, createdAt: now, updatedAt: now })
    t.objectStore('settings').put({ key: 'ai-config', value: { service: 'custom', mode: 'direct', baseUrl: 'https://api.mock.test/v1', apiKey: 'sk-mock', proxyUrl: '', proxyToken: '', model: 'mock-model', temperature: 0.7, maxTokens: 200 } })
    t.oncomplete = () => res(db.version)
  `)
  check(before === 80, `旧版本数据库为 v8（${before}）`)
  await ctx.close()
  srv.stop(); await new Promise((r) => setTimeout(r, 500))

  // 2. 新版本：升级到 v9，数据完整
  srv = await serve(path.resolve('dist'))
  ctx = await chromium.launchPersistentContext(userDir, opts)
  page = ctx.pages()[0] ?? (await ctx.newPage())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const bodies = []
  await page.route('https://api.mock.test/**', async (route) => {
    bodies.push(JSON.parse(route.request().postData() || '{}'))
    const chunk = (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: chunk('<msg>收到，') + chunk('我在。</msg>') + 'data: [DONE]\n\n' })
  })
  await page.goto(BASE + '#/me')
  await page.waitForTimeout(1200)
  const after = await idb(page, `
    const names = [...db.objectStoreNames]
    const t = db.transaction(['notes','events','diaries','characters'], 'readonly')
    const out = { version: db.version, hasLogs: names.includes('toolLogs') }
    t.objectStore('notes').get('n1').onsuccess = (e) => out.note = e.target.result?.text
    t.objectStore('events').get('e1').onsuccess = (e) => out.event = e.target.result?.title
    t.objectStore('diaries').get('d1').onsuccess = (e) => out.diary = e.target.result?.content
    t.objectStore('characters').get('c1').onsuccess = (e) => out.char = e.target.result?.name
    t.oncomplete = () => res(out)
  `)
  check(after.version === 90 && after.hasLogs, `升级到 v9 并新增 toolLogs 表（${after.version}）`)
  check(after.note === '保留我' && after.event === '旧日程' && after.diary === '私密' && after.char === '沈星回', '旧的便签、日程、日记、角色完整保留')

  // 3. 聊天：没有可用工具，请求不带 tools，回复正常显示
  await page.goto(BASE + '#/chat/cv1')
  const input = page.locator('textarea').first()
  await input.waitFor({ timeout: 5000 })
  await input.fill('在吗')
  await page.getByRole('button', { name: '发送' }).click()
  const got = await page.getByText('收到，我在。').first().waitFor({ timeout: 8000 }).then(() => true, () => false)
  check(got, '【模拟模型】回复正常显示')
  check(bodies.length === 1 && !('tools' in bodies[0]), '没有可用工具时请求体不含 tools')
  await page.reload()
  check(await page.getByText('收到，我在。').first().waitFor({ timeout: 5000 }).then(() => true, () => false), '刷新后回复仍在')
  check(errors.length === 0, `没有页面错误 ${errors.join(' | ')}`)
  await ctx.close()
  srv.stop(); await new Promise((r) => setTimeout(r, 500))
  fs.rmSync(userDir, { recursive: true, force: true })
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
  process.exit(failed ? 1 : 0)
})()
