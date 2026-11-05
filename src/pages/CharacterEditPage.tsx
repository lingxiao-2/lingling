import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../components/NavBar'
import { useFormImport } from '../import/useFormImport'
import Avatar from '../components/Avatar'
import { AreaField, PrimaryButton, Section, TextField } from '../components/ui'
import { db } from '../db/db'
import { DEFAULT_WORLD_ID } from '../db/schema'
import type { ChatStyle, World } from '../db/schema'
import { CLOSENESS_LABEL, STICKER_LABEL, TONE_LABEL, VERBOSITY_LABEL } from '../services/ai/style'
import { createCharacter, updateCharacter } from '../db/repo'
import type { CharacterInput } from '../db/repo'
import { imageToAvatar } from '../lib/util'

/** 一行可选项：细描边小胶囊 */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="px-4 py-2.5">
      <div className="text-[12px] tracking-wide text-[var(--c-text-2)] mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`press h-7 px-3 rounded-full border text-[12.5px] ${
              value === v ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/10 text-[var(--c-accent-strong)]' : 'border-[var(--c-line)] bg-white/40 text-[var(--c-text-2)]'
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

const EMPTY: CharacterInput = {
  name: '',
  avatar: undefined,
  bio: '',
  personality: '',
  speakingStyle: '',
  backstory: '',
  relationToUser: '',
  greeting: '',
  exampleDialogue: '',
  worldId: DEFAULT_WORLD_ID,
}

