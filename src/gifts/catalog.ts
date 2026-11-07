/**
 * 虚拟礼物清单（只在聆聆里，不涉及真实的钱、订单或物流）。图标使用统一的细线风格。
 */
import type { IconName } from '../theme/icons'

export type GiftCategory = 'flowers' | 'sweets' | 'winter' | 'keepsake' | 'books' | 'heart'
export const CATEGORIES: { id: GiftCategory; name: string }[] = [
  { id: 'flowers', name: '花' },
  { id: 'sweets', name: '甜点与饮品' },
  { id: 'winter', name: '冬日' },
  { id: 'keepsake', name: '小物件' },
  { id: 'books', name: '书与音乐' },
  { id: 'heart', name: '心意' },
]

export interface Gift { id: string; name: string; category: GiftCategory; icon: IconName; desc: string }

export const GIFTS: Gift[] = [
  { id: 'rose', name: '一支白玫瑰', category: 'flowers', icon: 'giftRose', desc: '花瓣上还带着一点霜' },
  { id: 'bouquet', name: '冬日花束', category: 'flowers', icon: 'giftFlower2', desc: '雪柳、尤加利和小苍兰' },
  { id: 'sprout', name: '小盆绿植', category: 'flowers', icon: 'giftSprout', desc: '放在窗台上就能长大' },
  { id: 'clover', name: '四叶草书签', category: 'flowers', icon: 'giftClover', desc: '压干的四叶草，夹在书里' },
  { id: 'cake', name: '草莓奶油蛋糕', category: 'sweets', icon: 'giftCake', desc: '一小块，刚好一个人吃' },
  { id: 'cocoa', name: '一杯热可可', category: 'sweets', icon: 'giftCoffee', desc: '加了棉花糖' },
  { id: 'cookie', name: '手作曲奇', category: 'sweets', icon: 'giftCookie', desc: '形状不太整齐，但很香' },
  { id: 'candy', name: '星星糖', category: 'sweets', icon: 'giftCandy', desc: '装在小玻璃瓶里' },
  { id: 'croissant', name: '早餐可颂', category: 'sweets', icon: 'giftCroissant', desc: '外层酥脆，还是热的' },
  { id: 'icecream', name: '冬天的冰淇淋', category: 'sweets', icon: 'giftIceCreamCone', desc: '在暖气房里吃最好' },
  { id: 'scarf', name: '一条围巾', category: 'winter', icon: 'giftRibbon', desc: '浅灰蓝色，很软' },
  { id: 'snowflake', name: '雪花水晶', category: 'winter', icon: 'giftSnowflake', desc: '在灯下会闪' },
  { id: 'umbrella', name: '透明雨伞', category: 'winter', icon: 'giftUmbrella', desc: '下雪天也能用' },
  { id: 'tree', name: '迷你圣诞树', category: 'winter', icon: 'giftTreePine', desc: '挂着很小的铃铛' },
  { id: 'candle', name: '香薰蜡烛', category: 'winter', icon: 'giftFlame', desc: '雪松和柑橘的味道' },
  { id: 'gem', name: '月光石吊坠', category: 'keepsake', icon: 'giftGem', desc: '泛着淡淡的蓝光' },
  { id: 'watch', name: '复古怀表', category: 'keepsake', icon: 'giftWatch', desc: '指针走得很安静' },
  { id: 'shell', name: '海边的贝壳', category: 'keepsake', icon: 'giftShell', desc: '能听见海的声音' },
  { id: 'feather', name: '羽毛笔', category: 'keepsake', icon: 'giftFeather', desc: '适合写信' },
  { id: 'lamp', name: '小夜灯', category: 'keepsake', icon: 'giftLamp', desc: '暖黄色的光' },
  { id: 'origami', name: '纸鹤', category: 'keepsake', icon: 'giftOrigami', desc: '亲手折的' },
  { id: 'telescope', name: '星空望远镜', category: 'books', icon: 'giftTelescope', desc: '可以看到月亮的环形山' },
  { id: 'book', name: '一本诗集', category: 'books', icon: 'giftScroll', desc: '扉页留了空白' },
  { id: 'vinyl', name: '黑胶唱片', category: 'books', icon: 'giftMusic2', desc: '一张老歌合集' },
  { id: 'palette', name: '水彩颜料', category: 'books', icon: 'giftPalette', desc: '十二种冬天的颜色' },
  { id: 'camera', name: '拍立得相纸', category: 'books', icon: 'giftCamera', desc: '一盒，留给想记住的时刻' },
  { id: 'heart', name: '一颗小心心', category: 'heart', icon: 'giftHeart', desc: '没什么理由，就是想送' },
  { id: 'star', name: '一颗星星', category: 'heart', icon: 'giftStar', desc: '以你的名字命名（想象中的）' },
  { id: 'bell', name: '风铃', category: 'heart', icon: 'giftBell', desc: '有风的时候会想起你' },
  { id: 'puzzle', name: '拼图的最后一块', category: 'heart', icon: 'giftPuzzle', desc: '刚好补上' },
]

export const giftById = (id: string) => GIFTS.find((g) => g.id === id)
