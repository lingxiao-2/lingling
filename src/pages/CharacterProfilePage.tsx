import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil } from 'lucide-react'
import NavBar, { NavButton } from '../components/NavBar'
import Avatar from '../components/Avatar'
import { ConfirmDialog } from '../components/Sheet'
import { PrimaryButton, Section } from '../components/ui'
import { db } from '../db/db'
import { deleteCharacter, getOrCreateSingleConversation } from '../db/repo'

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="px-4 py-3 hairline-b last:border-b-0">
      <div className="text-xs text-[var(--c-text-3)] mb-1">{label}</div>
      <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
        {text || <span className="text-[var(--c-text-3)]">未填写</span>}
      </div>
    </div>
  )
}

export default function CharacterProfilePage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const c = useLiveQuery(() => db.characters.get(id), [id])
  const [confirmDel, setConfirmDel] = useState(false)

  const chat = async () => {
    const convId = await getOrCreateSingleConversation(id)
    nav(`/chat/${convId}`)
  }

  if (!c) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="角色资料" back />
        <div className="p-10 text-center text-sm text-[var(--c-text-3)]">
          {c === undefined ? '加载中…' : '角色不存在'}
        </div>
      </div>
    )
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title="角色资料"
        back
        right={
          <NavButton label="编辑" onClick={() => nav(`/character/${id}/edit`)}>
            <Pencil size={20} strokeWidth={1.5} />
          </NavButton>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <div className="flex flex-col items-center pt-6 pb-2 gap-2">
          <Avatar name={c.name} src={c.avatar} size={88} rounded={24} />
          <div className="text-xl font-medium">{c.name}</div>
          {c.bio && <div className="px-10 text-center text-sm text-[var(--c-text-2)]">{c.bio}</div>}
        </div>

        <Section title="设定">
          <Block label="与你的关系" text={c.relationToUser} />
          <Block label="性格设定" text={c.personality} />
          <Block label="说话风格" text={c.speakingStyle} />
          <Block label="背景故事" text={c.backstory} />
        </Section>

        <div className="flex justify-center mt-6">
          <PrimaryButton onClick={() => void chat()}>发消息</PrimaryButton>
        </div>
        <div className="flex justify-center mt-4">
          <button onClick={() => setConfirmDel(true)} className="press text-sm text-[var(--c-danger)] px-4 py-2">
            删除角色
          </button>
        </div>
      </div>

      {confirmDel && (
        <ConfirmDialog
          title={`删除「${c.name}」？`}
          message="该角色、与 TA 的聊天记录和相关记忆都会被永久删除，无法恢复。"
          confirmText="删除"
          danger
          onCancel={() => setConfirmDel(false)}
          onConfirm={async () => {
            await deleteCharacter(id)
            nav('/contacts', { replace: true })
          }}
        />
      )}
    </div>
  )
}
