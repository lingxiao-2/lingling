/**
 * 虚拟手机桌面上的应用。
 *  - route 有值：已完成，点开进入真实页面（沿用原有路由）
 *  - route 为 null：尚未开发，点开是如实说明的「待开发」页面，不伪造数据
 */
import type { IconName } from '../theme/icons'

export type AppId =
  | 'messages'
  | 'contacts'
  | 'moments'
  | 'me'
  | 'memory'
  | 'theme'
  | 'worlds'
  | 'lorebooks'
  | 'stickers'
  | 'backup'
  | 'ai'
  | 'album'
  | 'diary'
  | 'notes'
  | 'calendar'
  | 'music'
  | 'clock'
  | 'weather'
  | 'mail'
  | 'gift'
  | 'tarot'

export interface DesktopApp {
  id: AppId
  name: string
  /** 英文副名（桌面小字、待开发页的装饰标题） */
  en: string
  icon: IconName
  route: string | null
  /** 待开发应用的说明：计划做什么（不是已有功能） */
  plan?: string
}

export const APPS: Record<AppId, DesktopApp> = {
  messages: { id: 'messages', name: '消息', en: 'Messages', icon: 'tabMessages', route: '/messages' },
  contacts: { id: 'contacts', name: '联系人', en: 'Contacts', icon: 'tabContacts', route: '/contacts' },
  moments: { id: 'moments', name: '动态', en: 'Moments', icon: 'tabMoments', route: '/moments' },
  me: { id: 'me', name: '我的', en: 'Me', icon: 'tabMe', route: '/me' },
  memory: { id: 'memory', name: '记忆', en: 'Memory', icon: 'memory', route: '/memories' },
  theme: { id: 'theme', name: '主题装扮', en: 'Theme', icon: 'dress', route: '/me/theme' },
  worlds: { id: 'worlds', name: '世界', en: 'Worlds', icon: 'world', route: '/contacts?tab=worlds' },
  lorebooks: { id: 'lorebooks', name: '世界书', en: 'Lore', icon: 'lorebook', route: '/contacts?tab=lorebooks' },
  stickers: { id: 'stickers', name: '表情包', en: 'Stickers', icon: 'emoji', route: '/me/stickers' },
  backup: { id: 'backup', name: '备份', en: 'Backup', icon: 'backup', route: '/me/backup' },
  ai: { id: 'ai', name: 'AI 服务', en: 'AI', icon: 'key', route: '/me/api' },
  album: { id: 'album', name: '相册', en: 'Album', icon: 'album', route: '/album' },
  diary: { id: 'diary', name: '日记', en: 'Diary', icon: 'diary', route: '/diary' },
  notes: { id: 'notes', name: '便签', en: 'Notes', icon: 'note', route: '/notes' },
  calendar: { id: 'calendar', name: '日历', en: 'Calendar', icon: 'calendar', route: '/calendar' },
  music: { id: 'music', name: '音乐', en: 'Music', icon: 'music', route: '/music' },
  clock: { id: 'clock', name: '时钟', en: 'Clock', icon: 'clock', route: null, plan: '世界时钟与闹钟。' },
  weather: { id: 'weather', name: '天气', en: 'Weather', icon: 'weather', route: null, plan: '查看天气（需要你同意后才会联网获取）。' },
  mail: { id: 'mail', name: '信箱', en: 'Letters', icon: 'mail', route: null, plan: '和角色互相写信。' },
  gift: { id: 'gift', name: '礼物', en: 'Gifts', icon: 'gift', route: null, plan: '给角色送礼物、收到回礼。' },
  tarot: { id: 'tarot', name: '塔罗', en: 'Tarot', icon: 'tarot', route: null, plan: '抽一张牌，和角色聊聊。' },
}

export const APP_IDS = Object.keys(APPS) as AppId[]

export function isAppId(x: unknown): x is AppId {
  return typeof x === 'string' && x in APPS
}

/** 点开应用要去的地址：已完成的进入真实页面，未完成的进入待开发说明页 */
export function appHref(id: AppId): string {
  return APPS[id].route ?? `/app/${id}`
}
