/**
 * 日程编辑：标题、类型（日程 / 纪念日 / 生日）、全天、日期与时间、重复、地点、备注；
 * 纪念日 / 生日可以关联角色（日期由你填写，聆聆不会自动生成）；关联日记；导出给 iPhone 日历（需要你手动添加）。
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../../components/NavBar'
import { ActionSheet, ConfirmDialog } from '../../components/Sheet'
import { db } from '../../db/db'
import type { AnniversaryType, CalEvent, Character, Diary, EventKind, EventRepeat } from '../../db/schema'
import { restoreEvent, saveEvent, trashEvent, type EventInput } from '../../db/eventRepo'
import { ANNIV_LABEL, defaultRepeat, EVENT_LIMITS, KIND_LABEL, REPEAT_LABEL, toICS, toShortcutPayload } from '../../life/calendar'
import { dateParts, isDateString, localDate } from '../../life/diary'

const field = 'w-full h-10 rounded-[12px] bg-white/60 border border-[var(--c-line)] px-3 text-[16px] outline-none focus:border-[var(--c-accent)]'
const label = 'block text-[12px] text-[var(--c-text-3)] mb-1'

export default function EventEditorPage() {
  const { id: routeId = 'new' } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const isNew = routeId === 'new'
  const existing = useLiveQuery(() => (isNew ? null : db.events.get(routeId).then((e) => e ?? null)), [routeId])
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const diaries = useLiveQuery(() => db.diaries.toArray(), [], [] as Diary[])
  const [f, setF] = useState<EventInput | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [picking, setPicking] = useState(false)
  const [askDelete, setAskDelete] = useState(false)

  useEffect(() => {
    if (f) return
    if (isNew) {
      const d = params.get('date')
      setF({ title: '', kind: 'event', allDay: true, date: isDateString(d) ? d : localDate(), startTime: '09:00', endTime: '10:00', location: '', note: '', repeat: 'none', characterId: undefined, anniversaryType: undefined, diaryIds: [] })
    } else if (existing) {
      const { title, kind, allDay, date, startTime, endTime, location, note, repeat, characterId, anniversaryType, diaryIds } = existing
      setF({ title, kind, allDay, date, startTime: startTime ?? '09:00', endTime: endTime ?? '', location, note, repeat, characterId, anniversaryType, diaryIds })
    }
  }, [existing, isNew, f, params])

  if (!isNew && existing === null) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="日程" back="/calendar" />
        <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">这个日程不存在了。</p>
      </div>
    )
  }
  if (!f) return <div className="h-dvh" />
  const set = (p: Partial<EventInput>) => setF((x) => (x ? { ...x, ...p } : x))
  const deleted = !!existing?.deletedAt
  const save = async () => {
    setErr('')
    try {
      const id = await saveEvent(isNew ? null : routeId, f)
      nav(`/calendar?date=${f.date}`, { replace: true })
      return id
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  const asEvent = (): CalEvent => ({ ...(existing as CalEvent), ...f, id: existing?.id ?? 'unsaved', source: 'local', createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() })
  const exportIcs = () => {
    const blob = new Blob([toICS(asEvent())], { type: 'text/calendar' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${f.title || 'event'}.ics`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
    setMsg('已导出 .ics 文件。在 iPhone 上打开它，选择「添加到日历」后才会出现在系统日历里。')
  }
  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(toShortcutPayload(asEvent()), null, 2))
      setMsg('已复制快捷指令数据（只是复制，不会写入系统日历）。')
    } catch {
      setMsg('无法复制，请检查浏览器权限。')
    }
  }
  const linked = f.diaryIds.map((id) => diaries.find((d) => d.id === id))

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title={isNew ? '新建日程' : '日程'}
        back="/calendar"
        sideWidth={72}
        right={!deleted ? <button onClick={() => void save()} className="press mr-1 h-8 px-3.5 rounded-full bg-[var(--c-accent)] text-white text-[13px]">保存</button> : undefined}
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        {deleted && (
          <div className="mx-4 mt-2 card px-4 py-2.5 text-[13px] flex justify-between items-center">
            <span className="text-[var(--c-text-2)]">这个日程在最近删除中</span>
            <button className="press text-[var(--c-accent-strong)]" onClick={() => void restoreEvent(routeId)}>恢复</button>
          </div>
        )}
        <section className="mx-4 mt-2 card px-4 py-3 space-y-3">
          <div className="flex rounded-full bg-white/50 p-0.5 text-[12.5px]" role="radiogroup" aria-label="类型">
            {(['event', 'anniversary', 'birthday'] as EventKind[]).map((k) => (
              <button key={k} role="radio" aria-checked={f.kind === k} onClick={() => set({ kind: k, repeat: f.kind === k ? f.repeat : defaultRepeat(k), allDay: k === 'event' ? f.allDay : true })} className={`press flex-1 h-8 rounded-full ${f.kind === k ? 'bg-white text-[var(--c-accent-strong)] shadow-sm' : 'text-[var(--c-text-3)]'}`}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          <div>
            <label className={label}>标题</label>
            <input value={f.title} maxLength={EVENT_LIMITS.title} onChange={(e) => set({ title: e.target.value })} placeholder={f.kind === 'birthday' ? '例如：沈遥的生日' : f.kind === 'anniversary' ? '例如：第一次见面' : '例如：一起去看雪'} className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>日期</label>
              <input type="date" value={f.date} onChange={(e) => isDateString(e.target.value) && set({ date: e.target.value })} className={field} />
            </div>
            <div>
              <label className={label}>重复</label>
              <select value={f.repeat} onChange={(e) => set({ repeat: e.target.value as EventRepeat })} className={field}>
                {(Object.keys(REPEAT_LABEL) as EventRepeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
              </select>
            </div>
          </div>
          {f.kind === 'event' && (
            <>
              <label className="flex items-center gap-2 text-[14px] text-[var(--c-text)]"><input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} /> 全天</label>
              {!f.allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={label}>开始</label><input type="time" value={f.startTime ?? ''} onChange={(e) => set({ startTime: e.target.value })} className={field} /></div>
                  <div><label className={label}>结束（可不填）</label><input type="time" value={f.endTime ?? ''} onChange={(e) => set({ endTime: e.target.value })} className={field} /></div>
                </div>
              )}
              <div><label className={label}>地点</label><input value={f.location} maxLength={EVENT_LIMITS.location} onChange={(e) => set({ location: e.target.value })} className={field} /></div>
            </>
          )}
          {f.kind !== 'event' && (
            <>
              {f.kind === 'anniversary' && (
                <div>
                  <label className={label}>纪念日类型</label>
                  <select value={f.anniversaryType ?? 'other'} onChange={(e) => set({ anniversaryType: e.target.value as AnniversaryType })} className={field}>
                    {(['met', 'together', 'other'] as AnniversaryType[]).map((t) => <option key={t} value={t}>{ANNIV_LABEL[t]}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className={label}>关联角色（可不选）</label>
                <select value={f.characterId ?? ''} onChange={(e) => set({ characterId: e.target.value || undefined })} className={field}>
                  <option value="">不关联</option>
                  {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  {f.characterId && !chars.some((c) => c.id === f.characterId) && <option value={f.characterId}>已删除的角色</option>}
                </select>
              </div>
              <p className="text-[11.5px] text-[var(--c-text-3)]">日期由你填写，聆聆不会根据人设自动生成纪念日或生日。</p>
            </>
          )}
          <div><label className={label}>备注</label><textarea value={f.note} maxLength={EVENT_LIMITS.note} onChange={(e) => set({ note: e.target.value })} rows={3} className="w-full resize-none rounded-[12px] bg-white/60 border border-[var(--c-line)] px-3 py-2 text-[16px] outline-none focus:border-[var(--c-accent)]" /></div>
          {err && <p className="text-[12.5px] text-[var(--c-danger)]">{err}</p>}
        </section>

        <section className="mx-4 mt-3 card px-4 py-3">
          <div className="text-[12px] text-[var(--c-text-3)]">关联的日记</div>
          {linked.length === 0 && <div className="mt-1 text-[13px] text-[var(--c-text-3)]">还没有关联日记</div>}
          {linked.map((d, i) => (
            <div key={f.diaryIds[i]} className="mt-1.5 flex items-center justify-between gap-2">
              {d && !d.deletedAt ? (
                <button className="press min-w-0 truncate text-left text-[14px] text-[var(--c-text)]" onClick={() => nav(`/diary/${d.id}`)}>· {d.title || '无标题'} <span className="text-[11.5px] text-[var(--c-text-3)]">{dateParts(d.date).zh}</span></button>
              ) : (
                <span className="text-[13px] text-[var(--c-text-3)]">· 这篇日记已删除</span>
              )}
              <button aria-label="取消关联" className="press text-[12px] text-[var(--c-text-3)]" onClick={() => set({ diaryIds: f.diaryIds.filter((x) => x !== f.diaryIds[i]) })}>取消关联</button>
            </div>
          ))}
          <div className="mt-2 flex gap-4 text-[12.5px]">
            <button className="press text-[var(--c-accent-strong)]" onClick={() => setPicking(true)}>＋ 关联已有日记</button>
            <button className="press text-[var(--c-accent-strong)]" onClick={() => nav(`/diary/new?date=${f.date}`)}>写这一天的日记</button>
          </div>
        </section>

        {!isNew && !deleted && (
          <section className="mx-4 mt-3 card px-4 py-3">
            <div className="text-[13px] text-[var(--c-text)]">添加到 iPhone 日历</div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--c-text-3)]">这个日程目前只保存在聆聆，没有同步到系统日历。可以导出后自己添加。</p>
            <div className="mt-2 flex gap-2">
              <button className="press h-8 px-3 rounded-full border border-[var(--c-line)] text-[12.5px] text-[var(--c-accent-strong)]" onClick={exportIcs}>导出 .ics 文件</button>
              <button className="press h-8 px-3 rounded-full border border-[var(--c-line)] text-[12.5px] text-[var(--c-accent-strong)]" onClick={() => void copyPayload()}>复制快捷指令数据</button>
            </div>
            {msg && <p className="mt-1.5 text-[12px] text-[var(--c-accent-strong)]">{msg}</p>}
          </section>
        )}
        {!isNew && !deleted && (
          <div className="mt-5 text-center"><button className="press text-[13px] text-[var(--c-danger)]" onClick={() => setAskDelete(true)}>删除日程</button></div>
        )}
      </div>
      {picking && (
        <ActionSheet
          title="关联日记"
          subtitle={diaries.some((d) => !d.deletedAt) ? undefined : '还没有日记'}
          actions={diaries.filter((d) => !d.deletedAt && !f.diaryIds.includes(d.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map((d) => ({ label: `${d.title || '无标题'} · ${dateParts(d.date).zh}`, onClick: () => { setPicking(false); set({ diaryIds: [...f.diaryIds, d.id] }) } }))}
          onClose={() => setPicking(false)}
        />
      )}
      {askDelete && (
        <ConfirmDialog title="删除这个日程？" message="会移到「最近删除」（在日历的搜索页中），可以恢复。" confirmText="删除" danger onCancel={() => setAskDelete(false)} onConfirm={() => void trashEvent(routeId).then(() => nav('/calendar', { replace: true }))} />
      )}
    </div>
  )
}
