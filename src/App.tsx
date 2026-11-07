import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import TabBar from './components/TabBar'
import Wallpaper from './components/Wallpaper'
import { ensureDefaults } from './db/db'
import MessagesPage from './pages/MessagesPage'
import DesktopPage from './pages/DesktopPage'
import ComingSoonPage from './pages/ComingSoonPage'
import AiToolsPage, { AiToolsCharacterPage } from './pages/AiToolsPage'
import TimerWatcher from './components/TimerWatcher'
import ContactsPage from './pages/ContactsPage'
import MomentsPage from './pages/MomentsPage'
import MomentComposePage from './pages/MomentComposePage'
import MePage from './pages/MePage'
import ChatPage from './pages/ChatPage'
import CharacterEditPage from './pages/CharacterEditPage'
import CharacterProfilePage from './pages/CharacterProfilePage'
import ProfileEditPage from './pages/ProfileEditPage'
import LorebookDetailPage from './pages/LorebookDetailPage'
import LorebookEditPage from './pages/LorebookEditPage'
import WorldDetailPage from './pages/WorldDetailPage'
import WorldEditPage from './pages/WorldEditPage'

// 不常用的页面按需加载（打开时才下载），让桌面与聊天更快打开
const MemoriesHubPage = lazy(() => import('./pages/MemoriesHubPage'))
const AlbumHomePage = lazy(() => import('./pages/album/AlbumHomePage'))
const AlbumGridPage = lazy(() => import('./pages/album/AlbumGridPage'))
const PhotoViewerPage = lazy(() => import('./pages/album/PhotoViewerPage'))
const DiaryListPage = lazy(() => import('./pages/diary/DiaryListPage'))
const DiaryEditorPage = lazy(() => import('./pages/diary/DiaryEditorPage'))
const DiaryTrashPage = lazy(() => import('./pages/diary/DiaryTrashPage'))
const NotesListPage = lazy(() => import('./pages/notes/NotesListPage'))
const NoteEditorPage = lazy(() => import('./pages/notes/NoteEditorPage'))
const NotesTrashPage = lazy(() => import('./pages/notes/NotesTrashPage'))
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage'))
const EventEditorPage = lazy(() => import('./pages/calendar/EventEditorPage'))
const IphonePage = lazy(() => import('./pages/iphone/IphonePage'))
const RunPage = lazy(() => import('./pages/iphone/IphonePage').then((m) => ({ default: m.RunPage })))
const SharePage = lazy(() => import('./pages/SharePage'))
const MusicPage = lazy(() => import('./pages/music/MusicPage'))
const ClockPage = lazy(() => import('./pages/ClockPage'))
const WeatherPage = lazy(() => import('./pages/WeatherPage'))
const MailPage = lazy(() => import('./pages/mail/MailPage'))
const ComposePage = lazy(() => import('./pages/mail/ComposePage'))
const LetterPage = lazy(() => import('./pages/mail/LetterPage'))
const GiftsPage = lazy(() => import('./pages/gifts/GiftsPage'))
const SendGiftPage = lazy(() => import('./pages/gifts/SendGiftPage'))
const GiftRecordPage = lazy(() => import('./pages/gifts/GiftRecordPage'))
const TarotPage = lazy(() => import('./pages/tarot/TarotPage'))
const ReadingPage = lazy(() => import('./pages/tarot/ReadingPage'))
const PlaylistPage = lazy(() => import('./pages/music/PlaylistPage'))
const NowPlayingPage = lazy(() => import('./pages/music/NowPlayingPage'))
const ContextPreviewPage = lazy(() => import('./pages/ContextPreviewPage'))
const MemoryPage = lazy(() => import('./pages/MemoryPage'))
const ApiSettingsPage = lazy(() => import('./pages/ApiSettingsPage'))
const ThemeSettingsPage = lazy(() => import('./pages/ThemeSettingsPage'))
const ImportPage = lazy(() => import('./pages/ImportPage'))
const StickerSettingsPage = lazy(() => import('./pages/StickerSettingsPage'))
const BackupPage = lazy(() => import('./pages/BackupPage'))

function TabLayout() {
  return (
    <div className="h-dvh flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">
        <Outlet />
      </div>
      <TabBar />
    </div>
  )
}

