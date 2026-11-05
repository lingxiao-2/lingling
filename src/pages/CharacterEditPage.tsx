import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { AreaField, PrimaryButton, Section, TextField } from '../components/ui'
import { db } from '../db/db'
import { DEFAULT_WORLD_ID } from '../db/schema'
import type { World } from '../db/schema'
import { createCharacter, updateCharacter } from '../db/repo'
import type { CharacterInput } from '../db/repo'
import { imageToAvatar } from '../lib/util'

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
    })
  }, [existing])

  const set = <K extends keyof CharacterInput>(k: K, v: CharacterInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

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
      <NavBar title={id ? '编辑角色' : '创建角色'} back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <div className="flex justify-center pt-6">
          <button onClick={() => fileRef.current?.click()} className="press flex flex-col items-center gap-2">
            <Avatar name={form.name || '?'} src={form.avatar} size={84} rounded={22} />
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
