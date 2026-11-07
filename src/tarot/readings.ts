/**
 * 塔罗记录：抽牌结果保存在本机；AI 解读只在你请求时调用模型；你同意后才保存到日记。
 * 塔罗只用于娱乐与自我反思，不能作为医疗、财务或其他重大决定的依据。
 */
import { db, DEFAULT_PROFILE } from '../db/db'
import type { TarotReading, UserProfile } from '../db/schema'
import { saveDiary } from '../db/diaryRepo'
import { localDate } from '../life/diary'
import { uid } from '../lib/util'
import { composeWithCharacter } from '../services/ai/compose'
import { AIError } from '../services/ai/openai'
import { cardById, draw, secureRandom, SPREADS, type Rng, type SpreadId } from './deck'

export const DISCLAIMER = '塔罗仅供娱乐与自我反思，不是对未来的预测，也不能作为医疗、财务、法律或其他重大决定的依据。'
export const QUESTION_MAX = 100

export async function newReading(spread: SpreadId, question: string, theme: TarotReading['theme'], rng: Rng = secureRandom): Promise<TarotReading> {
  const r: TarotReading = { id: uid('tarot'), spread, question: question.trim().slice(0, QUESTION_MAX), cards: draw(spread, rng), theme, createdAt: Date.now() }
  await db.tarotReadings.add(r)
  return r
}

/** 牌面的文字描述（解读与保存到日记共用） */
export function cardsText(r: TarotReading): string {
  return r.cards.map((d) => {
    const c = cardById(d.cardId)!
    return `【${d.position}】${c.name}（${c.en}）${d.reversed ? '逆位' : '正位'}：${d.reversed ? c.reversed : c.upright}`
  }).join('\n')
}

export async function interpret(readingId: string, characterId: string, fetchImpl?: typeof fetch): Promise<string> {
  const r = await db.tarotReadings.get(readingId)
  if (!r) throw new Error('记录不存在')
  const c = await db.characters.get(characterId)
  if (!c) throw new Error('角色不存在')
  const p = { ...DEFAULT_PROFILE, ...(((await db.settings.get('profile'))?.value as UserProfile | undefined) ?? {}) }
  const user = p.nickname || '你'
  const out = await composeWithCharacter({
    character: c,
    intro: `你是「${c.name}」。${user}抽了塔罗牌，请你以${c.name}的身份和语气，陪TA一起看看这些牌。`,
    outro: [
      '【要求】',
      `1. 只根据下面真实抽到的牌和${user}的问题来解读，每张牌都要提到；可以用讲故事或情绪反思的方式，语气符合${c.name}的性格。`,
      '2. 塔罗只是娱乐和自我反思：不要预测确定的未来，不要给出医疗、财务、法律或其他重大决定的建议；如果问题涉及这些，温和地建议去找专业的人。',
      `3. 不要编造你们没有经历过的事。不要替${user}做决定。`,
      '4. 长度约 150～400 字。只输出解读本身，不要格式标记。',
    ].join('\n'),
    task: `${r.question ? `${user}的问题：「${r.question}」\n` : `${user}没有写具体问题，想看看此刻的指引。\n`}牌阵：${SPREADS[r.spread].name}\n${cardsText(r)}`,
    maxTokens: 900,
    fetchImpl,
  })
  const text = out.text.replace(/<\/?msg>/g, '').trim()
  if (text.length < 20) throw new AIError('模型返回的解读太短，没有保存，请重试', 'empty')
  await db.tarotReadings.update(r.id, { interpretation: text.slice(0, 3000), interpreterId: c.id, model: out.model })
  return text
}

/** 你同意后，把这次占卜保存为一篇日记（只给自己看，不允许 AI 读取） */
export async function saveReadingToDiary(readingId: string): Promise<string> {
  const r = await db.tarotReadings.get(readingId)
  if (!r) throw new Error('记录不存在')
  if (r.diaryId && (await db.diaries.get(r.diaryId))) return r.diaryId
  const who = r.interpreterId ? (await db.characters.get(r.interpreterId))?.name : undefined
  const body = [r.question ? `问题：${r.question}` : '', `牌阵：${SPREADS[r.spread].name}`, cardsText(r), r.interpretation ? `\n${who ?? '角色'}的解读：\n${r.interpretation}` : '', `\n（${DISCLAIMER}）`].filter(Boolean).join('\n')
  const id = await saveDiary(null, { date: localDate(new Date(r.createdAt)), title: `塔罗 · ${r.question || SPREADS[r.spread].name}`.slice(0, 40), body, tags: ['塔罗'], photoIds: [], aiReadable: false })
  if (!id) throw new Error('保存日记失败')
  await db.tarotReadings.update(r.id, { diaryId: id })
  return id
}

export async function deleteReading(id: string) {
  await db.tarotReadings.update(id, { deletedAt: Date.now() })
}
