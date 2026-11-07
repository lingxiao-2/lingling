/**
 * 连接真实 iPhone：运行环境检查 → 快捷指令的作用 → 创建快捷指令（步骤）→ 登记 → 测试连接 → 结果 → 允许调用的快捷指令 → 角色权限。
 */
import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../../components/NavBar'
import { ConfirmDialog } from '../../components/Sheet'
import ShortcutRunCard from '../../components/ShortcutRunCard'
import IphoneActions from './IphoneActions'
import { Icon } from '../../theme/icons'
import { db } from '../../db/db'
import { detectEnvironment } from '../../ios/env'
import { RECIPES } from '../../ios/recipes'
import { clearRuns, createRun, STATUS_LABEL } from '../../ios/runs'
import { LIMITS, listShortcuts, registerShortcut, removeShortcut, SHORTCUTS_KEY, updateShortcut, type RegisteredShortcut, type ShortcutPurpose } from '../../ios/shortcuts'

const PURPOSE_LABEL: Record<ShortcutPurpose, string> = { test: '测试连接', reminder: '提醒事项', calendar: '系统日历', open_app: '打开应用（旧）', custom: '自定义（例如打开某个 App）' }
const REGISTERABLE: ShortcutPurpose[] = ['test', 'reminder', 'calendar', 'custom']

function useShortcuts() {
  return useLiveQuery(async () => {
    await db.settings.get(SHORTCUTS_KEY)
    return listShortcuts()
  }, [])
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mx-4 mt-3 card px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="h-5 w-5 rounded-full bg-[var(--c-accent)] text-white text-[11px] flex items-center justify-center">{n}</span>
        <span className="serif-zh text-[15px] text-[var(--c-brand)]">{title}</span>
      </div>
      <div className="mt-2 text-[12.5px] leading-relaxed text-[var(--c-text-2)]">{children}</div>
    </section>
  )
}

