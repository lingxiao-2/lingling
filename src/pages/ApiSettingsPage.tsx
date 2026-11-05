import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { PrimaryButton, Section, TextField } from '../components/ui'
import { setSetting } from '../db/db'
import { useAIConfig } from '../store/profile'

export default function ApiSettingsPage() {
  const nav = useNavigate()
  const cfg = useAIConfig()
  const loaded = useRef(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState('0.8')
  const [maxTokens, setMaxTokens] = useState('1024')

  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    setBaseUrl(cfg.baseUrl)
    setApiKey(cfg.apiKey)
    setModel(cfg.model)
    setTemperature(String(cfg.temperature))
    setMaxTokens(String(cfg.maxTokens))
  }, [cfg])

  const save = async () => {
    const t = Number(temperature)
    const m = Number(maxTokens)
    await setSetting('ai-config', {
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      apiKey: apiKey.trim(),
      model: model.trim(),
      temperature: Number.isFinite(t) ? Math.min(2, Math.max(0, t)) : 0.8,
      maxTokens: Number.isFinite(m) && m > 0 ? Math.round(m) : 1024,
    })
    nav(-1)
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="API 设置" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <div className="mx-3 mt-3 rounded-2xl bg-[var(--c-accent-soft)] px-4 py-3 text-xs leading-relaxed text-[var(--c-text-2)]">
          <b className="text-[var(--c-text)]">请先了解：</b>
          这是纯前端应用，API Key 只保存在当前设备的浏览器中。聊天时，浏览器会直接把密钥和聊天内容发送给你填写的 API 服务，这不等同于可信后端对密钥的保护，请使用额度受限的密钥，并避免在公共设备上保存。部分服务商不允许浏览器直接请求（CORS），此时需要后续版本提供的代理方式。
        </div>
        <Section title="OpenAI 兼容接口">
          <TextField
            label="API Base URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <TextField
            label="API Key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            autoCapitalize="off"
            autoCorrect="off"
          />
          <TextField label="模型名称" value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" autoCapitalize="off" autoCorrect="off" />
        </Section>
        <Section title="生成参数">
          <TextField label="temperature（0–2）" inputMode="decimal" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          <TextField label="max_tokens" inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
        </Section>
        <p className="mx-6 mt-3 text-[11px] leading-relaxed text-[var(--c-text-3)]">
          当前版本只保存这些配置，尚未接入聊天；「连接测试」与真实 AI 回复将在第二轮开发中开放。
        </p>
        <div className="flex justify-center mt-5">
          <PrimaryButton onClick={() => void save()}>保存</PrimaryButton>
        </div>
      </div>
    </div>
  )
}
