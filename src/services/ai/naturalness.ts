/**
 * 自然聊天的「分寸」提示（纯函数，不调用模型）。
 *
 *  - personaVoice：从用户导入的人设原文里识别话量、松弛感、外向、冷静、内敛等特点，转成具体的表达分寸。
 *    只认原文明确写出的词（带否定的不算），识别不到就不写——不会给所有角色套同一个模板。
 *  - turnGuidance：看这一轮对方说了什么、角色最近几次是怎么回的，提醒模型避免重复的开头、口头禅、
 *    连续追问、每次都给建议、每句都叫昵称、每条都带 emoji，以及按情境决定回复的长短。
 *
 *  这些提示只影响「怎么说」，不改动人设内容；与人设冲突时以人设为准。
 */
import type { Character, Message } from '../../db/schema'

type Trait = { re: RegExp; hint: string }

/** 顺序即输出顺序；同一类只输出一次 */
const TRAITS: Trait[] = [
  { re: /(寡言|话少|话很少|少言|沉默寡言|不爱说话|不善言辞|惜字如金|言简意赅|三棍子打不出)/, hint: '你话少：多数时候一条短消息就够，不主动展开，不连发好几条；认真的事也只说要紧的几句。' },
  { re: /(慵懒|懒散|懒洋洋|懒懒|松弛|随性|佛系|散漫|漫不经心)/, hint: '你说话带着松弛感：不急不躁，可以拖长语气、偶尔敷衍两句，但在意的事会稳稳接住。' },
  { re: /(活泼|开朗|话痨|话多|元气|外向|爱闹|跳脱|热情|爱笑|闹腾)/, hint: '你比较外向：可以主动开玩笑、接梗、连发几条，但不用每次都很满。' },
  { re: /(冷静|沉稳|理性|稳重|淡定|克制|理智)/, hint: '你表达稳定：语气平稳，少用感叹号和语气词，情绪不大起大落。' },
  { re: /(内敛|含蓄|害羞|腼腆|别扭|傲娇|嘴硬|口是心非|不善表达)/, hint: '你表达亲密很含蓄：关心藏在细节和行动里，不说直白的情话，不会突然变得油腻或黏人。' },
  { re: /(毒舌|嘴损|损人|腹黑|刻薄|嘴欠)/, hint: '你嘴上不饶人：可以调侃、损两句，但不真的伤人，对方真难过时会收起来。' },
  { re: /(高冷|冷淡|冷漠|疏离|面瘫)/, hint: '你外表冷淡：回复简短克制，不主动热络；在意也不会说得很满。' },
]

const NEG_BEFORE = /(不|并不|没有|没那么|不太|不算|不再|一点也不|从不)$/

/** 从人设原文中识别表达分寸（性格、说话风格、简介；不读背景故事，避免把经历当成性格） */
export function personaVoice(c: Pick<Character, 'personality' | 'speakingStyle' | 'bio'>): string[] {
  const text = [c.personality, c.speakingStyle, c.bio].filter(Boolean).join('\n')
  if (!text.trim()) return []
  const out: string[] = []
  for (const t of TRAITS) {
    const re = new RegExp(t.re.source, 'g')
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 4), m.index)
      if (NEG_BEFORE.test(before)) continue
      out.push(t.hint)
      break
    }
  }
  return out
}

export function personaVoiceSection(c: Pick<Character, 'personality' | 'speakingStyle' | 'bio'>): string {
  const lines = personaVoice(c)
  if (!lines.length) return ''
  return `【人设里的说话分寸】（从上面的人设中提炼，用来把握话量和亲密表达；以人设原文为准）\n${lines.map((l) => `· ${l}`).join('\n')}`
}

