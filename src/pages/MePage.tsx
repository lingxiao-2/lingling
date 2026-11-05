import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Icon } from '../theme/icons'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { Row, Section } from '../components/ui'
import { db } from '../db/db'
import { useAIConfig, useProfile } from '../store/profile'

export default function MePage() {
  const nav = useNavigate()
  const profile = useProfile()
  const ai = useAIConfig()
  const stats = useLiveQuery(async () => ({
    characters: await db.characters.count(),
    conversations: await db.conversations.count(),
    messages: await db.messages.filter((m) => !m.deleted).count(),
  }), [], { characters: 0, conversations: 0, messages: 0 })

  return (
    <>
      <NavBar title="我的" />
      <div className="flex-1 min-h-0 overflow-y-auto pb-8">
        <button
          onClick={() => nav('/me/profile')}
          className="press card mx-3 mt-3 w-[calc(100%-1.5rem)] p-4 flex items-center gap-4 text-left"
        >
          <Avatar name={profile.nickname} src={profile.avatar} size={56} />
          <div className="flex-1 min-w-0">
            <div className="text-lg font-medium truncate">{profile.nickname}</div>
            <div className="text-sm text-[var(--c-text-3)] truncate">{profile.signature || '写一句签名吧'}</div>
          </div>
          <Icon name="forward" size="sm" className="text-[var(--c-text-3)]" />
        </button>

        <Section title="外观">
          <Row
            label="主题与壁纸"
            onClick={() => nav('/me/theme')}
            value="冬日来信"
            right={<Icon name="forward" size="sm" />}
          />
        </Section>

        <Section title="AI 服务">
          <Row
            label="API 设置"
            onClick={() => nav('/me/api')}
            value={ai.apiKey ? ai.model : '未配置'}
            right={<Icon name="forward" size="sm" />}
          />
        </Section>

        <Section title="数据管理">
          <Row label="角色" value={stats.characters} />
          <Row label="会话" value={stats.conversations} />
          <Row label="消息" value={stats.messages} />
          <Row label="备份与恢复（.lingling）" value="V0.3 开放" />
        </Section>

        <Section title="关于">
          <Row label="聆聆 AI" value="V0.1 · 第一轮基础工程" />
          <Row label="数据存储" value="仅保存在本设备浏览器" />
        </Section>
        <p className="mx-6 mt-4 text-[11px] leading-relaxed text-[var(--c-text-3)]">
          所有数据保存在当前浏览器的本地存储中。清除 Safari 网站数据或更换设备会导致数据丢失，完整备份功能将在后续版本提供。
        </p>
      </div>
    </>
  )
}
