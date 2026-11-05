import { useState } from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import { configProblem } from '../services/ai/openai'
import {
  APP_VERSION,
  FEEDBACK_FORM_URL,
  INTENT_OPTIONS,
  PERK_OPTIONS,
  PRICE_OPTIONS,
  feedbackChannelOpen,
  feedbackSummary,
  isEmptyFeedback,
  type FeedbackEntry,
  type IntentId,
  type PerkId,
  type PriceId,
} from '../services/feedback'
import { readFeedbackLog, saveFeedbackLocally } from '../services/feedbackStore'
import { useAIConfig } from '../store/profile'
import { Icon } from '../theme/icons'

function Chip({ on, children, onClick }: { on: boolean; children: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`press h-8 px-3 rounded-full border text-[12.5px] transition-colors ${
        on ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/12 text-[var(--c-accent-strong)]' : 'border-[var(--c-line)] bg-white/40 text-[var(--c-text-2)]'
      }`}
    >
      {children}
    </button>
  )
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mx-4 mt-4 glass rounded-[var(--radius-card)] px-4 pt-3.5 pb-4">
      <div className="serif-zh text-[14.5px] tracking-[0.06em] text-[var(--c-brand)]">{title}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--c-text-3)]">{hint}</div>}
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * 付费意向登记与体验反馈：自愿、匿名，不收集姓名、联系方式或聊天内容。
 */
export default function FeedbackPage() {
  const ai = useAIConfig()
  const [intent, setIntent] = useState<IntentId | undefined>()
  const [perks, setPerks] = useState<PerkId[]>([])
  const [price, setPrice] = useState<PriceId | undefined>()
  const [experience, setExperience] = useState('')
  const [done, setDone] = useState<{ summary: string; copied: boolean } | null>(null)
  const history = useLiveQuery(readFeedbackLog, [], [] as FeedbackEntry[])
  const channel = feedbackChannelOpen()

  const togglePerk = (id: PerkId) => setPerks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const empty = isEmptyFeedback({ intent, perks, price, experience })

  const submit = async () => {
    if (empty) return
    const entry: FeedbackEntry = {
      intent,
      perks,
      price,
      experience: experience.trim().slice(0, 2000),
      chatWorking: !configProblem(ai),
      createdAt: Date.now(),
      appVersion: APP_VERSION,
    }
    const summary = feedbackSummary(entry)
    // iPhone Safari 只允许在点击的同一时刻写剪贴板，所以先复制、再保存
    const copying = copy(summary)
    await saveFeedbackLocally(entry)
    setDone({ summary, copied: await copying })
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="意向登记与反馈" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <div className="px-7 pt-4 text-center">
          <div className="eyebrow">A Letter to Us</div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
            会员尚未开售，这里只是想听听你的想法。所有问题都可以跳过，不需要填写姓名、手机号或微信号，也不会附带你的聊天内容。
          </p>
        </div>

        {done ? (
          <section className="mx-4 mt-5 glass rounded-[var(--radius-card)] px-4 py-4">
            <div className="flex items-center gap-2 text-[14px] text-[#4f7d68]">
              <Icon name="check" size="sm" />
              谢谢你的来信
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
              {channel
                ? '内容已保存在本机' + (done.copied ? '并已复制' : '') + '。点「打开问卷」，把它粘贴到问卷的留言里就完成了。'
                : '反馈收集渠道还没有开通，内容已保存在这台设备上' + (done.copied ? '，并已复制，可以直接粘贴发给开发者。' : '。')}
            </p>
            <pre className="mt-3 whitespace-pre-wrap rounded-[12px] bg-white/45 border border-[var(--c-line)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--c-text-2)] font-[inherit]">
              {done.summary}
            </pre>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void copy(done.summary).then((ok) => setDone({ ...done, copied: ok }))}
                className="press h-8 px-3 rounded-full border border-[var(--c-line)] bg-white/45 text-[12px] text-[var(--c-text-2)] inline-flex items-center gap-1"
              >
                <Icon name="copy" size="xs" />
                {done.copied ? '已复制' : '复制'}
              </button>
              {channel && (
                <a
                  href={FEEDBACK_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="press h-8 px-3 rounded-full border border-[var(--c-line)] bg-white/45 text-[12px] text-[var(--c-accent-strong)] inline-flex items-center gap-1"
                >
                  打开问卷
                  <Icon name="external" size="xs" />
                </a>
              )}
              <button
                onClick={() => {
                  setDone(null)
                  setIntent(undefined)
                  setPerks([])
                  setPrice(undefined)
                  setExperience('')
                }}
                className="press h-8 px-3 rounded-full text-[12px] text-[var(--c-text-3)]"
              >
                再写一封
              </button>
            </div>
          </section>
        ) : (
          <>
            <Block title="如果会员开售，你会考虑吗？">
              <div className="flex flex-wrap gap-2">
                {INTENT_OPTIONS.map((o) => (
                  <Chip key={o.id} on={intent === o.id} onClick={() => setIntent(intent === o.id ? undefined : o.id)}>
                    {o.label}
                  </Chip>
                ))}
              </div>
            </Block>

            <Block title="你最看重哪些权益？" hint="可多选">
              <div className="flex flex-wrap gap-2">
                {PERK_OPTIONS.map((o) => (
                  <Chip key={o.id} on={perks.includes(o.id)} onClick={() => togglePerk(o.id)}>
                    {o.label}
                  </Chip>
                ))}
              </div>
            </Block>

            <Block title="你觉得每月多少钱比较合适？">
              <div className="flex flex-wrap gap-2">
                {PRICE_OPTIONS.map((o) => (
                  <Chip key={o.id} on={price === o.id} onClick={() => setPrice(price === o.id ? undefined : o.id)}>
                    {o.label}
                  </Chip>
                ))}
              </div>
            </Block>

            <Block title="使用体验" hint="哪里好用、哪里卡住了、希望加什么，都可以写">
              <textarea
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="例如：连接 API 时不知道去哪里复制 Key……"
                className="w-full resize-none rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 py-2 text-[16px] leading-relaxed outline-none focus:border-[var(--c-accent)] placeholder:text-[13.5px] placeholder:text-[var(--c-text-3)]"
              />
              <p className="mt-1.5 text-[11px] text-[var(--c-text-3)]">请不要在这里填写 API Key、手机号等个人信息。</p>
            </Block>

            <div className="mx-4 mt-5">
              <button
                onClick={() => void submit()}
                disabled={empty}
                className="press w-full h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px] tracking-[0.08em] shadow-[0_4px_14px_rgba(95,128,170,0.24)] disabled:opacity-45 disabled:shadow-none"
              >
                {channel ? '保存并复制，下一步打开问卷' : '保存并复制'}
              </button>
              <p className="mt-2 text-center text-[11px] leading-relaxed text-[var(--c-text-3)]">
                {channel ? '会复制一份摘要，再打开反馈问卷粘贴即可。' : '反馈收集渠道尚未开通：内容会保存在本机并复制，你可以粘贴发给开发者。'}
                会附带「是否已能正常聊天」和版本号，帮助我们改进首次使用流程。
              </p>
            </div>
          </>
        )}

        {history.length > 0 && (
          <p className="mx-7 mt-6 text-center text-[11px] text-[var(--c-text-3)]">这台设备上已保存 {history.length} 份你写过的反馈。</p>
        )}
      </div>
    </div>
  )
}
