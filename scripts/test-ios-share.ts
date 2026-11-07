/**
 * 第七阶段 PR C：从 iPhone 分享菜单导入（解析、长度限制、敏感提醒、只暂存不保存）：npm test
 * Node 自动测试，**不是真机测试**。
 */
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/db/db'
import { clearShare, MAX_TEXT, parseShare, pendingShare, sensitivity, shareUrlPrefix } from '../src/ios/share'
import { handleIncoming } from '../src/ios/incoming'

beforeEach(async () => {
  await db.delete()
  await db.open()
  clearShare()
})

const q = (o: Record<string, string>) => `?${new URLSearchParams(o).toString()}`

test('文字与链接：去掉控制字符；整段是 http(s) 网址时识别为链接；javascript: 不是链接', () => {
  const t = parseShare(q({ lingling_share: '1', t: '  今天\u0000 很冷‮  ' }), 1)
  assert.deepEqual(t, { kind: 'text', text: '今天 很冷', url: undefined, truncated: false, receivedAt: 1 })
  const u = parseShare(q({ lingling_share: '1', t: 'https://example.com/a?b=1&c=2' }))
  assert.equal(u!.kind, 'url')
  assert.equal(u!.url, 'https://example.com/a?b=1&c=2')
  assert.equal(parseShare(q({ lingling_share: '1', t: 'javascript:alert(1)' }))!.kind, 'text')
  assert.equal(parseShare(q({ lingling_share: '1', t: 'https://u:p@evil.com' }))!.url, undefined)
  assert.equal(parseShare(q({ lingling_share: '1', t: '看看 https://example.com' }))!.kind, 'text', '混在文字里的网址按文字处理')
})

test('长度限制：超过 4000 字截断并标记；空内容、没有标记的地址忽略', () => {
  const long = parseShare(q({ lingling_share: '1', t: '雪'.repeat(MAX_TEXT + 50) }))!
  assert.equal(long.text.length, MAX_TEXT)
  assert.equal(long.truncated, true)
  assert.equal(parseShare(q({ lingling_share: '1', t: '   ' })), null)
  assert.equal(parseShare(q({ t: 'x' })), null)
  assert.equal(parseShare(q({ lingling_share: '2', t: 'x' })), null)
})

test('图片与文件：图片不经过链接（只有标记）；文件只有信息', () => {
  const img = parseShare(q({ lingling_share: '1', kind: 'image' }))!
  assert.deepEqual([img.kind, img.text], ['image', ''])
  const f = parseShare(q({ lingling_share: '1', kind: 'file', t: '文件：合同.pdf 大小：1.2 MB' }))!
  assert.deepEqual([f.kind, f.text], ['file', '文件：合同.pdf 大小：1.2 MB'])
  assert.equal(shareUrlPrefix('https://lingxiao-2.github.io/lingling/', 'image'), 'https://lingxiao-2.github.io/lingling/#lingling_share=1&kind=image&t=')
  assert.equal(parseShare('#lingling_share=1&t=%E9%9B%AA')!.text, '雪', '支持 # 形式')
})

test('敏感提醒：证件号 / 密码为高风险，健康财务为私人信息', () => {
  assert.equal(sensitivity('我的身份证 110101199003077777'), 'forbidden')
  assert.equal(sensitivity('银行卡密码是 1234'), 'forbidden')
  assert.equal(sensitivity('明天去医院复查'), 'sensitive')
  assert.equal(sensitivity('今天下雪了'), null)
})

test('打开聆聆时：分享内容只暂存并跳到预览页，地址参数去掉；不写入任何数据', async () => {
  const urls: string[] = []
  const hist = { replaceState: (_: unknown, __: string, u: string) => urls.push(u) } as unknown as History
  await handleIncoming({ search: q({ lingling_share: '1', t: '帮我记住这句话' }), pathname: '/lingling/', hash: '' } as Location, hist)
  assert.deepEqual(urls, ['/lingling/#/share'])
  assert.equal(pendingShare()!.text, '帮我记住这句话')
  assert.deepEqual([await db.notes.count(), await db.messages.count(), await db.memories.count()], [0, 0, 0])
  urls.length = 0
  clearShare()
  await handleIncoming({ search: '?lingling_share=1&t=', pathname: '/lingling/', hash: '' } as Location, hist)
  assert.deepEqual(urls, ['/lingling/#/share?empty=1'])
  assert.equal(pendingShare(), null)
  urls.length = 0
  await handleIncoming({ search: '', pathname: '/lingling/', hash: '#lingling_share=1&t=%E4%BD%A0%E5%A5%BD' } as Location, hist)
  assert.deepEqual(urls, ['/lingling/#/share'])
  assert.equal(pendingShare()!.text, '你好')
})
