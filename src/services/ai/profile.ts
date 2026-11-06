/**
 * 长篇角色人设的分层（纯函数）。
 *
 *  - 核心设定：每次都发送。各字段在预算内整段发送；超出预算的部分按段落移入扩展资料。
 *    「其他设定」中较短的章节（合计 800 字以内）也算核心。
 *  - 扩展资料：不每次发送。根据最近几条聊天内容挑出相关段落（按字词重合程度），最多约 1500 字。
 *  - 全文：导入时的完整原文保存在角色的 sourceDoc 中，不发送给模型。
 *
 * 普通长度的角色（各字段都在预算内）完全不受影响，仍然整段发送。
 */
import type { Character } from '../../db/schema'

export const PROFILE_BUDGET = {
  bio: 300,
  personality: 2500,
  speakingStyle: 2500,
  relationToUser: 1500,
  backstory: 2500,
  /** 「其他设定」中每次都发送的部分 */
  coreExtras: 800,
  /** 每次最多附带的相关扩展资料 */
  related: 1500,
  /** 扩展资料切块的最大长度 */
  chunk: 500,
}

export type CoreField = 'bio' | 'personality' | 'speakingStyle' | 'relationToUser' | 'backstory'

export interface ProfileChunk {
  /** 来源：字段名或章节标题 */
  label: string
  text: string
  /** 在原资料中的顺序，用于按原顺序输出 */
  order: number
}

export interface LayeredProfile {
  core: Record<CoreField, string>
  coreExtras: { label: string; text: string }[]
  /** 不每次发送的扩展资料 */
  pool: ProfileChunk[]
}

const FIELD_NAME: Record<CoreField, string> = {
  bio: '角色简介',
  personality: '性格',
  speakingStyle: '说话风格',
  relationToUser: '关系',
  backstory: '背景故事',
}

/** 按空行或「【小标题】」把一段文字切成块，长块再按行切到 max 以内 */
export function splitBlocks(text: string, max = PROFILE_BUDGET.chunk): string[] {
  const paras = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n|\n(?=【)/)
    .map((p) => p.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const p of paras) {
    if (p.length <= max) {
      out.push(p)
      continue
    }
    let buf = ''
    for (const line of p.split('\n')) {
      if (buf && buf.length + line.length + 1 > max) {
        out.push(buf)
        buf = ''
      }
      // 单行超长时硬切
      let l = line
      while (l.length > max) {
        out.push(l.slice(0, max))
        l = l.slice(max)
      }
      buf = buf ? `${buf}\n${l}` : l
    }
    if (buf.trim()) out.push(buf)
  }
  return out
}

export function layerProfile(c: Pick<Character, CoreField | 'profileExtras'>): LayeredProfile {
  const core = {} as Record<CoreField, string>
  const pool: ProfileChunk[] = []
  let order = 0
  for (const f of Object.keys(FIELD_NAME) as CoreField[]) {
    const text = (c[f] ?? '').trim()
    const max = PROFILE_BUDGET[f]
    if (text.length <= max) {
      core[f] = text
      continue
    }
    const blocks = splitBlocks(text)
    // 从头开始连续保留，直到第一块放不下；之后的内容全部进入扩展资料（保持核心部分连贯）
    const kept: string[] = []
    let used = 0
    let full = false
    for (const b of blocks) {
      if (!full && used + b.length <= max) {
        kept.push(b)
        used += b.length + 2
      } else {
        full = true
        pool.push({ label: FIELD_NAME[f], text: b, order: order++ })
      }
    }
    core[f] = kept.join('\n\n')
  }
  const coreExtras: { label: string; text: string }[] = []
  let usedExtras = 0
  for (const e of c.profileExtras ?? []) {
    const t = e.text.trim()
    if (!t) continue
    if (usedExtras + t.length <= PROFILE_BUDGET.coreExtras) {
      coreExtras.push({ label: e.label, text: t })
      usedExtras += t.length
    } else {
      for (const b of splitBlocks(t)) pool.push({ label: e.label, text: b, order: order++ })
    }
  }
  return { core, coreExtras, pool }
}

/** 中文按相邻两字、英文按单词切出特征，用于判断相关程度 */
export function features(text: string): Set<string> {
  const set = new Set<string>()
  const t = text.toLowerCase()
  for (const run of t.match(/[一-龥]+/g) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) set.add(run.slice(i, i + 2))
  }
  for (const w of t.match(/[a-z0-9]{3,}/g) ?? []) set.add(w)
  return set
}

/** 常见的两字组合几乎处处出现，不能作为相关依据 */
export const STOP = new Set(['我们', '你们', '他们', '什么', '一个', '没有', '不是', '就是', '还是', '可以', '这个', '那个', '自己', '时候', '知道', '现在', '今天', '真的', '一下', '怎么', '因为', '所以', '但是', '如果', '已经', '觉得', '喜欢'])

/** 从扩展资料中挑出与最近聊天相关的段落（按原顺序返回） */
export function pickRelated(pool: ProfileChunk[], recentText: string, budget = PROFILE_BUDGET.related, minScore = 2): ProfileChunk[] {
  const want = features(recentText)
  for (const s of STOP) want.delete(s)
  if (!want.size || !pool.length) return []
  const scored = pool
    .map((ch) => {
      const f = features(`${ch.label} ${ch.text}`)
      let score = 0
      for (const w of want) if (f.has(w)) score++
      return { ch, score }
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || a.ch.order - b.ch.order)
  const out: ProfileChunk[] = []
  let used = 0
  for (const { ch } of scored) {
    if (used + ch.text.length > budget) continue
    out.push(ch)
    used += ch.text.length
  }
  return out.sort((a, b) => a.order - b.order)
}
