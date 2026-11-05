import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { setSetting } from '../db/db'
import type { AIConfig } from '../db/schema'
import { testConnection } from '../services/ai/openai'
import { PROVIDERS, findProvider, type ProviderPreset } from '../services/ai/providers'
import { useAIConfigLoaded } from '../store/profile'
import { Icon } from '../theme/icons'

/** 步骤标题：细线圆圈序号 + 衬线标题 */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mx-4 mt-4 glass rounded-[var(--radius-card)] px-4 pt-3.5 pb-4">
      <div className="flex items-center gap-2.5">
        <span className="h-[22px] w-[22px] shrink-0 rounded-full border border-[var(--c-accent)]/60 text-[11.5px] leading-[20px] text-center text-[var(--c-accent-strong)] serif-zh">
          {n}
        </span>
        <span className="serif-zh text-[15.5px] tracking-[0.08em] text-[var(--c-brand)]">{title}</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

const field =
  'w-full rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none focus:border-[var(--c-accent)] placeholder:text-[13.5px] placeholder:text-[var(--c-text-3)]'

/**
 * 「连接 AI」向导：为第一次使用的 iPhone 用户准备的三步流程。
 * 选择服务商 → 获取 API Key → 粘贴、测试并保存。
 * 只保存到本设备；测试通过后才默认保存，测试失败也允许先保存。
 */