/** 常见的爱称：被叫得太频繁时提醒 */
const PET_NAMES = ['宝宝', '宝贝', '亲爱的', '乖乖', '小可爱', '老婆', '老公', 'honey', 'baby']
const SUGGEST = /(建议|你可以试试|可以试试|不妨|要不要试试|最好(是|先)?|记得要|别忘了要|多喝(热)?水)/
const EMOJI = /\p{Extended_Pictographic}/u
const SERIOUS = /(怎么办|为什么|为啥|怎么(做|写|弄|处理|回事)|如何|解释|帮我|代码|报错|作业|题目|论文|面试|简历|工作上|医生|医院|症状|合同|考试|原理|区别|步骤|推荐一下)/
const EMOTION = /(难过|好累|累死|烦死|好烦|想哭|哭了|崩溃|失眠|委屈|压力好大|焦虑|难受|不开心|伤心|孤单|心累|emo)/
const QUESTION_END = /[？?][」”"')）]*$/

interface Group {
  texts: string[]
}

/** 角色最近的几组回复（同一次生成的多条为一组；按时间从旧到新） */
function recentGroups(active: Message[], max: number): Group[] {
  const groups: Group[] = []
  let cur: Group | null = null
  let curId = ''
  for (const m of active) {
    if (m.senderType !== 'character') {
      cur = null
      curId = ''
      continue
    }
    const id = m.replyGroupId ?? m.id
    if (!cur || id !== curId) {
      cur = { texts: [] }
      curId = id
      groups.push(cur)
    }
    if (m.kind !== 'sticker') cur.texts.push(m.content.trim())
  }
  return groups.filter((g) => g.texts.length).slice(-max)
}

/** 一条消息的开头（去掉标点和空白后的前两个字） */
function opener(t: string): string {
  const s = t.replace(/^[\s\p{P}\p{S}]+/u, '')
  const m = s.match(/^[一-龥]{2}/)
  return m ? m[0] : ''
}

/** 在多条不同消息中反复出现的 4 字说法（只看中文，过滤掉昵称和名字） */
function repeatedPhrases(texts: string[], exclude: string[], minMsgs = 3): string[] {
  const count = new Map<string, number>()
  const names = exclude.filter((x) => x && x.length >= 2).sort((a, b) => b.length - a.length)
  for (const raw of texts) {
    // 名字和昵称本身不算口头禅（昵称是否叫得太多另外判断），先去掉再找重复说法
    let t = raw
    for (const x of names) t = t.split(x).join('，')
    const seen = new Set<string>()
    for (const run of t.match(/[一-龥]{4,}/g) ?? []) for (let i = 0; i + 4 <= run.length; i++) seen.add(run.slice(i, i + 4))
    for (const g of seen) count.set(g, (count.get(g) ?? 0) + 1)
  }
  const hits = [...count.entries()]
    .filter(([, n]) => n >= minMsgs)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g)
  // 合并相互重叠的片段（「我会一直」「会一直在」只保留一个）
  const out: string[] = []
  for (const g of hits) {
    const overlaps = (a: string, b: string) => [1, 2, 3].some((k) => b.startsWith(a.slice(k)))
    if (out.some((o) => overlaps(o, g) || overlaps(g, o))) continue
    out.push(g)
    if (out.length >= 3) break
  }
  return out
}

export interface TurnGuidanceInput {
  /** 当前有效的聊天记录（按时间升序，见 activeMessages） */
  active: Message[]
  charName: string
  userName: string
  /** 角色对用户的称呼（来自关系识别），用于判断是否叫得太频繁 */
  nicknames?: string[]
  /** 本会话中用户发言的轮数 */
  exchanges: number
}