export default function CharacterEditPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const existing = useLiveQuery(() => (id ? db.characters.get(id) : undefined), [id])
  const [params] = useSearchParams()
  const worlds = useLiveQuery(
    async () => (await db.worlds.toArray()).filter((w) => w.id !== DEFAULT_WORLD_ID),
    [],
    [] as World[],
  )
  const [form, setForm] = useState<CharacterInput>(() => ({ ...EMPTY, worldId: params.get('world') || DEFAULT_WORLD_ID }))
  const [saving, setSaving] = useState(false)
  const loaded = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /** 从本地文件（角色卡 / 文档）填写表单 */
  const fileImport = useFormImport(
    'character',
    (f) =>
      f.characters.length
        ? `读取到角色「${f.characters[0].name}」${f.characters.length > 1 ? `（文件中共 ${f.characters.length} 个角色，只使用第一个）` : ''}${f.avatar ? '，含头像' : ''}。`
        : '文件中没有角色资料。',
    async (f) => {
      const d = f.characters[0]
      if (!d) return
      let avatar: string | undefined
      if (f.avatar) {
        try {
          avatar = await imageToAvatar(new Blob([f.avatar.bytes as BlobPart], { type: f.avatar.mime }))
        } catch {
          avatar = undefined
        }
      }
      setForm((cur) => ({
        ...cur,
        name: d.name || cur.name,
        avatar: avatar ?? cur.avatar,
        bio: d.bio || cur.bio,
        personality: d.personality || cur.personality,
        speakingStyle: d.speakingStyle || cur.speakingStyle,
        backstory: d.backstory || cur.backstory,
        relationToUser: d.relationToUser || cur.relationToUser,
        greeting: d.greeting || cur.greeting,
        exampleDialogue: d.exampleDialogue || cur.exampleDialogue,
      }))
    },
  )

  useEffect(() => {
    if (loaded.current || !existing) return
    loaded.current = true
    const { name, avatar, bio, personality, speakingStyle, backstory, relationToUser } = existing
    setForm({
      name,
      avatar,
      bio,
      personality,
      speakingStyle,
      backstory,
      relationToUser,
      greeting: existing.greeting ?? '',
      exampleDialogue: existing.exampleDialogue ?? '',
      worldId: existing.worldId,
      chatStyle: existing.chatStyle,
    })
  }, [existing])

  const set = <K extends keyof CharacterInput>(k: K, v: CharacterInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const style: ChatStyle = form.chatStyle ?? {}
  const setStyle = (patch: ChatStyle) => setForm((f) => ({ ...f, chatStyle: { ...(f.chatStyle ?? {}), ...patch } }))

  const pick = async (file?: File) => {
    if (!file) return
    try {
      set('avatar', await imageToAvatar(file))
    } catch {
      alert('图片读取失败，请换一张试试')
    }
  }

  const save = async () => {
    const name = form.name.trim()
    if (!name || saving) return
    setSaving(true)
    const data: CharacterInput = {
      ...form,
      name,
      bio: form.bio.trim(),
      personality: form.personality.trim(),
      speakingStyle: form.speakingStyle.trim(),
      backstory: form.backstory.trim(),
      relationToUser: form.relationToUser.trim(),
      greeting: (form.greeting ?? '').trim(),
      exampleDialogue: (form.exampleDialogue ?? '').trim(),
      worldId: form.worldId || DEFAULT_WORLD_ID,
      chatStyle: form.chatStyle ? { ...form.chatStyle, quirks: (form.chatStyle.quirks ?? '').trim() } : undefined,
    }
    if (id) {
      await updateCharacter(id, data)
      nav(-1)
    } else {
      const c = await createCharacter(data)
      nav(`/character/${c.id}`, { replace: true })
    }
  }

  if (id && existing === undefined && !loaded.current) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="编辑角色" back />
      </div>
    )
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title={id ? '编辑角色' : '创建角色'}
        back
        right={<NavButton label="从本地文件导入" icon="import" onClick={fileImport.open} />}
      />
      {fileImport.ui}
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <div className="flex justify-center pt-6">
          <button onClick={() => fileRef.current?.click()} className="press flex flex-col items-center gap-2">
            <Avatar name={form.name || '?'} src={form.avatar} size="profile" />
            <span className="text-xs text-[var(--c-accent-strong)]">{form.avatar ? '更换头像' : '上传头像'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>

        <Section title="基本信息">
          <TextField label="昵称（必填）" value={form.name} maxLength={20} onChange={(e) => set('name', e.target.value)} placeholder="角色的名字" />
          <AreaField label="角色简介" rows={2} value={form.bio} maxLength={120} onChange={(e) => set('bio', e.target.value)} placeholder="一句话介绍 TA" />
          <TextField label="与你的关系" value={form.relationToUser} maxLength={40} onChange={(e) => set('relationToUser', e.target.value)} placeholder="例如：青梅竹马、同事、旧友" />
          <label className="block px-4 py-3">
            <div className="text-xs text-[var(--c-text-2)] mb-1.5">所属世界</div>
            <select
              value={form.worldId ?? DEFAULT_WORLD_ID}
              onChange={(e) => set('worldId', e.target.value)}
              className="w-full rounded-xl bg-[var(--c-bg-2)] px-3 py-2.5 text-[15px] outline-none border border-transparent focus:border-[var(--c-accent)]"
            >
              <option value={DEFAULT_WORLD_ID}>未归入世界</option>
              {worlds.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-[var(--c-text-3)] mt-1.5 leading-relaxed">一个角色只属于一个世界，可以随时更换。</div>
          </label>
        </Section>

        <Section title="人设">
          <AreaField label="性格设定" rows={3} value={form.personality} onChange={(e) => set('personality', e.target.value)} placeholder="性格、喜好、价值观……" />
          <AreaField label="说话风格" rows={3} value={form.speakingStyle} onChange={(e) => set('speakingStyle', e.target.value)} placeholder="语气、口头禅、用词习惯……" />
          <AreaField label="背景故事" rows={5} value={form.backstory} onChange={(e) => set('backstory', e.target.value)} placeholder="TA 的经历与所处的世界" />
        </Section>

        <Section title="聊天风格（可选）">
          <p className="px-4 pt-3 text-[11.5px] leading-relaxed text-[var(--c-text-3)]">
            只影响 TA 在聊天里怎么说话，不会改动上面的人设；和人设冲突时以人设为准。
          </p>
          <Choice
            label="话量"
            value={style.verbosity ?? 'medium'}
            options={(['low', 'medium', 'high'] as const).map((v) => [v, VERBOSITY_LABEL[v]])}
            onChange={(v) => setStyle({ verbosity: v })}
          />
          <Choice
            label="表达风格"
            value={style.tone ?? ''}
            options={[['', '跟随人设'], ...(['concise', 'lively', 'gentle', 'cool', 'playful'] as const).map((v): ['concise' | 'lively' | 'gentle' | 'cool' | 'playful', string] => [v, TONE_LABEL[v]])]}
            onChange={(v) => setStyle({ tone: v })}
          />
          <Choice
            label="表情包"
            value={style.stickers ?? (existing?.permissions?.useStickers === false ? 'never' : 'sometimes')}
            options={(['never', 'sometimes', 'often'] as const).map((v) => [v, STICKER_LABEL[v]])}
            onChange={(v) => setStyle({ stickers: v })}
          />
          <Choice
            label="亲密程度"
            value={style.closeness ?? 'auto'}
            options={(['auto', 'distant', 'friendly', 'close'] as const).map((v) => [v, CLOSENESS_LABEL[v]])}
            onChange={(v) => setStyle({ closeness: v })}
          />
          <AreaField
            label="语言特点"
            rows={2}
            value={style.quirks ?? ''}
            maxLength={300}
            onChange={(e) => setStyle({ quirks: e.target.value })}
            placeholder="例如：句尾爱加「啦」；不用感叹号；偶尔夹一句日语"
            hint="「亲密程度」选自动时，会结合「与你的关系」和你们实际聊了多久来把握分寸。"
          />
        </Section>

        <Section title="开场白与示例对话">
          <AreaField
            label="开场白"
            rows={2}
            value={form.greeting ?? ''}
            onChange={(e) => set('greeting', e.target.value)}
            placeholder="可选"
            hint="只作为角色设定保存，不会自动写入聊天记录。"
          />
          <AreaField
            label="示例对话"
            rows={4}
            value={form.exampleDialogue ?? ''}
            onChange={(e) => set('exampleDialogue', e.target.value)}
            placeholder="可选，用来示范 TA 的说话方式"
            hint="示例对话不是你们真实的聊天历史，也不会进入记忆。"
          />
        </Section>

        <div className="flex justify-center mt-6">
          <PrimaryButton onClick={() => void save()} disabled={!form.name.trim() || saving}>
            {id ? '保存修改' : '创建角色'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
