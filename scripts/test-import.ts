/**
 * 导入解析器单元测试：npm test
 * 只测试纯函数（src/import），不依赖浏览器或 IndexedDB。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftFromSections, parseImportFile } from '../src/import/parse'
import type { ParsedFile } from '../src/import/types'

function ok(name: string, text: string, kind: 'character' | 'lorebook' | 'world' = 'character'): ParsedFile {
  const r = parseImportFile(name, text, kind)
  if (!r.ok) assert.fail(`期望解析成功，实际失败：${r.error}`)
  return r.file
}
function err(name: string, text: string, kind: 'character' | 'lorebook' | 'world' = 'character'): string {
  const r = parseImportFile(name, text, kind)
  assert.equal(r.ok, false, '期望解析失败')
  return r.ok ? '' : r.error
}

const stV2 = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '林晚',
    description: '在雪城长大的图书管理员。',
    personality: '温柔、安静、偶尔毒舌',
    scenario: '冬夜的图书馆',
    first_mes: '你来啦，外面雪下得很大吧？',
    mes_example: '<START>\n{{user}}: 你好\n{{char}}: 嗯，你好。',
    creator_notes: '一位安静的图书管理员\n第二行说明',
    system_prompt: '保持角色',
    alternate_greetings: ['早上好'],
    tags: ['温柔'],
    creator: 'someone',
    character_version: '1.0',
    extensions: { talkativeness: '0.5', world: '雪城' },
    character_book: {
      name: '雪城设定',
      scan_depth: 4,
      extensions: {},
      entries: [
        { keys: ['雪城', '北境'], content: '常年下雪的城市。', enabled: true, insertion_order: 10, id: 0, comment: '' },
        { keys: [], content: '始终生效的设定', constant: true, enabled: false, name: '常驻' },
      ],
    },
  },
}

test('SillyTavern V2 角色卡 + 内置世界书', () => {
  const f = ok('linwan.json', JSON.stringify(stV2))
  assert.equal(f.format, 'st-card-v2')
  assert.equal(f.characters.length, 1)
  const c = f.characters[0]
  assert.equal(c.name, '林晚')
  assert.equal(c.personality, '温柔、安静、偶尔毒舌')
  assert.match(c.backstory, /图书管理员/)
  assert.match(c.backstory, /【场景】\n冬夜的图书馆/)
  assert.equal(c.greeting, '你来啦，外面雪下得很大吧？')
  assert.match(c.exampleDialogue, /<START>/)
  assert.equal(c.bio, '一位安静的图书管理员')
  const st = c.extensions.sillytavern as Record<string, unknown>
  assert.equal(st.system_prompt, '保持角色')
  assert.deepEqual(st.alternate_greetings, ['早上好'])
  assert.equal(st.creator_notes, '一位安静的图书管理员\n第二行说明')
  assert.equal(st.spec, 'chara_card_v2')
  assert.deepEqual(st.extensions, { talkativeness: '0.5', world: '雪城' })
  assert.equal('character_book' in st, false, '内置世界书已单独解析，不应重复保存')

  assert.equal(f.lorebooks.length, 1)
  const b = f.lorebooks[0]
  assert.equal(b.name, '雪城设定')
  assert.equal(b.entries.length, 2)
  assert.deepEqual(b.entries[0].keys, ['雪城', '北境'])
  assert.equal(b.entries[0].name, '雪城')
  assert.equal(b.entries[0].extensions.insertion_order, 10)
  assert.equal(b.entries[1].constant, true)
  assert.equal(b.entries[1].enabled, false)
  assert.equal(b.extensions.scan_depth, 4)
  assert.deepEqual(f.links, [{ character: 0, lorebook: 0 }])
})

test('SillyTavern V3 按 V2 读取并给出提示', () => {
  const f = ok('v3.json', JSON.stringify({ ...stV2, spec: 'chara_card_v3', spec_version: '3.0' }))
  assert.equal(f.characters[0].name, '林晚')
  assert.ok(f.warnings.some((w) => w.includes('chara_card_v3')))
})

test('SillyTavern V1 扁平角色卡', () => {
  const f = ok('v1.json', JSON.stringify({ name: 'Aki', description: 'desc', personality: 'calm', scenario: '', first_mes: 'hi', mes_example: '', avatar: 'none', chat: 'x' }))
  assert.equal(f.format, 'st-card-v1')
  assert.equal(f.characters[0].name, 'Aki')
  assert.equal(f.characters[0].greeting, 'hi')
  assert.equal((f.characters[0].extensions.sillytavern as Record<string, unknown>).avatar, 'none')
})

test('SillyTavern 世界书（entries 为对象，disable / comment / key）', () => {
  const wi = {
    entries: {
      '0': { uid: 0, key: ['魔法', '法术'], keysecondary: ['禁咒'], comment: '魔法体系', content: '魔法需要代价。', constant: false, disable: false, order: 100 },
      '1': { uid: 1, key: '王都, 首都', comment: '', content: '王都位于中央。', disable: true },
    },
  }
  const f = ok('world.json', JSON.stringify(wi))
  assert.equal(f.format, 'st-worldinfo')
  assert.equal(f.characters.length, 0)
  const b = f.lorebooks[0]
  assert.equal(b.name, 'world')
  assert.equal(b.entries[0].name, '魔法体系')
  assert.deepEqual(b.entries[0].secondaryKeys, ['禁咒'])
  assert.equal(b.entries[0].extensions.order, 100)
  assert.equal('comment' in b.entries[0].extensions, false)
  assert.deepEqual(b.entries[1].keys, ['王都', '首都'])
  assert.equal(b.entries[1].enabled, false)
  assert.equal(b.entries[1].name, '王都')
})

test('组合 JSON：按名称与下标建立关联', () => {
  const combo = {
    characters: [
      { name: '甲', personality: '冷静', lorebooks: ['共同世界'] },
      { spec: 'chara_card_v2', data: { name: '乙', description: 'd', first_mes: 'hi' } },
    ],
    worldbooks: [
      { name: '共同世界', entries: [{ keys: ['城'], content: '一座城' }] },
      { name: '乙的秘密', characters: [1], entries: [{ keys: ['秘密'], content: '…' }] },
      { name: '孤立', characters: ['不存在'], entries: [{ keys: ['x'], content: 'y' }] },
    ],
  }
  const f = ok('combo.json', JSON.stringify(combo))
  assert.equal(f.format, 'combo-json')
  assert.equal(f.characters.length, 2)
  assert.equal(f.lorebooks.length, 3)
  assert.deepEqual(
    [...f.links].sort((a, b) => a.lorebook - b.lorebook),
    [
      { character: 0, lorebook: 0 },
      { character: 1, lorebook: 1 },
    ],
  )
  assert.equal('lorebooks' in (f.characters[0].extensions.unmapped as object ?? {}), false)
  assert.ok(f.warnings.some((w) => w.includes('不存在')))
})

test('通用中文 JSON：字段映射 + 未识别字段保留', () => {
  const f = ok('char.json', JSON.stringify({ 昵称: '小雪', 性格: '活泼', 说话风格: '爱用叠词', 背景故事: '北方人', 关系: '同桌', 开场白: '早呀', 生日: '1月1日', 爱好: ['滑雪'] }))
  assert.equal(f.format, 'generic-json')
  const c = f.characters[0]
  assert.equal(c.name, '小雪')
  assert.equal(c.personality, '活泼')
  assert.equal(c.speakingStyle, '爱用叠词')
  assert.equal(c.backstory, '北方人')
  assert.equal(c.relationToUser, '同桌')
  assert.equal(c.greeting, '早呀')
  assert.deepEqual(c.extensions.unmapped, { 生日: '1月1日', 爱好: ['滑雪'] })
})

test('JSON 数组：多个角色', () => {
  const f = ok('list.json', JSON.stringify([{ name: 'A', personality: 'p' }, { name: 'B', bio: 'b' }, 42]))
  assert.equal(f.characters.length, 2)
  assert.ok(f.warnings.some((w) => w.includes('第 3 项')))
})

test('缺少名称时用文件名并提示', () => {
  const f = ok('无名.json', JSON.stringify({ spec: 'chara_card_v2', data: { name: '', description: 'x', first_mes: '' } }))
  assert.equal(f.characters[0].name, '无名')
  assert.ok(f.warnings.some((w) => w.includes('缺少名称')))
})

test('错误：空文件、错误 JSON、无法识别、PNG、不支持的扩展名', () => {
  assert.match(err('a.json', '   \n'), /文件为空/)
  assert.match(err('a.txt', '﻿'), /文件为空/)
  assert.match(err('a.json', '{"name": '), /JSON 格式错误/)
  assert.match(err('a.json', '{"foo": 1}'), /无法识别/)
  assert.match(err('a.json', '"text"'), /顶层/)
  assert.match(err('a.json', '[]'), /数组为空/)
  assert.match(err('card.png', 'xxx'), /PNG/)
  assert.match(err('a.yaml', 'name: x'), /暂不支持/)
})

test('Markdown 角色：一级标题作名称，已知标题自动归属，未知标题放入背景', () => {
  const md = `# 沈清

一个总在窗边看雪的人。

## 性格
安静、克制

## 说话风格
简短，常用省略号

## 喜欢的东西
热可可

## 开场白
……你也睡不着吗？
`
  const f = ok('shen.md', md)
  assert.equal(f.format, 'markdown')
  const c = f.characters[0]
  assert.equal(c.name, '沈清')
  assert.equal(c.personality, '安静、克制')
  assert.equal(c.speakingStyle, '简短，常用省略号')
  assert.equal(c.greeting, '……你也睡不着吗？')
  assert.match(c.backstory, /一个总在窗边看雪的人/)
  assert.match(c.backstory, /【喜欢的东西】\n热可可/)
  assert.ok(f.sections && f.sections.length >= 5)
  assert.ok(f.warnings.some((w) => w.includes('沈清')))
})

test('TXT 角色：「字段：」行拆分，无名称时用文件名', () => {
  const txt = '性格：开朗\n喜欢唱歌\n【背景故事】\n来自海边小镇\n说话风格: 爱笑'
  const f = ok('阿暖.txt', txt)
  assert.equal(f.format, 'text')
  const c = f.characters[0]
  assert.equal(c.name, '阿暖')
  assert.equal(c.personality, '开朗\n喜欢唱歌')
  assert.equal(c.backstory, '来自海边小镇')
  assert.equal(c.speakingStyle, '爱笑')
  assert.ok(f.warnings.some((w) => w.includes('文件名')))
})

test('TXT 角色：名称行', () => {
  const f = ok('x.txt', '名称：白露\n简介：雪国少女')
  assert.equal(f.characters[0].name, '白露')
  assert.equal(f.characters[0].bio, '雪国少女')
})

test('段落重新归属', () => {
  const f = ok('x.txt', '一段说不清归属的文字')
  assert.equal(f.characters[0].backstory, '一段说不清归属的文字')
  const moved = f.sections!.map((s) => ({ ...s, target: 'personality' as const }))
  const d = draftFromSections(moved, 'x')
  assert.equal(d.personality, '一段说不清归属的文字')
  assert.equal(d.backstory, '')
  const ignored = f.sections!.map((s) => ({ ...s, target: 'ignore' as const }))
  assert.equal(draftFromSections(ignored, 'x').backstory, '')
})

test('Markdown 世界书：标题为条目与关键词', () => {
  const md = `# 雪城纪事

关于雪城的一切。

## 钟楼
城中心的钟楼，午夜会敲十三下。

## 冰湖
冬天可以在上面滑冰。
`
  const f = ok('snow.md', md, 'lorebook')
  const b = f.lorebooks[0]
  assert.equal(b.name, '雪城纪事')
  assert.equal(b.description, '关于雪城的一切。')
  assert.equal(b.entries.length, 2)
  assert.equal(b.entries[0].name, '钟楼')
  assert.deepEqual(b.entries[0].keys, ['钟楼'])
  assert.match(b.entries[1].content, /滑冰/)
})

test('TXT 世界书：整体作为一个条目并提示', () => {
  const f = ok('设定.txt', '这是一段世界观设定。', 'lorebook')
  const b = f.lorebooks[0]
  assert.equal(b.name, '设定')
  assert.equal(b.entries.length, 1)
  assert.deepEqual(b.entries[0].keys, [])
  assert.ok(f.warnings.some((w) => w.includes('没有标题')))
})

test('角色模式下导入世界书 JSON 仍按内容识别', () => {
  const f = ok('w.json', JSON.stringify({ name: '某世界', entries: [{ keys: ['a'], content: 'b' }] }), 'character')
  assert.equal(f.lorebooks.length, 1)
  assert.equal(f.lorebooks[0].name, '某世界')
})

/* ---------------- 世界导入（第三轮） ---------------- */

