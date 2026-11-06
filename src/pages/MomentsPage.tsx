/**
 * 动态（朋友圈）：自己的头像与签名、动态列表（新的在上）、点赞评论、查看大图、删除后可撤销。
 * 所有数据只保存在本机。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import NavBar, { NavButton } from '../components/NavBar'
import Avatar from '../components/Avatar'
import MomentCard, { type ActorInfo } from '../components/MomentCard'
import { Empty } from '../components/ui'
import { db } from '../db/db'
import type { Character, Moment, MomentActor } from '../db/schema'
import { deleteComment, deleteMoment, restoreMoment } from '../db/momentRepo'
import { feed } from '../services/moments'
import { ActionSheet } from '../components/Sheet'
import { canJoinMoments, generateCharacterMoment, replyToComment, useMomentBusy } from '../services/ai/momentEngine'
import { useProfile } from '../store/profile'

export function ImageViewer({ images, index, onClose }: { images: string[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index)
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose} role="dialog" aria-label="查看图片">
      <img src={images[i]} alt="" className="max-h-full max-w-full object-contain" />
      {images.length > 1 && (
        <>
          <button aria-label="上一张" className="absolute left-0 top-0 bottom-0 w-1/4" onClick={(e) => { e.stopPropagation(); setI((i - 1 + images.length) % images.length) }} />
          <button aria-label="下一张" className="absolute right-0 top-0 bottom-0 w-1/4" onClick={(e) => { e.stopPropagation(); setI((i + 1) % images.length) }} />
          <div className="absolute bottom-[calc(var(--safe-bottom)+16px)] text-white/80 text-[13px]">{i + 1} / {images.length}</div>
        </>
      )}
    </div>
  )
}

interface Undo {
  text: string
  run: () => Promise<unknown>
}

export default function MomentsPage() {
  const nav = useNavigate()
  const profile = useProfile()
  const moments = useLiveQuery(() => db.moments.toArray(), [], undefined as Moment[] | undefined)
  const chars = useLiveQuery(() => db.characters.toArray(), [], [] as Character[])
  const [viewer, setViewer] = useState<{ images: string[]; index: number } | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const [err, setErr] = useState('')
  const [picking, setPicking] = useState(false)
  const busy = useMomentBusy()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])
  const offerUndo = (u: Undo) => {
    clearTimeout(timer.current)
    setUndo(u)
    timer.current = setTimeout(() => setUndo(null), 6000)
  }

  const byId = new Map(chars.map((c) => [c.id, c]))
  const actor = (a: MomentActor): ActorInfo => {
    if (a.type === 'user') return { name: profile.nickname || '我', avatar: profile.avatar }
    const c = byId.get(a.id)
    return { name: c?.name ?? '已删除的角色', avatar: c?.avatar }
  }
  const list = moments ? feed(moments) : []
  const joinable = chars.filter(canJoinMoments)
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : String(e))
  const posting = [...busy.keys()].filter((k) => k.startsWith('post:')).map((k) => byId.get(k.slice(5))?.name ?? '')
  const noteFor = (m: Moment) => {
    const reply = busy.get(`reply:${m.id}`)
    if (reply) return reply
    const reacting = [...busy.keys()].filter((k) => k.startsWith(`react:${m.id}:`)).map((k) => byId.get(k.split(':')[2])?.name ?? '')
    return reacting.length ? `${reacting.join('、')}正在看你的动态…` : undefined
  }

  return (
    <>
      <NavBar
        title="动态"
        sideWidth={84}
        right={
          <>
            <NavButton label="让角色发动态" icon="character" onClick={() => { setErr(''); setPicking(true) }} />
            <NavButton label="发动态" icon="camera" onClick={() => nav('/moments/new')} />
          </>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        <section className="mx-3 mt-2 glass rounded-[var(--radius-card)] px-4 py-4 flex items-center gap-3">
          <Avatar name={profile.nickname || '我'} src={profile.avatar} size={56} />
          <div className="min-w-0">
            <div className="serif-zh text-[17px] tracking-[0.06em] text-[var(--c-brand)] truncate">{profile.nickname || '我'}</div>
            <div className="mt-0.5 text-[12px] text-[var(--c-text-3)] truncate">{profile.signature || '动态只保存在这台设备上'}</div>
          </div>
        </section>

        {posting.length > 0 && <p className="mx-6 mt-2 text-[12px] text-[var(--c-text-3)]">{posting.join('、')}正在写动态…</p>}
        {moments && list.length === 0 && (
          <Empty
            title="还没有动态"
            hint="点右上角的相机发一条吧。可以只给部分角色看，也可以仅自己可见；所有内容只保存在这台设备上。"
          />
        )}
        {list.length > 0 && (
          <div className="mx-3 mt-3 glass rounded-[var(--radius-card)] overflow-hidden">
            {list.map((m) => (
              <MomentCard
                key={m.id}
                m={m}
                actor={actor}
                onError={setErr}
                onOpenImage={(images, index) => setViewer({ images, index })}
                onDelete={(x) =>
                  void deleteMoment(x.id).then(() => offerUndo({ text: '动态已删除', run: () => restoreMoment(x.id) }), (e) => setErr(String(e?.message ?? e)))
                }
                onCommentDeleted={(x, c) => offerUndo({ text: '评论已删除', run: () => deleteComment(x.id, c.id, false) })}
                onCommented={(x, c) => void replyToComment(x.id, c).catch(fail)}
                busyNote={noteFor(m)}
              />
            ))}
          </div>
        )}
        {err && <p className="mx-6 mt-3 text-[12.5px] text-[var(--c-danger)]">{err}</p>}
      </div>

      {undo && (
        <div className="fixed left-4 right-4 z-40 flex justify-center" style={{ bottom: 'calc(var(--safe-bottom) + 84px)' }}>
          <div className="glass-3 rounded-full px-4 h-10 flex items-center gap-3 text-[13px] shadow-[var(--shadow-soft)]">
            <span className="text-[var(--c-text-2)]">{undo.text}</span>
            <button
              className="press text-[var(--c-accent-strong)]"
              onClick={() => {
                const u = undo
                setUndo(null)
                void u.run().catch((e) => setErr(String(e?.message ?? e)))
              }}
            >
              撤销
            </button>
          </div>
        </div>
      )}
      {picking && (
        <ActionSheet
          title="让谁发一条动态？"
          subtitle={joinable.length ? '会向你配置的 AI 服务发送一次请求；只依据角色的人设、记忆和你们真实的聊天，不会编造共同经历' : '没有开启「参与朋友圈」的角色。可以在角色资料页开启'}
          actions={joinable.map((c) => ({ label: c.name, onClick: () => { setPicking(false); void generateCharacterMoment(c.id).catch(fail) } }))}
          onClose={() => setPicking(false)}
        />
      )}
      {viewer && <ImageViewer images={viewer.images} index={viewer.index} onClose={() => setViewer(null)} />}
    </>
  )
}
