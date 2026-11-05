/**
 * 图标注册表：页面只用语义名称（back、plus、world…），不直接引用图标库。
 * 以后要换一套「美化图标」，调用 registerIcons() 覆盖对应名称即可，页面无需改动。
 */
import type { ComponentType } from 'react'
import {
  AlertCircle,
  Aperture,
  ArrowDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileDown,
  FileText,
  Globe,
  ImagePlus,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Palette,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { ICON, type IconSize, type IconStroke } from './tokens'

export interface IconProps {
  size?: number
  strokeWidth?: number
  className?: string
}

const REGISTRY = {
  back: ChevronLeft,
  forward: ChevronRight,
  expand: ChevronDown,
  collapse: ChevronUp,
  more: MoreHorizontal,
  plus: Plus,
  search: Search,
  edit: Pencil,
  delete: Trash2,
  import: FileDown,
  file: FileText,
  image: ImagePlus,
  link: Link2,
  check: Check,
  alert: AlertCircle,
  send: Send,
  scrollDown: ArrowDown,
  pin: Pin,
  theme: Palette,
  // 实体
  character: UserRound,
  people: Users,
  world: Globe,
  lorebook: BookOpen,
  // 底部导航
  tabMessages: MessageCircle,
  tabContacts: Users,
  tabMoments: Aperture,
  tabMe: UserRound,
} satisfies Record<string, ComponentType<IconProps>>

export type IconName = keyof typeof REGISTRY

const overrides: Partial<Record<IconName, ComponentType<IconProps>>> = {}

/** 预留：替换部分或全部图标（例如用户安装的图标包） */
export function registerIcons(icons: Partial<Record<IconName, ComponentType<IconProps>>>) {
  Object.assign(overrides, icons)
}

export function Icon({
  name,
  size = 'md',
  stroke = 'regular',
  className,
}: {
  name: IconName
  size?: IconSize
  stroke?: IconStroke
  className?: string
}) {
  const C = overrides[name] ?? REGISTRY[name]
  return <C size={ICON.size[size]} strokeWidth={ICON.stroke[stroke]} className={className} />
}
