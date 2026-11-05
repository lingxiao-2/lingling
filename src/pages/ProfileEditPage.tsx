import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { PrimaryButton, Section, TextField } from '../components/ui'
import { setSetting } from '../db/db'
import { useProfileLoaded } from '../store/profile'
import { imageToAvatar } from '../lib/util'

export default function ProfileEditPage() {
  const nav = useNavigate()
  const profile = useProfileLoaded()
  const [nickname, setNickname] = useState('')
  const [signature, setSignature] = useState('')
  const [avatar, setAvatar] = useState<string | undefined>()
  const loaded = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (loaded.current || !profile) return
    loaded.current = true
    setNickname(profile.nickname)
    setSignature(profile.signature)
    setAvatar(profile.avatar)
  }, [profile])

  const pick = async (file?: File) => {
    if (!file) return
    try {
      setAvatar(await imageToAvatar(file))
    } catch {
      alert('图片读取失败，请换一张试试')
    }
  }

  const save = async () => {
    if (!profile) return
    await setSetting('profile', {
      ...profile, nickname: nickname.trim() || '我', signature: signature.trim(), avatar })
    nav(-1)
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="个人资料" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <div className="flex justify-center pt-6">
          <button onClick={() => fileRef.current?.click()} className="press flex flex-col items-center gap-2">
            <Avatar name={nickname || '我'} src={avatar} size="profile" />
            <span className="text-xs text-[var(--c-accent-strong)]">更换头像</span>
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
        <Section>
          <TextField label="昵称" value={nickname} maxLength={20} onChange={(e) => setNickname(e.target.value)} />
          <TextField label="个性签名" value={signature} maxLength={60} onChange={(e) => setSignature(e.target.value)} />
        </Section>
        <div className="flex justify-center mt-6">
          <PrimaryButton onClick={() => void save()}>保存</PrimaryButton>
        </div>
      </div>
    </div>
  )
}
