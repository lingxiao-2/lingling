/**
 * 角色分组与排序（纯函数）。
 *  - 分组列表与排序方式保存在 settings（key = character-groups）；角色所属分组保存在角色的 groupId 上
 *  - 没有 groupId、或分组已被删除的角色都属于「未分组」
 */
import type { Character } from '../db/schema'

export interface CharacterGroup {
  id: string
  name: string
}

export type CharacterSort = 'name' | 'recent' | 'created' | 'manual'

export interface GroupSettings {
  groups: CharacterGroup[]
  sort: CharacterSort
  /** 手动排序时的角色顺序（角色 id）；不在列表中的排在后面，按名称 */
  order: string[]
  /** 收起的分组 id（'none' 表示未分组） */
  collapsed: string[]
}

export const GROUPS_KEY = 'character-groups'
export const UNGROUPED = 'none'
export const DEFAULT_GROUP_SETTINGS: GroupSettings = { groups: [], sort: 'name', order: [], collapsed: [] }

export const SORT_LABEL: Record<CharacterSort, string> = {
  name: '按名称',
  recent: '按最近聊天',
  created: '按添加时间',
  manual: '手动排序',
}

export function normalizeGroupSettings(v: Partial<GroupSettings> | undefined | null): GroupSettings {
  const groups = Array.isArray(v?.groups) ? v!.groups.filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string') : []
  const sort = v?.sort && v.sort in SORT_LABEL ? v.sort : 'name'
  return { groups, sort, order: Array.isArray(v?.order) ? v!.order.filter((x) => typeof x === 'string') : [], collapsed: Array.isArray(v?.collapsed) ? v!.collapsed : [] }
}

export function checkGroupName(name: string, groups: CharacterGroup[], exceptId?: string): string | null {
  const n = name.trim()
  if (!n) return '请输入分组名称'
  if (n.length > 20) return '分组名称最多 20 个字'
  if (n === '未分组') return '「未分组」是保留名称'
  if (groups.some((g) => g.id !== exceptId && g.name === n)) return '已经有同名的分组'
  return null
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('zh-Hans-CN') : null
const byName = (a: Character, b: Character) => (collator ? collator.compare(a.name, b.name) : a.name.localeCompare(b.name))

export function sortCharacters(list: Character[], sort: CharacterSort, lastChat: Map<string, number>, order: string[] = []): Character[] {
  const xs = [...list]
  if (sort === 'recent') return xs.sort((a, b) => (lastChat.get(b.id) ?? 0) - (lastChat.get(a.id) ?? 0) || byName(a, b))
  if (sort === 'created') return xs.sort((a, b) => b.createdAt - a.createdAt || byName(a, b))
  if (sort === 'manual') {
    const pos = new Map(order.map((id, i) => [id, i]))
    return xs.sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity) || byName(a, b))
  }
  return xs.sort(byName)
}

export function groupOf(c: Character, groups: CharacterGroup[]): string {
  return c.groupId && groups.some((g) => g.id === c.groupId) ? c.groupId : UNGROUPED
}

export interface GroupSection {
  id: string
  name: string
  characters: Character[]
}

/** 按分组列出（分组按创建顺序，未分组在最后；空分组也显示） */
export function sectionize(chars: Character[], s: GroupSettings, lastChat: Map<string, number>): GroupSection[] {
  const sorted = sortCharacters(chars, s.sort, lastChat, s.order)
  const sections: GroupSection[] = s.groups.map((g) => ({ id: g.id, name: g.name, characters: [] }))
  const none: GroupSection = { id: UNGROUPED, name: '未分组', characters: [] }
  for (const c of sorted) {
    const gid = groupOf(c, s.groups)
    ;(sections.find((x) => x.id === gid) ?? none).characters.push(c)
  }
  return [...sections, none]
}

export function matches(c: Character, q: string): boolean {
  const kw = q.trim().toLowerCase()
  return !kw || c.name.toLowerCase().includes(kw) || (c.bio ?? '').toLowerCase().includes(kw)
}

/** 手动排序：把一个角色在同一分组内上移 / 下移一位，返回新的整体顺序 */
export function moveInOrder(section: Character[], id: string, dir: -1 | 1, all: Character[], s: GroupSettings, lastChat: Map<string, number>): string[] {
  // 以当前显示顺序为基础（首次切到手动排序时，沿用之前看到的顺序）
  const base = sortCharacters(all, s.sort, lastChat, s.order).map((c) => c.id)
  const ids = section.map((c) => c.id)
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return base
  const a = base.indexOf(ids[i])
  const b = base.indexOf(ids[j])
  ;[base[a], base[b]] = [base[b], base[a]]
  return base
}
