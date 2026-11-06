import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../components/NavBar'
import Avatar from '../components/Avatar'
import RelationshipCard from '../components/RelationshipCard'
import { ConfirmDialog } from '../components/Sheet'
import PickerSheet from '../components/PickerSheet'
import OrganizeCard from '../components/OrganizeCard'
import { PrimaryButton, Section } from '../components/ui'
import { db } from '../db/db'
import { characterTextChars, deleteCharacter, getOrCreateSingleConversation, linkLorebook, unlinkLorebook } from '../db/repo'
import { DEFAULT_WORLD_ID } from '../db/schema'
import type { Lorebook } from '../db/schema'
import { FORMAT_LABELS, type ImportFormat } from '../import/types'

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="px-4 py-3 hairline-b last:border-b-0">
      <div className="text-xs text-[var(--c-text-3)] mb-1">{label}</div>
      <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
        {text || <span className="text-[var(--c-text-3)]">未填写</span>}
      </div>
    </div>
  )
}

export default function CharacterProfilePage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const c = useLiveQuery(async () => (await db.characters.get(id)) ?? null, [id])
  const memCount = useLiveQuery(
    async () => {
      const ms = await db.memories.where('characterId').equals(id).toArray()
      return { active: ms.filter((m) => m.status === 'active').length, pending: ms.filter((m) => m.status === 'pending').length }
    },
    [id],
    { active: 0, pending: 0 },
  )
  const [confirmDel, setConfirmDel] = useState(false)
  const [picker, setPicker] = useState(false)
  const [unlinkTarget, setUnlinkTarget] = useState<Lorebook | null>(null)
  const allBooks = useLiveQuery(() => db.lorebooks.toArray(), [], [] as Lorebook[])
  const linkedBookIds = useLiveQuery(
    async () => (await db.characterLorebooks.where('characterId').equals(id).toArray()).map((l) => l.lorebookId),
    [id],
    [] as string[],
  )
  const linkedBooks = allBooks.filter((b) => linkedBookIds.includes(b.id))
  const worldId = c?.worldId
  const world = useLiveQuery(
    async () => (worldId && worldId !== DEFAULT_WORLD_ID ? (await db.worlds.get(worldId)) ?? null : null),
    [worldId],
  )

  const chat = async () => {
    const convId = await getOrCreateSingleConversation(id)
    nav(`/chat/${convId}`)
  }

  if (!c) {
    return (
      <div className="h-dvh flex flex-col">
        <NavBar title="角色资料" back />
        <div className="p-10 text-center text-sm text-[var(--c-text-3)]">
          {c === undefined ? '加载中…' : '角色不存在'}
        </div>
      </div>
    )
  }

  return (
    <div className="h-dvh flex flex-col">
      <NavBar
        title="角色资料"
        back
        right={
          <NavButton label="编辑" icon="edit" onClick={() => nav(`/character/${id}/edit`)} />
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        <div className="flex flex-col items-center pt-6 pb-2 gap-2">
          <Avatar name={c.name} src={c.avatar} size="profile" />
          <div className="text-xl font-medium">{c.name}</div>
          {c.bio && <div className="px-10 text-center text-sm text-[var(--c-text-2)]">{c.bio}</div>}
          <button
            onClick={() => (world ? nav(`/world/${world.id}`) : nav(`/character/${id}/edit`))}
            className="press mt-1 flex items-center gap-2 text-[12px] tracking-[0.14em]"
          >
            <span className="h-px w-4 bg-[var(--c-brand-soft)]" />
            <span className={world ? 'serif-zh text-[var(--c-brand)]' : 'text-[var(--c-text-3)]'}>
              {world ? world.name : '未归入世界'}
            </span>
            <span className="h-px w-4 bg-[var(--c-brand-soft)]" />
          </button>
        </div>

        <RelationshipCard c={c} />

        <Section title="记忆">
          <button onClick={() => nav(`/character/${id}/memories`)} className="press w-full flex items-center justify-between px-4 py-3 text-left">
            <span className="text-[14px]">
              已记住 {memCount.active} 条
              {memCount.pending > 0 && <span className="ml-2 text-[12px] text-[var(--c-accent-strong)]">{memCount.pending} 条待确认</span>}
            </span>
            <span className="text-[12px] text-[var(--c-text-3)]">查看与管理</span>
          </button>
        </Section>

        <Section title="朋友圈">
          <label className="w-full flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
            <span>
              参与朋友圈
              <span className="block text-[11.5px] text-[var(--c-text-3)]">开启后可以让 TA 发动态、给你的动态点赞评论、回复你的评论。每次都由你的操作触发，会向你配置的 AI 服务发送一次请求</span>
            </span>
            <input
              type="checkbox"
              checked={c.permissions?.postMoments !== false}
              onChange={(e) => void db.characters.update(c.id, { permissions: { useStickers: c.permissions?.useStickers !== false, postMoments: e.target.checked } })}
            />
          </label>
        </Section>

        <Section title="设定">
          <Block label="与你的关系" text={c.relationToUser} />
          <Block label="性格设定" text={c.personality} />
          <Block label="说话风格" text={c.speakingStyle} />
          <Block label="背景故事" text={c.backstory} />
        </Section>

        {(c.profileExtras?.length ?? 0) > 0 && (
          <Section title="其他设定（导入时无法归类，原文保留）">
            {c.profileExtras!.map((e, i) => (
              <Block key={i} label={e.label} text={e.text} />
            ))}
          </Section>
        )}

        {c.sourceDoc && (
          <div className="mx-6 mt-3 text-[11.5px] leading-relaxed text-[var(--c-text-3)]">
            导入自「{c.sourceDoc.fileName}」：原文 {c.sourceDoc.chars.toLocaleString()} 字
            {c.sourceDoc.paragraphs ? `、${c.sourceDoc.paragraphs} 段` : ''}，全文保存在本机。
            当前资料共 {characterTextChars(c).toLocaleString()} 字；聊天时核心设定每次发送，较长的部分按话题挑选相关段落发送。
          </div>
        )}

        <div className="mx-4 mt-3">
          <button onClick={() => nav(`/character/${id}/context`)} className="press w-full h-10 rounded-full border border-[var(--c-line)] bg-white/40 text-[13px] text-[var(--c-accent-strong)]">
            查看发送给 AI 的设定
          </button>
        </div>

        <OrganizeCard c={c} autoOpen={params.get('organize') === '1' && !!c.sourceDoc} />

        {(c.greeting || c.exampleDialogue) && (
          <Section title="开场白与示例对话（仅作设定，不是聊天记录）">
            {c.greeting && <Block label="开场白" text={c.greeting} />}
            {c.exampleDialogue && <Block label="示例对话" text={c.exampleDialogue} />}
          </Section>
        )}

        <Section title="关联的世界书">
          {linkedBooks.length === 0 && (
            <div className="px-4 py-3 text-sm text-[var(--c-text-3)]">还没有关联世界书</div>
          )}
          {linkedBooks.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-2.5 hairline-b">
              <button onClick={() => nav(`/lorebook/${b.id}`)} className="press flex-1 min-w-0 text-left">
                <div className="text-[15px] truncate">{b.name}</div>
                <div className="text-xs text-[var(--c-text-3)]">{b.entries.length} 个条目</div>
              </button>
              <button
                onClick={() => setUnlinkTarget(b)}
                className="press shrink-0 text-xs text-[var(--c-text-2)] px-2.5 h-7 rounded-full border border-[var(--c-line)]"
              >
                解除关联
              </button>
            </div>
          ))}
          <button onClick={() => setPicker(true)} className="press w-full h-11 text-[15px] text-[var(--c-accent-strong)]">
            添加世界书
          </button>
        </Section>

        {c.importSource && (
          <p className="mx-6 mt-3 text-[11px] leading-relaxed text-[var(--c-text-3)]">
            导入自 {c.importSource.fileName}（
            {FORMAT_LABELS[c.importSource.format as ImportFormat] ?? c.importSource.format}）
            {c.extensions && Object.keys(c.extensions).length > 0 && '，未识别的原始字段已保留在扩展数据中'}
          </p>
        )}

        <div className="flex justify-center mt-6">
          <PrimaryButton onClick={() => void chat()}>发消息</PrimaryButton>
        </div>
        <div className="flex justify-center mt-4">
          <button onClick={() => setConfirmDel(true)} className="press text-sm text-[var(--c-danger)] px-4 py-2">
            删除角色
          </button>
        </div>
      </div>

      {picker && (
        <PickerSheet
          title="添加世界书"
          showAvatar={false}
          options={allBooks
            .filter((b) => !linkedBookIds.includes(b.id))
            .map((b) => ({ id: b.id, name: b.name, hint: `${b.entries.length} 个条目` }))}
          emptyText={allBooks.length ? '所有世界书都已关联' : '还没有世界书，请先到「联系人 → 世界书」导入'}
          onClose={() => setPicker(false)}
          onConfirm={(ids) => {
            void Promise.all(ids.map((bid) => linkLorebook(id, bid)))
          }}
        />
      )}
      {unlinkTarget && (
        <ConfirmDialog
          title="解除关联？"
          message={`「${unlinkTarget.name}」将不再关联到这个角色。世界书本身不会被删除。`}
          confirmText="解除"
          onCancel={() => setUnlinkTarget(null)}
          onConfirm={() => {
            void unlinkLorebook(id, unlinkTarget.id)
            setUnlinkTarget(null)
          }}
        />
      )}
      {confirmDel && (
        <ConfirmDialog
          title={`删除「${c.name}」？`}
          message="该角色、与 TA 的聊天记录和相关记忆都会被永久删除，无法恢复。关联的世界书会保留，只解除关联。"
          confirmText="删除"
          danger
          onCancel={() => setConfirmDel(false)}
          onConfirm={async () => {
            await deleteCharacter(id)
            nav('/contacts', { replace: true })
          }}
        />
      )}
    </div>
  )
}
