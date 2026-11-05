import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar from '../components/NavBar'
import Avatar from '../components/Avatar'
import PickerSheet from '../components/PickerSheet'
import { ConfirmDialog } from '../components/Sheet'
import { Section } from '../components/ui'
import { db } from '../db/db'
import { deleteLorebook, linkLorebook, unlinkLorebook } from '../db/repo'
import type { Character } from '../db/schema'
import { FORMAT_LABELS, type ImportFormat } from '../import/types'

export default function LorebookDetailPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const book = useLiveQuery(async () => (await db.lorebooks.get(id)) ?? null, [id])
  const allChars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const linkedIds = useLiveQuery(
    async () => (await db.characterLorebooks.where('lorebookId').equals(id).toArray()).map((l) => l.characterId),
    [id],
    [] as string[],
  )
  const [picker, setPicker] = useState(false)
  const [unlinkTarget, setUnlinkTarget] = useState<Character | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [open, setOpen] = useState<Set<number>>(new Set())

  if (!book) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="世界书" back />
        <div className="p-10 text-center text-sm text-[var(--c-text-3)]">
          {book === undefined ? '加载中…' : '世界书不存在或已被删除'}
        </div>
      </div>
    )
  }

  const linked = allChars.filter((c) => linkedIds.includes(c.id))
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  return (
    <div className="h-dvh flex flex-col">
      <NavBar title={book.name} back />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <div className="mx-3 mt-3 card p-4">
          <div className="text-lg font-medium break-words">{book.name}</div>
          {book.description && (
            <div className="mt-1.5 text-sm text-[var(--c-text-2)] whitespace-pre-wrap break-words leading-relaxed">
              {book.description}
            </div>
          )}
          <div className="mt-2 text-xs text-[var(--c-text-3)]">
            {book.entries.length} 个条目
            {book.importSource &&
              ` · 导入自 ${book.importSource.fileName}（${
                FORMAT_LABELS[book.importSource.format as ImportFormat] ?? book.importSource.format
              }）`}
          </div>
        </div>

        <Section title="关联的角色">
          {linked.length === 0 && <div className="px-4 py-3 text-sm text-[var(--c-text-3)]">还没有关联任何角色</div>}
          {linked.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 hairline-b">
              <button onClick={() => nav(`/character/${c.id}`)} className="press">
                <Avatar name={c.name} src={c.avatar} size={36} rounded={10} />
              </button>
              <span className="flex-1 min-w-0 truncate text-[15px]">{c.name}</span>
              <button
                onClick={() => setUnlinkTarget(c)}
                className="press text-xs text-[var(--c-text-2)] px-2.5 h-7 rounded-full border border-[var(--c-line)]"
              >
                解除关联
              </button>
            </div>
          ))}
          <button
            onClick={() => setPicker(true)}
            className="press w-full h-11 text-[15px] text-[var(--c-accent-strong)]"
          >
            添加关联角色
          </button>
        </Section>

        <Section title="条目">
          {book.entries.length === 0 && <div className="px-4 py-3 text-sm text-[var(--c-text-3)]">没有条目</div>}
          {book.entries.map((e, i) => (
            <button key={e.id} onClick={() => toggle(i)} className="press w-full text-left px-4 py-3 hairline-b">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-[15px]">{e.name}</span>
                {e.constant && <span className="text-[10px] text-[var(--c-accent-strong)]">常驻</span>}
                {!e.enabled && <span className="text-[10px] text-[var(--c-text-3)]">已停用</span>}
              </div>
              {e.keys.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.keys.map((k) => (
                    <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--c-accent-soft)] text-[var(--c-accent-strong)]">
                      {k}
                    </span>
                  ))}
                </div>
              )}
              <div
                className={`mt-1.5 text-[13px] text-[var(--c-text-2)] whitespace-pre-wrap break-words leading-relaxed ${
                  open.has(i) ? '' : 'line-clamp-2'
                }`}
              >
                {e.content || '（无正文）'}
              </div>
            </button>
          ))}
        </Section>

        <div className="flex justify-center mt-6">
          <button onClick={() => setConfirmDel(true)} className="press text-sm text-[var(--c-danger)] px-4 py-2">
            删除世界书
          </button>
        </div>
      </div>

      {picker && (
        <PickerSheet
          title="添加关联角色"
          options={allChars
            .filter((c) => !linkedIds.includes(c.id))
            .map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, hint: c.bio }))}
          emptyText="所有联系人都已关联"
          onClose={() => setPicker(false)}
          onConfirm={(ids) => {
            void Promise.all(ids.map((cid) => linkLorebook(cid, id)))
          }}
        />
      )}
      {unlinkTarget && (
        <ConfirmDialog
          title="解除关联？"
          message={`「${unlinkTarget.name}」将不再关联这本世界书。世界书和角色都不会被删除。`}
          confirmText="解除"
          onCancel={() => setUnlinkTarget(null)}
          onConfirm={() => {
            void unlinkLorebook(unlinkTarget.id, id)
            setUnlinkTarget(null)
          }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`删除「${book.name}」？`}
          message="世界书及其全部条目会被永久删除，并解除与所有角色的关联。角色本身不受影响。"
          confirmText="删除"
          danger
          onCancel={() => setConfirmDel(false)}
          onConfirm={async () => {
            await deleteLorebook(id)
            nav('/lorebooks', { replace: true })
          }}
        />
      )}
    </div>
  )
}
