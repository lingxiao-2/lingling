/**
 * 说话方式：让每个角色按自己的人设说话，减少机械式回复和重复句式（纯函数）。
 *  - voiceSection：通用要求（从人设推出语气；不用客服口吻；不过度解释；区分设定 / 真实经历 / 推测）
 *  - repetitionHint：根据角色最近的回复，找出反复出现的开头和句子片段，提醒这次换个说法
 */
import type { Message } from '../../db/schema'

export function voiceSection(name: string, user: string): string {
  return [
    '【说话方式】',
    `· 语气、用词、句子长短都从你（${name}）的性格和说话风格里来：冷淡的人话少且不热络，活泼的人会接梗，嘴硬的人不直说关心。不同的人说话本来就不一样，不要用通用的客服 / 助手口吻。`,
    `· 像真人发微信：不要复述${user}刚说的话，不要先总结再回应，不要列清单，不要每次都用问题结尾，不要一次说教或解释太多。`,
    `· 区分三种信息：人设里写的是你的设定；聊天记录和「你记得的事」里的是你们真实经历过的；除此之外关于${user}或你们过去的事，都只是你的推测 —— 推测时用「是不是」「可能」这样的语气，不要说成事实。`,
  ].join('\n')
}

/** 句子开头的前几个字（去掉标点、语气词） */
function opening(text: string): string {
  return text.replace(/^[\s"'“”‘’…~～!！?？,，.。]+/, '').slice(0, 2)
}

/**
 * 找出最近回复中重复的开头与片段。
 * @param recentReplies 角色最近的回复（按时间顺序，每条一个字符串）
 */
export function repetitionHint(recentReplies: string[], window = 10): string {
  const xs = recentReplies.filter((x) => x.trim()).slice(-window)
  if (xs.length < 4) return ''
  const openCount = new Map<string, number>()
  for (const x of xs) {
    const o = opening(x)
    if (o.length === 2 && !/[a-zA-Z0-9]/.test(o)) openCount.set(o, (openCount.get(o) ?? 0) + 1)
  }
  const openings = [...openCount].filter(([, n]) => n >= 3).map(([o]) => o)
  // 4～6 字的片段在 3 条以上不同回复中出现
  const seen = new Map<string, Set<number>>()
  xs.forEach((x, i) => {
    const t = x.replace(/[\s，。！？、,.!?~～…"'“”]/g, '')
    for (const len of [6, 5, 4]) {
      for (let k = 0; k + len <= t.length; k++) {
        const g = t.slice(k, k + len)
        if (!/[一-龥]{3}/.test(g)) continue
        if (!seen.has(g)) seen.set(g, new Set())
        seen.get(g)!.add(i)
      }
    }
  })
  const phrases: string[] = []
  for (const [g, set] of [...seen].sort((a, b) => b[0].length - a[0].length || b[1].size - a[1].size)) {
    if (set.size < 3 || phrases.some((p) => p.includes(g))) continue
    phrases.push(g)
    if (phrases.length >= 4) break
  }
  if (!openings.length && !phrases.length) return ''
  const parts: string[] = []
  if (openings.length) parts.push(`最近好几次都用「${openings.join('」「')}」开头`)
  if (phrases.length) parts.push(`反复说过「${phrases.join('」「')}」`)
  return `【避免重复】你${parts.join('，')}。这次换一种说法，不要再用这些句式。`
}

/** 从聊天记录中取出角色最近的回复（同一次回复的多条合并） */
export function recentReplies(active: Message[]): string[] {
  const out: string[] = []
  let last = ''
  for (const m of active) {
    if (m.senderType !== 'character' || m.kind !== 'text') continue
    const g = m.replyGroupId ?? m.id
    if (g === last) out[out.length - 1] += `\n${m.content}`
    else out.push(m.content)
    last = g
  }
  return out
}