export default function IphonePage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const env = useMemo(() => detectEnvironment(navigator as never, (q) => window.matchMedia?.(q).matches ?? false), [])
  const shortcuts = useShortcuts()
  const runs = useLiveQuery(() => db.shortcutRuns.orderBy('createdAt').reverse().limit(20).toArray(), [])
  const [testRun, setTestRun] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState<ShortcutPurpose>('test')
  const [desc, setDesc] = useState('')
  const [msg, setMsg] = useState('')
  const [removing, setRemoving] = useState<RegisteredShortcut | null>(null)
  const test = shortcuts?.find((s) => s.purpose === 'test')

  const prepareTest = async () => {
    if (!test) return
    const code = Math.random().toString(36).slice(2, 8)
    const r = await createRun({ kind: 'test', shortcutName: test.name, title: `测试连接：${test.name}`, lines: [`会把「聆聆测试 ${code}」交给快捷指令，它应原样交回`], input: `聆聆测试 ${code}`, source: 'settings' })
    setTestRun(r.id)
  }
  const add = async () => {
    try {
      await registerShortcut({ name, purpose, description: desc })
      setName('')
      setDesc('')
      setMsg('已登记')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="连接真实 iPhone" back="/me" />
      <div className="flex-1 min-h-0 overflow-y-auto pb-16">
        {params.get('callback') === 'unknown' && (
          <p className="mx-4 mt-2 rounded-[14px] bg-white/60 px-4 py-2.5 text-[12.5px] text-[var(--c-danger)]">收到了快捷指令的回跳，但在这里找不到对应的运行（它可能是在主屏幕 App 或另一个浏览器里发起的）。请回到原来的地方，在运行卡片上手动确认结果。</p>
        )}
        {params.get('callback') === 'invalid' && (
          <p className="mx-4 mt-2 rounded-[14px] bg-white/60 px-4 py-2.5 text-[12.5px] text-[var(--c-danger)]">收到一个校验失败的回跳，已忽略，没有改变任何运行的状态。</p>
        )}
        <Section n={1} title="运行环境">
          <div className="grid grid-cols-2 gap-y-0.5">
            <span>设备</span><span>{env.isIOS ? `iPhone / iPad${env.iosVersion ? ` · iOS ${env.iosVersion}` : ''}` : '不是 iPhone / iPad'}</span>
            <span>打开方式</span><span>{env.standalone ? '主屏幕 App' : env.safari ? 'Safari' : '其他浏览器'}</span>
            <span>快捷指令链接</span><span className={env.canTryShortcuts ? 'text-[#2f7d5b]' : 'text-[var(--c-danger)]'}>{env.canTryShortcuts ? '可以尝试（需要测试）' : '不可用'}</span>
          </div>
          {env.notes.map((n) => <p key={n} className="mt-1.5 text-[11.5px] text-[#8a7a3c]">· {n}</p>)}
        </Section>

        <Section n={2} title="快捷指令能做什么">
          聆聆是网页，不能直接操作其他 App。iPhone 自带的「快捷指令」App 可以创建提醒事项、日历事件、打开应用等；聆聆通过 <code>shortcuts://</code> 链接运行<b>你自己创建并登记</b>的快捷指令，每一次都要你先确认。
          <br />它<b>不能</b>查看屏幕、读取其他 App 的数据或模拟点击。快捷指令完成后会回跳到聆聆报告结果；没有收到回跳时，聆聆只会显示「已发起」或「无法验证」，不会说成功。
        </Section>

        <Section n={3} title="在快捷指令 App 中创建">
          <p className="text-[11.5px] text-[var(--c-text-3)]">聆聆无法替你安装快捷指令，请照着步骤在 iPhone 上创建（约 1 分钟）。</p>
          {RECIPES.map((r) => (
            <details key={r.purpose} className="mt-2 rounded-[12px] bg-white/45 px-3 py-2" open={r.purpose === 'test' && !test}>
              <summary className="text-[13px] text-[var(--c-text)]">「{r.name}」· {r.title}</summary>
              <p className="mt-1 text-[11.5px] text-[var(--c-text-3)]">{r.why}</p>
              <ol className="mt-1 list-decimal pl-5 text-[12.5px]">
                {r.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              {r.sample && <p className="mt-1 text-[11px] text-[var(--c-text-3)]">聆聆传入的内容示例：<code className="break-all">{r.sample}</code></p>}
            </details>
          ))}
        </Section>

        <Section n={4} title="登记快捷指令（白名单）">
          <p className="text-[11.5px] text-[var(--c-text-3)]">只有登记在这里的快捷指令才能被运行；名称必须和快捷指令 App 中完全一致。AI 不能添加或修改这里的内容。</p>
          <div className="mt-2 flex flex-col gap-2">
            <input aria-label="快捷指令名称" value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder={RECIPES[0].name} className="h-9 rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 text-[15px] outline-none" />
            <select aria-label="用途" value={purpose} onChange={(e) => setPurpose(e.target.value as ShortcutPurpose)} className="h-9 rounded-[10px] bg-white/70 border border-[var(--c-line)] px-2 text-[14px]">
              {REGISTERABLE.map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
            </select>
            {purpose === 'custom' && <input aria-label="用途说明" value={desc} maxLength={LIMITS.description} onChange={(e) => setDesc(e.target.value)} placeholder="它是做什么的（AI 会看到这句说明）" className="h-9 rounded-[10px] bg-white/70 border border-[var(--c-line)] px-3 text-[14px] outline-none" />}
            <button className="press h-9 rounded-full bg-[var(--c-accent)] text-white text-[13.5px] disabled:opacity-50" disabled={!name.trim()} onClick={() => void add()}>登记</button>
            {msg && <p className="text-[12px] text-[var(--c-accent-strong)]">{msg}</p>}
          </div>
          {shortcuts?.map((s) => (
            <div key={s.id} className="registered-shortcut mt-2 flex items-center gap-2 rounded-[12px] bg-white/45 px-3 py-2">
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[13px] text-[var(--c-text)]">{s.name}</span>
                <span className="block text-[11px] text-[var(--c-text-3)]">{PURPOSE_LABEL[s.purpose]}{s.description ? ` · ${s.description}` : ''}</span>
              </span>
              {s.purpose === 'custom' && (
                <label className="flex items-center gap-1 text-[11.5px] text-[var(--c-text-2)]">
                  <input type="checkbox" checked={s.allowAI} onChange={(e) => void updateShortcut(s.id, { allowAI: e.target.checked })} />AI 可用
                </label>
              )}
              <button aria-label={`移除 ${s.name}`} className="press text-[12px] text-[var(--c-danger)]" onClick={() => setRemoving(s)}>移除</button>
            </div>
          ))}
        </Section>

        <Section n={5} title="测试连接">
          {!test ? (
            <p>请先创建并登记用途为「测试连接」的快捷指令。</p>
          ) : (
            <>
              <p>会打开「{test.name}」，传入一段文字；快捷指令把它交回后，这里会显示结果。iPhone 会先问「是否在快捷指令中打开」，请点「打开」。</p>
              {!testRun && <button className="press mt-2 h-9 w-full rounded-full bg-[var(--c-accent)] text-white text-[13.5px]" onClick={() => void prepareTest()}>准备测试</button>}
              {testRun && (
                <div className="mt-2">
                  <ShortcutRunCard runId={testRun} />
                  <TestVerdict runId={testRun} />
                  <button className="press mt-2 text-[12px] text-[var(--c-accent-strong)]" onClick={() => setTestRun(null)}>重新测试</button>
                </div>
              )}
            </>
          )}
        </Section>

        <Section n={6} title="试一试真实操作">
          <p className="mb-2 text-[11.5px] text-[var(--c-text-3)]">不经过 AI，直接从这里运行。先生成执行计划，看清日期、时间和标题，再打开快捷指令。</p>
          <IphoneActions />
        </Section>

        <Section n={7} title="最近的运行">
          {runs?.length === 0 && <p className="text-[var(--c-text-3)]">还没有。</p>}
          {runs?.map((r) => (
            <button key={r.id} className="run-row press w-full flex justify-between gap-2 py-1.5 text-left hairline-b last:border-b-0" onClick={() => nav(`/me/iphone/run/${r.id}`)}>
              <span className="truncate text-[12.5px] text-[var(--c-text)]">{r.title}</span>
              <span className="shrink-0 text-[12px]">{STATUS_LABEL[r.status]}</span>
            </button>
          ))}
          {!!runs?.length && <button className="press mt-2 text-[12px] text-[var(--c-text-3)]" onClick={() => void clearRuns()}>清除已结束的记录</button>}
        </Section>

        <Section n={8} title="角色权限">
          哪些角色可以在你确认后使用这些快捷指令，在「AI 工具权限」中逐个角色设置，默认全部关闭。
          <button className="press mt-2 flex items-center gap-1 text-[var(--c-accent-strong)]" onClick={() => nav('/me/ai-tools')}>前往 AI 工具权限 <Icon name="forward" size="xs" /></button>
        </Section>
      </div>
      {removing && (
        <ConfirmDialog title={`移除「${removing.name}」？`} message="只是从聆聆的白名单中移除，不会删除 iPhone 上的快捷指令。" confirmText="移除" danger onCancel={() => setRemoving(null)} onConfirm={() => void removeShortcut(removing.id).then(() => setRemoving(null))} />
      )}
    </div>
  )
}

/** 测试结果：回跳带回的内容和传入的一致，说明参数接收正确 */
export function TestVerdict({ runId }: { runId: string }) {
  const r = useLiveQuery(() => db.shortcutRuns.get(runId), [runId])
  if (!r || r.kind !== 'test' || r.status !== 'confirmed') return null
  const same = (r.result ?? '').trim() === (r.input ?? '').trim()
  return (
    <p className={`test-verdict mt-1.5 text-[12px] ${same ? 'text-[#2f7d5b]' : 'text-[#8a7a3c]'}`}>
      {same ? '✓ 打开快捷指令、传入参数、回到聆聆都正常。' : `快捷指令运行了，但交回的内容和传入的不一致（收到：「${(r.result ?? '').slice(0, 60)}」）。请检查「停止并输出」是否设为「快捷指令输入」。`}
    </p>
  )
}

export function RunPage() {
  const { id = '' } = useParams()
  const r = useLiveQuery(() => db.shortcutRuns.get(id).then((x) => x ?? null), [id])
  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="快捷指令运行" back="/me/iphone" />
      <div className="px-4 pt-3">
        {r === null && <p className="text-center text-[13px] text-[var(--c-text-3)]">找不到这次运行。</p>}
        {r && <ShortcutRunCard runId={r.id} />}
        {r && <TestVerdict runId={r.id} />}
        {r?.conversationId && <a className="mt-3 block text-center text-[13px] text-[var(--c-accent-strong)]" href={`#/chat/${r.conversationId}`}>回到聊天</a>}
      </div>
    </div>
  )
}
