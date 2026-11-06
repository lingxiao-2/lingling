/**
 * 聊天中实际可用的工具与授权方式。
 *  - 只在「自己的 API」（例如 DeepSeek，OpenAI 兼容）下提供工具；聆聆默认服务暂不提供工具调用
 *  - 本阶段 PR A：权限层尚未接入，涉及个人数据的工具一律不提供、不执行（denyPersonalData）
 */
import type { AIConfig } from '../db/schema'
import { denyPersonalData, type Authorizer } from './executor'
import { toolRegistry, type ToolDefinition } from './registry'

export function toolCallingSupported(config: AIConfig): boolean {
  return config.service !== 'lingling'
}

/** 某个角色这一次可以使用的工具 */
export async function toolsForCharacter(_characterId: string, config: AIConfig): Promise<ToolDefinition[]> {
  if (!toolCallingSupported(config)) return []
  return toolRegistry.list().filter((d) => d.permission === null && !d.confirm)
}

export const authorizeTool: Authorizer = denyPersonalData