/** 这一轮的分寸提示；没有需要提醒的就返回空数组 */
export function turnGuidance({ active, charName, userName, nicknames = [], exchanges }: TurnGuidanceInput): string[] {
  const lines: string[] = []
  // 对方这一轮说的话（最近一条角色消息之后的用户消息）
  const lastUser: string[] = []
  for (let i = active.length - 1; i >= 0; i--) {
    const m = active[i]
    if (m.senderType === 'character') break
    if (m.senderType === 'user') lastUser.unshift(m.kind === 'sticker' ? '' : m.content.trim())
  }
  const said = lastUser.join('\n').trim()
  const onlySticker = lastUser.length > 0 && !said
  if (said) {
    if (EMOTION.test(said)) {
      lines.push(`${userName}在说自己的情绪：先用你自己的方式接住，不讲道理、不急着给建议，也不要用「我理解你的感受」这类套话。`)
    } else if (SERIOUS.test(said) || said.length >= 80) {
      lines.push(`${userName}在认真问事情或说正事：先把事情说清楚，可以写长一点，用 1～2 条完整回答，不必拆成很多条。`)
    } else if (said.length <= 12 && !/[？?]/.test(said)) {
      lines.push(`${userName}这句很随意：像平时发微信那样回一两句就好，不用展开，不用总结，也不用反问。`)
    }
  } else if (onlySticker) {
    lines.push(`${userName}只发了一个表情包：轻轻接一句或回个表情就好，不用长篇回应。`)
  }

  const groups = recentGroups(active, 6)
  const last3 = groups.slice(-3)
  if (last3.length >= 2 && last3.filter((g) => QUESTION_END.test(g.texts[g.texts.length - 1])).length >= 2) {
    lines.push('你最近几次回复都以提问结尾：这次不要再追问，说说你自己的想法或反应就好。')
  }
  if (last3.length === 3 && last3.every((g) => g.texts.length === last3[0].texts.length) && last3[0].texts.length >= 3) {
    lines.push(`你最近连续几次都发了 ${last3[0].texts.length} 条：这次按情境来，可以只发一两条。`)
  }
  const openers = groups.slice(-4).map((g) => opener(g.texts[0])).filter(Boolean)
  const openerCount = new Map<string, number>()
  for (const o of openers) openerCount.set(o, (openerCount.get(o) ?? 0) + 1)
  const sameOpener = [...openerCount.entries()].find(([, n]) => n >= 2)
  if (sameOpener) lines.push(`最近你好几次都用「${sameOpener[0]}」开头：这次换个开头。`)

  const recentTexts = groups.flatMap((g) => g.texts).slice(-12)
  const phrases = repeatedPhrases(recentTexts, [charName, userName, ...nicknames, ...PET_NAMES])
  if (phrases.length) lines.push(`这些说法最近用得太多了：${phrases.map((p) => `「${p}」`).join('、')}，这次别再用。`)

  const lastTen = recentTexts.slice(-10)
  for (const n of [...new Set([...nicknames, ...PET_NAMES])]) {
    if (!n) continue
    const used = lastTen.filter((t) => t.toLowerCase().includes(n.toLowerCase())).length
    if (used >= 4) {
      lines.push(`「${n}」最近叫得太频繁了：这次不用叫，正常说话就好。`)
      break
    }
  }
  const last6 = groups.slice(-6)
  if (last6.length >= 3 && last6.filter((g) => g.texts.some((t) => EMOJI.test(t))).length >= Math.max(3, Math.ceil(last6.length * 0.6))) {
    lines.push('最近 emoji 用得比较多：这次不用带。')
  }
  if (groups.slice(-4).filter((g) => g.texts.some((t) => SUGGEST.test(t))).length >= 2 && !SERIOUS.test(said)) {
    lines.push(`最近已经给了不少建议：除非${userName}主动问，这次不要再提建议。`)
  }
  if (exchanges >= 30) {
    lines.push(`你们已经聊了 ${exchanges} 轮：语气、话量和称呼仍然按上面的【性格】【说话风格】来，不要被聊天带成另一个人，也不要越聊越像客服或越来越腻。`)
  }
  return lines
}

export function turnGuidanceSection(lines: string[]): string {
  if (!lines.length) return ''
  return `【这一轮的分寸】（根据最近的聊天自动生成，只影响怎么说）\n${lines.map((l) => `· ${l}`).join('\n')}`
}
