/**
 * 备份与恢复：导出全部数据或单个角色为 .lingling 文件；从文件恢复（预览 → 选择方式 → 确认）。
 */
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import { ConfirmDialog } from '../components/Sheet'
import { db } from '../db/db'
import {
  backupFileName,
  BackupError,
  buildBackup,
  parseBackup,
  pickCharacter,
  planRestore,
  rowsToWrite,
  summarize,
  TABLE_LABEL,
  type BackupFile,
  type RestoreMode,
  type RestorePlan,
} from '../services/backup'
import { applyRestore, CURRENT_SCHEMA, dumpAll, saveBackupFile } from '../services/backupDb'
import { storageEstimate } from '../services/stickerImport'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mx-4 mt-4 glass rounded-[var(--radius-card)] px-4 pt-3.5 pb-4">
      <div className="serif-zh text-[15px] tracking-[0.08em] text-[var(--c-brand)]">{title}</div>
      <div className="mt-2.5 text-[13px] leading-relaxed text-[var(--c-text-2)]">{children}</div>
    </section>
  )
}

const btn = 'press h-9 px-4 rounded-full border border-[var(--c-line)] bg-white/45 text-[13px] text-[var(--c-accent-strong)] disabled:opacity-45'
const mainBtn = 'press h-10 px-5 rounded-full bg-[var(--c-accent)] text-white text-[14px] disabled:opacity-45'
const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

const MODES: { key: RestoreMode; label: string; hint: string }[] = [
  { key: 'merge-keep', label: '合并（保留本机）', hint: '只添加本机没有的内容；同一条数据两边不同时，保留本机的。最安全' },
  { key: 'merge-overwrite', label: '合并（以备份为准）', hint: '添加新内容；同一条数据两边不同时，用备份覆盖本机的' },
  { key: 'replace', label: '完全替换', hint: '先清空本机全部数据，再恢复备份。本机有而备份没有的内容会丢失' },
]

