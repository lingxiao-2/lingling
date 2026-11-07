/**
 * 礼物：送给角色（TA 根据人设、关系、礼物类型、近期聊天和已确认的共同经历回应）、请 TA 选一份礼物送给你。
 *  - 全部是聆聆里的虚拟礼物：没有金钱、订单、物流、积分
 *  - 回应与回礼都真实调用已配置的模型；失败时如实记录并可重试，不用预设文字冒充
 *  - 只在你点按时调用；每条记录只属于一个角色
 */
import { db, DEFAULT_PROFILE } from '../db/db'
import type { CalEvent, Character, GiftRecord, UserProfile } from '../db/schema'
import { uid } from '../lib/util'
import { composeWithCharacter } from '../services/ai/compose'
import { AIError } from '../services/ai/openai'
import { GIFTS, giftById, type Gift } from './catalog'

export const MESSAGE_MAX = 200

async function userName() {
  const p = { ...DEFAULT_PROFILE, ...(((await db.settings.get('profile'))?.value as UserProfile | undefined) ?? {}) }
  return p.nickname || '你'
}

/** 这个角色关联的纪念日、生日（日历中设置了这个角色的） */
export async function anniversariesOf(characterId: string): Promise<CalEvent[]> {
  return (await db.events.toArray()).filter((e) => !e.deletedAt && e.characterId === characterId && (e.kind === 'anniversary' || e.kind === 'birthday'))
}

const RULES = (name: string, user: string) => [
  `【要求】`,
  `1. 用${name}自己的性格和语气自然地回应，符合你们现在的关系：关系还不亲近时不要过分热情，内敛的人可以只说一两句。`,
  `2. 这是聆聆里的虚拟礼物，不涉及真实的钱和物品；不要提价格、快递、订单。`,
  `3. 只把设定、长期记忆和最近聊天里真实存在的事当作你们的共同经历，不要编造。`,
  `4. 不要替${user}说话或描写${user}的动作。只输出你的回应本身，不要任何解释、引号或格式标记。`,
].join('\n')

function clean(t: string) {
  return t.replace(/<\/?msg>/g, '').replace(/<sticker[^>]*>/g, '').replace(/^["“「]|["”」]$/g, '').trim()
}

/** 送礼物：保存记录，然后请 TA 回应（回应失败时记录保留，可以重试） */
export async function sendGift(o: { characterId: string; giftId: string; message?: string; eventId?: string; fetchImpl?: typeof fetch }): Promise<GiftRecord> {
  const gift = giftById(o.giftId)
  if (!gift) throw new Error('没有这个礼物')
  const c = await db.characters.get(o.characterId)
  if (!c) throw new Error('角色不存在')
  if (o.eventId) {
    const e = await db.events.get(o.eventId)
    if (!e || e.characterId !== c.id) throw new Error('纪念日不存在或不属于这个角色')
  }
  const r: GiftRecord = { id: uid('gift'), characterId: c.id, direction: 'to_character', giftId: gift.id, message: (o.message ?? '').trim().slice(0, MESSAGE_MAX), eventId: o.eventId, replyStatus: 'waiting', starred: false, createdAt: Date.now() }
  await db.giftRecords.add(r)
  await requestReply(r.id, o.fetchImpl).catch(() => {})
  return (await db.giftRecords.get(r.id))!
}

