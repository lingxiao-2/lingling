/**
 * 标准 78 张塔罗牌（22 张大阿卡纳 + 56 张小阿卡纳），正位与逆位的简要牌意。
 * 塔罗只用于娱乐与自我反思，不能作为医疗、财务或其他重大决定的依据。
 */
export type Suit = 'major' | 'wands' | 'cups' | 'swords' | 'pentacles'

export interface TarotCard {
  id: string
  name: string
  en: string
  suit: Suit
  /** 大阿卡纳的编号（0–21），小阿卡纳的点数（1–14） */
  number: number
  upright: string
  reversed: string
}

const MAJOR: [string, string, string, string][] = [
  ['愚者', 'The Fool', '新的开始、自由、勇于冒险', '鲁莽、犹豫不前、错失起点'],
  ['魔术师', 'The Magician', '创造力、行动力、手边的资源', '能力未发挥、言过其实'],
  ['女祭司', 'The High Priestess', '直觉、内在智慧、尚未揭晓的事', '忽视直觉、心事被压抑'],
  ['皇后', 'The Empress', '丰盛、滋养、温柔与美', '过度付出、依赖、停滞'],
  ['皇帝', 'The Emperor', '秩序、稳定、承担责任', '控制欲、固执、缺乏弹性'],
  ['教皇', 'The Hierophant', '传统、指引、共同的信念', '质疑常规、走自己的路'],
  ['恋人', 'The Lovers', '选择、关系、内心的和谐', '失衡、犹豫不决的选择'],
  ['战车', 'The Chariot', '意志、前进、克服阻碍', '失去方向、力不从心'],
  ['力量', 'Strength', '勇气、温柔的力量、耐心', '自我怀疑、急躁'],
  ['隐士', 'The Hermit', '独处、内省、寻找答案', '孤立、逃避与人联结'],
  ['命运之轮', 'Wheel of Fortune', '转变、机遇、新的循环', '阻滞、抗拒变化'],
  ['正义', 'Justice', '公正、平衡、承担选择的结果', '失衡、逃避责任'],
  ['倒吊人', 'The Hanged Man', '换个角度、暂停、放下执着', '拖延、无谓的牺牲'],
  ['死神', 'Death', '结束与新生、转化', '抗拒结束、停滞不前'],
  ['节制', 'Temperance', '平衡、调和、耐心', '过度、节奏失调'],
  ['恶魔', 'The Devil', '束缚、欲望、执念', '挣脱束缚、开始觉察'],
  ['高塔', 'The Tower', '突然的变化、打破旧有、觉醒', '害怕改变、勉强维持'],
  ['星星', 'The Star', '希望、疗愈、灵感', '失望、信心不足'],
  ['月亮', 'The Moon', '不确定、梦境、潜意识', '迷雾渐散、放下不安'],
  ['太阳', 'The Sun', '快乐、成功、活力', '暂时的阴霾、过度乐观'],
  ['审判', 'Judgement', '觉醒、反思、回应内心的召唤', '自我苛责、错过时机'],
  ['世界', 'The World', '完成、圆满、一段旅程的终点', '尚未完成、缺少收尾'],
]

