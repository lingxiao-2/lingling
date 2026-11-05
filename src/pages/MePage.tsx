import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { Row } from '../components/ui'
import { db } from '../db/db'
import { useAIConfig, useProfile } from '../store/profile'

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
        <button onClick={() => nav('/me/profile')} className="press w-full flex items-center gap-3.5 px-6 pt-5 pb-2 text-left">
          <Avatar name={profile.nickname} src={profile.avatar} size={52} />
          <div className="flex-1 min-w-0">
            <div className="serif-zh text-[19px] tracking-[0.06em] text-[var(--c-brand)] truncate">{profile.nickname}</div>
            <div className="mt-0.5 text-[12.5px] text-[var(--c-text-3)] truncate">{profile.signature || '写一句签名吧'}</div>
          </div>
          <Icon name="forward" size="sm" className="text-[var(--c-text-3)]" />
        </button>

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
        </Group>

        <Group en="AI">
          <Row icon="key" label="API 设置" value={ai.apiKey ? ai.model : '未配置'} onClick={() => nav('/me/api')} right={<Icon name="forward" size="sm" />} />
        </Group>

        <Group en="Data">
          <Row icon="backup" label="备份与恢复（.lingling）" value="V0.3 开放" />
          <Row icon="data" label="数据存储" value="仅本设备浏览器" />
          <Row icon="info" label="聆聆 AI" value="V0.1" />
        </Group>

        <p className="mx-7 mt-4 text-[11px] leading-relaxed text-[var(--c-text-3)]">
          所有数据保存在当前浏览器的本地存储中。清除 Safari 网站数据或更换设备会导致数据丢失，完整备份功能将在后续版本提供。
        </p>
      </div>
    </>
  )
}
