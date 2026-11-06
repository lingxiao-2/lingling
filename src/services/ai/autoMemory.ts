/**
 * 自动记忆。
 *
 *  1. 聊天中说「记住……」：用户明确的要求，原样保存（memoryPrefs.rememberRequests，默认开启，可以关闭）。
 *     与已有记忆重复时只合并依据，不新增；敏感内容先放进「待确认」。
 *  2. 定期提取：只有用户在记忆页面开启并同意后才会运行（memoryPrefs.autoExtract，默认关闭）。
 *     每新增 20 条用户消息，在一次回复完成后，把这段时间的聊天（最多 40 条）发给用户自己配置的 AI 服务，
 *     提取候选。候选必须引用用户本人的原话，只进入「待确认」，用户确认后才会在聊天中使用。
 *     敏感内容（健康、财务等）默认直接丢弃；用户另外允许后才作为待确认候选保存，且 7 天内不确认就清除。
 *  每个角色独立，一次只运行一个；失败不影响聊天，只在记忆页面显示原因。
 */
import { db } from '../../db/db'
import type { Character, Memory, Message } from '../../db/schema'
import { addProposals, purgeStalePending, setMemoryPrefs } from '../../db/memoryRepo'
import { extractWithAI, proposeFromRequests } from './memory'
import { configProblem } from './openai'
import { getDeviceId, normalizeAIConfig } from './service'
import type { AIConfig } from '../../db/schema'

/** 每新增多少条用户消息自动提取一次 */
export const AUTO_EVERY = 20
/** 每次最多发送多少条最近消息 */
export const AUTO_WINDOW = 40

/** 处理聊天中的「记住……」：返回新增的记忆（敏感的为待确认） */
export async function saveRememberRequests(character: Character, history: Message[], memories: Memory[]): Promise<Memory[]> {
  if (character.memoryPrefs?.rememberRequests === false) return []
  const ps = proposeFromRequests(history, memories)
  if (!ps.length) return []
  const { added } = await addProposals(character.id, ps, { status: (p) => (p.sensitive ? 'pending' : 'active'), priority: 2 })
  return added
}

/** 自上次提取以来、需要处理的消息；不到 AUTO_EVERY 条用户消息时返回 null */
export function autoExtractBatch(character: Pick<Character, 'memoryPrefs'>, history: Message[]): Message[] | null {
  const p = character.memoryPrefs
  if (!p?.autoExtract || !p.autoConsentAt) return null
  const since = Math.max(p.lastExtractedAt ?? 0, p.autoConsentAt - 1)
  const fresh = history.filter((m) => !m.deleted && !m.superseded && m.kind === 'text' && m.createdAt > since)
  if (fresh.filter((m) => m.senderType === 'user').length < AUTO_EVERY) return null
  return fresh.slice(-AUTO_WINDOW)
}

const running = new Set<string>()

export interface AutoExtractResult {
  ran: boolean
  added: number
  merged: number
  droppedSensitive: number
  note?: string
}

/** 回复完成后调用：满足条件时在后台提取一次（结果只进入「待确认」） */
export async function maybeAutoExtract(characterId: string, convId: string, opts: { fetchImpl?: typeof fetch; config?: AIConfig } = {}): Promise<AutoExtractResult> {
  const none: AutoExtractResult = { ran: false, added: 0, merged: 0, droppedSensitive: 0 }
  if (running.has(characterId)) return none
  const character = await db.characters.get(characterId)
  if (!character?.memoryPrefs?.autoExtract) return none
  const history = await db.messages.where('conversationId').equals(convId).sortBy('createdAt')
  const batch = autoExtractBatch(character, history)
  if (!batch) return none
  running.add(characterId)
  try {
    await purgeStalePending(characterId)
    const config = opts.config ?? normalizeAIConfig((await db.settings.get('ai-config'))?.value as Partial<AIConfig> | undefined)
    const problem = configProblem(config)
    if (problem) {
      await setMemoryPrefs(characterId, { lastNote: `自动提取没有运行：${problem}` })
      return { ...none, note: problem }
    }
    const profile = (await db.settings.get('profile'))?.value as { nickname?: string } | undefined
    const existing = await db.memories.where('characterId').equals(characterId).toArray()
    const r = await extractWithAI(config, character.name, profile?.nickname || '我', batch, existing, {
      deviceId: config.service === 'lingling' ? await getDeviceId() : '',
      fetchImpl: opts.fetchImpl,
    })
    const allowSensitive = !!character.memoryPrefs.allowSensitive
    const keep = r.proposals.filter((p) => allowSensitive || !p.sensitive || p.mergeInto)
    const droppedSensitive = r.proposals.length - keep.length
    const { added, merged } = await addProposals(characterId, keep)
    const note = `${new Date().toLocaleString()} 自动提取：新增待确认 ${added.length} 条${merged ? `，合并重复 ${merged} 条` : ''}${droppedSensitive ? `，${droppedSensitive} 条敏感内容未保存` : ''}`
    await setMemoryPrefs(characterId, { lastExtractedAt: batch[batch.length - 1].createdAt, lastNote: note })
    return { ran: true, added: added.length, merged, droppedSensitive, note }
  } catch (e) {
    // 失败也记下进度：等再聊 20 条才会重试，避免每次回复都重复请求、重复计费
    const note = `${new Date().toLocaleString()} 自动提取失败：${e instanceof Error ? e.message : String(e)}`
    await setMemoryPrefs(characterId, { lastExtractedAt: batch[batch.length - 1].createdAt, lastNote: note })
    return { ...none, ran: true, note }
  } finally {
    running.delete(characterId)
  }
}
