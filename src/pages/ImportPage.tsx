import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import NavBar from '../components/NavBar'
import PickerSheet from '../components/PickerSheet'
import WorldCover from '../components/WorldCover'
import type { PickerOption } from '../components/PickerSheet'
import { PrimaryButton } from '../components/ui'
import { db } from '../db/db'
import { saveImport } from '../db/repo'
import type { ImportSummary } from '../db/repo'
import { DEFAULT_WORLD_ID } from '../db/schema'
import type { Character, Lorebook } from '../db/schema'
import { MAX_FILE_BYTES, draftFromSections, fileStem, normalizeName, parseImportFile } from '../import/parse'
import {
  FIELD_LABELS,
  FORMAT_LABELS,
  type CharacterDraft,
  type CharacterFieldKey,
  type ImportFormat,
  type ImportKind,
  type LorebookDraft,
  type SectionTarget,
  type TextSection,
  type WorldDraft,
  emptyWorldDraft,
} from '../import/types'

/* ---------------- 预览状态 ---------------- */

type DupAction = 'skip' | 'create'

interface FileInfo {
  index: number
  fileName: string
  format: ImportFormat
  warnings: string[]
}

interface CharItem {
  key: string
  fileIndex: number
  include: boolean
  dupAction: DupAction
  draft: CharacterDraft
  sections?: TextSection[]
  nameEdited: boolean
  expanded: boolean
}

interface BookItem {
  key: string
  fileIndex: number
  include: boolean
  dupAction: DupAction
  draft: LorebookDraft
  /** 关键词输入框的原始文本（逗号分隔），保存时再拆分 */
  keysText: string[]
  linkNew: string[]
  linkExisting: string[]
  expanded: boolean
}

interface FileError {
  fileName: string
  error: string
}

const EDITABLE_FIELDS: CharacterFieldKey[] = [
  'bio',
  'relationToUser',
  'personality',
  'speakingStyle',
  'backstory',
  'greeting',
  'exampleDialogue',
]

const SECTION_TARGETS: SectionTarget[] = [
  'name',
  'bio',
  'personality',
  'speakingStyle',
  'backstory',
  'relationToUser',
  'greeting',
  'exampleDialogue',
  'ignore',
]

const splitKeys = (s: string) =>
  s
    .split(/[,，、;；]/)
    .map((x) => x.trim())
    .filter(Boolean)

const inputCls =
  'w-full rounded-xl bg-[var(--c-bg-2)] px-3 py-2 text-[15px] outline-none border border-transparent focus:border-[var(--c-accent)] placeholder:text-[var(--c-text-3)]'

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`press shrink-0 h-5 w-5 rounded-full flex items-center justify-center border ${
        on ? 'bg-[var(--c-accent)] border-[var(--c-accent)] text-white' : 'border-[var(--c-text-3)] bg-white'
      }`}
    >
      {on && <Icon name="check" size="xs" stroke="bold" />}
    </button>
  )
}

