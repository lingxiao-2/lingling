/**
 * AI 工具权限：逐个角色管理角色能使用哪些应用（默认全部关闭），以及工具执行记录（可查看、清空）。
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { ConfirmDialog } from '../components/Sheet'
import { Icon } from '../theme/icons'
import { db } from '../db/db'
import type { ToolLog } from '../db/schema'
import { useAIConfig } from '../store/profile'
import { toolCallingSupported } from '../tools/runtime'
import { getPermissions, PERMISSION_INFO, PERMISSIONS_KEY, revokeAll, setMode, type PermissionMode } from '../tools/permissions'
import { TOOL_PERMISSIONS } from '../tools/registry'
import { clearToolLogs } from '../tools/audit'

const MODE_LABEL: Record<PermissionMode, string> = { off: '关闭', ask: '每次询问', always: '始终允许', deny: '禁止' }
const CONFIRM_LABEL: Record<ToolLog['confirmation'], string> = {
  not_required: '无需授权',
  always: '始终允许',
  once: '你允许了本次',
  user_rejected: '你拒绝了',
  denied: '已禁止',
  not_granted: '未授权',
}

const time = (ts: number) => {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 权限变化时重新读取（settings 表变化即刷新） */
function usePermissions(characterId: string) {
  return useLiveQuery(async () => {
    await db.settings.get(PERMISSIONS_KEY)
    return getPermissions(characterId)
  }, [characterId])
}

function ServiceNote() {
  const ai = useAIConfig()
  if (!ai || toolCallingSupported(ai)) return null
  return <p className="mx-4 mt-2 rounded-[14px] bg-white/50 px-4 py-2.5 text-[12px] leading-relaxed text-[var(--c-text-2)]">现在使用的是聆聆默认服务，暂不支持工具调用；改用自己的 API（例如 DeepSeek）后，这里的设置才会生效。</p>
}

function LogList({ characterId }: { characterId?: string }) {
  const logs = useLiveQuery(async () => {
    const all = await db.toolLogs.orderBy('at').reverse().limit(500).toArray()
    return all.filter((l) => !characterId || l.characterId === characterId).slice(0, 100)
  }, [characterId])
  const names = useLiveQuery(async () => new Map((await db.characters.toArray()).map((c) => [c.id, c.name])), [])
  const [clearing, setClearing] = useState(false)
  return (
    <section className="mx-4 mt-4 card px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="serif-zh text-[15px] text-[var(--c-brand)]">执行记录</span>
        {!!logs?.length && <button className="press text-[12.5px] text-[var(--c-danger)]" onClick={() => setClearing(true)}>清空</button>}
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--c-text-3)]">只记录时间、角色、工具、是否确认和结果概要；不记录日记、照片、便签的内容，也不记录 API Key。</p>
      {logs && logs.length === 0 && <p className="mt-2 text-[12.5px] text-[var(--c-text-3)]">还没有记录。</p>}
      {logs?.map((l) => (
        <div key={l.id} className="tool-log mt-2 rounded-[12px] bg-white/45 px-3 py-2 text-[12.5px]">
          <div className="flex justify-between gap-2">
            <span className="text-[var(--c-text)]">{!characterId && `${names?.get(l.characterId) ?? '已删除的角色'} · `}{l.tool}</span>
            <span className={l.status === 'ok' ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-danger)]'}>{l.status === 'ok' ? '成功' : l.status === 'rejected' ? '未执行' : '失败'}</span>
          </div>
          <div className="text-[11px] text-[var(--c-text-3)]">{time(l.at)} · {CONFIRM_LABEL[l.confirmation]}{l.summary ? ` · ${l.summary}` : ''}{l.error ? ` · ${l.error}` : ''}</div>
        </div>
      ))}
      {clearing && (
        <ConfirmDialog
          title="清空执行记录？"
          message="只删除记录，不影响任何便签、日程、日记或权限设置。"
          confirmText="清空"
          danger
          onCancel={() => setClearing(false)}
          onConfirm={() => void clearToolLogs(characterId).then(() => setClearing(false))}
        />
      )}
    </section>
  )
}

