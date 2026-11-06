/**
 * AI 工具权限：逐个角色管理，**默认全部关闭**。
 *  - off（关闭，默认）/ deny（禁止访问）：工具根本不提供给模型
 *  - ask（每次询问）：每次使用前在聊天里问你「允许本次 / 拒绝」
 *  - always（本角色始终允许）：只对读取有效；写入、删除、持久化创建、发送私人图片无论如何都要逐次确认
 * 权限只能由用户在「AI 工具权限」页修改，没有任何工具可以修改权限。
 * 存在 settings 'tool-permissions'（随「设置」进入备份）；每次执行前都重新读取，撤销立即生效。
 */
import { db } from '../db/db'
import { TOOL_PERMISSIONS, type ToolPermission } from './registry'

export type PermissionMode = 'off' | 'ask' | 'always' | 'deny'
export const PERMISSIONS_KEY = 'tool-permissions'

export interface ToolPermissionStore {
  version: 1
  characters: Record<string, Partial<Record<ToolPermission, PermissionMode>>>
}

export const PERMISSION_INFO: Record<ToolPermission, { label: string; hint: string; write?: boolean }> = {
  calendar_read: { label: '日历读取', hint: '查看日程、重复事件和纪念日' },
  calendar_write: { label: '日历写入', hint: '创建、修改、删除日程；每一次都要你先确认', write: true },
  notes_read: { label: '便签读取', hint: '查看和搜索便签（最近删除的不会读取）' },
  notes_write: { label: '便签写入', hint: '创建、修改、删除便签；每一次都要你先确认', write: true },
  diary_read: { label: '日记读取', hint: '只读，只包括逐篇勾选了「允许 AI 读取」的日记；不会写入长期记忆' },
  album_meta: { label: '相册元数据', hint: '照片名称、备注、日期和相册，不包含图片本身' },
  image_read: { label: '图片读取', hint: '把某张照片交给支持识图的模型；每一次都要你先确认，不会自动上传', write: true },
  memory_propose: { label: '记忆提议', hint: '提出新的长期记忆，只进入「待确认」，由你决定是否保存' },
}

const MODES: PermissionMode[] = ['off', 'ask', 'always', 'deny']

async function read(): Promise<ToolPermissionStore> {
  const v = (await db.settings.get(PERMISSIONS_KEY))?.value as Partial<ToolPermissionStore> | undefined
  const out: ToolPermissionStore = { version: 1, characters: {} }
  if (!v || typeof v.characters !== 'object' || !v.characters) return out
  for (const [cid, perms] of Object.entries(v.characters)) {
    if (!perms || typeof perms !== 'object') continue
    const clean: Partial<Record<ToolPermission, PermissionMode>> = {}
    for (const p of TOOL_PERMISSIONS) {
      const m = (perms as Record<string, unknown>)[p]
      // 数据损坏或未知的值一律当作关闭
      if (typeof m === 'string' && MODES.includes(m as PermissionMode) && m !== 'off') clean[p] = m as PermissionMode
    }
    out.characters[cid] = clean
  }
  return out
}

export async function getPermissions(characterId: string): Promise<Record<ToolPermission, PermissionMode>> {
  const s = await read()
  const mine = s.characters[characterId] ?? {}
  return Object.fromEntries(TOOL_PERMISSIONS.map((p) => [p, mine[p] ?? 'off'])) as Record<ToolPermission, PermissionMode>
}

export async function getMode(characterId: string, permission: ToolPermission): Promise<PermissionMode> {
  return (await getPermissions(characterId))[permission]
}

/** 只有「AI 工具权限」页调用 */
export async function setMode(characterId: string, permission: ToolPermission, mode: PermissionMode): Promise<void> {
  if (!TOOL_PERMISSIONS.includes(permission) || !MODES.includes(mode)) throw new Error('权限设置不合法')
  await db.transaction('rw', db.settings, async () => {
    const s = await read()
    const mine = { ...(s.characters[characterId] ?? {}) }
    if (mode === 'off') delete mine[permission]
    else mine[permission] = mode
    s.characters[characterId] = mine
    await db.settings.put({ key: PERMISSIONS_KEY, value: s })
  })
}

/** 一键关闭某个角色的全部权限 */
export async function revokeAll(characterId: string): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const s = await read()
    delete s.characters[characterId]
    await db.settings.put({ key: PERMISSIONS_KEY, value: s })
  })
}

/** 已开启（每次询问或始终允许）的权限数量 */
export async function grantedCount(characterId: string): Promise<number> {
  return Object.values(await getPermissions(characterId)).filter((m) => m === 'ask' || m === 'always').length
}
