/**
 * 新建 / 编辑页里的「从本地文件导入」：读取文件 → 弹窗预览摘要 → 用户确认后填入表单。
 * 只填表单，不直接保存；用户检查、修改后再点「保存」。
 */
import { useRef, useState } from 'react'
import { ConfirmDialog } from '../components/Sheet'
import { FILE_ACCEPT, importFile } from './pipeline'
import { browserCMapUrl, loadPdfjsBrowser } from './pdfjsBrowser'
import type { ImportKind, ParsedFile } from './types'

export function useFormImport(kind: ImportKind, describe: (f: ParsedFile) => string, apply: (f: ParsedFile) => void | Promise<void>) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<ParsedFile | null>(null)
  const [error, setError] = useState('')

  const onPick = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await file.arrayBuffer())
      } catch {
        setError('无法读取文件。如果文件在 iCloud 云盘中，请先在「文件」App 里点开一次，等它下载到本机后再导入')
        return
      }
      const outcomes = await importFile(file.name, bytes, kind, { loadPdfjs: loadPdfjsBrowser, cMapUrl: browserCMapUrl() })
      const ok = outcomes.find((r) => r.ok)
      if (!ok || !ok.ok) {
        const first = outcomes[0]
        setError(first && !first.ok ? first.error : '没有可导入的内容')
        return
      }
      setPending(ok.file)
    } finally {
      setBusy(false)
    }
  }

  const ui = (
    <>
      <input
        ref={ref}
        type="file"
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {pending && (
        <ConfirmDialog
          title="用文件内容填写？"
          message={
            <>
              <span className="block">{describe(pending)}</span>
              {pending.warnings.slice(0, 2).map((w, i) => (
                <span key={i} className="block mt-1 text-[12px] text-[var(--c-text-3)]">
                  · {w}
                </span>
              ))}
              <span className="block mt-2 text-[12px] text-[var(--c-text-3)]">内容会填入表单，检查无误后再点保存。</span>
            </>
          }
          confirmText="填入"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const f = pending
            setPending(null)
            void apply(f)
          }}
        />
      )}
      {error && (
        <ConfirmDialog title="无法导入" message={error} confirmText="知道了" onCancel={() => setError('')} onConfirm={() => setError('')} />
      )}
    </>
  )

  return { open: () => ref.current?.click(), busy, ui }
}
