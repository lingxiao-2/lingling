/** 通过链接导入表情包：链接校验、下载限制、类型识别、错误原因、网页图片提取：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkLink, extractCandidates, fetchLink, isPrivateHost, LINK_LIMITS } from '../src/services/linkImport'

test('链接校验：只允许公开的 http/https，拒绝内网、本机、元数据地址和带密码的链接', () => {
  assert.equal(checkLink(' https://example.com/a.gif ').href, 'https://example.com/a.gif')
  for (const bad of ['ftp://x.com/a', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'https://user:pw@x.com/a.png']) assert.throws(() => checkLink(bad))
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '[::1]', 'metadata.google.internal', 'printer.local', '2130706433', '100.64.0.1']) {
    assert.ok(isPrivateHost(h), h)
    assert.throws(() => checkLink(`http://${h}/a.png`), /内网|本机/)
  }
  assert.ok(!isPrivateHost('cdn.example.com'))
  assert.ok(!isPrivateHost('8.8.8.8'))
})

const gif = new Uint8Array(readFileSync('scripts/fixtures/stickers/anim.gif'))
const zip = new Uint8Array(readFileSync('scripts/fixtures/stickers/pack.zip'))
const respond = (body: Uint8Array | string, init: ResponseInit & { url?: string; type?: string } = {}) =>
  (async () => {
    const r = new Response(typeof body === 'string' ? body : (body as BodyInit), { status: init.status ?? 200, headers: { 'content-type': init.type ?? '' } })
    if (init.url) Object.defineProperty(r, 'url', { value: init.url })
    return r
  }) as unknown as typeof fetch

test('下载：按文件内容识别图片 / ZIP / 网页（不信任扩展名和 Content-Type）', async () => {
  assert.equal((await fetchLink('https://x.com/a.png', respond(gif, { type: 'text/plain' }))).kind, 'image')
  assert.equal((await fetchLink('https://x.com/pack', respond(zip, { type: 'application/octet-stream' }))).kind, 'zip')
  assert.equal((await fetchLink('https://x.com/p', respond('<!doctype html><html><body></body></html>', { type: 'text/html' }))).kind, 'html')
  await assert.rejects(fetchLink('https://x.com/a.png', respond('%PDF-1.4')), /不是支持的图片/)
})

test('下载失败：给出具体原因，不假装成功', async () => {
  await assert.rejects(fetchLink('https://x.com/a', (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch), (e: { kind: string; message: string }) => e.kind === 'cors' && /跨域/.test(e.message))
  await assert.rejects(fetchLink('https://x.com/a', respond('', { status: 403 })), /需要登录或没有访问权限/)
  await assert.rejects(fetchLink('https://x.com/a', respond('', { status: 404 })), /不存在/)
  await assert.rejects(fetchLink('https://x.com/a', respond('', { status: 429 })), /访问频率/)
  await assert.rejects(fetchLink('https://x.com/a', respond('', { status: 200 })), /空/)
  // 跳转到内网地址
  await assert.rejects(fetchLink('https://x.com/a', respond(gif, { url: 'http://169.254.169.254/latest' })), /不允许访问的地址/)
  // 边下边数：超过上限立即停止
  const huge = new Uint8Array(LINK_LIMITS.imageBytes + 10)
  huge.set(gif.subarray(0, 16))
  await assert.rejects(fetchLink('https://x.com/a.gif', respond(huge, { type: 'image/gif' })), /太大/)
})

test('网页提取：只取正文中的图片与 ZIP，过滤头像、图标、广告、小图、SVG、内网地址', () => {
  const html = `<!doctype html><html><body>
    <header><img src="/logo.png"></header>
    <nav><img src="/nav/home.png"></nav>
    <main>
      <h1>冬日团子表情包</h1>
      <img src="/stk/1.gif" alt="开心">
      <img data-src="https://cdn.example.com/stk/2.png" src="/loading.gif">
      <img srcset="/stk/3-small.webp 1x, /stk/3-big.webp 2x">
      <img src="/stk/1.gif">
      <img class="user-avatar" src="/u/9.jpg">
      <img src="/ads/banner.jpg">
      <img src="/stk/tiny.png" width="16" height="16">
      <img src="/stk/vector.svg">
      <img src="data:image/png;base64,AAAA">
      <img src="http://192.168.1.2/x.png">
      <a href="/download/pack.zip">打包下载</a>
      <a href="/stk/4.jpg">原图</a>
    </main>
    <footer><img src="/qrcode.png"></footer>
  </body></html>`
  const c = extractCandidates(html, 'https://example.com/post/1')
  assert.deepEqual(
    c.map((x) => `${x.kind}:${x.url}`),
    [
      'image:https://example.com/stk/1.gif',
      'image:https://cdn.example.com/stk/2.png',
      'image:https://example.com/stk/3-big.webp',
      'zip:https://example.com/download/pack.zip',
      'image:https://example.com/stk/4.jpg',
    ],
  )
  assert.equal(c[0].alt, '开心')
})