export default function AiToolsPage() {
  const nav = useNavigate()
  const chars = useLiveQuery(async () => {
    await db.settings.get(PERMISSIONS_KEY)
    const list = (await db.characters.toArray()).sort((a, b) => a.createdAt - b.createdAt)
    return Promise.all(list.map(async (c) => ({ c, n: Object.values(await getPermissions(c.id)).filter((m) => m === 'ask' || m === 'always').length })))
  }, [])
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="AI 工具权限" back="/me" />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <p className="mx-6 mt-2 text-[12px] leading-relaxed text-[var(--c-text-3)]">
          角色可以在你授权后查看或整理日历、便签、日记、相册和记忆。每个角色单独设置，<b>默认全部关闭</b>；写入、删除和发送私人图片每一次都要你确认；随时可以撤销，立即生效。AI 不能修改这里的设置。
        </p>
        <ServiceNote />
        <section className="mx-4 mt-3 card overflow-hidden">
          {chars?.length === 0 && <p className="px-4 py-3 text-[12.5px] text-[var(--c-text-3)]">还没有角色。</p>}
          {chars?.map(({ c, n }) => (
            <button key={c.id} className="press w-full flex items-center gap-3 px-4 py-2.5 hairline-b last:border-b-0 text-left" onClick={() => nav(`/me/ai-tools/${c.id}`)}>
              <Avatar name={c.name} src={c.avatar} size={36} />
              <span className="flex-1 min-w-0 truncate text-[14px] text-[var(--c-text)]">{c.name}</span>
              <span className="text-[12px] text-[var(--c-text-3)]">{n ? `已开启 ${n} 项` : '全部关闭'}</span>
              <Icon name="forward" size="sm" />
            </button>
          ))}
        </section>
        <LogList />
      </div>
    </div>
  )
}

export function AiToolsCharacterPage() {
  const { charId = '' } = useParams()
  const character = useLiveQuery(() => db.characters.get(charId).then((c) => c ?? null), [charId])
  const perms = usePermissions(charId)
  if (character === null) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="AI 工具权限" back="/me/ai-tools" />
        <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">这个角色已经删除了。</p>
      </div>
    )
  }
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={character ? `${character.name} 的权限` : 'AI 工具权限'} back="/me/ai-tools" />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <ServiceNote />
        <p className="mx-6 mt-2 text-[12px] leading-relaxed text-[var(--c-text-3)]">
          「每次询问」：每次使用前在聊天里问你。「始终允许」：读取不再询问；写入、删除、图片仍然每次确认。「关闭」和「禁止」时角色完全看不到这项能力。
        </p>
        <section className="mx-4 mt-3 card overflow-hidden">
          {TOOL_PERMISSIONS.map((p) => (
            <div key={p} className="px-4 py-3 hairline-b last:border-b-0" data-permission={p}>
              <div className="text-[14px] text-[var(--c-text)]">{PERMISSION_INFO[p].label}</div>
              <div className="text-[11.5px] text-[var(--c-text-3)]">{PERMISSION_INFO[p].hint}</div>
              <div className="mt-2 grid grid-cols-4 gap-1 rounded-full bg-white/50 p-0.5" role="radiogroup" aria-label={PERMISSION_INFO[p].label}>
                {(['off', 'ask', 'always', 'deny'] as const).map((m) => {
                  const on = (perms?.[p] ?? 'off') === m
                  return (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={on}
                      className={`press h-7 rounded-full text-[12px] ${on ? (m === 'deny' ? 'bg-[var(--c-danger)] text-white' : m === 'off' ? 'bg-[#9aa8bd] text-white' : 'bg-[var(--c-accent)] text-white') : 'text-[var(--c-text-2)]'}`}
                      onClick={() => void setMode(charId, p, m)}
                    >
                      {m === 'always' && PERMISSION_INFO[p].write ? '允许·逐次确认' : MODE_LABEL[m]}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
        <button className="press mx-4 mt-3 w-[calc(100%-2rem)] h-10 rounded-full bg-white/55 text-[13.5px] text-[var(--c-danger)]" onClick={() => void revokeAll(charId)}>
          全部关闭
        </button>
        <LogList characterId={charId} />
      </div>
    </div>
  )
}
