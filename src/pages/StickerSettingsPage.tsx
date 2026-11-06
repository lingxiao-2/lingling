/**
 * 表情包与识图：开启识图（首次需要确认）、选择识图模型、测试、用量、批量识别、存储空间。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import { ConfirmDialog } from '../components/Sheet'
import { db } from '../db/db'
import type { Sticker, StickerAnalysis } from '../db/schema'
import { listStickers } from '../db/stickerRepo'
import { storageEstimate } from '../services/stickerImport'
import { analysesFor, analyzeMany, loadVisionConfig, loadVisionUsage, saveVisionConfig } from '../services/vision/stickerVision'
import { DEFAULT_VISION_CONFIG, describeAnalysis, requestAnalysis, visionTarget, type VisionConfig } from '../services/vision/vision'
import { useAIConfig } from '../store/profile'
import { checkProxyUrl, loadLinkProxy, saveLinkProxy } from '../services/linkProxy'
import { browserProbe, fetchLink, LinkError } from '../services/linkImport'

const PRESETS = [
  { label: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
]

const field =
  'w-full rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none focus:border-[var(--c-accent)] placeholder:text-[13.5px] placeholder:text-[var(--c-text-3)]'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-4 mt-4 glass rounded-[var(--radius-card)] px-4 pt-3.5 pb-4">
      <div className="serif-zh text-[15px] tracking-[0.08em] text-[var(--c-brand)]">{title}</div>
      <div className="mt-2.5 text-[13px] leading-relaxed text-[var(--c-text-2)]">{children}</div>
    </section>
  )
}

/** 测试图：画一个大字，验证模型确实能看图（而不是只接受请求） */
function testImage(): string {
  const c = document.createElement('canvas')
  c.width = 160
  c.height = 160
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 160, 160)
  g.fillStyle = '#222'
  g.font = 'bold 110px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('雪', 80, 86)
  return c.toDataURL('image/png')
}