/** 请 TA 回应一份你送出的礼物（第一次或重试） */
export async function requestReply(recordId: string, fetchImpl?: typeof fetch): Promise<string> {
  const r = await db.giftRecords.get(recordId)
  if (!r || r.direction !== 'to_character') throw new Error('只能回应你送出的礼物')
  const c = await db.characters.get(r.characterId)
  const gift = giftById(r.giftId)
  if (!c || !gift) throw new Error('角色或礼物不存在')
  await db.giftRecords.update(r.id, { replyStatus: 'waiting', replyError: undefined })
  const user = await userName()
  const ev = r.eventId ? await db.events.get(r.eventId) : undefined
  try {
    const out = await composeWithCharacter({
      character: c,
      intro: `你是「${c.name}」。${user}刚刚在聆聆里送给你一份虚拟礼物，请以${c.name}的身份回应。`,
      outro: `${RULES(c.name, user)}\n5. 长度约 30～150 字。`,
      task: `${user}送给你的礼物：「${gift.name}」（${gift.desc}）。${r.message ? `\n${user}附上的话：「${r.message}」` : ''}${ev ? `\n这份礼物是为了纪念：「${ev.title}」（${ev.date}）。` : ''}\n请回应。`,
      recallText: `${gift.name} ${r.message} ${ev?.title ?? ''}`,
      maxTokens: 400,
      fetchImpl,
    })
    const reply = clean(out.text)
    if (reply.length < 2) throw new AIError('模型返回的回应是空的', 'empty')
    await db.giftRecords.update(r.id, { reply: reply.slice(0, 600), replyStatus: 'done', model: out.model })
    return reply
  } catch (e) {
    await db.giftRecords.update(r.id, { replyStatus: 'failed', replyError: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

/** 从模型输出中取出 {giftId, message}；礼物必须在清单里 */
export function parseChoice(raw: string): { gift: Gift; message: string } {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new AIError('模型没有按要求选择礼物，请重试', 'other')
  let j: { giftId?: unknown; message?: unknown }
  try {
    j = JSON.parse(m[0])
  } catch {
    throw new AIError('模型返回的格式不对，请重试', 'other')
  }
  const gift = typeof j.giftId === 'string' ? giftById(j.giftId) : undefined
  if (!gift) throw new AIError('模型选择了清单里没有的礼物，没有保存，请重试', 'other')
  const message = typeof j.message === 'string' ? clean(j.message).slice(0, MESSAGE_MAX) : ''
  if (message.length < 2) throw new AIError('模型没有写留言，没有保存，请重试', 'other')
  return { gift, message }
}

/** 请 TA 从清单里选一份礼物送给你 */
export async function askCharacterGift(characterId: string, fetchImpl?: typeof fetch): Promise<GiftRecord> {
  const c: Character | undefined = await db.characters.get(characterId)
  if (!c) throw new Error('角色不存在')
  const user = await userName()
  const recent = (await db.giftRecords.where('characterId').equals(c.id).toArray()).filter((g) => g.direction === 'from_character').slice(-5).map((g) => g.giftId)
  const out = await composeWithCharacter({
    character: c,
    intro: `你是「${c.name}」。${user}希望你在聆聆的虚拟礼物里挑一份送给TA。`,
    outro: `${RULES(c.name, user).replace('只输出你的回应本身，不要任何解释、引号或格式标记。', '')}\n5. 根据你的性格、你们的关系和你真正了解的${user}来挑选；留言约 20～120 字。\n6. 只输出一行 JSON：{"giftId":"清单中的 id","message":"你附上的话"}`,
    task: `可以选择的礼物（id：名称 · 说明）：\n${GIFTS.map((g) => `${g.id}：${g.name} · ${g.desc}`).join('\n')}${recent.length ? `\n你最近已经送过：${recent.join('、')}，尽量换一样。` : ''}`,
    maxTokens: 400,
    fetchImpl,
  })
  const { gift, message } = parseChoice(out.text)
  const r: GiftRecord = { id: uid('gift'), characterId: c.id, direction: 'from_character', giftId: gift.id, message, model: out.model, starred: false, createdAt: Date.now() }
  await db.giftRecords.add(r)
  return r
}

export async function toggleGiftStar(id: string) {
  const r = await db.giftRecords.get(id)
  if (r) await db.giftRecords.update(id, { starred: !r.starred })
}
export async function deleteGiftRecord(id: string) {
  await db.giftRecords.update(id, { deletedAt: Date.now() })
}
export async function restoreGiftRecord(id: string) {
  await db.giftRecords.update(id, { deletedAt: undefined })
}
