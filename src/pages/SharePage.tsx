/**
 * 从 iPhone 分享菜单收到的内容：先预览，由你选择保存为便签、放进和某个角色的输入框（不会自动发送）、保存图片到相册或丢弃。
 * 不会自动发给 AI；含有敏感信息时会提醒你。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import { db } from '../db/db'
import { saveNote } from '../db/noteRepo'
import { getOrCreateSingleConversation, saveDraft } from '../db/repo'
import { clearShare, MAX_TEXT, pendingShare, sensitivity, type SharedItem } from '../ios/share'
import { importFiles } from './album/AlbumHomePage'

const KIND_LABEL: Record<SharedItem['kind'], string> = { text: '文字', url: '网页链接', image: '图片', file: '文件信息' }

export default function SharePage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [item, setItem] = useState<SharedItem | null>(() => pendingShare())
  const [msg, setMsg] = useState('')
  const [picking, setPicking] = useState(false)
  const [images, setImages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const chars = useLiveQuery(() => db.characters.toArray(), [])
  // 聆聆已经打开时又收到新的分享
  useEffect(() => {
    const on = () => {
      setItem(pendingShare())
      setMsg('')
      setImages([])
    }
    window.addEventListener('lingling-share', on)
    return () => window.removeEventListener('lingling-share', on)
  }, [])
  useEffect(() => {
    const urls = images.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [images])

  const done = (text: string) => {
    clearShare()
    setItem(null)
    setMsg(text)
  }
  const level = item && item.kind !== 'image' ? sensitivity(item.text) : null

  const saveAsNote = async () => {
    if (!item) return
    const id = await saveNote(null, { title: item.kind === 'url' ? '分享的链接' : item.kind === 'file' ? '分享的文件' : '分享的文字', kind: 'text', text: item.text })
    if (!id || !(await db.notes.get(id))) return setMsg('保存失败')
    done('已保存为便签')
  }
  const toCharacter = async (characterId: string) => {
    if (!item) return
    const convId = await getOrCreateSingleConversation(characterId)
    const conv = await db.conversations.get(convId)
    await saveDraft(convId, conv?.draft ? `${conv.draft}\n${item.text}` : item.text)
    clearShare()
    nav(`/chat/${convId}`)
  }
  const paste = async () => {
    setMsg('')
    try {
      const list = await navigator.clipboard.read()
      const files: File[] = []
      for (const it of list) {
        const type = it.types.find((t) => t.startsWith('image/'))
        if (!type) continue
        const blob = await it.getType(type)
        files.push(new File([blob], `分享的图片.${type.split('/')[1] || 'png'}`, { type }))
      }
      if (!files.length) return setMsg('剪贴板里没有图片。请确认快捷指令里有「拷贝到剪贴板」，或者点「从照片中选择」')
      setImages(files)
    } catch {
      setMsg('无法读取剪贴板（需要你允许「粘贴」）。也可以点「从照片中选择」')
    }
  }
  const saveImages = async () => {
    setSaving(true)
    const r = await importFiles(images, undefined, () => {})
    setSaving(false)
    if (r.ok === 0) return setMsg(`没有保存成功：${r.failed.map((f) => `${f.name} ${f.reason}`).join('；')}`)
    setImages([])
    done(`已保存 ${r.ok} 张图片到相册${r.failed.length ? `，${r.failed.length} 张失败` : ''}`)
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title="收到的分享" back="/" />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-16">
        {msg && <p role="status" className="mt-3 rounded-[14px] bg-white/60 px-4 py-2.5 text-[13px] text-[var(--c-accent-strong)]">{msg}</p>}
        {!item && !msg && (
          <p className="mt-10 text-center text-[13px] text-[var(--c-text-3)]">{params.get('empty') ? '没有收到内容。可能内容为空，或「分享到聆聆」快捷指令的设置不对（我的 → 连接真实 iPhone）。' : '没有待处理的分享。'}</p>
        )}
        {item && (
          <>
            <div className="mt-3 card px-4 py-3">
              <div className="flex justify-between text-[12px] text-[var(--c-text-3)]">
                <span>{KIND_LABEL[item.kind]}</span>
                {item.kind !== 'image' && <span>{item.text.length} 字</span>}
              </div>
              {item.kind === 'url' && item.url && (
                <a className="share-preview mt-1.5 block break-all text-[14px] text-[var(--c-accent-strong)] underline" href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>
              )}
              {(item.kind === 'text' || item.kind === 'file') && <div className="share-preview mt-1.5 max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words text-[14px] text-[var(--c-text)]">{item.text}</div>}
              {item.truncated && <p className="mt-1.5 text-[11.5px] text-[#8a7a3c]">内容超过 {MAX_TEXT} 字，只收到了前 {MAX_TEXT} 字。</p>}
              {level === 'forbidden' && <p className="share-warning mt-1.5 text-[12px] text-[var(--c-danger)]">看起来含有证件号、银行卡号、密码或密钥。建议不要发给角色。</p>}
              {level === 'sensitive' && <p className="share-warning mt-1.5 text-[12px] text-[#8a7a3c]">可能含有健康、财务或住址等私人信息，发给角色前请再看一下。</p>}
              <p className="mt-1.5 text-[11px] text-[var(--c-text-3)]">这些内容只在这台设备上，你选择之前不会保存，也不会发给 AI。</p>
            </div>

            {item.kind === 'image' ? (
              <div className="mt-3 card px-4 py-3">
                <p className="text-[12.5px] text-[var(--c-text-2)]">图片不会放在链接里。如果快捷指令已经把图片拷贝到剪贴板，点「粘贴图片」；也可以从照片中选择。</p>
                <div className="mt-2 flex gap-2">
                  <button className="press flex-1 h-9 rounded-full bg-[var(--c-accent)] text-white text-[13.5px]" onClick={() => void paste()}>粘贴图片</button>
                  <button className="press flex-1 h-9 rounded-full bg-white/70 text-[13.5px] text-[var(--c-accent-strong)]" onClick={() => fileRef.current?.click()}>从照片中选择</button>
                </div>
                <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { setImages(e.target.files ? [...e.target.files] : []); e.target.value = '' }} />
                {previews.length > 0 && (
                  <>
                    <div className="mt-2 grid grid-cols-3 gap-1">{previews.map((u) => <img key={u} src={u} alt="预览" className="share-image aspect-square w-full object-cover rounded-[8px]" />)}</div>
                    <button disabled={saving} className="press mt-2 h-9 w-full rounded-full bg-[var(--c-accent)] text-white text-[13.5px] disabled:opacity-50" onClick={() => void saveImages()}>{saving ? '正在保存…' : `保存 ${images.length} 张到相册`}</button>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-3 card overflow-hidden">
                <button className="press w-full px-4 py-3 text-left text-[14px] hairline-b" onClick={() => void saveAsNote()}>保存为便签</button>
                <button className="press w-full px-4 py-3 text-left text-[14px] hairline-b" onClick={() => setPicking((x) => !x)}>放进和角色的输入框（不会自动发送）</button>
                {picking && (
                  <div className="px-4 py-2 hairline-b">
                    {chars?.length === 0 && <p className="text-[12px] text-[var(--c-text-3)]">还没有角色。</p>}
                    {chars?.map((c) => (
                      <button key={c.id} className="press flex w-full items-center gap-2 py-1.5 text-left text-[13.5px]" onClick={() => void toCharacter(c.id)}>
                        <Avatar name={c.name} src={c.avatar} size={28} />{c.name}
                      </button>
                    ))}
                  </div>
                )}
                <button className="press w-full px-4 py-3 text-left text-[14px] hairline-b" onClick={() => void navigator.clipboard?.writeText(item.text).then(() => setMsg('已复制'), () => setMsg('复制失败'))}>复制</button>
                <button className="press w-full px-4 py-3 text-left text-[14px] text-[var(--c-danger)]" onClick={() => done('已丢弃')}>丢弃</button>
              </div>
            )}
            {item.kind === 'image' && <button className="press mt-3 w-full text-center text-[13px] text-[var(--c-danger)]" onClick={() => { setImages([]); done('已丢弃') }}>丢弃</button>}
          </>
        )}
      </div>
    </div>
  )
}