export default function BackupPage() {
  const characters = useLiveQuery(() => db.characters.orderBy('name').toArray(), [], [])
  const [charId, setCharId] = useState('')
  const [secrets, setSecrets] = useState(false)
  const [busy, setBusy] = useState('')
  const [ready, setReady] = useState<{ file: BackupFile; name: string; size: number } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [incoming, setIncoming] = useState<{ file: BackupFile; plan: RestorePlan; local: Awaited<ReturnType<typeof dumpAll>> } | null>(null)
  const [mode, setMode] = useState<RestoreMode>('merge-keep')
  const [confirm, setConfirm] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /** 第一步：生成（读数据库需要时间）；第二步：用户再点「保存」，iPhone 上分享面板需要在点击时立即打开 */
  const prepare = async (scope: 'all' | 'character') => {
    setBusy('正在生成备份…')
    setMsg(null)
    setReady(null)
    try {
      const dump = await dumpAll()
      const file = scope === 'all' ? buildBackup(dump, { schemaVersion: CURRENT_SCHEMA, includeSecrets: secrets }) : pickCharacter(dump, charId, { schemaVersion: CURRENT_SCHEMA })
      const size = new Blob([JSON.stringify(file)]).size
      setReady({ file, name: backupFileName(file), size })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy('')
    }
  }
  const save = async () => {
    if (!ready) return
    const r = await saveBackupFile(ready.file, ready.name)
    if (r !== 'cancelled') setMsg({ ok: true, text: r === 'shared' ? '已打开分享面板：选择「存储到文件」即可保存到 iPhone 的「文件」App' : '已开始下载。iPhone 上可以在「文件 → 下载项」中找到' })
  }

  const pick = async (f: File | undefined) => {
    if (!f) return
    setMsg(null)
    setIncoming(null)
    setBusy('正在读取备份…')
    try {
      const file = parseBackup(await f.text(), CURRENT_SCHEMA)
      const local = await dumpAll()
      setIncoming({ file, plan: planRestore(file, local), local })
      setMode('merge-keep')
    } catch (e) {
      setMsg({ ok: false, text: e instanceof BackupError ? e.message : `读取失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy('')
    }
  }

  const restore = async () => {
    if (!incoming) return
    setConfirm(false)
    setBusy('正在恢复…')
    try {
      const est = await storageEstimate()
      const need = new Blob([JSON.stringify(incoming.file.tables)]).size
      if (est && est.quota - est.usage < need * 1.5) throw new Error(`设备存储空间可能不足（需要约 ${mb(need)}）`)
      const rows = rowsToWrite(incoming.file, incoming.local, incoming.plan, mode)
      const n = await applyRestore(rows, mode)
      setMsg({ ok: true, text: `恢复完成：写入 ${n} 条数据。` })
      setIncoming(null)
    } catch (e) {
      setMsg({ ok: false, text: `恢复失败，本机数据没有改动：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy('')
    }
  }

  const totals = incoming?.plan.tables.reduce((a, t) => ({ added: a.added + t.added, same: a.same + t.same, conflicts: a.conflicts + t.conflicts, dedup: a.dedup + t.dedup }), { added: 0, same: 0, conflicts: 0, dedup: 0 })

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="备份与恢复" back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-14">
        <Card title="导出全部数据">
          <p>包含角色与人设、世界、世界书、聊天记录、关系与记忆、表情包图片、主题与个人设置。导出为一个 .lingling 文件，可以保存到「文件」或发给自己。</p>
          <label className="mt-2 flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" checked={secrets} onChange={(e) => setSecrets(e.target.checked)} className="mt-1" />
            <span>
              同时导出 API Key 和代理口令
              <span className="block text-[11.5px] text-[var(--c-text-3)]">默认不导出。勾选后，任何拿到这个文件的人都能使用你的 API 额度，请妥善保管。</span>
            </span>
          </label>
          <button onClick={() => void prepare('all')} disabled={!!busy} className={`${mainBtn} mt-3`}>
            生成全部数据备份
          </button>
        </Card>

        <Card title="导出单个角色">
          <p>角色资料、与 Ta 的单聊记录、记忆、关联的世界与世界书，以及聊天中用到的表情包。不包含任何密钥。</p>
          <select value={charId} onChange={(e) => setCharId(e.target.value)} className="mt-2.5 w-full h-10 rounded-[12px] bg-white/55 border border-[var(--c-line)] px-3 text-[16px]">
            <option value="">选择角色</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={() => void prepare('character')} disabled={!charId || !!busy} className={`${btn} mt-2.5`}>
            生成角色备份
          </button>
        </Card>

        {ready && (
          <Card title="备份已生成">
            <div>
              {ready.name}（{mb(ready.size)}）
            </div>
            <div className="mt-1 text-[11.5px] text-[var(--c-text-3)]">{summarize(ready.file).map((s) => `${TABLE_LABEL[s.table]} ${s.count}`).join(' · ')}</div>
            {!ready.file.includesSecrets && <div className="mt-1 text-[11.5px] text-[var(--c-text-3)]">不含 API Key 和代理口令。</div>}
            <button onClick={() => void save()} className={`${mainBtn} mt-3`}>
              保存文件
            </button>
          </Card>
        )}

        <Card title="从备份恢复">
          <p>选择 .lingling 文件后，会先显示将要恢复的内容，确认后才写入。恢复在一次操作中完成，中途失败不会改动本机数据。</p>
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} className={`${btn} mt-2.5`}>
            选择备份文件
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".lingling,.json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              void pick(f)
            }}
          />
          {incoming && totals && (
            <div className="mt-3">
              <div className="text-[12.5px]">
                {incoming.file.scope === 'character' ? `角色备份「${incoming.file.characterName}」` : '全部数据备份'}，导出于 {new Date(incoming.file.exportedAt).toLocaleString()}
              </div>
              <div className="mt-1.5 rounded-[12px] bg-white/40 px-3 py-2 text-[12px]">
                {incoming.plan.tables.map((t) => (
                  <div key={t.table} className="flex justify-between gap-2">
                    <span>{TABLE_LABEL[t.table]}</span>
                    <span className="text-[var(--c-text-3)]">
                      新增 {t.added}
                      {t.same ? ` · 相同 ${t.same}` : ''}
                      {t.conflicts ? <span className="text-[var(--c-danger)]"> · 冲突 {t.conflicts}</span> : ''}
                      {t.dedup ? ` · 已有同图 ${t.dedup}` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1 text-[11.5px] text-[var(--c-text-3)]">「冲突」指本机和备份中都有、但内容不同的同一条数据；「已有同图」的表情包不会重复保存。</div>
              <div className="mt-2.5 space-y-1.5">
                {MODES.map((m) => (
                  <label key={m.key} className={`flex items-start gap-2 rounded-[12px] border px-3 py-2 ${mode === m.key ? 'border-[var(--c-accent)] bg-white/50' : 'border-[var(--c-line)]'}`}>
                    <input type="radio" name="mode" checked={mode === m.key} onChange={() => setMode(m.key)} className="mt-1" />
                    <span>
                      <span className={m.key === 'replace' ? 'text-[var(--c-danger)]' : ''}>{m.label}</span>
                      <span className="block text-[11.5px] text-[var(--c-text-3)]">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setIncoming(null)} className="press h-10 px-4 rounded-full text-[13px] text-[var(--c-text-2)]">
                  取消
                </button>
                <button onClick={() => setConfirm(true)} disabled={!!busy || (mode === 'merge-keep' && totals.added === 0)} className={`${mainBtn} flex-1`}>
                  {mode === 'merge-keep' && totals.added === 0 ? '没有需要新增的内容' : '恢复'}
                </button>
              </div>
            </div>
          )}
        </Card>

        {busy && <div className="mx-6 mt-3 text-[12.5px] text-[var(--c-text-2)]">{busy}</div>}
        {msg && <div className={`mx-6 mt-3 text-[12.5px] leading-relaxed ${msg.ok ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-danger)]'}`}>{msg.text}</div>}
        <p className="mx-6 mt-4 text-[11px] leading-relaxed text-[var(--c-text-3)]">
          数据只保存在这台设备的浏览器里。清除 Safari 网站数据、长期不打开网站或更换手机都可能丢失数据，建议定期导出备份。备份文件是普通 JSON，不会上传到任何服务器。
        </p>
      </div>
      {confirm && incoming && (
        <ConfirmDialog
          title={mode === 'replace' ? '完全替换本机数据？' : '开始恢复？'}
          danger={mode !== 'merge-keep'}
          confirmText={mode === 'replace' ? '清空并恢复' : '恢复'}
          message={
            mode === 'replace'
              ? '本机现有的全部角色、聊天记录和表情包都会被清空，换成备份中的内容。建议先在上面「生成全部数据备份」保存一份当前数据。'
              : mode === 'merge-overwrite'
                ? `将新增 ${totals?.added ?? 0} 条，并用备份覆盖 ${totals?.conflicts ?? 0} 条不同的数据。`
                : `将新增 ${totals?.added ?? 0} 条数据，本机已有的内容不会被改动。`
          }
          onConfirm={() => void restore()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}
