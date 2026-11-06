/**
 * 角色的长期记忆：记忆分类说明；待确认 / 已确认（按类别筛选、固定、重要程度、编辑、改类别、删除）/ 已失效；
 * 疑似重复的合并；检索试一试（与聊天使用同一个 recallMemories）；手动添加；自动记忆设置（需同意）；从最近聊天中提取。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import { db } from '../db/db'
import type { Memory, MemoryKind } from '../db/schema'
import { addMemory, addProposals, MemoryError, mergeMemories, purgeStalePending, removeMemory, setMemoryPrefs, SENSITIVE_PENDING_DAYS, updateMemory } from '../db/memoryRepo'
import { configProblem } from '../services/ai/openai'
import { extractWithAI, KIND_LABEL, MEMORY_BUDGET, recallMemories, RECALL_LABEL, relatedPairs } from '../services/ai/memory'
import { AUTO_EVERY, AUTO_WINDOW } from '../services/ai/autoMemory'
import { effectiveRelationship } from '../services/ai/relationship'
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

const KINDS: MemoryKind[] = ['preference', 'event', 'promise', 'user-fact', 'recent']
const chip = 'press h-7 px-2.5 rounded-full border border-[var(--c-line)] bg-white/45 text-[11.5px]'
const field = 'w-full rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none focus:border-[var(--c-accent)]'

function Item({ m, onError, worldId }: { m: Memory; onError: (s: string) => void; worldId?: string }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.content)
  const [kind, setKind] = useState<MemoryKind>(m.kind)
  const otherWorld = !!m.worldId && !!worldId && m.worldId !== worldId
  const run = (p: Promise<unknown>) => void p.catch((e) => onError(e instanceof MemoryError ? e.message : String(e)))
  return (
    <div className="py-2.5 hairline-b last:border-b-0">
      {editing ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={field} />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`${chip} ${kind === k ? 'border-[var(--c-accent)] text-[var(--c-accent-strong)]' : ''}`}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button className={chip} onClick={() => run(updateMemory(m.id, { content: text, kind }).then(() => setEditing(false)))}>保存</button>
            <button className={chip} onClick={() => setEditing(false)}>取消</button>
          </div>
        </>
      ) : (
        <div className="text-[13.5px] text-[var(--c-text)]">
          {m.pinned && <span className="mr-1 text-[11px] text-[var(--c-accent-strong)]">固定</span>}
          {m.sensitive && <span className="mr-1 text-[11px] text-[var(--c-danger)]">敏感</span>}
          {otherWorld && <span className="mr-1 text-[11px] text-[var(--c-text-3)]">其他世界线</span>}
          {m.content}
        </div>
      )}
      <div className="mt-0.5 text-[11px] text-[var(--c-text-3)]">
        {KIND_LABEL[m.kind] ?? m.kind} · {m.origin === 'manual' ? '你手写的' : m.origin === 'user-request' ? '你在聊天中要求记住' : '从聊天中提取'}
        {(m.mentions ?? 1) > 1 ? ` · 提到过 ${m.mentions} 次` : ''}
        {m.quote ? ` · 原话「${m.quote.slice(0, 40)}」` : ''}
      </div>
      {otherWorld && <div className="mt-0.5 text-[11px] text-[var(--c-text-3)]">这条是角色在另一个世界时记下的，现在不会发送给模型，避免不同世界线的设定混在一起。</div>}
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
              {otherWorld && <button className={chip} onClick={() => run(updateMemory(m.id, { worldId }))}>用于当前世界</button>}
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
  const [filter, setFilter] = useState<MemoryKind | 'all'>('all')
  const [probe, setProbe] = useState('')
  const [askAuto, setAskAuto] = useState(false)

  // 敏感的待确认记忆超过 7 天没有确认：清除，不长期保存
  useEffect(() => {
    if (id) void purgeStalePending(id)
  }, [id])

  const pending = mems.filter((m) => m.status === 'pending')
  const allActive = mems.filter((m) => m.status === 'active').sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.priority ?? 1) - (a.priority ?? 1) || b.createdAt - a.createdAt)
  const active = filter === 'all' ? allActive : allActive.filter((m) => m.kind === filter)
  const kindsInUse = [...new Set(allActive.map((m) => m.kind))]
  const invalid = mems.filter((m) => m.status === 'invalidated' && m.content)
  const pairs = useMemo(() => relatedPairs(allActive), [allActive])
  const recalled = useMemo(
    () => (probe.trim() && c ? recallMemories(mems.filter((m) => m.characterId === id), probe, { worldId: c.worldId, relation: effectiveRelationship(c).status }) : []),
    [probe, mems, c, id],
  )
  const prefs = c?.memoryPrefs ?? {}
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
      const { added, merged } = r.proposals.length ? await addProposals(id, r.proposals) : { added: [], merged: 0 }
      const extra = [merged ? `${merged} 条与已有记忆重复，只合并了依据` : '', r.dropped ? `${r.dropped} 条找不到你的原话依据或重复，已丢弃` : ''].filter(Boolean).join('；')
      setNote(added.length ? `提取到 ${added.length} 条，请在「待确认」中逐条确认${extra ? `；${extra}` : ''}` : `没有发现值得记住的新内容${extra ? `（${extra}）` : ''}`)
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
          这里只保存你确认过的事，只属于这个角色，其他角色读不到。聊天时会带上固定和重要的记忆、最近几天的共同经历，其余的只在聊到相关话题时带上（每次最多约 {MEMORY_BUDGET.chars} 字）。删除后立即不再发送。
        </p>

        <Card title="记忆分类">
          <div className="space-y-0.5 text-[12px]">
            <div>
              · <b>角色永久人设</b>、<b>与你的固定关系</b>：在
              <button className="mx-0.5 text-[var(--c-accent-strong)]" onClick={() => nav(`/character/${id}`)}>角色资料</button>
              里管理，每次聊天都发送，原文不会被修改
            </div>
            <div>· <b>共同经历</b>、<b>长期偏好</b>、<b>重要约定</b>、<b>要记住的事</b>、<b>近期的事</b>：保存在这里</div>
            <div>· <b>临时上下文</b>：就是最近的聊天记录本身，不另外保存</div>
            <div className="text-[var(--c-text-3)]">内容有冲突时，以你确认过的关系和记忆为准。</div>
          </div>
        </Card>

        {pending.length > 0 && (
          <Card title={`待确认 ${pending.length}`}>
            <p className="text-[11.5px] text-[var(--c-text-3)]">确认后才会在聊天中使用。敏感内容 {SENSITIVE_PENDING_DAYS} 天内不确认会自动清除。</p>
            {pending.map((m) => <Item key={m.id} m={m} onError={setErr} worldId={c?.worldId} />)}
          </Card>
        )}

        <Card title={`已记住 ${allActive.length}`}>
          {kindsInUse.length > 1 && (
            <div className="mb-1 flex flex-wrap gap-1.5">
              {(['all', ...kindsInUse] as const).map((k) => (
                <button key={k} onClick={() => setFilter(k)} className={`${chip} ${filter === k ? 'border-[var(--c-accent)] text-[var(--c-accent-strong)]' : ''}`}>
                  {k === 'all' ? '全部' : KIND_LABEL[k] ?? k} {k === 'all' ? allActive.length : allActive.filter((m) => m.kind === k).length}
                </button>
              ))}
            </div>
          )}
          {allActive.length === 0 && <div className="text-[var(--c-text-3)]">还没有记忆。在聊天里说「记住……」，或在下面手动添加。</div>}
          {active.map((m) => <Item key={m.id} m={m} onError={setErr} worldId={c?.worldId} />)}
        </Card>

        {pairs.length > 0 && (
          <Card title={`可能重复 ${pairs.length}`}>
            <p className="text-[11.5px] text-[var(--c-text-3)]">这些记忆说的可能是同一件事。合并时保留较完整的一句（或两句都保留），不会改写意思；合并后可以再编辑。</p>
            {pairs.map(([a, b]) => (
              <div key={`${a.id}-${b.id}`} className="py-2 hairline-b last:border-b-0">
                <div className="text-[13px] text-[var(--c-text)]">「{a.content}」</div>
                <div className="text-[13px] text-[var(--c-text)]">「{b.content}」</div>
                <button className={`${chip} mt-1.5`} onClick={() => void mergeMemories(a.id, b.id).catch((e) => setErr(String(e?.message ?? e)))}>合并</button>
              </div>
            ))}
          </Card>
        )}

        <Card title="检索试一试">
          <p>输入一句聊天内容，看看这句话会让角色想起哪些记忆（与实际聊天使用同一套检索，只在本机计算，不发送、不花钱）。</p>
          <input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="例如：还记得我们上次去看雪吗" className={`${field} mt-2`} />
          {probe.trim() && recalled.length === 0 && <p className="mt-1.5 text-[12px] text-[var(--c-text-3)]">这句话不会带上任何记忆。</p>}
          {recalled.map((r) => (
            <div key={r.memory.id} className="mt-1.5 text-[12.5px]">
              · {r.memory.content}
              <span className="ml-1 text-[11px] text-[var(--c-text-3)]">
                {RECALL_LABEL[r.reason]}
                {r.hits.length ? `（${r.hits.slice(0, 4).join('、')}）` : ''}
              </span>
            </div>
          ))}
        </Card>

        <Card title="添加记忆">
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`${chip} ${kind === k ? 'border-[var(--c-accent)] text-[var(--c-accent-strong)]' : ''}`}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder={kind === 'event' ? '例如：去年冬天我们一起去看了初雪' : kind === 'promise' ? '例如：说好今年冬天一起去北海道' : kind === 'preference' ? '例如：我不吃香菜' : '例如：我对芒果过敏'}
            className={`${field} mt-2`}
          />
          <label className="mt-1.5 flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> 固定（每次聊天都带上）
          </label>
          <button onClick={() => void add()} disabled={!text.trim()} className="press mt-2 h-9 px-4 rounded-full bg-[var(--c-accent)] text-white text-[13px] disabled:opacity-45">添加</button>
        </Card>

        <Card title="自动记忆">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={prefs.rememberRequests !== false} onChange={(e) => void setMemoryPrefs(id, { rememberRequests: e.target.checked })} />
            <span>聊天中说「记住……」「别忘了……」时自动保存（只保存你自己的原话；敏感内容先放进待确认）</span>
          </label>
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={!!prefs.autoExtract}
              onChange={(e) => (e.target.checked ? setAskAuto(true) : void setMemoryPrefs(id, { autoExtract: false }))}
            />
            <span>定期从聊天中提取记忆候选（默认关闭）</span>
          </label>
          {askAuto && !prefs.autoExtract && (
            <div className="mt-2 rounded-[12px] bg-white/45 px-3 py-2 text-[12px]">
              开启后，每新增 {AUTO_EVERY} 条你发的消息，会在一次回复完成后，把这段时间最多 {AUTO_WINDOW} 条聊天发送到你配置的 AI 服务（{config.service === 'lingling' ? '聆聆默认服务' : config.model}）提取候选，每次消耗一次请求的费用，由服务商结算。
              候选只依据你自己说过的话，先放进「待确认」，你确认后才会使用。随时可以关闭。
              {problem && <div className="mt-1 text-[var(--c-danger)]">现在无法使用：{problem}</div>}
              <div className="mt-1.5 flex gap-1.5">
                <button className={`${chip} text-[var(--c-accent-strong)]`} onClick={() => void setMemoryPrefs(id, { autoExtract: true, autoConsentAt: Date.now() }).then(() => setAskAuto(false))}>同意并开启</button>
                <button className={chip} onClick={() => setAskAuto(false)}>取消</button>
              </div>
            </div>
          )}
          {prefs.autoExtract && (
            <label className="mt-2 flex items-start gap-2 pl-5 text-[12px]">
              <input type="checkbox" className="mt-0.5" checked={!!prefs.allowSensitive} onChange={(e) => void setMemoryPrefs(id, { allowSensitive: e.target.checked })} />
              <span>自动提取时也保留健康、财务等敏感内容作为候选（默认不保留：直接丢弃，不写入本机）</span>
            </label>
          )}
          {prefs.lastNote && <p className="mt-1.5 text-[11.5px] text-[var(--c-text-3)]">{prefs.lastNote}</p>}
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
            {invalid.map((m) => <Item key={m.id} m={m} onError={setErr} worldId={c?.worldId} />)}
          </Card>
        )}
        {err && <p className="mx-6 mt-3 text-[12.5px] text-[var(--c-danger)]">{err}</p>}
      </div>
    </div>
  )
}