function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'info' | 'error'; children: ReactNode }) {
  const color =
    tone === 'error'
      ? 'bg-[#fbeceb] text-[var(--c-danger)]'
      : tone === 'info'
        ? 'bg-[var(--c-accent-soft)] text-[var(--c-text-2)]'
        : 'bg-[#f7f1e4] text-[#8a6d3b]'
  return <div className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${color}`}>{children}</div>
}

function DupChooser({
  text,
  value,
  onChange,
}: {
  text: string
  value: DupAction
  onChange: (v: DupAction) => void
}) {
  return (
    <Notice>
      <div className="mb-1.5">{text}</div>
      <div className="flex gap-2">
        {(['skip', 'create'] as const).map((v) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`press px-3 h-7 rounded-full text-xs border ${
              value === v
                ? 'bg-[var(--c-accent)] border-[var(--c-accent)] text-white'
                : 'border-[#d9c9a5] bg-white text-[var(--c-text-2)]'
            }`}
          >
            {v === 'skip' ? '跳过' : '仍然导入为新的一份'}
          </button>
        ))}
      </div>
    </Notice>
  )
}

const KIND_TITLES: Record<ImportKind, string> = {
  character: '导入角色',
  world: '导入世界',
  lorebook: '导入世界书',
}

/* ---------------- 页面 ---------------- */

export default function ImportPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const rawKind = params.get('kind')
  const kind: ImportKind = rawKind === 'lorebook' || rawKind === 'world' ? rawKind : 'character'
  /** 从世界页面进入时，导入的角色与世界书归入这个已有世界 */
  const targetWorldId = kind !== 'world' ? params.get('world') ?? undefined : undefined
  const targetWorld = useLiveQuery(
    async () => (targetWorldId && targetWorldId !== DEFAULT_WORLD_ID ? (await db.worlds.get(targetWorldId)) ?? null : null),
    [targetWorldId],
  )
  const [world, setWorld] = useState<WorldDraft | null>(null)
  const [worldSource, setWorldSource] = useState<{ fileName: string; format: ImportFormat } | null>(null)

  const [stage, setStage] = useState<'pick' | 'reading' | 'preview' | 'saving' | 'done'>('pick')
  const [files, setFiles] = useState<FileInfo[]>([])
  const [errors, setErrors] = useState<FileError[]>([])
  const [chars, setChars] = useState<CharItem[]>([])
  const [books, setBooks] = useState<BookItem[]>([])
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [saveError, setSaveError] = useState('')
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const existingChars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const existingBooks = useLiveQuery(() => db.lorebooks.toArray(), [], [] as Lorebook[])
  const existingCharNames = useMemo(
    () => new Map(existingChars.map((c) => [normalizeName(c.name), c.name])),
    [existingChars],
  )
  const existingBookNames = useMemo(
    () => new Map(existingBooks.map((b) => [normalizeName(b.name), b.name])),
    [existingBooks],
  )

  /* ---- 读取文件 ---- */
  const readFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    setStage('reading')
    const infos: FileInfo[] = []
    const errs: FileError[] = []
    const cs: CharItem[] = []
    const bs: BookItem[] = []
    let foundWorld: WorldDraft | null = null
    let worldSrc: { fileName: string; format: ImportFormat } | null = null

    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_BYTES) {
        errs.push({ fileName: file.name, error: '文件超过 5 MB，暂不支持' })
        continue
      }
      let text: string
      try {
        text = await file.text()
      } catch {
        errs.push({ fileName: file.name, error: '无法读取文件内容' })
        continue
      }
      const r = parseImportFile(file.name, text, kind)
      if (!r.ok) {
        errs.push({ fileName: r.fileName, error: r.error })
        continue
      }
      const fi = infos.length
      const f = r.file
      if (f.world) {
        if (!foundWorld) {
          foundWorld = f.world
          worldSrc = { fileName: f.fileName, format: f.format }
        } else {
          f.warnings.push(`已使用「${worldSrc?.fileName}」中的世界设定，本文件中的世界设定「${f.world.name}」未采用`)
        }
      }
      infos.push({ index: fi, fileName: f.fileName, format: f.format, warnings: f.warnings })
      const charKeys = f.characters.map((draft, i) => {
        const key = `f${fi}c${i}`
        cs.push({
          key,
          fileIndex: fi,
          include: true,
          dupAction: 'skip',
          draft,
          sections: f.sections,
          nameEdited: false,
          expanded: !!f.sections,
        })
        return key
      })
      f.lorebooks.forEach((draft, i) => {
        bs.push({
          key: `f${fi}b${i}`,
          fileIndex: fi,
          include: true,
          dupAction: 'skip',
          draft,
          keysText: draft.entries.map((e) => e.keys.join('，')),
          linkNew: f.links.filter((l) => l.lorebook === i).map((l) => charKeys[l.character]),
          linkExisting: [],
          expanded: false,
        })
      })
    }

    setFiles(infos)
    setErrors(errs)
    setChars(cs)
    setBooks(bs)
    setWorld(kind === 'world' ? foundWorld ?? emptyWorldDraft() : null)
    setWorldSource(worldSrc)
    setSaveError('')
    setStage('preview')
  }

  /* ---- 重名判断（与已有数据，以及本批次中排在前面的项目） ---- */
  const charDup = (item: CharItem): string | null => {
    const n = normalizeName(item.draft.name)
    if (!n) return null
    const hit = existingCharNames.get(n)
    if (hit) return `联系人中已有同名角色「${hit}」`
    const earlier = chars.slice(0, chars.indexOf(item)).find((c) => c.include && normalizeName(c.draft.name) === n)
    return earlier ? `本次导入中有重名角色「${earlier.draft.name}」` : null
  }
  const bookDup = (item: BookItem): string | null => {
    const n = normalizeName(item.draft.name)
    if (!n) return null
    const hit = existingBookNames.get(n)
    if (hit) return `已有同名世界书「${hit}」`
    const earlier = books.slice(0, books.indexOf(item)).find((b) => b.include && normalizeName(b.draft.name) === n)
    return earlier ? `本次导入中有重名世界书「${earlier.draft.name}」` : null
  }

  const charWillSave = (c: CharItem) => c.include && !(charDup(c) && c.dupAction === 'skip')
  const bookWillSave = (b: BookItem) => b.include && !(bookDup(b) && b.dupAction === 'skip')

  const savingChars = chars.filter(charWillSave)
  const savingBooks = books.filter(bookWillSave)
  const missingName = savingChars.some((c) => !c.draft.name.trim())
  const missingWorldName = !!world && !world.name.trim()
  const canSave = !missingName && !missingWorldName && (savingChars.length + savingBooks.length > 0 || !!world)

  /* ---- 更新 ---- */
  const patchChar = (key: string, fn: (c: CharItem) => CharItem) =>
    setChars((list) => list.map((c) => (c.key === key ? fn(c) : c)))
  const patchBook = (key: string, fn: (b: BookItem) => BookItem) =>
    setBooks((list) => list.map((b) => (b.key === key ? fn(b) : b)))

  const updateSections = (item: CharItem, sections: TextSection[]) => {
    const fileName = files[item.fileIndex]?.fileName ?? ''
    const draft = draftFromSections(sections, fileStem(fileName))
    if (item.nameEdited) draft.name = item.draft.name
    patchChar(item.key, (c) => ({ ...c, sections, draft }))
  }

  /* ---- 保存 ---- */
  const save = async () => {
    if (!canSave) return
    setStage('saving')
    setSaveError('')
    try {
      const savingKeys = new Set(savingChars.map((c) => c.key))
      const result = await saveImport(
        savingChars.map((c) => ({
          key: c.key,
          draft: c.draft,
          source: { fileName: files[c.fileIndex].fileName, format: files[c.fileIndex].format },
        })),
        savingBooks.map((b) => ({
          key: b.key,
          draft: {
            ...b.draft,
            entries: b.draft.entries.map((e, i) => ({ ...e, keys: splitKeys(b.keysText[i] ?? '') })),
          },
          source: { fileName: files[b.fileIndex].fileName, format: files[b.fileIndex].format },
          linkNewCharacters: b.linkNew.filter((k) => savingKeys.has(k)),
          linkExistingCharacters: b.linkExisting,
        })),
        world ? { draft: world, source: worldSource ?? undefined } : undefined,
        targetWorld ? targetWorld.id : undefined,
      )
      setSummary(result)
      setStage('done')
    } catch (e) {
      setSaveError(`保存失败，没有写入任何数据：${e instanceof Error ? e.message : String(e)}`)
      setStage('preview')
    }
  }

  const reset = () => {
    setFiles([])
    setErrors([])
    setChars([])
    setBooks([])
    setWorld(null)
    setSummary(null)
    setStage('pick')
  }

  /* ---- 关联选择 ---- */
  const pickerBook = books.find((b) => b.key === pickerFor)
  const pickerOptions: PickerOption[] = [
    ...chars
      .filter(charWillSave)
      .map((c) => ({ id: `new:${c.key}`, name: c.draft.name || '（未命名）', hint: '本次导入的新角色' })),
    ...existingChars.map((c) => ({ id: `old:${c.id}`, name: c.name, avatar: c.avatar, hint: '已有联系人' })),
  ]

  const nameOfNew = (key: string) => chars.find((c) => c.key === key)?.draft.name || '（未命名）'
  const nameOfOld = (id: string) => existingChars.find((c) => c.id === id)?.name ?? '（已删除）'

  /* ================= 渲染 ================= */

  if (stage === 'done' && summary) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="导入完成" back={summary.worldId ? '/contacts?tab=worlds' : '/contacts'} />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center px-8 pt-16 gap-3 text-center">
          <div className="h-14 w-14 rounded-full bg-[var(--c-accent-soft)] flex items-center justify-center text-[var(--c-accent-strong)]">
            <Icon name="check" size="lg" />
          </div>
          <div className="text-lg">已保存到本设备</div>
          <div className="text-sm text-[var(--c-text-2)] leading-relaxed">
            {summary.worldId && <>世界 1 个 · </>}角色 {summary.characters} 个 · 世界书 {summary.lorebooks} 本 · 角色关联{' '}
            {summary.links} 条
          </div>
          <div className="flex flex-col gap-3 mt-6 w-full max-w-xs">
            {summary.worldId ? (
              <PrimaryButton onClick={() => nav(`/world/${summary.worldId}`, { replace: true })}>查看世界</PrimaryButton>
            ) : targetWorld ? (
              <PrimaryButton onClick={() => nav(`/world/${targetWorld.id}`, { replace: true })}>
                返回「{targetWorld.name}」
              </PrimaryButton>
            ) : summary.characters > 0 ? (
              <PrimaryButton onClick={() => nav('/contacts?tab=characters', { replace: true })}>查看角色</PrimaryButton>
            ) : null}
            {!summary.worldId && !targetWorld && summary.lorebooks > 0 && (
              <button
                onClick={() => nav('/contacts?tab=lorebooks', { replace: true })}
                className="press h-11 rounded-full border border-[var(--c-accent)] text-[var(--c-accent-strong)] text-[15px]"
              >
                查看世界书
              </button>
            )}
            <button onClick={reset} className="press h-10 text-sm text-[var(--c-text-2)]">
              继续导入
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (stage === 'pick' || stage === 'reading') {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title={KIND_TITLES[kind]} back />
        <div className="flex-1 min-h-0 overflow-y-auto pb-10">
          {targetWorld ? (
            <div className="mx-4 mt-4 rounded-2xl bg-[var(--c-accent-soft)] px-4 py-3 text-xs leading-relaxed text-[var(--c-text-2)]">
              导入的{kind === 'lorebook' ? '世界书将关联到' : '角色将归入'}世界
              <span className="serif-zh text-[var(--c-brand)]">「{targetWorld.name}」</span>
            </div>
          ) : (
            <div role="tablist" className="flex justify-center gap-10 hairline-b">
              {(['character', 'world', 'lorebook'] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={kind === k}
                  onClick={() => setParams({ kind: k }, { replace: true })}
                  className="press lib-tab"
                >
                  {k === 'character' ? '角色' : k === 'world' ? '世界' : '世界书'}
                </button>
              ))}
            </div>
          )}

          <div className="pt-8 pb-2 text-center">
            <div className="eyebrow">{kind === 'world' ? 'Import a World' : kind === 'lorebook' ? 'Import Lorebooks' : 'Import Characters'}</div>
            <div className="serif-zh mt-2 text-[18px] tracking-[0.14em] text-[var(--c-brand)]">从本地文件导入</div>
          </div>

          <div className="card mx-4 mt-4 p-5 text-sm leading-relaxed text-[var(--c-text-2)]">
            <div className="text-[13px] text-[var(--c-text-3)] tracking-wider mb-2">支持的文件</div>
            {kind === 'world' ? (
              <ul className="list-disc pl-5 space-y-1">
                <li>世界设定 Markdown / TXT：一级标题作为世界名称，其余内容作为设定</li>
                <li>世界设定 JSON（name / 世界名、tagline / 简介、description / 世界观 等字段）</li>
                <li>组合 JSON：{'{ world, characters, lorebooks }'}，一次导入世界、角色与世界书</li>
                <li>可同时选择角色卡和世界书文件，它们会一起归入这个世界</li>
              </ul>
            ) : kind === 'character' ? (
              <ul className="list-disc pl-5 space-y-1">
                <li>SillyTavern 角色卡 JSON（V2，兼容 V1 / V3）；卡内的世界书会一并导入并自动关联</li>
                <li>通用 JSON（name / 昵称 / 性格 / 说话风格 / 背景故事 等字段）</li>
                <li>包含角色和世界书的组合 JSON</li>
                <li>TXT / Markdown：按标题或「性格：」这样的行拆段，在预览中确认字段归属</li>
              </ul>
            ) : (
              <ul className="list-disc pl-5 space-y-1">
                <li>SillyTavern 世界书 JSON（World Info 导出，或角色卡的 character_book）</li>
                <li>包含角色和世界书的组合 JSON</li>
                <li>Markdown：每个「## 标题」成为一个条目，标题即关键词</li>
                <li>TXT：整体作为一个条目</li>
              </ul>
            )}
            <div className="mt-3 text-xs text-[var(--c-text-3)]">
              暂不支持 PNG 图片角色卡，请先在 SillyTavern 中导出为 JSON。可一次选择多个文件，单个文件不超过 5 MB。所有内容会先显示预览，确认后才保存。
            </div>
          </div>

          <div className="flex flex-col items-center mt-8 gap-2">
            <PrimaryButton onClick={() => fileRef.current?.click()} disabled={stage === 'reading'}>
              {stage === 'reading' ? '正在读取…' : '选择文件'}
            </PrimaryButton>
            <div className="text-[11px] text-[var(--c-text-3)]">在 iPhone 上，请在弹出的菜单中选择「选取文件」</div>
          </div>
          {/* 不限制 accept：iOS 会把 .md 等未登记类型置灰，格式在读取后再校验 */}
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void readFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </div>
    )
  }

  /* ---- 预览 ---- */
  const nothing = chars.length === 0 && books.length === 0 && !world

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="导入预览" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-6">
        {world && (
          <div className="mx-3 mt-3 card overflow-hidden">
            <WorldCover name={world.name || '新的世界'} className="h-[120px]">
              <div className="absolute inset-0 cover-shade" />
              <div className="absolute left-4 bottom-3 right-4 text-white">
                <div className="eyebrow" style={{ color: 'rgba(255,255,255,0.78)' }}>
                  New World
                </div>
                <div className="serif-zh mt-1 text-[20px] tracking-[0.16em] truncate">{world.name || '世界的名字'}</div>
              </div>
            </WorldCover>
            <div className="p-3 space-y-3">
              {!worldSource && (
                <Notice tone="info">所选文件中没有世界设定，请为这个世界填写名称，设定可稍后补充。</Notice>
              )}
              {missingWorldName && <Notice tone="error">请填写世界名称</Notice>}
              <label className="block">
                <div className="text-xs text-[var(--c-text-2)] mb-1">世界名称</div>
                <input
                  value={world.name}
                  maxLength={30}
                  onChange={(e) => setWorld({ ...world, name: e.target.value })}
                  placeholder="必填"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <div className="text-xs text-[var(--c-text-2)] mb-1">一句话简介</div>
                <input
                  value={world.tagline}
                  maxLength={60}
                  onChange={(e) => setWorld({ ...world, tagline: e.target.value })}
                  placeholder="未填写"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <div className="text-xs text-[var(--c-text-2)] mb-1">世界设定</div>
                <textarea
                  value={world.description}
                  rows={5}
                  onChange={(e) => setWorld({ ...world, description: e.target.value })}
                  placeholder="未填写"
                  className={`${inputCls} resize-none leading-relaxed text-[14px]`}
                />
              </label>
              {Object.keys(world.extensions).length > 0 && (
                <Notice tone="info">另有无法对应的字段会原样保留在世界的扩展数据中。</Notice>
              )}
              {(chars.length > 0 || books.length > 0) && (
                <div className="text-[11px] text-[var(--c-text-3)] leading-relaxed">
                  下方勾选的角色将归入这个世界，世界书将与这个世界关联。
                </div>
              )}
            </div>
          </div>
        )}
        {errors.length > 0 && (
          <div className="mx-3 mt-3 card p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-sm text-[var(--c-danger)]">
              <Icon name="alert" size="sm" /> {errors.length} 个文件无法导入
            </div>
            {errors.map((e, i) => (
              <div key={i} className="text-xs leading-relaxed">
                <div className="font-medium truncate">{e.fileName}</div>
                <div className="text-[var(--c-text-2)]">{e.error}</div>
              </div>
            ))}
          </div>
        )}

        {nothing && (
          <div className="py-12 text-center text-sm text-[var(--c-text-3)]">没有可以导入的内容</div>
        )}

        {files.map((f) => (
          <section key={f.index} className="mx-3 mt-4">
            <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-[var(--c-text-3)]">
              <Icon name="file" size="xs" />
              <span className="truncate">{f.fileName}</span>
              <span className="shrink-0">· {FORMAT_LABELS[f.format]}</span>
            </div>
            {f.warnings.length > 0 && (
              <div className="mb-2">
                <Notice>
                  {f.warnings.map((w, i) => (
                    <div key={i}>· {w}</div>
                  ))}
                </Notice>
              </div>
            )}

            {chars
              .filter((c) => c.fileIndex === f.index)
              .map((c) => {
                const dup = charDup(c)
                const linkedBooks = books.filter((b) => b.include && b.linkNew.includes(c.key))
                const extKeys = Object.keys(c.draft.extensions)
                return (
                  <div key={c.key} className={`card p-3 mb-3 ${c.include ? '' : 'opacity-55'}`}>
                    <div className="flex items-center gap-2.5">
                      <Toggle
                        on={c.include}
                        label="导入这个角色"
                        onClick={() => patchChar(c.key, (x) => ({ ...x, include: !x.include }))}
                      />
                      <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-[var(--c-accent-soft)] text-[var(--c-accent-strong)]">
                        角色
                      </span>
                      <input
                        value={c.draft.name}
                        onChange={(e) =>
                          patchChar(c.key, (x) => ({ ...x, nameEdited: true, draft: { ...x.draft, name: e.target.value } }))
                        }
                        placeholder="角色名称（必填）"
                        maxLength={40}
                        className="flex-1 min-w-0 bg-transparent outline-none text-[16px] border-b border-[var(--c-line)] py-1"
                      />
                      <button
                        aria-label={c.expanded ? '收起' : '展开'}
                        onClick={() => patchChar(c.key, (x) => ({ ...x, expanded: !x.expanded }))}
                        className="press h-8 w-8 flex items-center justify-center text-[var(--c-text-3)]"
                      >
                        <Icon name={c.expanded ? 'collapse' : 'expand'} size="md" />
                      </button>
                    </div>

                    <div className="mt-2 space-y-2">
                      {c.include && !c.draft.name.trim() && <Notice tone="error">请填写角色名称</Notice>}
                      {c.include && dup && (
                        <DupChooser
                          text={dup}
                          value={c.dupAction}
                          onChange={(v) => patchChar(c.key, (x) => ({ ...x, dupAction: v }))}
                        />
                      )}
                      {!c.expanded && (
                        <div className="text-xs text-[var(--c-text-3)] line-clamp-2">
                          {c.draft.bio || c.draft.personality || c.draft.backstory || '（没有设定内容）'}
                        </div>
                      )}
                      {linkedBooks.length > 0 && (
                        <div className="text-xs text-[var(--c-text-2)] flex items-center gap-1">
                          <Icon name="link" size="xs" /> 将关联世界书：{linkedBooks.map((b) => b.draft.name).join('、')}
                        </div>
                      )}
                    </div>

                    {c.expanded && c.sections && (
                      <div className="mt-3 space-y-3">
                        <Notice tone="info">
                          TXT / Markdown 不会自动猜测内容含义。请为每一段选择它属于哪个字段，选「忽略」则不保存该段。
                        </Notice>
                        {c.sections.map((s, si) => (
                          <div key={si} className="rounded-xl bg-[var(--c-bg-2)] p-2.5">
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-xs text-[var(--c-text-3)] truncate">{s.label || `段落 ${si + 1}`}</span>
                              <select
                                value={s.target}
                                onChange={(e) =>
                                  updateSections(
                                    c,
                                    c.sections!.map((x, i) => (i === si ? { ...x, target: e.target.value as SectionTarget } : x)),
                                  )
                                }
                                className="text-xs rounded-lg bg-white px-2 py-1 border border-[var(--c-line)]"
                              >
                                {SECTION_TARGETS.map((t) => (
                                  <option key={t} value={t}>
                                    {t === 'ignore' ? '忽略' : FIELD_LABELS[t]}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <textarea
                              value={s.text}
                              rows={Math.min(6, Math.max(2, s.text.split('\n').length))}
                              onChange={(e) =>
                                updateSections(
                                  c,
                                  c.sections!.map((x, i) => (i === si ? { ...x, text: e.target.value } : x)),
                                )
                              }
                              className="w-full resize-none bg-transparent outline-none text-[14px] leading-relaxed"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {c.expanded && !c.sections && (
                      <div className="mt-3 space-y-3">
                        {EDITABLE_FIELDS.map((k) => (
                          <label key={k} className="block">
                            <div className="text-xs text-[var(--c-text-2)] mb-1">{FIELD_LABELS[k]}</div>
                            <textarea
                              value={c.draft[k]}
                              rows={k === 'bio' || k === 'relationToUser' ? 1 : 3}
                              onChange={(e) =>
                                patchChar(c.key, (x) => ({ ...x, draft: { ...x.draft, [k]: e.target.value } }))
                              }
                              placeholder="未填写"
                              className={`${inputCls} resize-none leading-relaxed text-[14px]`}
                            />
                          </label>
                        ))}
                        {extKeys.length > 0 && (
                          <Notice tone="info">
                            另有 {extKeys.length} 组无法对应的字段会原样保留在角色的扩展数据中（
                            {extKeys
                              .flatMap((k) => {
                                const v = c.draft.extensions[k]
                                return v && typeof v === 'object' ? Object.keys(v as object) : [k]
                              })
                              .slice(0, 8)
                              .join('、')}
                            …）
                          </Notice>
                        )}
                      </div>
                    )}

                    {(c.draft.greeting || c.draft.exampleDialogue) && (
                      <div className="mt-2 text-[11px] text-[var(--c-text-3)] leading-relaxed">
                        开场白和示例对话只作为角色设定保存，不会写入聊天记录。
                      </div>
                    )}
                  </div>
                )
              })}

            {books
              .filter((b) => b.fileIndex === f.index)
              .map((b) => {
                const dup = bookDup(b)
                const shown = b.draft.entries.slice(0, 60)
                return (
                  <div key={b.key} className={`card p-3 mb-3 ${b.include ? '' : 'opacity-55'}`}>
                    <div className="flex items-center gap-2.5">
                      <Toggle
                        on={b.include}
                        label="导入这本世界书"
                        onClick={() => patchBook(b.key, (x) => ({ ...x, include: !x.include }))}
                      />
                      <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-[#eef0f7] text-[#62708e]">
                        世界书
                      </span>
                      <input
                        value={b.draft.name}
                        onChange={(e) => patchBook(b.key, (x) => ({ ...x, draft: { ...x.draft, name: e.target.value } }))}
                        placeholder="世界书名称"
                        maxLength={40}
                        className="flex-1 min-w-0 bg-transparent outline-none text-[16px] border-b border-[var(--c-line)] py-1"
                      />
                      <button
                        aria-label={b.expanded ? '收起' : '展开'}
                        onClick={() => patchBook(b.key, (x) => ({ ...x, expanded: !x.expanded }))}
                        className="press h-8 w-8 flex items-center justify-center text-[var(--c-text-3)]"
                      >
                        <Icon name={b.expanded ? 'collapse' : 'expand'} size="md" />
                      </button>
                    </div>

                    <div className="mt-2 space-y-2">
                      <div className="text-xs text-[var(--c-text-3)]">{b.draft.entries.length} 个条目</div>
                      {b.include && dup && (
                        <DupChooser
                          text={dup}
                          value={b.dupAction}
                          onChange={(v) => patchBook(b.key, (x) => ({ ...x, dupAction: v }))}
                        />
                      )}

                      <div className="rounded-xl bg-[var(--c-bg-2)] p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--c-text-2)]">关联到联系人</span>
                          <button
                            onClick={() => setPickerFor(b.key)}
                            className="press text-xs text-[var(--c-accent-strong)] px-1"
                          >
                            选择
                          </button>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {b.linkNew.length + b.linkExisting.length === 0 && (
                            <span className="text-xs text-[var(--c-text-3)]">暂不关联</span>
                          )}
                          {b.linkNew.map((k) => (
                            <span key={k} className="text-xs px-2 py-0.5 rounded-full bg-white border border-[var(--c-line)]">
                              {nameOfNew(k)}
                              <span className="text-[var(--c-text-3)]"> · 新</span>
                            </span>
                          ))}
                          {b.linkExisting.map((id) => (
                            <span key={id} className="text-xs px-2 py-0.5 rounded-full bg-white border border-[var(--c-line)]">
                              {nameOfOld(id)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {b.expanded && (
                      <div className="mt-3 space-y-3">
                        <label className="block">
                          <div className="text-xs text-[var(--c-text-2)] mb-1">描述</div>
                          <textarea
                            value={b.draft.description}
                            rows={2}
                            onChange={(e) =>
                              patchBook(b.key, (x) => ({ ...x, draft: { ...x.draft, description: e.target.value } }))
                            }
                            placeholder="未填写"
                            className={`${inputCls} resize-none text-[14px]`}
                          />
                        </label>
                        {shown.map((e, i) => (
                          <div key={i} className="rounded-xl bg-[var(--c-bg-2)] p-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-medium truncate flex-1">{e.name}</span>
                              {e.constant && <span className="text-[10px] text-[var(--c-accent-strong)]">常驻</span>}
                              {!e.enabled && <span className="text-[10px] text-[var(--c-text-3)]">已停用</span>}
                            </div>
                            <input
                              value={b.keysText[i] ?? ''}
                              onChange={(ev) =>
                                patchBook(b.key, (x) => ({
                                  ...x,
                                  keysText: x.keysText.map((t, j) => (j === i ? ev.target.value : t)),
                                }))
                              }
                              placeholder="关键词，用逗号分隔"
                              className="mt-1.5 w-full rounded-lg bg-white px-2 py-1 text-xs outline-none border border-[var(--c-line)]"
                            />
                            <div className="mt-1.5 text-xs text-[var(--c-text-2)] whitespace-pre-wrap break-words line-clamp-4">
                              {e.content || '（无正文）'}
                            </div>
                          </div>
                        ))}
                        {b.draft.entries.length > shown.length && (
                          <div className="text-center text-xs text-[var(--c-text-3)]">
                            还有 {b.draft.entries.length - shown.length} 个条目，导入后可在世界书中查看
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
          </section>
        ))}

        <div className="mx-6 mt-2 text-[11px] text-[var(--c-text-3)] leading-relaxed">
          世界、角色、世界书与聊天记录分开保存，只通过关联相连。当前版本尚未接入 AI，世界设定和世界书暂时不会影响对话。
        </div>
      </div>

      <footer
        className="glass hairline-t shrink-0 px-4 pt-2.5"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 10px)' }}
      >
        {saveError && <div className="mb-2 text-xs text-[var(--c-danger)]">{saveError}</div>}
        {missingName && <div className="mb-2 text-xs text-[var(--c-danger)]">还有角色没有填写名称</div>}
        <div className="flex items-center gap-3">
          <div className="flex-1 text-xs text-[var(--c-text-2)]">
            将导入{world ? '世界 1 个、' : ''}角色 {savingChars.length} 个、世界书 {savingBooks.length} 本
          </div>
          <button onClick={reset} className="press text-sm text-[var(--c-text-2)] px-2">
            重选
          </button>
          <PrimaryButton
            onClick={() => void save()}
            disabled={stage === 'saving' || !canSave}
          >
            {stage === 'saving' ? '保存中…' : '确认导入'}
          </PrimaryButton>
        </div>
      </footer>

      {pickerBook && (
        <PickerSheet
          title="关联到联系人"
          options={pickerOptions}
          initial={[...pickerBook.linkNew.map((k) => `new:${k}`), ...pickerBook.linkExisting.map((id) => `old:${id}`)]}
          emptyText="还没有可关联的联系人"
          onClose={() => setPickerFor(null)}
          onConfirm={(ids) =>
            patchBook(pickerBook.key, (x) => ({
              ...x,
              linkNew: ids.filter((i) => i.startsWith('new:')).map((i) => i.slice(4)),
              linkExisting: ids.filter((i) => i.startsWith('old:')).map((i) => i.slice(4)),
            }))
          }
        />
      )}
    </div>
  )
}