test('世界模式：组合 JSON（世界 + 角色 + 世界书）', () => {
  const combo = {
    world: { name: '雪城', tagline: '永冬之城', setting: '一座常年飘雪的北方城市。', 气候: '严寒' },
    characters: [{ name: '林晚', personality: '温柔', lorebooks: ['雪城地理'] }],
    lorebooks: [{ name: '雪城地理', entries: [{ keys: ['钟楼'], content: '城中心的钟楼' }] }],
  }
  const f = ok('snowcity.json', JSON.stringify(combo), 'world')
  assert.equal(f.format, 'combo-json')
  assert.ok(f.world)
  assert.equal(f.world!.name, '雪城')
  assert.equal(f.world!.tagline, '永冬之城')
  assert.equal(f.world!.description, '一座常年飘雪的北方城市。')
  assert.deepEqual(f.world!.extensions.unmapped, { 气候: '严寒' })
  assert.equal(f.characters.length, 1)
  assert.equal(f.lorebooks.length, 1)
  assert.deepEqual(f.links, [{ character: 0, lorebook: 0 }])
})

test('世界模式：只有世界设定的 JSON', () => {
  const f = ok('w.json', JSON.stringify({ 世界名: '浮岛', 简介: '漂在云上的群岛', 世界观: '岛屿靠风帆相连。' }), 'world')
  assert.equal(f.format, 'world-json')
  assert.equal(f.characters.length, 0)
  assert.equal(f.world!.name, '浮岛')
  assert.equal(f.world!.tagline, '漂在云上的群岛')
  assert.equal(f.world!.description, '岛屿靠风帆相连。')
})

