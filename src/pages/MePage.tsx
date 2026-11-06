import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import Brand from '../components/Brand'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { Row } from '../components/ui'
import { configProblem } from '../services/ai/openai'
import { db } from '../db/db'
import { updateProfile, useAIConfig, useProfile } from '../store/profile'
import { imageToAvatar } from '../lib/util'

/** 分组：英文小字标题 + 轻薄毛玻璃列表 */
function Group({ en, children }: { en: string; children: ReactNode }) {
  return (
    <section className="mx-4 mt-5">
      <div className="eyebrow px-1 pb-1.5">{en}</div>
      <div className="glass rounded-[var(--radius-card)] overflow-hidden">{children}</div>
    </section>
  )
}

export default function MePage() {
  const nav = useNavigate()
  const profile = useProfile()
  const ai = useAIConfig()
  const fileRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)

  /** 直接在「我的」页更换头像：压缩为 256px，保存在本设备 */
  const pickAvatar = async (file?: File) => {
    if (!file) return
    setAvatarBusy(true)
    try {
      await updateProfile({ avatar: await imageToAvatar(file) })
    } catch {
      alert('图片读取失败，请换一张试试')
    } finally {
      setAvatarBusy(false)
    }
  }
  const stats = useLiveQuery(
    async () => ({
      characters: await db.characters.count(),
      worlds: Math.max(0, (await db.worlds.count()) - 1),
      lorebooks: await db.lorebooks.count(),
      messages: await db.messages.filter((m) => !m.deleted).count(),
    }),
    [],
    { characters: 0, worlds: 0, lorebooks: 0, messages: 0 },
  )

  return (
    <>
      <NavBar title="我的" />
      <div className="flex-1 min-h-0 overflow-y-auto pb-8">
        {/* 个人资料：不用大卡片，头像 + 衬线名字 + 签名 */}
        <div className="flex items-center gap-3.5 px-6 pt-5 pb-2">
          <button
            aria-label="更换头像"
            onClick={() => fileRef.current?.click()}
            disabled={avatarBusy}
            className="press relative shrink-0"
          >
            <Avatar name={profile.nickname} src={profile.avatar} size={52} />
            <span className="absolute -right-0.5 -bottom-0.5 h-[18px] w-[18px] rounded-full bg-white/90 border border-[var(--c-line)] flex items-center justify-center text-[var(--c-accent-strong)]">
              <Icon name="camera" size="xs" />
            </span>
          </button>
          <button onClick={() => nav('/me/profile')} className="press flex-1 min-w-0 flex items-center gap-2 text-left">
            <div className="flex-1 min-w-0">
              <div className="serif-zh text-[19px] tracking-[0.06em] text-[var(--c-brand)] truncate">{profile.nickname}</div>
              <div className="mt-0.5 text-[12.5px] text-[var(--c-text-3)] truncate">
                {avatarBusy ? '正在更换头像…' : profile.signature || '写一句签名吧'}
              </div>
            </div>
            <Icon name="forward" size="sm" className="text-[var(--c-text-3)]" />
          </button>
          {/* iPhone 上会提供「照片图库 / 拍照 / 选取文件」 */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void pickAvatar(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>

        <div className="mx-6 mt-3 flex justify-between text-center">
          {[
            ['角色', stats.characters],
            ['世界', stats.worlds],
            ['世界书', stats.lorebooks],
            ['消息', stats.messages],
          ].map(([label, n]) => (
            <div key={label as string} className="flex-1">
              <div className="serif-zh text-[17px] text-[var(--c-text)]">{n}</div>
              <div className="mt-0.5 text-[11px] text-[var(--c-text-3)] tracking-wider">{label}</div>
            </div>
          ))}
        </div>

        <Group en="Appearance">
          <Row icon="theme" label="主题与壁纸" value="冬日来信" onClick={() => nav('/me/theme')} right={<Icon name="forward" size="sm" />} />
          <Row icon="emoji" label="表情包与识图" onClick={() => nav('/me/stickers')} right={<Icon name="forward" size="sm" />} />
        </Group>

        <Group en="AI">
          <Row
            icon="key"
            label="AI 服务"
            value={
              ai.service === 'lingling'
                ? configProblem(ai)
                  ? '默认服务 · 未开通'
                  : '聆聆默认服务'
                : configProblem(ai)
                  ? '自己的 API · 未配置'
                  : `自己的 API · ${ai.model}`
            }
            onClick={() => nav('/me/api')}
            right={<Icon name="forward" size="sm" />}
          />
        </Group>

        <Group en="Data">
          <Row icon="backup" label="备份与恢复" value=".lingling 文件" onClick={() => nav('/me/backup')} right={<Icon name="forward" size="sm" />} />
          <Row icon="data" label="数据存储" value="仅本设备浏览器" />
          <Row icon="info" label="聆聆 AI" value="V0.1" />
        </Group>

        <p className="mx-7 mt-4 text-[11px] leading-relaxed text-[var(--c-text-3)]">
          所有数据保存在当前浏览器的本地存储中。清除 Safari 网站数据或更换设备会导致数据丢失，请在「备份与恢复」中定期导出。
        </p>

        {/* 品牌标识放在这里，消息页顶部不再放大标题 */}
        <div className="mt-8 mb-4 flex justify-center opacity-80">
          <Brand />
        </div>
      </div>
    </>
  )
}
