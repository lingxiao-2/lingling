/**
 * AI 服务适配层接口（第二轮实现）。
 * 目标：UI 与具体模型服务解耦，先支持 OpenAI-compatible Chat Completions，
 * 之后可增加其他协议或「安全代理」实现而不改动聊天界面。
 */
import type { AIConfig } from '../../db/schema'

/** OpenAI 兼容的多模态内容（只在支持图片的模型上使用） */
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

/** OpenAI 兼容的工具调用（模型提出，前端解析、校验、授权后才执行） */
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  /** assistant：本轮模型提出的工具调用 */
  tool_calls?: ToolCall[]
  /** tool：对应哪一次调用 */
  tool_call_id?: string
}

export interface GenerateOptions {
  config: AIConfig
  messages: ChatTurn[]
  /** 用于用户手动停止生成 */
  signal?: AbortSignal
}

export interface ChatProvider {
  /** 连接测试：用最小请求验证地址、密钥、模型和 CORS 是否可用 */
  testConnection(config: AIConfig, signal?: AbortSignal): Promise<{ ok: boolean; message: string }>
  /** 生成一次回复（完整文本）；流式输出在后续版本加入 */
  generate(options: GenerateOptions): Promise<string>
}