export default function StickerSettingsPage() {
  const chat = useAIConfig()
  const [v, setV] = useState<VisionConfig>(DEFAULT_VISION_CONFIG)
  const loaded = useRef(false)
  const [consentAsk, setConsentAsk] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null)
  const [batchAsk, setBatchAsk] = useState(false)
  const [batch, setBatch] = useState<{ done: number; total: number; ok: number; failed: number; running: boolean } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const usage = useLiveQuery(loadVisionUsage, [])
  const stickers = useLiveQuery(listStickers, [], [] as Sticker[])
  const analyses = useLiveQuery(() => analysesFor(stickers), [stickers], new Map<string, StickerAnalysis>())
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const imageBytes = useLiveQuery(async () => (await db.stickers.toArray()).reduce((s, x) => s + (x.bytes || 0), 0), [], 0)

  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyToken, setProxyToken] = useState('')
  const [proxyMsg, setProxyMsg] = useState<{ ok: boolean; msg: string; steps?: string[] } | null>(null)
  const [proxyTestUrl, setProxyTestUrl] = useState('')
  const [proxyBusy, setProxyBusy] = useState(false)

  const saveProxy = async () => {
    const bad = proxyUrl.trim() ? checkProxyUrl(proxyUrl) : null
    if (bad) return setProxyMsg({ ok: false, msg: bad })
    await saveLinkProxy(proxyUrl.trim() ? { url: proxyUrl, token: proxyToken } : null)
    setProxyMsg({ ok: true, msg: proxyUrl.trim() ? '已保存。之后通过链接导入时，浏览器读不到的公开图片会改由你的代理下载。' : '已清除代理，只使用浏览器直连。' })
  }
  const testLink = async () => {
    setProxyBusy(true)
    setProxyMsg(null)
    try {
      const f = await fetchLink(proxyTestUrl, fetch, undefined, { proxy: await loadLinkProxy(), probe: (u) => browserProbe(u) })
      setProxyMsg({ ok: true, msg: `读取成功：${f.kind === 'image' ? '图片' : f.kind === 'zip' ? 'ZIP' : '网页'}，${(f.bytes.length / 1024).toFixed(0)} KB` })
    } catch (e) {
      setProxyMsg({ ok: false, msg: e instanceof Error ? e.message : String(e), steps: e instanceof LinkError ? e.steps : undefined })
    } finally {
      setProxyBusy(false)
    }
  }

  useEffect(() => {
    void loadLinkProxy().then((p) => {
      if (p) {
        setProxyUrl(p.url)
        setProxyToken(p.token)
      }
    })
    void loadVisionConfig().then((c) => {
      if (!loaded.current) {
        loaded.current = true
        setV(c)
      }
    })
    void storageEstimate().then(setStorage)
  }, [])

  const save = async (next: VisionConfig) => {
    setV(next)
    setTest(null)
    await saveVisionConfig(next)
  }
  const toggle = () => {
    if (!v.enabled && !v.consentAt) return setConsentAsk(true)
    void save({ ...v, enabled: !v.enabled })
  }
  const target = visionTarget({ ...v, enabled: true, consentAt: v.consentAt ?? 1 }, chat)

  const runTest = async () => {
    if ('problem' in target) return setTest({ ok: false, msg: target.problem })
    setTesting(true)
    setTest(null)
    try {
      const out = await requestAnalysis(target.config, { dataUrl: testImage(), coverage: 'static', frames: 1 })
      const a = out.analysis
      const sawIt = `${a.text}${a.summary}`.includes('雪')
      setTest({
        ok: sawIt,
        msg: sawIt ? `识图正常：模型看到了测试图里的「雪」字（${describeAnalysis(a)}）` : `模型有回应，但没有认出测试图里的「雪」字（它说：${describeAnalysis(a)}）。这个模型可能不擅长识图。`,
      })
    } catch (e) {
      setTest({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const unknown = stickers.filter((s) => !(s.hash && analyses.get(s.hash)?.status === 'done'))
  const runBatch = async () => {
    const ctrl = new AbortController()
    abort.current = ctrl
    setBatch({ done: 0, total: unknown.length, ok: 0, failed: 0, running: true })
    const r = await analyzeMany(unknown, (done, total, ok, failed) => setBatch({ done, total, ok, failed, running: true }), ctrl.signal)
    setBatch((b) => (b ? { ...b, ok: r.ok, failed: r.failed, running: false } : b))
  }

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
  const visionReady = v.enabled && !!v.consentAt && !('problem' in target)

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="表情包与识图" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <Card title="识图">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[14px] text-[var(--c-text)]">让角色看懂表情包</div>
              <div className="text-[11.5px] text-[var(--c-text-3)]">{v.enabled ? (visionReady ? '已开启' : '已开启，但还不能使用：请完成下面的设置') : '未开启：角色不会假装看懂图片'}</div>
            </div>
            <button
              role="switch"
              aria-checked={v.enabled}
              onClick={toggle}
              className={`press shrink-0 h-[26px] w-[44px] rounded-full p-[3px] transition-colors ${v.enabled ? 'bg-[var(--c-accent)]' : 'bg-[#cfd7e6]'}`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${v.enabled ? 'translate-x-[18px]' : ''}`} />
            </button>
          </div>

          {v.enabled && (
            <>
              <div className="mt-3 p-0.5 rounded-full bg-white/50 border border-[var(--c-line)] grid grid-cols-2 text-[12.5px]">
                {(['separate', 'chat'] as const).map((m) => (
                  <button key={m} onClick={() => void save({ ...v, mode: m })} className={`press h-8 rounded-full ${v.mode === m ? 'bg-[var(--c-accent)] text-white' : ''}`}>
                    {m === 'separate' ? '单独的视觉模型' : '使用聊天模型'}
                  </button>
                ))}
              </div>
              {v.mode === 'chat' ? (
                <div className="mt-2.5 text-[12px]">
                  <p>直接用「AI 服务」里的聊天模型（{chat.service === 'custom' ? chat.model || '未填写' : '聆聆默认服务'}）看图。它必须支持图片输入，例如各家带 VL / Vision 的模型；纯文本模型会被拒绝或看不见图片。</p>
                  <label className="mt-2 flex items-center gap-2">
                    <input type="checkbox" checked={v.attachToChat} onChange={(e) => void save({ ...v, attachToChat: e.target.checked })} />
                    回复时把最新的表情包原图也交给聊天模型
                  </label>
                </div>
              ) : (
                <div className="mt-2.5 space-y-2.5">
                  <p className="text-[12px]">视觉模型只负责看图，聊天仍由原来的模型完成，两者可以来自不同服务商。模型名称请到服务商控制台复制支持图片输入的模型（通常带 VL / Vision / V 字样）。</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                      <button key={p.label} onClick={() => void save({ ...v, baseUrl: p.baseUrl })} className="press h-7 px-3 rounded-full border border-[var(--c-line)] bg-white/45 text-[12px]">
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input className={field} value={v.baseUrl} placeholder="接口地址（OpenAI 兼容，通常以 /v1 结尾）" inputMode="url" autoCapitalize="off" autoCorrect="off" onChange={(e) => setV({ ...v, baseUrl: e.target.value })} onBlur={() => void save(v)} />
                  <input className={field} type="password" value={v.apiKey} placeholder="API Key（只保存在本设备）" autoCapitalize="off" autoCorrect="off" onChange={(e) => setV({ ...v, apiKey: e.target.value })} onBlur={() => void save(v)} />
                  <input className={field} value={v.model} placeholder="视觉模型名称" autoCapitalize="off" autoCorrect="off" onChange={(e) => setV({ ...v, model: e.target.value })} onBlur={() => void save(v)} />
                </div>
              )}
              <button onClick={() => void runTest()} disabled={testing} className="press mt-3 w-full h-9 rounded-full glass-1 text-[13px] text-[var(--c-accent-strong)] disabled:opacity-50">
                {testing ? '正在用测试图检查…' : '测试识图'}
              </button>
              {test && <p className={`mt-2 text-[12px] ${test.ok ? 'text-[#4f7d68]' : 'text-[var(--c-danger)]'}`}>{test.msg}</p>}
              <p className="mt-2 text-[11px] text-[var(--c-text-3)]">测试会发送一张写着「雪」字的小图，可能产生极少量费用。</p>
            </>
          )}
        </Card>

        <Card title="收藏夹">
          <div>
            共 {stickers.length} 个表情包，已识别 {stickers.length - unknown.length} 个。角色只会主动发送已识别（或你写过含义）的表情包。
          </div>
          {batch ? (
            <div className="mt-2.5">
              <div>
                {batch.running ? `正在识别 ${batch.done} / ${batch.total}` : `识别完成：成功 ${batch.ok}，失败 ${batch.failed}`}
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-white/60 overflow-hidden">
                <div className="h-full bg-[var(--c-accent)]" style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 100}%` }} />
              </div>
              {batch.running && (
                <button onClick={() => abort.current?.abort()} className="press mt-2 h-7 px-3 rounded-full border border-[var(--c-line)] bg-white/45 text-[12px]">
                  停止
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => setBatchAsk(true)}
              disabled={!visionReady || unknown.length === 0}
              className="press mt-2.5 h-8 px-3.5 rounded-full border border-[var(--c-line)] bg-white/45 text-[12.5px] text-[var(--c-accent-strong)] disabled:opacity-45"
            >
              识别全部未识别的 {unknown.length} 张
            </button>
          )}
          <p className="mt-2 text-[11.5px] text-[var(--c-text-3)]">
            不批量识别也可以：你发出的表情包会在发送时自动识别；同一张图只识别一次，结果保存在本机。
          </p>
        </Card>

        <Card title="链接导入代理（可选）">
          <p>
            很多图床允许显示图片，但不允许其他网页读取图片内容（跨域限制），这时「通过链接导入」会失败。可以填写<b>你自己部署</b>的图片代理来下载这类公开图片。部署方法见仓库 docs/link-import.md；不填写时只用浏览器直连。
          </p>
          <input value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} placeholder="代理地址，例如 https://xxx.workers.dev" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${field} mt-2.5`} />
          <input value={proxyToken} onChange={(e) => setProxyToken(e.target.value)} placeholder="访问口令（部署时自己设定的 ACCESS_TOKEN）" type="password" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${field} mt-2`} />
          <button onClick={() => void saveProxy()} className="press mt-2.5 h-8 px-3.5 rounded-full border border-[var(--c-line)] bg-white/45 text-[12.5px] text-[var(--c-accent-strong)]">
            保存
          </button>
          <div className="mt-3 text-[12px]">测试一个链接（会显示每一步的诊断结果）：</div>
          <div className="mt-1.5 flex gap-2">
            <input value={proxyTestUrl} onChange={(e) => setProxyTestUrl(e.target.value)} placeholder="https://" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${field} flex-1 min-w-0`} />
            <button onClick={() => void testLink()} disabled={!proxyTestUrl.trim() || proxyBusy} className="press shrink-0 px-3 rounded-[12px] border border-[var(--c-line)] bg-white/45 text-[12.5px] text-[var(--c-accent-strong)] disabled:opacity-45">
              {proxyBusy ? '测试中…' : '测试'}
            </button>
          </div>
          {proxyMsg && (
            <div className={`mt-2 text-[12px] leading-relaxed ${proxyMsg.ok ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-danger)]'}`}>
              {proxyMsg.msg}
              {proxyMsg.steps?.length ? (
                <ul className="mt-1 list-disc pl-4 text-[11.5px] text-[var(--c-text-3)]">
                  {proxyMsg.steps.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              ) : null}
            </div>
          )}
          <p className="mt-2 text-[11px] text-[var(--c-text-3)]">口令只保存在这台设备的浏览器里。代理只下载公开的 https 图片 / ZIP，不会绕过登录、验证码或防盗链。</p>
        </Card>

        <Card title="用量">
          {usage ? (
            <div>
              识图请求 {usage.calls} 次（失败 {usage.failures} 次）
              {usage.promptTokens + usage.completionTokens > 0 && `，约 ${(usage.promptTokens + usage.completionTokens).toLocaleString()} Token`}。
              <div className="text-[11.5px] text-[var(--c-text-3)]">费用由你的服务商按其价格结算；一张表情包通常是一次几百到一千多 Token 的请求，动图会拼成一张图发送。</div>
            </div>
          ) : null}
        </Card>

        <Card title="存储">
          <div>
            表情包约 {mb(imageBytes)}
            {storage && `；本网站已用 ${mb(storage.usage)}，浏览器允许约 ${mb(storage.quota)}`}。
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--c-text-3)]">
            所有图片只保存在这台设备的浏览器里，不会上传到聆聆。iPhone Safari 的空间有限，长时间不打开网站时也可能清理数据；空间不足时导入会停止并提示。
          </p>
        </Card>
      </div>

      {consentAsk && (
        <ConfirmDialog
          title="开启识图？"
          message={
            <>
              <span className="block">· 表情包图片会发送给你选择的模型服务商来识别；</span>
              <span className="block">· 识图会消耗你的 API 额度；</span>
              <span className="block">· 可以随时关闭或更换服务商。</span>
              <span className="block mt-1.5 text-[12px] text-[var(--c-text-3)]">开启后，你发送的表情包会自动识别；整个收藏夹不会自动上传，批量识别需要你手动确认。</span>
            </>
          }
          confirmText="同意并开启"
          onCancel={() => setConsentAsk(false)}
          onConfirm={() => {
            setConsentAsk(false)
            void save({ ...v, enabled: true, consentAt: Date.now() })
          }}
        />
      )}
      {batchAsk && (
        <ConfirmDialog
          title={`识别 ${unknown.length} 张表情包？`}
          message={`这些图片会逐张发送给识图模型，大约产生 ${unknown.length} 次请求的费用。已经识别过的不会重复识别，中途可以停止。`}
          confirmText="开始识别"
          onCancel={() => setBatchAsk(false)}
          onConfirm={() => {
            setBatchAsk(false)
            void runBatch()
          }}
        />
      )}
    </div>
  )
}
