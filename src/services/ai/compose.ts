/**
 * 以角色身份写一段内容（信件、礼物回应、塔罗解读）：与聊天使用同一套人设、关系、世界、世界书和长期记忆，
 * 真实调用已配置的模型。失败时抛出错误，不使用任何预设文字冒充。
 * 只在用户主动操作时调用；只发送这次任务需要的内容。
 */
import { db } from '../../db/db'
import type { AIConfig, Character, Message } from '../../db/schema'
import { buildContext } from './context'
import { loadContextSources, loadMemories } from './contextInput'
import { AIError, chatTurn } from './openai'
import { getDeviceId, normalizeAIConfig } from './service'

export interface ComposeOptions {
  character: Character
  /** 写作模式的开头（替代聊天的基本要求） */
  intro: string
  /** 写作要求（格式、长度、注意事项） */
  outro: string
  /** 这次的具体任务（作为用户消息发送） */
  task: string
  /** 用于挑选相关记忆与世界书的文字（默认用 task） */
  recallText?: string
  maxTokens?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface Composed {
  text: string
  model: string
}

async function singleChatHistory(characterId: string): Promise<Message[]> {
  const conv = (await db.conversations.toArray()).find((v) => v.type === 'single' && v.characterIds.length === 1 && v.characterIds[0] === characterId)
  return conv ? db.messages.where('conversationId').equals(conv.id).sortBy('createdAt') : []
}

export async function composeWithCharacter(o: ComposeOptions): Promise<Composed> {
  const config: AIConfig = normalizeAIConfig((await db.settings.get('ai-config'))?.value as Partial<AIConfig> | undefined)
  const src = await loadContextSources(o.character)
  const ctx = buildContext({
    character: o.character,
    userName: src.profile.nickname,
    world: src.world,
    lorebooks: src.books,
    history: await singleChatHistory(o.character.id),
    memories: await loadMemories(o.character.id),
    compose: { intro: o.intro, outro: o.outro, recallText: (o.recallText ?? o.task).slice(0, 2000) },
  })
  if (ctx.usedMemoryIds.length) void db.memories.where('id').anyOf(ctx.usedMemoryIds).modify({ lastUsedAt: Date.now() })
  const r = await chatTurn({
    config: o.maxTokens ? { ...config, maxTokens: Math.max(config.maxTokens, o.maxTokens) } : config,
    messages: [...ctx.messages, { role: 'user', content: o.task }],
    signal: o.signal,
    fetchImpl: o.fetchImpl,
    deviceId: config.service === 'lingling' ? await getDeviceId() : '',
  })
  const text = r.content.trim()
  if (!text) throw new AIError('模型返回了空内容，请重试', 'empty')
  return { text, model: config.model }
}
