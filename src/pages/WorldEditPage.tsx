import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import NavBar from '../components/NavBar'
import WorldCover from '../components/WorldCover'
import { AreaField, PrimaryButton, Section, TextField } from '../components/ui'
import { db } from '../db/db'
import { createWorld, updateWorld } from '../db/repo'
import type { WorldInput } from '../db/repo'
import { imageToCover } from '../lib/util'

export default function WorldEditPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const existing = useLiveQuery(async () => (id ? (await db.worlds.get(id)) ?? null : null), [id])
  const [form, setForm] = useState<WorldInput>({ name: '', tagline: '', description: '' })
  const [saving, setSaving] = useState(false)
  const loaded = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (loaded.current || !existing) return
    loaded.current = true
    setForm({
      name: existing.name,
      tagline: existing.tagline ?? '',
      description: existing.description,
      cover: existing.cover,
    })
  }, [existing])

  const set = <K extends keyof WorldInput>(k: K, v: WorldInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const pick = async (file?: File) => {
    if (!file) return
    try {
      set('cover', await imageToCover(file))
    } catch {
      alert('图片读取失败，请换一张试试')
    }
  }

  const save = async () => {
    if (!form.name.trim() || saving) return
    setSaving(true)
    if (id) {
      await updateWorld(id, form)
      nav(-1)
    } else {
      const w = await createWorld(form)
      nav(`/world/${w.id}`, { replace: true })
    }
  }

  if (id && existing === null) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="编辑世界" back />
        <div className="p-10 text-center text-sm text-[var(--c-text-3)]">世界不存在或已被删除</div>
      </div>
    )
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={id ? '编辑世界' : '新建世界'} back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <div className="px-4 pt-4">
          <button onClick={() => fileRef.current?.click()} className="press block w-full">
            <WorldCover name={form.name || '新的世界'} cover={form.cover} className="h-[176px] rounded-[22px]">
              <div className="absolute inset-0 cover-shade" />
              <div className="absolute left-5 bottom-4 right-5 text-left text-white">
                <div className="serif-zh text-[22px] tracking-[0.16em] truncate">{form.name || '世界的名字'}</div>
                <div className="mt-1 text-[12px] text-white/85 truncate">{form.tagline || '一句话写下它的气质'}</div>
              </div>
              <span className="absolute top-3 right-3 h-8 px-3 rounded-full bg-white/70 backdrop-blur text-[12px] text-[var(--c-brand)] flex items-center gap-1.5">
                <Icon name="image" size="xs" /> {form.cover ? '更换封面' : '上传封面'}
              </span>
            </WorldCover>
          </button>
          {form.cover && (
            <div className="mt-2 text-right">
              <button onClick={() => set('cover', undefined)} className="press text-xs text-[var(--c-text-3)] px-1">
                移除封面，使用默认插画
              </button>
            </div>
          )}
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

        <Section>
          <TextField label="世界名称（必填）" value={form.name} maxLength={30} onChange={(e) => set('name', e.target.value)} placeholder="例如：雪城" />
          <TextField label="一句话简介" value={form.tagline} maxLength={60} onChange={(e) => set('tagline', e.target.value)} placeholder="例如：永远在下雪的北方之城" />
          <AreaField
            label="世界设定"
            rows={10}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="地理、历史、规则、氛围……"
            hint="世界设定与角色人设、世界书分开保存。居民角色和世界书可在世界页面中关联。"
          />
        </Section>

        <div className="flex justify-center mt-6">
          <PrimaryButton onClick={() => void save()} disabled={!form.name.trim() || saving}>
            {id ? '保存修改' : '创建世界'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
