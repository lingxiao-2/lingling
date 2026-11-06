/** 角色分组的读写（IndexedDB）：分组列表与排序在 settings；角色的分组在 character.groupId */
import { db, getSetting, setSetting } from './db'
import { uid } from '../lib/util'
import { checkGroupName, DEFAULT_GROUP_SETTINGS, GROUPS_KEY, normalizeGroupSettings, type GroupSettings } from '../lib/characterGroups'

export class GroupError extends Error {}

export async function loadGroupSettings(): Promise<GroupSettings> {
  return normalizeGroupSettings(await getSetting<Partial<GroupSettings> | null>(GROUPS_KEY, DEFAULT_GROUP_SETTINGS))
}

export async function saveGroupSettings(patch: Partial<GroupSettings>): Promise<GroupSettings> {
  const next = { ...(await loadGroupSettings()), ...patch }
  await setSetting(GROUPS_KEY, next)
  return next
}

export async function createGroup(name: string): Promise<string> {
  const s = await loadGroupSettings()
  const err = checkGroupName(name, s.groups)
  if (err) throw new GroupError(err)
  const id = uid('grp')
  await saveGroupSettings({ groups: [...s.groups, { id, name: name.trim() }] })
  return id
}

export async function renameGroup(id: string, name: string): Promise<void> {
  const s = await loadGroupSettings()
  const err = checkGroupName(name, s.groups, id)
  if (err) throw new GroupError(err)
  await saveGroupSettings({ groups: s.groups.map((g) => (g.id === id ? { ...g, name: name.trim() } : g)) })
}

/** 删除分组：其中的角色全部移入「未分组」，角色本身不受影响 */
export async function deleteGroup(id: string): Promise<number> {
  let moved = 0
  await db.transaction('rw', [db.characters, db.settings], async () => {
    const s = await loadGroupSettings()
    const members = (await db.characters.toArray()).filter((c) => c.groupId === id)
    for (const c of members) await db.characters.update(c.id, { groupId: undefined })
    moved = members.length
    await setSetting(GROUPS_KEY, { ...s, groups: s.groups.filter((g) => g.id !== id), collapsed: s.collapsed.filter((x) => x !== id) })
  })
  return moved
}

/** 把角色移到分组（groupId 为空表示未分组）。只改 groupId，不改角色的其他资料和 updatedAt */
export async function moveCharacter(characterId: string, groupId: string | null): Promise<void> {
  await db.characters.update(characterId, { groupId: groupId ?? undefined })
}
