/**
 * 角色资料页的「你们的关系」：显示识别出的关系与原文依据，可修改。保存后下一条回复立即使用。
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { db } from '../db/db'
import type { Character, Relationship, RelationshipStatus } from '../db/schema'
import { detectRelationship, effectiveRelationship, RELATION_LABEL, relationSources } from '../services/ai/relationship'
import { Section } from './ui'

const STATUSES: RelationshipStatus[] = ['lover', 'married', 'friend', 'ambiguous', 'stranger', 'custom', 'unknown']
const field =
  'w-full rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none focus:border-[var(--c-accent)] placeholder:text-[13px] placeholder:text-[var(--c-text-3)]'

const splitList = (s: string) =>
  s
    .split(/[，,、\n]/)
    .map((x) => x.trim())
    .filter(Boolean)

export async function saveRelationship(id: string, rel: Relationship) {
  await db.characters.update(id, { relationship: rel, updatedAt: Date.now() })
}

export default function RelationshipCard({ c }: { c: Character }) {
  const rel = effectiveRelationship(c)
  const [editing, setEditing] = useState(false)
  const label = rel.status === 'custom' ? rel.customLabel || '自定义' : RELATION_LABEL[rel.status]
  const stateNote = c.relationship ? (rel.source === 'user' ? '你确认过' : '导入时根据人设原文识别') : '根据人设原文实时识别（尚未确认）'

  return (
    <Section title="你们的关系">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-[16px] text-[var(--c-brand)] serif-zh">{label}</span>
            <span className="ml-2 text-[11.5px] text-[var(--c-text-3)]">{stateNote}</span>
          </div>
          <button onClick={() => setEditing(true)} className="press shrink-0 h-7 px-3 rounded-full border border-[var(--c-line)] text-[12px] text-[var(--c-accent-strong)]">
            修改
          </button>
        </div>
        {rel.status === 'unknown' && <p className="mt-1.5 text-[12px] text-[var(--c-text-3)]">人设里没有找到明确写出的关系。可以手动设置，角色会从下一句话开始按这个关系聊天。</p>}
        {rel.evidence.length > 0 && (
          <div className="mt-2 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
            <div className="text-[11.5px] text-[var(--c-text-3)]">原文依据</div>
            {rel.evidence.slice(0, 3).map((e, i) => (
              <div key={i} className="mt-0.5">
                「{e.quote}」<span className="text-[11px] text-[var(--c-text-3)]">— {e.source}</span>
              </div>
            ))}
          </div>
        )}
        {(rel.nicknames.forUser.length > 0 || rel.nicknames.forChar.length > 0) && (
          <div className="mt-2 text-[12.5px] text-[var(--c-text-2)]">
            {rel.nicknames.forUser.length > 0 && <div>Ta 叫你：{rel.nicknames.forUser.join('、')}</div>}
            {rel.nicknames.forChar.length > 0 && <div>你叫 Ta：{rel.nicknames.forChar.join('、')}</div>}
          </div>
        )}
        {rel.sharedHistory.length > 0 && (
          <div className="mt-2 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
            <div className="text-[11.5px] text-[var(--c-text-3)]">共同经历（原文）</div>
            {rel.sharedHistory.slice(0, 4).map((s, i) => (
              <div key={i}>· {s}</div>
            ))}
          </div>
        )}
        {rel.habits.length > 0 && (
          <div className="mt-2 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">
            <div className="text-[11.5px] text-[var(--c-text-3)]">相处习惯（原文）</div>
            {rel.habits.slice(0, 3).map((s, i) => (
              <div key={i}>· {s}</div>
            ))}
          </div>
        )}
      </div>
      {editing && <RelationshipEditor c={c} rel={rel} onClose={() => setEditing(false)} />}
    </Section>
  )
}

function RelationshipEditor({ c, rel, onClose }: { c: Character; rel: Relationship; onClose: () => void }) {
  const [status, setStatus] = useState<RelationshipStatus>(rel.status)
  const [customLabel, setCustomLabel] = useState(rel.customLabel ?? '')
  const [customNote, setCustomNote] = useState(rel.customNote ?? '')
  const [forUser, setForUser] = useState(rel.nicknames.forUser.join('、'))
  const [forChar, setForChar] = useState(rel.nicknames.forChar.join('、'))
  const [shared, setShared] = useState(rel.sharedHistory.join('\n'))
  const [habits, setHabits] = useState(rel.habits.join('\n'))

  const redetect = () => {
    const r = detectRelationship(relationSources(c))
    setStatus(r.status)
    setForUser(r.nicknames.forUser.join('、'))
    setForChar(r.nicknames.forChar.join('、'))
    setShared(r.sharedHistory.join('\n'))
    setHabits(r.habits.join('\n'))
  }

  const save = async () => {
    const auto = status === rel.status ? rel.evidence : detectRelationship(relationSources(c)).status === status ? detectRelationship(relationSources(c)).evidence : []
    await saveRelationship(c.id, {
      status,
      customLabel: status === 'custom' ? customLabel.trim().slice(0, 20) : undefined,
      customNote: status === 'custom' ? customNote.trim().slice(0, 300) : undefined,
      evidence: auto,
      nicknames: { forUser: splitList(forUser).slice(0, 4), forChar: splitList(forChar).slice(0, 4) },
      sharedHistory: shared.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8),
      habits: habits.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6),
      source: 'user',
      updatedAt: Date.now(),
    })
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 sheet-overlay sheet-fade" />
      <div
        className="relative w-full max-w-[480px] card rounded-b-none px-5 pt-4 sheet-rise max-h-[88dvh] overflow-y-auto"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 14px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="serif-zh text-[16px] text-[var(--c-brand)]">你和{c.name}的关系</div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={`press h-8 px-3 rounded-full border text-[13px] ${status === s ? 'border-[var(--c-accent)] bg-[var(--c-accent)] text-white' : 'border-[var(--c-line)] bg-white/45 text-[var(--c-text-2)]'}`}
            >
              {s === 'unknown' ? '不设定' : RELATION_LABEL[s]}
            </button>
          ))}
        </div>
        {status === 'custom' && (
          <>
            <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="关系名称，例如：师徒、契约关系" className={`${field} mt-2.5`} />
            <textarea value={customNote} onChange={(e) => setCustomNote(e.target.value)} rows={2} placeholder="补充说明（可选）" className={`${field} mt-2`} />
          </>
        )}
        <div className="mt-3 text-[12px] text-[var(--c-text-3)]">Ta 怎么称呼你（用顿号分隔，可留空）</div>
        <input value={forUser} onChange={(e) => setForUser(e.target.value)} className={`${field} mt-1`} />
        <div className="mt-2.5 text-[12px] text-[var(--c-text-3)]">你怎么称呼 Ta</div>
        <input value={forChar} onChange={(e) => setForChar(e.target.value)} className={`${field} mt-1`} />
        <div className="mt-2.5 text-[12px] text-[var(--c-text-3)]">共同经历（每行一条；只写真的设定过的，角色不会编造其他经历）</div>
        <textarea value={shared} onChange={(e) => setShared(e.target.value)} rows={3} className={`${field} mt-1`} />
        <div className="mt-2.5 text-[12px] text-[var(--c-text-3)]">相处习惯（每行一条）</div>
        <textarea value={habits} onChange={(e) => setHabits(e.target.value)} rows={2} className={`${field} mt-1`} />
        <div className="mt-4 flex gap-2">
          <button onClick={redetect} className="press h-10 px-4 rounded-full text-[13px] text-[var(--c-text-2)]">
            按人设重新识别
          </button>
          <button onClick={() => void save()} className="press flex-1 h-10 rounded-full bg-[var(--c-accent)] text-white text-[14px]">
            保存
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[var(--c-text-3)]">保存后，角色的下一条回复就会按这个关系来聊。不会改动人设原文和聊天记录。</p>
      </div>
    </div>,
    document.body,
  )
}