export default function SetupPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  // 只允许站内路径，防止被构造成跳转到外部网站
  const rawFrom = params.get('from') ?? '/'
  const from = rawFrom.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : '/'
  const cfg = useAIConfigLoaded()
  const loaded = useRef(false)

  const [provider, setProvider] = useState<ProviderPreset>(PROVIDERS[0])
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(PROVIDERS[0].baseUrl)
  const [model, setModel] = useState(PROVIDERS[0].model)
  const [advanced, setAdvanced] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saved, setSaved] = useState(false)

  // 已经配置过自己的 API：带出原来的服务商、地址和模型（Key 也带出，方便只改一项）
  useEffect(() => {
    if (loaded.current || cfg === undefined) return
    loaded.current = true
    if (cfg.service === 'custom' && cfg.mode === 'direct' && cfg.baseUrl) {
      const p = findProvider(cfg.baseUrl) ?? PROVIDERS[PROVIDERS.length - 1]
      setProvider(p)
      setBaseUrl(cfg.baseUrl)
      setModel(cfg.model)
      setApiKey(cfg.apiKey)
    }
  }, [cfg])

  const choose = (p: ProviderPreset) => {
    setProvider(p)
    setBaseUrl(p.baseUrl)
    setModel(p.model)
    setAdvanced(p.id === 'other')
    setResult(null)
  }

  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim()
      if (t) {
        setApiKey(t)
        setResult(null)
      }
    } catch {
      setResult({ ok: false, message: '无法读取剪贴板，请长按输入框选择「粘贴」' })
    }
  }

  const build = (): AIConfig | null => {
    if (!cfg) return null
    return {
      ...cfg,
      service: 'custom',
      mode: 'direct',
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      apiKey: apiKey.trim(),
      model: model.trim(),
    }
  }

  const missing = !apiKey.trim() ? '请先粘贴 API Key' : !baseUrl.trim() ? '请填写接口地址' : !model.trim() ? '请填写模型名称' : null

  const save = async (c: AIConfig) => {
    await setSetting('ai-config', c)
    setSaved(true)
  }

  const testAndSave = async () => {
    const c = build()
    if (!c || missing) return
    setTesting(true)
    setResult(null)
    setSaved(false)
    try {
      const r = await testConnection(c)
      setResult(r)
      if (r.ok) await save(c)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="连接 AI" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <div className="px-7 pt-4 text-center">
          <div className="eyebrow">Getting Started</div>
          <div className="serif-zh mt-1.5 text-[19px] tracking-[0.12em] text-[var(--c-brand)]">让角色开口说话</div>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
            聆聆本身免费。现在需要接入你自己的 AI 服务（API Key），角色才能回复。费用由服务商按用量直接向你收取：以 DeepSeek 为例，日常聊天 100 条回复大约几毛钱，具体取决于角色设定和聊天记录的长度。
          </p>
        </div>

        <Step n={1} title="选择 AI 服务商">
          <div className="-mx-1">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => choose(p)}
                className="press w-full flex items-center gap-3 px-1 py-2 text-left"
              >
                <span
                  className={`h-[16px] w-[16px] shrink-0 rounded-full border flex items-center justify-center ${
                    provider.id === p.id ? 'border-[var(--c-accent)]' : 'border-[var(--c-text-3)]/70'
                  }`}
                >
                  {provider.id === p.id && <span className="h-2 w-2 rounded-full bg-[var(--c-accent)]" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-[var(--c-text)]">{p.name}</span>
                  <span className="block text-[11.5px] text-[var(--c-text-3)]">{p.note}</span>
                </span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title="获取 API Key">
          <ol className="space-y-1.5 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
            {provider.steps.map((s, i) => (
              <li key={s} className="flex gap-2">
                <span className="serif-zh text-[var(--c-text-3)]">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          {provider.keyUrl && (
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="press mt-3 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full border border-[var(--c-line)] bg-white/45 text-[12.5px] text-[var(--c-accent-strong)]"
            >
              打开{provider.name.split(/[ （]/)[0]}控制台
              <Icon name="external" size="xs" />
            </a>
          )}
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--c-text-3)]">
            iPhone 小提示：控制台会在新标签页打开，复制好 Key 后切回这个标签页即可，已填写的内容不会丢失。
          </p>
        </Step>

        <Step n={3} title="粘贴 Key，测试连接">
          <label className="block">
            <span className="block text-[11.5px] tracking-wide text-[var(--c-text-2)] mb-1">API Key</span>
            <span className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setResult(null)
                }}
                placeholder="sk-…"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={field}
              />
              <button
                onClick={() => void paste()}
                className="press shrink-0 h-[42px] px-3 rounded-[12px] border border-[var(--c-line)] bg-white/45 text-[12.5px] text-[var(--c-accent-strong)] flex items-center gap-1"
              >
                <Icon name="paste" size="xs" />
                粘贴
              </button>
            </span>
          </label>

          {(advanced || !provider.model) && (
            <label className="block mt-3">
              <span className="block text-[11.5px] tracking-wide text-[var(--c-text-2)] mb-1">模型名称</span>
              <input
                value={model}
                onChange={(e) => {
                  setModel(e.target.value)
                  setResult(null)
                }}
                placeholder="从服务商控制台复制"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={field}
              />
            </label>
          )}
          {advanced && (
            <label className="block mt-3">
              <span className="block text-[11.5px] tracking-wide text-[var(--c-text-2)] mb-1">接口地址（OpenAI 兼容）</span>
              <input
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value)
                  setResult(null)
                }}
                placeholder="https://…/v1"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={field}
              />
            </label>
          )}
          {!advanced && (
            <button onClick={() => setAdvanced(true)} className="press mt-2 text-[11.5px] text-[var(--c-text-3)] underline underline-offset-2">
              {provider.model ? `将使用 ${provider.model} · 修改模型或接口地址` : '修改接口地址'}
            </button>
          )}

          <button
            onClick={() => void testAndSave()}
            disabled={testing || !!missing}
            className="press mt-4 w-full h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px] tracking-[0.08em] shadow-[0_4px_14px_rgba(95,128,170,0.24)] disabled:opacity-45 disabled:shadow-none"
          >
            {testing ? '正在连接…' : '测试并保存'}
          </button>
          {missing && !testing && <p className="mt-2 text-center text-[11.5px] text-[var(--c-text-3)]">{missing}</p>}

          {result && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-[12px] px-3 py-2.5 text-[12.5px] leading-relaxed ${
                result.ok ? 'bg-[#e8f3ee]/90 text-[#4f7d68]' : 'bg-[#fbeceb]/90 text-[var(--c-danger)]'
              }`}
            >
              <Icon name={result.ok ? 'check' : 'alert'} size="sm" className="shrink-0 mt-0.5" />
              <span>
                {result.message}
                {result.ok && saved && '，已保存到本设备。'}
              </span>
            </div>
          )}

          {result && !result.ok && (
            <div className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--c-text-3)]">
              <p>常见原因：Key 复制不完整、账户余额不足、模型名称不对，或服务商不允许浏览器直接访问（这时可以在「AI 服务」里改用安全代理）。</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    const c = build()
                    if (c && !missing) void save(c)
                  }}
                  className="press h-7 px-3 rounded-full border border-[var(--c-line)] bg-white/45 text-[12px] text-[var(--c-text-2)]"
                >
                  {saved ? '已保存' : '仍然保存'}
                </button>
                <button
                  onClick={() => nav('/me/api')}
                  className="press h-7 px-3 rounded-full border border-[var(--c-line)] bg-white/45 text-[12px] text-[var(--c-text-2)]"
                >
                  高级设置
                </button>
              </div>
            </div>
          )}

          {result?.ok && saved && (
            <button
              onClick={() => nav(from, { replace: true })}
              className="press mt-3 w-full h-10 rounded-full glass-1 text-[14px] tracking-[0.08em] text-[var(--c-accent-strong)]"
            >
              {from.startsWith('/chat/') ? '回到聊天' : '开始聊天'}
            </button>
          )}
        </Step>

        <p className="mx-7 mt-4 text-[11px] leading-relaxed text-[var(--c-text-3)]">
          你的 Key 只保存在这台设备的浏览器里，不会上传到聆聆或写进代码仓库。但聊天时浏览器会把 Key 直接发给服务商，请只在自己的手机上使用，并选择可以随时作废、设置了用量上限的 Key。
        </p>
      </div>
    </div>
  )
}
