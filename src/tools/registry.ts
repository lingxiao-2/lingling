/**
 * AI 工具注册表。每个工具都必须有：唯一名称、说明、严格的参数定义、所需权限、执行函数、标准结果；
 * 是否必须在执行前由用户确认（写入、删除、持久化创建、发送私人图片）写在定义里，任何权限模式都不能跳过。
 *
 * 安全边界
 *  - 只有注册在这里的工具能被执行；模型提出的未知工具一律拒绝
 *  - 工具只调用本应用的数据函数，不执行任意 JavaScript、不拼接数据库查询、不发起网络请求
 */
import type { ToolSpecForModel } from '../services/ai/openai'
import { wireName } from '../services/ai/openai'
import { schemaProblem, toJsonSchema, type ObjectSchema } from './schema'

/** 角色可以被授予的工具权限（AI 工具权限页逐个角色管理，默认全部关闭） */
export const TOOL_PERMISSIONS = ['calendar_read', 'calendar_write', 'notes_read', 'notes_write', 'diary_read', 'album_meta', 'image_read', 'memory_propose'] as const
export type ToolPermission = (typeof TOOL_PERMISSIONS)[number]

export type ToolErrorCode =
  | 'unknown_tool'
  | 'bad_arguments'
  | 'not_granted'
  | 'denied'
  | 'user_rejected'
  | 'not_found'
  | 'invalid'
  | 'execution_failed'
  | 'timeout'
  | 'aborted'
  | 'result_too_large'
  | 'limit_reached'
  | 'duplicate_call'
  | 'unavailable'

export type ToolResult =
  | { ok: true; data: unknown; /** 写进执行记录的简短说明（只写条数、ID，不写私人内容） */ summary: string }
  | { ok: false; code: ToolErrorCode; error: string }

export interface ToolContext {
  characterId: string
  characterName: string
  conversationId?: string
  signal: AbortSignal
}

/** 需要确认的工具在执行前给用户看的预览 */
export interface ToolPreview {
  title: string
  lines: string[]
  /** 危险操作（删除）用红色按钮 */
  danger?: boolean
}

export interface ToolDefinition {
  /** 唯一名称，例如 calendar.list_events */
  name: string
  /** 给模型看的说明 */
  description: string
  /** 给用户看的简短动作描述，例如「查看你的日程」 */
  label: string
  parameters: ObjectSchema
  /** 所需权限；null 表示不涉及任何个人数据（目前只有测试用的工具） */
  permission: ToolPermission | null
  /** 执行前必须由用户逐次确认（写入、删除、持久化创建、发送私人图片），与权限模式无关 */
  confirm: boolean
  timeoutMs?: number
  /** 结果序列化后的最大字数 */
  maxResultChars?: number
  /** 确认卡片上显示的内容（confirm 为 true 的工具必须提供） */
  /** 「每次询问」时给你看这次要读取的范围（例如「11月7日 的日程」），不读取任何数据 */
  describe?: (args: Record<string, unknown>) => string[]
  preview?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolPreview | { error: string }>
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

const NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/

export class ToolRegistry {
  private defs = new Map<string, ToolDefinition>()

  register(def: ToolDefinition): this {
    if (!NAME.test(def.name)) throw new Error(`工具名称不合法：${def.name}`)
    if (this.defs.has(def.name)) throw new Error(`工具名称重复：${def.name}`)
    if (!def.description.trim() || !def.label.trim()) throw new Error(`工具 ${def.name} 缺少说明`)
    const p = schemaProblem(def.parameters)
    if (p) throw new Error(`工具 ${def.name} 的参数定义不合法：${p}`)
    if (def.confirm && !def.preview) throw new Error(`需要确认的工具 ${def.name} 必须提供预览`)
    if (def.permission !== null && !TOOL_PERMISSIONS.includes(def.permission)) throw new Error(`工具 ${def.name} 的权限不存在`)
    this.defs.set(def.name, def)
    return this
  }

  unregister(name: string) {
    this.defs.delete(name)
  }

  get(name: string): ToolDefinition | undefined {
    return this.defs.get(name)
  }

  list(): ToolDefinition[] {
    return [...this.defs.values()]
  }
}

export function toModelTools(defs: ToolDefinition[]): ToolSpecForModel[] {
  return defs.map((d) => ({ type: 'function', function: { name: wireName(d.name), description: d.description, parameters: toJsonSchema(d.parameters) } }))
}

/** 应用唯一的工具注册表（生活应用、记忆工具在各自的模块里注册） */
export const toolRegistry = new ToolRegistry()
