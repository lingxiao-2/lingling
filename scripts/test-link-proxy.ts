/** 图片代理 Worker（proxy/link-proxy-worker.js）：来源与口令、SSRF、DNS、跳转、大小、类型：npm test */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error 纯 JS 模块，无类型声明
import { checkTarget, handle, isBlockedIPv4, isBlockedIPv6, LIMITS, sniff } from '../proxy/link-proxy-worker.js'

const gif = new Uint8Array(readFileSync('scripts/fixtures/stickers/anim.gif'))
const zip = new Uint8Array(readFileSync('scripts/fixtures/stickers/pack.zip'))
const ORIGIN = 'https://lingxiao-2.github.io'
const env = { ACCESS_TOKEN: 'tok-123', ALLOWED_ORIGINS: ORIGIN }
const req = (target: string, h: Record<string, string> = {}) =>
  new Request(`https://proxy.example.dev/fetch?url=${encodeURIComponent(target)}`, { headers: { origin: ORIGIN, 'x-lingling-token': 'tok-123', ...h } })

/** 模拟 DNS（DoH JSON）+ 源站 */
function net(dns: Record<string, string[]>, site: (u: string) => Response) {
  const hits: string[] = []
  const impl = async (u: string) => {
    if (u.startsWith('https://cloudflare-dns.com/')) {
      const q = new URL(u)
      const name = q.searchParams.get('name')!
      const type = q.searchParams.get('type')
      const ips = (dns[name] ?? []).filter((ip) => (type === 'A' ? !ip.includes(':') : ip.includes(':')))
      return Response.json({ Answer: ips.map((data) => ({ type: type === 'A' ? 1 : 28, data })) })
    }
    hits.push(u)
    return site(u)
  }
  return { impl, hits }
}

test('地址段：拒绝内网 / 本机 / 链路本地 / CGNAT / 保留 / 非公网 IPv6', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.20.1.1', '192.168.0.1', '169.254.169.254', '100.100.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) assert.ok(isBlockedIPv4(ip), ip)
  assert.ok(!isBlockedIPv4('104.21.3.4'))
  for (const ip of ['::1', '::ffff:127.0.0.1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '2001:db8::1']) assert.ok(isBlockedIPv6(ip), ip)
  assert.ok(!isBlockedIPv6('2606:4700::1111'))
  assert.equal(checkTarget('http://x.com/a').error, 'not_https')
  assert.equal(checkTarget('https://127.0.0.1/a').error, 'blocked')
  assert.equal(checkTarget('https://x.com:8443/a').error, 'blocked')
  assert.equal(checkTarget('https://u:p@x.com/a').error, 'invalid')
  assert.equal(checkTarget('https://intranet/a').error, 'blocked')
  assert.equal(sniff(gif), 'image/gif')
  assert.equal(sniff(zip), 'application/zip')
})

test('来源与口令：不在白名单或口令错误一律 403，且不返回允许跨域', async () => {
  const { impl, hits } = net({ 'i.imgant.com': ['1.1.1.1'] }, () => new Response(gif))
  const bad1 = await handle(req('https://i.imgant.com/a.jpg', { origin: 'https://evil.example' }), env, impl)
  assert.equal(bad1.status, 403)
  assert.equal(bad1.headers.get('access-control-allow-origin'), null)
  const bad2 = await handle(req('https://i.imgant.com/a.jpg', { 'x-lingling-token': 'nope' }), env, impl)
  assert.equal(bad2.status, 403)
  const noToken = await handle(req('https://i.imgant.com/a.jpg'), { ALLOWED_ORIGINS: ORIGIN }, impl)
  assert.equal(noToken.status, 403)
  assert.equal(hits.length, 0)
})

test('正常下载：按文件头返回类型、最终地址、允许聆聆读取；不带 Cookie / Referer', async () => {
  let sentHeaders: Record<string, string> = {}
  const { impl } = net({ 'i.imgant.com': ['104.21.1.1', '2606:4700::1'] }, () => new Response(gif, { headers: { 'content-type': 'application/octet-stream' } }))
  const wrapped = async (u: string, init?: RequestInit) => {
    if (!u.includes('dns-query')) sentHeaders = (init?.headers ?? {}) as Record<string, string>
    return impl(u)
  }
  const r = await handle(req('https://i.imgant.com/v2/itpBKTZ.jpeg'), env, wrapped)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/gif')
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN)
  assert.equal(r.headers.get('x-final-url'), 'https://i.imgant.com/v2/itpBKTZ.jpeg')
  assert.equal(new Uint8Array(await r.arrayBuffer()).length, gif.length)
  assert.ok(!Object.keys(sentHeaders).some((k) => /cookie|authorization|referer/i.test(k)))
  const z = await handle(req('https://i.imgant.com/pack'), env, net({ 'i.imgant.com': ['104.21.1.1'] }, () => new Response(zip)).impl)
  assert.equal(z.headers.get('x-content-kind'), 'zip')
})

test('DNS 重绑定 / 跳转到内网：每一跳都重新解析和校验，最多 3 次', async () => {
  const rebind = await handle(req('https://evil.example/a.jpg'), env, net({ 'evil.example': ['1.2.3.4', '127.0.0.1'] }, () => new Response(gif)).impl)
  assert.equal(rebind.status, 400)
  const n1 = net({ 'a.example': ['1.2.3.4'], 'internal.example': ['10.0.0.5'] }, (u) =>
    u.includes('a.example') ? new Response(null, { status: 302, headers: { location: 'https://internal.example/x' } }) : new Response(gif),
  )
  assert.equal((await handle(req('https://a.example/x'), env, n1.impl)).status, 400)
  assert.deepEqual(n1.hits, ['https://a.example/x'])
  const n2 = net({ 'a.example': ['1.2.3.4'] }, () => new Response(null, { status: 301, headers: { location: 'https://a.example/next' } }))
  const loop = await handle(req('https://a.example/x'), env, n2.impl)
  assert.equal(loop.status, 400)
  assert.equal(n2.hits.length, LIMITS.redirects + 1)
  const n3 = net({ 'a.example': ['1.2.3.4'] }, () => new Response(null, { status: 302, headers: { location: 'http://a.example/plain' } }))
  assert.equal(((await (await handle(req('https://a.example/x'), env, n3.impl)).json()) as { error: { code: string } }).error.code, 'not_https')
})

test('源站拒绝 / 不存在：原样告知，不重试、不绕过；非图片内容和超大文件被拒绝', async () => {
  const code = async (site: () => Response, url = 'https://a.example/x') =>
    ((await (await handle(req(url), env, net({ 'a.example': ['1.2.3.4'] }, site).impl)).json()) as { error: { code: string } }).error.code
  assert.equal(await code(() => new Response('', { status: 403 })), 'upstream_auth')
  assert.equal(await code(() => new Response('', { status: 404 })), 'upstream_notfound')
  assert.equal(await code(() => new Response('#!/bin/sh echo hi please run me')), 'unsupported')
  assert.equal(await code(() => new Response('<!doctype html><html><body>hi</body></html>')), 'unsupported') // 未声明 html=1
  assert.equal(await code(() => new Response(gif, { headers: { 'content-length': String(LIMITS.zip + 1) } })), 'too_large')
  // 声称很小但实际不断发送：边下边数
  const big = new ReadableStream({
    start(c) {
      c.enqueue(gif.subarray(0, 32))
      for (let i = 0; i < 12; i++) c.enqueue(new Uint8Array(1024 * 1024))
      c.close()
    },
  })
  assert.equal(await code(() => new Response(big)), 'too_large')
})