export default function App() {
  useEffect(() => {
    void ensureDefaults()
    // 请求持久化存储，降低 Safari 清理 IndexedDB 的风险（失败不影响使用）
    void navigator.storage?.persist?.()
  }, [])

  return (
    <>
    <Wallpaper />
    <TimerWatcher />
    <Suspense fallback={<div className="h-dvh" aria-busy="true" />}>
    <Routes>
      {/* 首页是虚拟手机桌面；原来的四个页面仍然在原地址（消息改为 /messages），底部导航多了「桌面」 */}
      <Route index element={<DesktopPage />} />
      <Route path="app/:id" element={<ComingSoonPage />} />
      <Route path="memories" element={<MemoriesHubPage />} />
      <Route path="album" element={<AlbumHomePage />} />
      <Route path="album/photo/:id" element={<PhotoViewerPage />} />
      <Route path="album/:albumId" element={<AlbumGridPage />} />
      <Route path="diary" element={<DiaryListPage />} />
      <Route path="diary/trash" element={<DiaryTrashPage />} />
      <Route path="diary/:id" element={<DiaryEditorPage />} />
      <Route path="notes" element={<NotesListPage />} />
      <Route path="notes/trash" element={<NotesTrashPage />} />
      <Route path="notes/:id" element={<NoteEditorPage />} />
      <Route path="calendar" element={<CalendarPage />} />
      <Route path="calendar/event/:id" element={<EventEditorPage />} />
      <Route element={<TabLayout />}>
        <Route path="messages" element={<MessagesPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="moments" element={<MomentsPage />} />
        <Route path="me" element={<MePage />} />
      </Route>
      <Route path="moments/new" element={<MomentComposePage />} />
      <Route path="chat/:convId" element={<ChatPage />} />
      <Route path="character/new" element={<CharacterEditPage />} />
      <Route path="character/:id/context" element={<ContextPreviewPage />} />
      <Route path="character/:id" element={<CharacterProfilePage />} />
      <Route path="character/:id/edit" element={<CharacterEditPage />} />
      <Route path="character/:id/memories" element={<MemoryPage />} />
      <Route path="me/api" element={<ApiSettingsPage />} />
      <Route path="me/profile" element={<ProfileEditPage />} />
      <Route path="me/theme" element={<ThemeSettingsPage />} />
      <Route path="me/stickers" element={<StickerSettingsPage />} />
      <Route path="me/backup" element={<BackupPage />} />
      <Route path="me/ai-tools" element={<AiToolsPage />} />
      <Route path="me/iphone" element={<IphonePage />} />
      <Route path="share" element={<SharePage />} />
      <Route path="music" element={<MusicPage />} />
      <Route path="clock" element={<ClockPage />} />
      <Route path="weather" element={<WeatherPage />} />
      <Route path="mail" element={<MailPage />} />
      <Route path="mail/new" element={<ComposePage />} />
      <Route path="mail/:id" element={<LetterPage />} />
      <Route path="gifts" element={<GiftsPage />} />
      <Route path="gifts/send" element={<SendGiftPage />} />
      <Route path="gifts/:id" element={<GiftRecordPage />} />
      <Route path="tarot" element={<TarotPage />} />
      <Route path="tarot/:id" element={<ReadingPage />} />
      <Route path="music/playlist/:id" element={<PlaylistPage />} />
      <Route path="music/now" element={<NowPlayingPage />} />
      <Route path="me/iphone/run/:id" element={<RunPage />} />
      <Route path="me/ai-tools/:charId" element={<AiToolsCharacterPage />} />
      {/* 第五阶段的全局开关页已由逐个角色的「AI 工具权限」取代；旧设置原样保留，不再使用 */}
      <Route path="me/life-access" element={<Navigate to="/me/ai-tools" replace />} />
      <Route path="import" element={<ImportPage />} />
      {/* 旧入口，保留以免已有链接失效 */}
      <Route path="lorebooks" element={<Navigate to="/contacts?tab=lorebooks" replace />} />
      <Route path="lorebook/new" element={<LorebookEditPage />} />
      <Route path="lorebook/:id" element={<LorebookDetailPage />} />
      <Route path="lorebook/:id/edit" element={<LorebookEditPage />} />
      <Route path="world/new" element={<WorldEditPage />} />
      <Route path="world/:id" element={<WorldDetailPage />} />
      <Route path="world/:id/edit" element={<WorldEditPage />} />
      {/* 旧版「消息」页的地址曾经是首页；未知地址回到桌面 */}
      <Route path="desktop" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </>
  )
}
