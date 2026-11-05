import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { GhostButton, PrimaryButton, Section, TextField } from '../components/ui'
import { setSetting } from '../db/db'
import type { AIConfig } from '../db/schema'
import { useAIConfigLoaded } from '../store/profile'
import { DEFAULT_AI_CONFIG } from '../db/db'
import { testConnection } from '../services/ai/openai'
import { Icon } from '../theme/icons'

const PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
]

export default function ApiSettingsPage() {
  const nav = useNavigate()
  const cfg = useAIConfigLoaded()
  const loaded = useRef(false)
  const [form, setForm] = useState<AIConfig>(DEFAULT_AI_CONFIG)
  const [temperature, setTemperature] = useState('0.8')
  const [maxTokens, setMaxTokens] = useState('1024')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (loaded.current || cfg === undefined) return
    loaded.current = true
    setForm(cfg)
    setTemperature(String(cfg.temperature))
    setMaxTokens(String(cfg.maxTokens))
  }, [cfg])

  const set = <K extends keyof AIConfig>(k: K, v: AIConfig[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setResult(null)
  }

  const normalized = (): AIConfig => {
    const t = Number(temperature)
    const m = Number(maxTokens)
    return {
      ...form,
      baseUrl: form.baseUrl.trim().replace(/\/+$/, ''),
      apiKey: form.apiKey.trim(),
      proxyUrl: form.proxyUrl.trim().replace(/\/+$/, ''),
      proxyToken: form.proxyToken.trim(),
      model: form.model.trim(),
      temperature: Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : 0.8,
      maxTokens: Number.isFinite(m) && m > 0 ? Math.round(m) : 1024,
    }
  }

  const save = async () => {
    await setSetting('ai-config', normalized())
    nav(-1)
  }

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await testConnection(normalized()))
    } finally {
      setTesting(false)
    }
  }

  const proxy = form.mode === 'proxy'

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="API 设置" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-12">
        {!cfg && <div className="py-16 text-center text-sm text-[var(--c-text-3)]">读取中…</div>}
        {cfg && (<>
        {/* 模式选择 */}
        <div className="mx-4 mt-3 p-1 rounded-full glass-1 grid grid-cols-2 text-[13px]">
          {(['direct', 'proxy'] as const).map((m) => (
            <button
              key={m}
              onClick={() => set('mode', m)}
              className={`press h-8 rounded-full ${form.mode === m ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-text-2)]'}`}
            >
              {m === 'direct' ? '个人测试（直连）' : '安全代理'}
            </button>
          ))}
        </div>

        <div className="mx-4 mt-3 rounded-[var(--radius-card)] bg-[var(--c-accent-soft)] px-4 py-3 text-[12px] leading-relaxed text-[var(--c-text-2)]">
          {proxy ? (
            <>
              <b className="text-[var(--c-text)]">安全代理：</b>
              服务商密钥只保存在你自己部署的代理服务器上，浏览器和本应用都看不到它。这里填写的「访问口令」只能用来调用你的代理，代理可限制来源网站、模型和用量。部署方法见仓库中的
              <code className="mx-1">docs/ai-proxy.md</code>。
            </>
          ) : (
            <>
              <b className="text-[var(--c-text)]">个人测试模式的局限：</b>
              聆聆部署在 GitHub Pages 这样的静态网站上，没有后端。API Key 只保存在本设备的浏览器里，但每次聊天时浏览器会把密钥连同聊天内容直接发给服务商，任何能操作这台设备或这个浏览器的人都可能取得它。请只在自己的设备上使用，选用额度受限、可随时作废的密钥。部分服务商不允许浏览器直接请求（CORS），这时需要改用安全代理。
            </>
          )}
        </div>

        {proxy ? (
          <Section title="代理">
            <TextField
              label="代理地址"
              value={form.proxyUrl}
              onChange={(e) => set('proxyUrl', e.target.value)}
              placeholder="https://lingling-proxy.你的名字.workers.dev"
              autoCapitalize="off"
              autoCorrect="off"
              inputMode="url"
            />
            <TextField
              label="访问口令"
              type="password"
              value={form.proxyToken}
              onChange={(e) => set('proxyToken', e.target.value)}
              placeholder="部署代理时设置的 ACCESS_TOKEN"
              autoCapitalize="off"
              autoCorrect="off"
              hint="不是服务商的 API Key。"
            />
          </Section>
        ) : (
          <Section title="OpenAI 兼容接口">
            <div className="flex gap-2 px-4 pt-3">
              {PRESETS.map((p) => (
                <GhostButton
                  key={p.label}
                  onClick={() => {
                    set('baseUrl', p.baseUrl)
                    set('model', p.model)
                  }}
                >
                  {p.label}
                </GhostButton>
              ))}
            </div>
            <TextField
              label="API Base URL"
              value={form.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              autoCapitalize="off"
              autoCorrect="off"
              inputMode="url"
            />
            <TextField
              label="API Key"
              type="password"
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              placeholder="sk-..."
              autoCapitalize="off"
              autoCorrect="off"
              hint="只保存在本设备，不会写入代码或 GitHub。"
            />
          </Section>
        )}

        <Section title="模型与生成参数">
          <TextField label="模型名称" value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="deepseek-chat" autoCapitalize="off" autoCorrect="off" />
          <TextField label="temperature（0–2，越高越随性）" inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          <TextField label="单次回复最多 tokens" inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
        </Section>

        <div className="mx-4 mt-4">
          <button
            onClick={() => void test()}
            disabled={testing}
            className="press w-full h-10 rounded-full glass-1 text-[14px] text-[var(--c-accent-strong)] disabled:opacity-50"
          >
            {testing ? '正在测试…' : '测试连接'}
          </button>
          {result && (
            <div
              className={`mt-2.5 flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2.5 text-[12.5px] leading-relaxed ${
                result.ok ? 'bg-[#e8f3ee] text-[#4f7d68]' : 'bg-[#fbeceb] text-[var(--c-danger)]'
              }`}
            >
              <Icon name={result.ok ? 'check' : 'alert'} size="sm" className="shrink-0 mt-0.5" />
              <span>{result.message}</span>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--c-text-3)]">测试会发送一条极短的请求，可能产生极少量费用。</p>
        </div>

        <div className="flex justify-center mt-6">
          <PrimaryButton onClick={() => void save()}>保存</PrimaryButton>
        </div>
        </>)}
      </div>
    </div>
  )
}
