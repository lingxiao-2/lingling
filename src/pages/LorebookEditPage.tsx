import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import NavBar, { NavButton } from '../components/NavBar'
import { useFormImport } from '../import/useFormImport'
import { AreaField, PrimaryButton, Section, TextField } from '../components/ui'
import { db } from '../db/db'
import { createLorebook, updateLorebook } from '../db/repo'
import type { LoreEntry } from '../db/schema'

/** 编辑中的条目：关键词以原始文本保存，避免输入逗号时被立即拆分 */
interface EntryForm {
  id?: string
  name: string
  keysText: string
  content: string
  enabled: boolean
  constant: boolean
  /** 导入时保留的原始字段，编辑时原样带回 */
  secondaryKeys: string[]
  extensions: Record<string, unknown>
}

const blankEntry = (): EntryForm => ({
  name: '',
  keysText: '',
  content: '',
  enabled: true,
  constant: false,
  secondaryKeys: [],
  extensions: {},
})

const splitKeys = (s: string) =>
  s
    .split(/[,，、;；]/)
    .map((x) => x.trim())
    .filter(Boolean)

export default function LorebookEditPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const existing = useLiveQuery(async () => (id ? (await db.lorebooks.get(id)) ?? null : null), [id])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [entries, setEntries] = useState<EntryForm[]>(() => (id ? [] : [blankEntry()]))
  const [saving, setSaving] = useState(false)
  const loaded = useRef(false)

  /** 从本地文件读取条目：追加到当前条目之后，不替换已有条目 */
  const fileImport = useFormImport(
    'lorebook',
    (f) => {
      const n = f.lorebooks.reduce((s, b) => s + b.entries.length, 0)
      return n ? `读取到 ${n} 个条目，将追加到当前条目之后。缺少关键词的条目请手动补充或设为常驻。` : '文件中没有世界书条目。'
    },
    (f) => {
      const book = f.lorebooks[0]
      if (!book) return
      if (!name.trim()) setName(book.name)
      if (!description.trim() && book.description) setDescription(book.description)
      const incoming: EntryForm[] = f.lorebooks.flatMap((b) =>
        b.entries.map((e) => ({
          name: e.name,
          keysText: e.keys.join('，'),
          content: e.content,
          enabled: e.enabled,
          constant: e.constant,
          secondaryKeys: e.secondaryKeys,
          extensions: e.extensions,
        })),
      )
      setEntries((list) => [...list.filter((e) => e.name.trim() || e.content.trim() || e.keysText.trim()), ...incoming])
    },
  )

  useEffect(() => {
    if (loaded.current || !existing) return
    loaded.current = true
    setName(existing.name)
    setDescription(existing.description)
    setEntries(
      existing.entries.map((e: LoreEntry) => ({
        id: e.id,
        name: e.name,
        keysText: e.keys.join('，'),
        content: e.content,
        enabled: e.enabled,
        constant: e.constant,
        secondaryKeys: e.secondaryKeys,
        extensions: e.extensions,
      })),
    )
  }, [existing])

  const patch = (i: number, p: Partial<EntryForm>) => setEntries((list) => list.map((e, j) => (j === i ? { ...e, ...p } : e)))

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    const payload = {
      name,
      description,
      entries: entries
        .filter((e) => e.name.trim() || e.content.trim() || e.keysText.trim())
        .map((e, i) => {
          const keys = splitKeys(e.keysText)
          const base = {
            name: e.name.trim() || keys[0] || `条目 ${i + 1}`,
            keys,
            secondaryKeys: e.secondaryKeys,
            content: e.content.trim(),
            enabled: e.enabled,
            constant: e.constant,
            extensions: e.extensions,
          }
          return e.id ? { ...base, id: e.id } : base
        }),
    }
    if (id) {
      await updateLorebook(id, payload)
      nav(-1)
    } else {
      const b = await createLorebook(payload)
      nav(`/lorebook/${b.id}`, { replace: true })
    }
  }

  if (id && existing === null) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="编辑世界书" back />
        <div className="p-10 text-center text-sm text-[var(--c-text-3)]">世界书不存在或已被删除</div>
      </div>
    )
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title={id ? '编辑世界书' : '新建世界书'}
        back
        right={<NavButton label="从本地文件导入" icon="import" onClick={fileImport.open} />}
      />
      {fileImport.ui}
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <Section>
          <TextField label="名称（必填）" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="例如：雪城地理" />
          <AreaField label="描述" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选" />
        </Section>

        <div className="flex items-end justify-between px-5 pt-7 pb-2">
          <div>
            <div className="eyebrow">Entries</div>
            <div className="serif-zh mt-1 text-[16px] tracking-[0.12em] text-[var(--c-brand)]">条目 · {entries.length}</div>
          </div>
        </div>

        {entries.map((e, i) => (
          <div key={e.id ?? `new-${i}`} className="card mx-3 mb-3 p-3.5">
            <div className="flex items-center gap-2">
              <input
                value={e.name}
                onChange={(ev) => patch(i, { name: ev.target.value })}
                placeholder={`条目 ${i + 1} 的名称`}
                maxLength={40}
                className="flex-1 min-w-0 bg-transparent outline-none text-[15px] border-b border-[var(--c-line)] py-1"
              />
              <button
                aria-label="删除条目"
                onClick={() => setEntries((list) => list.filter((_, j) => j !== i))}
                className="press h-8 w-8 flex items-center justify-center text-[var(--c-text-3)]"
              >
                <Icon name="delete" size="sm" />
              </button>
            </div>
            <input
              value={e.keysText}
              onChange={(ev) => patch(i, { keysText: ev.target.value })}
              placeholder="关键词，用逗号分隔"
              className="mt-2.5 w-full rounded-lg bg-[var(--c-bg-2)] px-3 py-2 text-[13px] outline-none"
            />
            <textarea
              value={e.content}
              rows={4}
              onChange={(ev) => patch(i, { content: ev.target.value })}
              placeholder="正文"
              className="mt-2 w-full resize-none rounded-lg bg-[var(--c-bg-2)] px-3 py-2 text-[14px] leading-relaxed outline-none"
            />
            <div className="mt-2 flex gap-4 text-xs text-[var(--c-text-2)]">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={e.enabled} onChange={(ev) => patch(i, { enabled: ev.target.checked })} />
                启用
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={e.constant} onChange={(ev) => patch(i, { constant: ev.target.checked })} />
                常驻（不依赖关键词）
              </label>
            </div>
          </div>
        ))}

        <button
          onClick={() => setEntries((list) => [...list, blankEntry()])}
          className="press mx-3 w-[calc(100%-1.5rem)] h-11 rounded-2xl border border-dashed border-[var(--c-accent)]/50 text-[14px] text-[var(--c-accent-strong)] flex items-center justify-center gap-1.5"
        >
          <Icon name="plus" size="sm" /> 添加条目
        </button>

        <div className="flex justify-center mt-7">
          <PrimaryButton onClick={() => void save()} disabled={!name.trim() || saving}>
            {id ? '保存修改' : '创建世界书'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
