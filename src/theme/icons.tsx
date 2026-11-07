/**
 * 图标注册表：页面只用语义名称（back、plus、world…），不直接引用图标库。
 * 以后要换一套「美化图标」，调用 registerIcons() 覆盖对应名称即可，页面无需改动。
 */
import type { ComponentType } from 'react'
import {
  Flower2,
  Cake,
  Coffee,
  Gem,
  Snowflake,
  Feather,
  Flame,
  Candy,
  Cookie,
  IceCreamCone,
  Shell,
  Leaf,
  Umbrella,
  Watch,
  TreePine,
  Telescope,
  Music2,
  Scroll,
  Glasses,
  Croissant,
  Sprout,
  Clover,
  Bird,
  Cat,
  PenTool,
  Lamp,
  Ribbon,
  Bell,
  Puzzle,
  Origami,
  Rose,
  Sun,
  Moon as MoonIcon,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudLightning,
  Wind,
  Droplets,
  RefreshCw,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
  Timer,
  Volume2,
  ListMusic,
  Star,
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
  Database,
  Info,
  KeyRound,
  Archive,
  Square,
  RotateCcw,
  Camera,
  CirclePlus,
  Smile,
  Mic,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Trash2,
  UserRound,
  Users,
  ExternalLink,
  ClipboardPaste,
  Heart,
  MessageSquare,
  Lock,
  StickyNote,
  NotebookPen,
  CalendarDays,
  Music,
  Clock,
  CloudSnow,
  Mail,
  Gift,
  Sparkles,
  BookHeart,
  Images,
  House,
  Moon,
  Shirt,
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
  data: Database,
  info: Info,
  key: KeyRound,
  backup: Archive,
  stop: Square,
  regenerate: RotateCcw,
  camera: Camera,
  add: CirclePlus,
  emoji: Smile,
  voice: Mic,
  external: ExternalLink,
  paste: ClipboardPaste,
  like: Heart,
  comment: MessageSquare,
  lock: Lock,
  // 桌面应用
  home: House,
  album: Images,
  diary: NotebookPen,
  note: StickyNote,
  calendar: CalendarDays,
  music: Music,
  play: Play,
  giftFlower2: Flower2,
  giftCake: Cake,
  giftCoffee: Coffee,
  giftGem: Gem,
  giftSnowflake: Snowflake,
  giftFeather: Feather,
  giftFlame: Flame,
  giftCandy: Candy,
  giftCookie: Cookie,
  giftIceCreamCone: IceCreamCone,
  giftShell: Shell,
  giftLeaf: Leaf,
  giftUmbrella: Umbrella,
  giftWatch: Watch,
  giftTreePine: TreePine,
  giftTelescope: Telescope,
  giftPalette: Palette,
  giftMusic2: Music2,
  giftCamera: Camera,
  giftHeart: Heart,
  giftScroll: Scroll,
  giftGlasses: Glasses,
  giftCroissant: Croissant,
  giftSprout: Sprout,
  giftClover: Clover,
  giftBird: Bird,
  giftCat: Cat,
  giftPenTool: PenTool,
  giftLamp: Lamp,
  giftRibbon: Ribbon,
  giftBell: Bell,
  giftPuzzle: Puzzle,
  giftOrigami: Origami,
  giftRose: Rose,
  giftStar: Star,
  wxSun: Sun,
  wxMoon: MoonIcon,
  wxCloudSun: CloudSun,
  wxCloud: Cloud,
  wxFog: CloudFog,
  wxDrizzle: CloudDrizzle,
  wxRain: CloudRain,
  wxSnow: CloudSnow,
  wxStorm: CloudLightning,
  wind: Wind,
  droplets: Droplets,
  refresh: RefreshCw,
  pause: Pause,
  prevTrack: SkipBack,
  nextTrack: SkipForward,
  repeat: Repeat,
  repeatOne: Repeat1,
  shuffle: Shuffle,
  timer: Timer,
  volume: Volume2,
  playlist: ListMusic,
  star: Star,
  clock: Clock,
  weather: CloudSnow,
  mail: Mail,
  gift: Gift,
  tarot: Moon,
  memory: BookHeart,
  dress: Shirt,
  sparkle: Sparkles,
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

/**
 * 预留：用图片作为图标（例如用户上传的美化图标包）。
 * 图片按图标尺寸显示；单色图标可通过 CSS mask 跟随文字颜色。
 */
export function imageIcon(url: string): ComponentType<IconProps> {
  return function ImageIcon({ size = 18, className }: IconProps) {
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          backgroundColor: 'currentColor',
          WebkitMask: `url("${url}") center / contain no-repeat`,
          mask: `url("${url}") center / contain no-repeat`,
        }}
      />
    )
  }
}

/** 把主题设置中的 customIcons（图标名 → 图片地址）注册为图标；未知名称会被忽略 */
export function applyCustomIcons(map: Record<string, string> | undefined) {
  if (!map) return
  const next: Partial<Record<IconName, ComponentType<IconProps>>> = {}
  for (const [name, url] of Object.entries(map)) {
    if (name in REGISTRY && typeof url === 'string' && url) next[name as IconName] = imageIcon(url)
  }
  registerIcons(next)
}
