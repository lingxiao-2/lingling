/**
 * 一条动态：作者、正文、九宫格配图（点开查看大图）、时间与可见范围、点赞、评论（可回复、可删除自己的评论）。
 */
import { useState } from 'react'
import Avatar from './Avatar'
import { Icon } from '../theme/icons'
import type { Moment, MomentActor, MomentComment } from '../db/schema'
import { addComment, deleteComment, toggleLike } from '../db/momentRepo'
import { hasLiked, momentTime, sameActor, USER_ACTOR, visibilityLabel, visibleComments } from '../services/moments'

export interface ActorInfo {
  name: string
  avatar?: string
}

interface Props {
  m: Moment
  actor: (a: MomentActor) => ActorInfo
  onDelete: (m: Moment) => void
  onOpenImage: (images: string[], index: number) => void
  onError: (msg: string) => void
  /** 用户发表评论后（PR B：角色回复） */
  onCommented?: (m: Moment, c: MomentComment) => void
  /** 删除了自己的评论（页面据此提供撤销） */
  onCommentDeleted?: (m: Moment, c: MomentComment) => void
}

function Grid({ images, onOpen }: { images: string[]; onOpen: (i: number) => void }) {
  if (!images.length) return null
  if (images.length === 1) {
    return (
      <button className="mt-2 block press" onClick={() => onOpen(0)} aria-label="查看图片">
        <img src={images[0]} alt="" className="max-h-[220px] max-w-[70%] rounded-[10px] object-cover" />
      </button>
    )
  }
  const cols = images.length === 4 ? 2 : 3
  return (
    <div className="mt-2 grid gap-1 max-w-[260px]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {images.map((src, i) => (
        <button key={i} className="press aspect-square overflow-hidden rounded-[6px]" onClick={() => onOpen(i)} aria-label={`查看第 ${i + 1} 张图片`}>
          <img src={src} alt="" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  )
}

export default function MomentCard({ m, actor, onDelete, onOpenImage, onError, onCommented, onCommentDeleted }: Props) {
  const [composing, setComposing] = useState(false)
  const [replyTo, setReplyTo] = useState<MomentActor | undefined>()
  const [text, setText] = useState('')
  const author = actor({ type: m.authorType, id: m.authorId })
  const liked = hasLiked(m, USER_ACTOR)
  const comments = visibleComments(m)
  const likes = m.likes ?? []
  const mine = m.authorType === 'user'

  const run = (p: Promise<unknown>) => void p.catch((e) => onError(e instanceof Error ? e.message : String(e)))
  const send = () =>
    run(
      addComment(m.id, USER_ACTOR, text, replyTo).then((c) => {
        setText('')
        setComposing(false)
        setReplyTo(undefined)
        onCommented?.(m, c)
      }),
    )
  const tapComment = (c: MomentComment) => {
    if (sameActor(c.author, USER_ACTOR)) {
      // 软删除，页面底部提供「撤销」
      run(deleteComment(m.id, c.id).then(() => onCommentDeleted?.(m, c)))
      return
    }
    setReplyTo(c.author)
    setComposing(true)
  }

  return (
    <article className="px-4 py-3.5 hairline-b">
      <div className="flex gap-3">
        <Avatar name={author.name} src={author.avatar} size={42} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] text-[var(--c-accent-strong)]">{author.name}</div>
          {m.content && <div className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[var(--c-text)]">{m.content}</div>}
          <Grid images={m.imageRefs} onOpen={(i) => onOpenImage(m.imageRefs, i)} />
          <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--c-text-3)]">
            <span>{momentTime(m.createdAt)}</span>
            {mine && m.visibility !== 'all' && (
              <span className="flex items-center gap-0.5">
                <Icon name="lock" size="xs" />
                {visibilityLabel(m, (id) => actor({ type: 'character', id }).name)}
              </span>
            )}
            {mine && (
              <button className="press text-[var(--c-accent-strong)]" onClick={() => onDelete(m)}>
                删除
              </button>
            )}
            <span className="flex-1" />
            <button aria-label={liked ? '取消点赞' : '点赞'} className={`press h-7 px-2 flex items-center gap-1 rounded-full bg-white/45 ${liked ? 'text-[var(--c-danger)]' : ''}`} onClick={() => run(toggleLike(m.id, USER_ACTOR))}>
              <Icon name="like" size="xs" />
              {liked ? '已赞' : '赞'}
            </button>
            <button aria-label="评论" className="press h-7 px-2 flex items-center gap-1 rounded-full bg-white/45" onClick={() => { setReplyTo(undefined); setComposing((v) => !v) }}>
              <Icon name="comment" size="xs" />
              评论
            </button>
          </div>

          {(likes.length > 0 || comments.length > 0) && (
            <div className="mt-2 rounded-[8px] bg-white/45 px-2.5 py-1.5 text-[13px] leading-relaxed">
              {likes.length > 0 && (
                <div className={`flex items-start gap-1 text-[var(--c-accent-strong)] ${comments.length ? 'pb-1 hairline-b' : ''}`}>
                  <Icon name="like" size="xs" className="mt-1 shrink-0" />
                  <span>{likes.map((l) => actor(l).name).join('，')}</span>
                </div>
              )}
              {comments.map((c) => (
                <button key={c.id} className="block w-full text-left press py-0.5" onClick={() => tapComment(c)}>
                  <span className="text-[var(--c-accent-strong)]">{actor(c.author).name}</span>
                  {c.replyTo && (
                    <>
                      <span className="text-[var(--c-text-3)]"> 回复 </span>
                      <span className="text-[var(--c-accent-strong)]">{actor(c.replyTo).name}</span>
                    </>
                  )}
                  <span className="text-[var(--c-text)]">：{c.content}</span>
                </button>
              ))}
            </div>
          )}

          {composing && (
            <div className="mt-2 flex items-end gap-2">
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={1}
                placeholder={replyTo ? `回复 ${actor(replyTo).name}` : '评论'}
                className="flex-1 min-w-0 resize-none rounded-[12px] bg-white/60 border border-[var(--c-line)] px-3 py-1.5 text-[16px] outline-none focus:border-[var(--c-accent)]"
              />
              <button onClick={send} disabled={!text.trim()} className="press h-9 px-3 rounded-full bg-[var(--c-accent)] text-white text-[13px] disabled:opacity-45">
                发送
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