const RANKS = ['王牌', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍从', '骑士', '王后', '国王']
const RANKS_EN = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King']
export const SUIT_INFO: Record<Exclude<Suit, 'major'>, { name: string; en: string; domain: string }> = {
  wands: { name: '权杖', en: 'Wands', domain: '行动、热情与创造' },
  cups: { name: '圣杯', en: 'Cups', domain: '情感、关系与直觉' },
  swords: { name: '宝剑', en: 'Swords', domain: '思考、沟通与冲突' },
  pentacles: { name: '星币', en: 'Pentacles', domain: '现实、物质与身体' },
}

const MINOR: Record<Exclude<Suit, 'major'>, [string, string][]> = {
  wands: [
    ['灵感、新计划、热情', '延迟、缺乏动力'], ['规划、决定、远见', '犹豫、害怕未知'], ['拓展、展望、进展', '受阻、计划不周'], ['庆祝、安定、归属感', '不安、处在过渡期'],
    ['竞争、冲突、摩擦', '回避冲突、内耗'], ['胜利、被认可、自信', '自负、缺少认可'], ['坚守、捍卫、勇气', '疲惫、想放弃立场'], ['迅速、进展、消息到来', '延误、过于仓促'],
    ['韧性、坚持、保持警惕', '精疲力竭、防备过度'], ['负担、责任过重', '卸下重担、学会分担'], ['好奇、探索、新的消息', '三分钟热度'], ['冲劲、冒险、立刻行动', '鲁莽、急躁'],
    ['自信、热情、独立', '嫉妒、情绪化'], ['领导、远见、魄力', '专断、冲动'],
  ],
  cups: [
    ['新的感情、爱、心意', '情绪压抑、内心空虚'], ['结合、互相吸引、伙伴', '失衡、误解'], ['友谊、庆祝、分享', '放纵、疏离'], ['倦怠、沉思、错过眼前', '重新打开心扉'],
    ['失落、遗憾、悲伤', '释怀、走出低谷'], ['怀旧、童真、美好回忆', '沉溺过去、学着向前看'], ['幻想、选择太多', '看清现实、做出选择'], ['离开、寻找更深的意义', '犹豫、害怕离开'],
    ['满足、心愿达成', '不满足、表面的快乐'], ['幸福、家、和谐', '关系失和、期待落差'], ['敏感、新的情感讯息', '情绪化、不成熟'], ['浪漫、追随内心', '不切实际、情绪多变'],
    ['温柔、共情、直觉', '情绪依赖、过度敏感'], ['情绪成熟、包容', '压抑情绪、冷淡'],
  ],
  swords: [
    ['清晰、真相、突破', '混乱、判断失误'], ['两难、僵持、回避', '信息不足、犹豫'], ['心碎、伤痛', '疗愈、释放悲伤'], ['休息、恢复、沉淀', '不安、勉强自己'],
    ['争执、输赢、代价', '和解、放下争执'], ['过渡、离开困境', '停留原地、问题未解'], ['策略、隐瞒、独自行动', '坦白、被看穿'], ['受困、自我限制', '解脱、看到出口'],
    ['焦虑、失眠、担忧', '恐惧减轻、向人求助'], ['结束、触底', '复原、最坏已经过去'], ['好奇、观察、求知', '流言、冒失'], ['果断、直接、迅速', '冲动、言辞尖锐'],
    ['理性、独立、清醒', '冷漠、刻薄'], ['理智、权威、明断', '冷酷、操控'],
  ],
  pentacles: [
    ['新机会、踏实的开始', '错失机会、计划不稳'], ['平衡、灵活、同时兼顾', '失衡、应接不暇'], ['合作、技艺、被认可', '缺乏合作、敷衍了事'], ['稳定、守护、节制', '吝啬、过度控制'],
    ['困难、匮乏、孤立感', '好转、得到帮助'], ['给予、分享、互惠', '不对等、附带条件'], ['耐心、等待收获', '焦急、投入没有回报'], ['专注、练习、精进', '敷衍、缺乏动力'],
    ['独立、富足、自我价值', '依赖、表面风光'], ['传承、家庭、长久', '家庭矛盾、根基不稳'], ['学习、计划、务实', '拖延、不切实际'], ['踏实、可靠、坚持', '停滞、过于保守'],
    ['照顾、务实、温暖', '忽略自己、过度操劳'], ['稳重、成就、富足', '固执、只看重物质'],
  ],
}

export const DECK: TarotCard[] = [
  ...MAJOR.map(([name, en, upright, reversed], i): TarotCard => ({ id: `major-${i}`, name, en, suit: 'major', number: i, upright, reversed })),
  ...(Object.keys(MINOR) as Exclude<Suit, 'major'>[]).flatMap((suit) =>
    MINOR[suit].map(([upright, reversed], i): TarotCard => ({ id: `${suit}-${i + 1}`, name: `${SUIT_INFO[suit].name}${RANKS[i]}`, en: `${RANKS_EN[i]} of ${SUIT_INFO[suit].en}`, suit, number: i + 1, upright, reversed })),
  ),
]

export const cardById = (id: string) => DECK.find((c) => c.id === id)

export const SPREADS = {
  single: { name: '单张牌', positions: ['指引'] },
  three: { name: '三张牌阵', positions: ['过去', '现在', '未来'] },
} as const
export type SpreadId = keyof typeof SPREADS

export interface DrawnCard { cardId: string; reversed: boolean; position: string }

/** 密码学随机数（不可预测）；测试时可以替换 */
export type Rng = () => number
export const secureRandom: Rng = () => {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0] / 2 ** 32
}

/** 洗牌（Fisher–Yates）后按牌阵抽取；每张牌独立决定正逆位。不会抽到重复的牌 */
export function draw(spread: SpreadId, rng: Rng = secureRandom): DrawnCard[] {
  const ids = DECK.map((c) => c.id)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return SPREADS[spread].positions.map((position, i) => ({ cardId: ids[i], reversed: rng() < 0.5, position }))
}

export const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI']
