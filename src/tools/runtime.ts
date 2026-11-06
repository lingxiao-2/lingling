/**
 * 聊天中实际可用的工具与授权方式。
 *  - 只在「自己的 API」（例如 DeepSeek，OpenAI 兼容）下提供工具；聆聆默认服务暂不提供工具调用
 *  - 只提供该角色已开启（每次询问 / 始终允许）的权限对应的工具；关闭或禁止的根本不让模型知道
 *  - 执行前重新读取权限（撤销立即生效）；需要确认的工具无论权限模式如何都先问你
 */
import type { AIConfig } from '../db/schema'
import { uid } from '../lib/util'
import { requestConfirmation } from './confirm'
import type { Authorizer } from './executor'
import { getMode, getPermissions } from './permissions'
import { toolRegistry, type ToolDefinition } from './registry'
import { registerLifeTools } from './lifeTools'
import { registerMemoryTools } from './memoryTools'

// 生活应用工具：只有在角色被授予对应权限后才会提供给模型
registerLifeTools(toolRegistry)
registerMemoryTools(toolRegistry)

export function toolCallingSupported(config: AIConfig): boolean {
  return config.service !== 'lingling'
}

/** 某个角色这一次可以使用的工具 */
export async function toolsForCharacter(characterId: string, config: AIConfig, registry = toolRegistry): Promise<ToolDefinition[]> {
  if (!toolCallingSupported(config)) return []
  const perms = await getPermissions(characterId)
  return registry.list().filter((d) => (d.permission === null ? !d.confirm : perms[d.permission] === 'ask' || perms[d.permission] === 'always'))
}

export const authorizeTool: Authorizer = async (def, args, ctx) => {
  if (def.permission === null && !def.confirm) return { allowed: true, confirmation: 'not_required' }
  const mode = def.permission ? await getMode(ctx.characterId, def.permission) : 'ask'
  if (mode === 'deny') return { allowed: false, confirmation: 'denied', reason: '用户禁止了这项访问' }
  if (mode === 'off') return { allowed: false, confirmation: 'not_granted', reason: '用户没有授权这项访问' }
  if (mode === 'always' && !def.confirm) return { allowed: true, confirmation: 'always' }

  let title = `${ctx.characterName}想${def.label}`
  let lines: string[] = def.describe?.(args) ?? []
  let danger = false
  if (def.preview) {
    const p = await def.preview(args, ctx)
    if ('error' in p) return { allowed: false, confirmation: 'not_required', reason: p.error, code: /识图/.test(p.error) ? 'unavailable' : /没有找到/.test(p.error) ? 'not_found' : 'invalid' }
    title = p.title
    lines = p.lines
    danger = !!p.danger
  }
  const ok = await requestConfirmation(
    { id: uid('cfm'), conversationId: ctx.conversationId ?? '', characterName: ctx.characterName, tool: def.name, kind: def.confirm ? 'write' : 'read', title, lines, danger, confirmText: def.confirm ? (danger ? '确认删除' : '确认') : '允许本次' },
    ctx.signal,
  )
  if (!ok) return { allowed: false, confirmation: 'user_rejected', reason: ctx.signal.aborted ? '已停止' : '用户拒绝了这次操作' }
  // 等待确认期间权限被撤销：不执行
  if (def.permission) {
    const now = await getMode(ctx.characterId, def.permission)
    if (now !== 'ask' && now !== 'always') return { allowed: false, confirmation: now === 'deny' ? 'denied' : 'not_granted', reason: '权限已被撤销' }
  }
  return { allowed: true, confirmation: 'once' }
}
