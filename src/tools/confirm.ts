/**
 * 聊天中的确认请求：工具执行前，在聊天页显示卡片，等待你点「允许本次 / 拒绝」或「确认 / 取消」。
 * 停止生成时，等待中的请求按拒绝处理；离开聊天页再回来，卡片仍在。
 */
import { useSyncExternalStore } from 'react'

export interface ConfirmRequest {
  id: string
  conversationId: string
  characterName: string
  tool: string
  /** read：每次询问的读取；write：写入、删除、持久化创建、私人图片 */
  kind: 'read' | 'write'
  title: string
  lines: string[]
  danger?: boolean
  confirmText: string
}

const pending = new Map<string, { req: ConfirmRequest; resolve: (ok: boolean) => void }>()
const listeners = new Set<() => void>()
let snapshot: ConfirmRequest[] = []
const emit = () => {
  snapshot = [...pending.values()].map((p) => p.req)
  for (const l of listeners) l()
}

export function requestConfirmation(req: ConfirmRequest, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false)
    const done = (ok: boolean) => {
      if (!pending.has(req.id)) return
      pending.delete(req.id)
      signal.removeEventListener('abort', onAbort)
      emit()
      resolve(ok)
    }
    const onAbort = () => done(false)
    signal.addEventListener('abort', onAbort, { once: true })
    pending.set(req.id, { req, resolve: done })
    emit()
  })
}

export function resolveConfirmation(id: string, ok: boolean) {
  pending.get(id)?.resolve(ok)
}

export function pendingConfirmations(conversationId?: string): ConfirmRequest[] {
  return snapshot.filter((r) => !conversationId || r.conversationId === conversationId)
}

export function usePendingConfirmation(conversationId: string): ConfirmRequest | undefined {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snapshot,
  )
  return list.find((r) => r.conversationId === conversationId)
}
