/**
 * 角色的长期记忆：待确认 / 已确认（固定、重要程度、编辑、删除）/ 已失效；手动添加；从最近聊天中提取（AI，需同意）。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import { db } from '../db/db'
import type { Memory, MemoryKind } from '../db/schema'
import { addMemory, addProposals, MemoryError, removeMemory, updateMemory } from '../db/memoryRepo'
import { configProblem } from '../services/ai/openai'
import { extractWithAI, KIND_LABEL, MEMORY_BUDGET } from '../services/ai/memory'
import { getDeviceId } from '../services/ai/service'
import { useAIConfig, useProfile } from '../store/profile'

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mx-4 mt-4 glass rounded-[var(--radius-card)] px-4 pt-3.5 pb-4">
      <div className="flex items-center justify-between">
        <div className="serif-zh text-[15px] tracking-[0.08em] text-[var(--c-brand)]">{title}</div>
        {right}
      </div>
      <div className="mt-2.5 text-[13px] leading-relaxed text-[var(--c-text-2)]">{children}</div>
    </section>
  )
}

const KINDS: MemoryKind[] = ['user-fact', 'event', 'recent']
const chip = 'press h-7 px-2.5 rounded-full border border-[var(--c-line)] bg-white/45 text-[11.5px]'
const field = 'w-full rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none focus:border-[var(--c-accent)]'

function Item({ m, onError }: { m: Memory; onError: (s: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.content)
  const run = (p: Promise<unknown>) => void p.catch((e) => onError(e instanceof MemoryError ? e.message : String(e)))
  return (
    <div className="py-2.5 hairline-b last:border-b-0">
      {editing ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={field} />
          <div className="mt-1.5 flex gap-1.5">
            <button className={chip} onClick={() => run(updateMemory(m.id, { content: text }).then(() => setEditing(false)))}>保存</button>
            <button className={chip} onClick={() => setEditing(false)}>取消</button>
          </div>
        </>
      ) : (
        <div className="text-[13.5px] text-[var(--c-text)]">
          {m.pinned && <span className="mr-1 text-[11px] text-[var(--c-accent-strong)]">固定</span>}
          {m.sensitive && <span className="mr-1 text-[11px] text-[var(--c-danger)]">敏感</span>}
          {m.content}
        </div>
      )}
      <div className="mt-0.5 text-[11px] text-[var(--c-text-3)]">
        {KIND_LABEL[m.kind] ?? m.kind} · {m.origin === 'manual' ? '你手写的' : m.origin === 'user-request' ? '你在聊天中要求记住' : '从聊天中提取'}
        {m.quote ? ` · 原话「${m.quote.slice(0, 40)}」` : ''}
      </div>
      {!editing && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {m.status === 'pending' ? (
            <>
              <button className={`${chip} text-[var(--c-accent-strong)]`} onClick={() => run(updateMemory(m.id, { status: 'active' }))}>记住</button>
              <button className={chip} onClick={() => setEditing(true)}>改一下</button>
              <button className={chip} onClick={() => run(removeMemory(m))}>不用记</button>
            </>
          ) : m.status === 'invalidated' ? (
            <>
              <button className={chip} onClick={() => run(updateMemory(m.id, { status: 'active' }))}>恢复</button>
              <button className={chip} onClick={() => run(removeMemory(m))}>删除</button>
            </>
          ) : (
            <>
              {!m.sensitive && <button className={chip} onClick={() => run(updateMemory(m.id, { pinned: !m.pinned }))}>{m.pinned ? '取消固定' : '固定'}</button>}
              <button className={chip} onClick={() => run(updateMemory(m.id, { priority: (((m.priority ?? 1) % 3) + 1) as 1 | 2 | 3 }))}>
                重要程度：{['', '普通', '重要', '非常重要'][m.priority ?? 1]}
              </button>
              <button className={chip} onClick={() => setEditing(true)}>编辑</button>
              <button className={`${chip} text-[var(--c-danger)]`} onClick={() => run(removeMemory(m))}>删除</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function MemoryPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const c = useLiveQuery(() => db.characters.get(id), [id])
  const mems = useLiveQuery(() => db.memories.where('characterId').equals(id).toArray(), [id], [] as Memory[])
  const config = useAIConfig()
  const profile = useProfile()
  const [kind, setKind] = useState<MemoryKind>('user-fact')
  const [text, setText] = useState('')
  const [pin, setPin] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  const pending = mems.filter((m) => m.status === 'pending')
  const active = mems.filter((m) => m.status === 'active').sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.priority ?? 1) - (a.priority ?? 1) || b.createdAt - a.createdAt)
  const invalid = mems.filter((m) => m.status === 'invalidated' && m.content)
  const problem = configProblem(config)

  const add = async () => {
    setErr('')
    try {
      await addMemory(id, { kind, content: text, pinned: pin })
      setText('')
      setPin(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const extract = async () => {
    setAsking(false)
    setBusy(true)
    setErr('')
    setNote('')
    try {
      const conv = (await db.conversations.toArray()).find((v) => v.type === 'single' && v.characterIds[0] === id)
      const msgs = conv ? (await db.messages.where('conversationId').equals(conv.id).sortBy('createdAt')).filter((m) => !m.deleted && !m.superseded).slice(-40) : []
      if (!msgs.some((m) => m.senderType === 'user')) throw new Error('还没有聊天记录')
      const r = await extractWithAI(config, c?.name ?? '角色', profile.nickname || '我', msgs, mems, { deviceId: await getDeviceId() })
      if (r.proposals.length) await addProposals(id, r.proposals)
      setNote(r.proposals.length ? `提取到 ${r.proposals.length} 条，请在「待确认」中逐条确认${r.dropped ? `；${r.dropped} 条找不到你的原话依据或与已有记忆重复，已丢弃` : ''}` : `没有发现值得记住的新内容${r.dropped ? `（${r.dropped} 条找不到你的原话依据或重复，已丢弃）` : ''}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={`${c?.name ?? ''}的记忆`} back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <p className="mx-6 mt-3 text-[11.5px] leading-relaxed text-[var(--c-text-3)]">
          这里只保存你确认过的事，只属于这个角色。角色的基础人设、世界设定和你们的关系在
          <button className="mx-0.5 text-[var(--c-accent-strong)]" onClick={() => nav(`/character/${id}`)}>角色资料</button>
          里管理。聊天时会带上固定和重要的记忆，其余的只在聊到相关话题时带上（每次最多约 {MEMORY_BUDGET.chars} 字）。
        </p>

        {pending.length > 0 && (
          <Card title={`待确认 ${pending.length}`}>
            {pending.map((m) => <Item key={m.id} m={m} onError={setErr} />)}
          </Card>
        )}

        <Card title={`已记住 ${active.length}`}>
          {active.length === 0 && <div className="text-[var(--c-text-3)]">还没有记忆。在聊天里说「记住……」，或在下面手动添加。</div>}
          {active.map((m) => <Item key={m.id} m={m} onError={setErr} />)}
        </Card>

        <Card title="添加记忆">
          <div className="flex gap-1.5">
            {KINDS.map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`${chip} ${kind === k ? 'border-[var(--c-accent)] text-[var(--c-accent-strong)]' : ''}`}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={kind === 'event' ? '例如：去年冬天我们一起去看了初雪' : '例如：我对芒果过敏'} className={`${field} mt-2`} />
          <label className="mt-1.5 flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> 固定（每次聊天都带上）
          </label>
          <button onClick={() => void add()} disabled={!text.trim()} className="press mt-2 h-9 px-4 rounded-full bg-[var(--c-accent)] text-white text-[13px] disabled:opacity-45">添加</button>
        </Card>

        <Card title="从最近聊天中提取">
          <p>让 AI 从最近 40 条消息中找出值得记住的事，只依据你自己说过的话（角色说的可能是编的，不作为依据）。结果先放进「待确认」，你确认后才生效。</p>
          {problem && <p className="mt-1 text-[var(--c-danger)]">现在无法使用：{problem}</p>}
          <button onClick={() => setAsking(true)} disabled={!!problem || busy} className="press mt-2 h-9 px-4 rounded-full border border-[var(--c-line)] bg-white/45 text-[13px] text-[var(--c-accent-strong)] disabled:opacity-45">
            {busy ? '正在提取…' : '提取'}
          </button>
          {asking && (
            <div className="mt-2 rounded-[12px] bg-white/45 px-3 py-2 text-[12px]">
              会把最近 40 条聊天内容发送到你配置的 AI 服务（{config.service === 'lingling' ? '聆聆默认服务' : config.model}），消耗一次请求的费用，由服务商结算。
              <div className="mt-1.5 flex gap-1.5">
                <button className={`${chip} text-[var(--c-accent-strong)]`} onClick={() => void extract()}>同意并提取</button>
                <button className={chip} onClick={() => setAsking(false)}>取消</button>
              </div>
            </div>
          )}
          {note && <p className="mt-1.5 text-[12px] text-[var(--c-accent-strong)]">{note}</p>}
        </Card>

        {invalid.length > 0 && (
          <Card title={`已失效 ${invalid.length}`}>
            <p className="text-[11.5px] text-[var(--c-text-3)]">来源消息被删除后，相关记忆会自动失效，不再发送给模型。</p>
            {invalid.map((m) => <Item key={m.id} m={m} onError={setErr} />)}
          </Card>
        )}
        {err && <p className="mx-6 mt-3 text-[12.5px] text-[var(--c-danger)]">{err}</p>}
      </div>
    </div>
  )
}
