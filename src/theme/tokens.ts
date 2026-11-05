/**
 * Winter Letter 设计常量（与 index.css 中的 CSS 变量配套）。
 * 尺寸统一从这里取，页面里不要直接写图标或头像的像素值。
 */

/** 图标：视觉小巧，点击区域另由按钮保证（≥ 40×40） */
export const ICON = {
  size: { xs: 14, sm: 16, md: 18, lg: 20 },
  stroke: { thin: 1.25, regular: 1.4, bold: 1.5 },
} as const

export type IconSize = keyof typeof ICON.size
export type IconStroke = keyof typeof ICON.stroke

/** 头像：统一圆形，按用途分档 */
export const AVATAR = {
  chat: 28, // 聊天消息旁
  picker: 32, // 选择器、小型列表
  list: 38, // 会话、联系人列表
  card: 44, // 卡片内
  profile: 72, // 资料页
} as const

export type AvatarSize = keyof typeof AVATAR