test('世界模式：带角色专属字段的对象仍按角色解析', () => {
  const f = ok('c.json', JSON.stringify({ name: '阿雪', personality: '活泼' }), 'world')
  assert.equal(f.world, undefined)
  assert.equal(f.characters[0].name, '阿雪')
})

test('世界模式：SillyTavern 角色卡照常解析为角色', () => {
  const f = ok('card.json', JSON.stringify(stV2), 'world')
  assert.equal(f.world, undefined)
  assert.equal(f.characters[0].name, '林晚')
  assert.equal(f.lorebooks.length, 1)
})

test('世界模式：Markdown 世界设定', () => {
  const md = '# 雪城\n简介：永冬之城\n\n## 地理\n北方高原。\n\n## 历史\n建城三百年。'
  const f = ok('x.md', md, 'world')
  assert.equal(f.world!.name, '雪城')
  assert.equal(f.world!.tagline, '永冬之城')
  assert.match(f.world!.description, /## 地理\n北方高原。/)
  assert.match(f.world!.description, /建城三百年/)
  assert.equal(f.characters.length, 0)
})

test('世界模式：TXT 无标题时用文件名', () => {
  const f = ok('星港.txt', '一座位于星环上的港口。', 'world')
  assert.equal(f.world!.name, '星港')
  assert.equal(f.world!.description, '一座位于星环上的港口。')
  assert.ok(f.warnings.some((w) => w.includes('文件名')))
})

test('非世界模式：文件里的世界设定不会被混入', () => {
  const combo = { world: { name: '雪城' }, characters: [{ name: '甲', personality: 'p' }] }
  const f = ok('a.json', JSON.stringify(combo), 'character')
  assert.equal(f.world, undefined)
  assert.equal(f.characters.length, 1)
  assert.ok(f.warnings.some((w) => w.includes('世界设定不会保存')))
  assert.match(err('b.json', JSON.stringify({ world: { name: '雪城' } }), 'lorebook'), /只包含世界设定/)
})
