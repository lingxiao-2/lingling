/**
 * 生活应用的 AI 权限：为第六阶段准备的授权开关（默认全部关闭），以及等待确认的草稿。
 * 目前没有任何 AI 使用这些权限。
 */
import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { confirmDraft, DEFAULT_POLICY, getPolicy, listDrafts, rejectDraft, setPolicy, type LifeAccessPolicy, type LifeDraft } from '../life/service'

const ITEMS: { key: keyof Omit<LifeAccessPolicy, 'version'>; label: string; hint: string }[] = [
  { key: 'diary', label: '读取日记', hint: '只包括你在日记里逐篇勾选了「允许 AI 读取」的那些' },
  { key: 'notes', label: '读取便签', hint: '最近删除的便签不会被读取' },
  { key: 'calendar', label: '读取日历', hint: '日程、重复事件和纪念日' },
  { key: 'album', label: '读取相册信息', hint: '只有照片名称、备注和日期，不包含图片本身' },
  { key: 'noteDrafts', label: '创建便签草稿', hint: '只能创建草稿，你在下面确认后才会保存' },
  { key: 'eventDrafts', label: '创建日程草稿', hint: '只能创建草稿，你在下面确认后才会保存' },
]

export default function LifeAccessPage() {
  const [policy, setP] = useState<LifeAccessPolicy>(DEFAULT_POLICY)
  const [drafts, setDrafts] = useState<LifeDraft[]>([])
  const [msg, setMsg] = useState('')
  const reload = () => void Promise.all([getPolicy(), listDrafts()]).then(([p, d]) => { setP(p); setDrafts(d) })
  useEffect(reload, [])

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="生活应用的 AI 权限" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <p className="mx-6 mt-2 text-[12px] leading-relaxed text-[var(--c-text-3)]">
          以后的版本里，角色可以在你授权后使用相册、日记、便签和日历。这些开关默认全部关闭；<b>目前还没有任何 AI 会读取或修改这些数据</b>。
        </p>
        <section className="mx-4 mt-3 card overflow-hidden">
          {ITEMS.map((it) => (
            <label key={it.key} className="flex items-start justify-between gap-3 px-4 py-3 hairline-b last:border-b-0">
              <span>
                <span className="block text-[14px] text-[var(--c-text)]">{it.label}</span>
                <span className="block text-[11.5px] text-[var(--c-text-3)]">{it.hint}</span>
              </span>
              <input type="checkbox" className="mt-1" checked={policy[it.key]} onChange={(e) => void setPolicy({ [it.key]: e.target.checked }).then(setP)} />
            </label>
          ))}
        </section>
        <section className="mx-4 mt-4 card px-4 py-3">
          <div className="serif-zh text-[15px] text-[var(--c-brand)]">等待确认的草稿</div>
          {drafts.length === 0 && <p className="mt-1 text-[12.5px] text-[var(--c-text-3)]">没有。以后角色创建的便签或日程草稿会出现在这里，确认后才会保存。</p>}
          {drafts.map((d) => (
            <div key={d.id} className="mt-2 rounded-[12px] bg-white/45 px-3 py-2 text-[13px]">
              <div className="text-[var(--c-text)]">{d.type === 'note' ? '便签' : '日程'}：{d.type === 'note' ? d.note?.title || d.note?.text.slice(0, 30) || d.note?.items.map((i) => i.text).join('、') : `${d.event?.title}（${d.event?.date}${d.event?.startTime ? ` ${d.event.startTime}` : ''}）`}</div>
              <div className="text-[11px] text-[var(--c-text-3)]">由 {d.proposedBy} 提出</div>
              <div className="mt-1.5 flex gap-4">
                <button className="press text-[var(--c-accent-strong)]" onClick={() => void confirmDraft(d.id).then(() => { setMsg('已保存'); reload() }, (e) => setMsg(String(e?.message ?? e)))}>确认保存</button>
                <button className="press text-[var(--c-text-3)]" onClick={() => void rejectDraft(d.id).then(reload)}>不要</button>
              </div>
            </div>
          ))}
          {msg && <p className="mt-1.5 text-[12px] text-[var(--c-accent-strong)]">{msg}</p>}
        </section>
      </div>
    </div>
  )
}
