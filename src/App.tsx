import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import TabBar from './components/TabBar'
import Wallpaper from './components/Wallpaper'
import { ensureDefaults } from './db/db'
import MessagesPage from './pages/MessagesPage'
import DesktopPage from './pages/DesktopPage'
import ComingSoonPage from './pages/ComingSoonPage'
import MemoriesHubPage from './pages/MemoriesHubPage'
import AlbumHomePage from './pages/album/AlbumHomePage'
import AlbumGridPage from './pages/album/AlbumGridPage'
import PhotoViewerPage from './pages/album/PhotoViewerPage'
import DiaryListPage from './pages/diary/DiaryListPage'
import DiaryEditorPage from './pages/diary/DiaryEditorPage'
import DiaryTrashPage from './pages/diary/DiaryTrashPage'
import NotesListPage from './pages/notes/NotesListPage'
import NoteEditorPage from './pages/notes/NoteEditorPage'
import NotesTrashPage from './pages/notes/NotesTrashPage'
import CalendarPage from './pages/calendar/CalendarPage'
import EventEditorPage from './pages/calendar/EventEditorPage'
import AiToolsPage, { AiToolsCharacterPage } from './pages/AiToolsPage'
import IphonePage, { RunPage } from './pages/iphone/IphonePage'
import SharePage from './pages/SharePage'
import MusicPage from './pages/music/MusicPage'
import TimerWatcher from './components/TimerWatcher'
import ClockPage from './pages/ClockPage'
import WeatherPage from './pages/WeatherPage'
import MailPage from './pages/mail/MailPage'
import ComposePage from './pages/mail/ComposePage'
import LetterPage from './pages/mail/LetterPage'
import GiftsPage from './pages/gifts/GiftsPage'
import SendGiftPage from './pages/gifts/SendGiftPage'
import GiftRecordPage from './pages/gifts/GiftRecordPage'
import TarotPage from './pages/tarot/TarotPage'
import ReadingPage from './pages/tarot/ReadingPage'
import PlaylistPage from './pages/music/PlaylistPage'
import NowPlayingPage from './pages/music/NowPlayingPage'
import ContactsPage from './pages/ContactsPage'
import MomentsPage from './pages/MomentsPage'
import MomentComposePage from './pages/MomentComposePage'
import MePage from './pages/MePage'
import ChatPage from './pages/ChatPage'
import CharacterEditPage from './pages/CharacterEditPage'
import ContextPreviewPage from './pages/ContextPreviewPage'
import CharacterProfilePage from './pages/CharacterProfilePage'
import MemoryPage from './pages/MemoryPage'
import ApiSettingsPage from './pages/ApiSettingsPage'
import ProfileEditPage from './pages/ProfileEditPage'
import ThemeSettingsPage from './pages/ThemeSettingsPage'
import ImportPage from './pages/ImportPage'
import LorebookDetailPage from './pages/LorebookDetailPage'
import LorebookEditPage from './pages/LorebookEditPage'
import WorldDetailPage from './pages/WorldDetailPage'
import WorldEditPage from './pages/WorldEditPage'
import StickerSettingsPage from './pages/StickerSettingsPage'
import BackupPage from './pages/BackupPage'

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
    </>
  )
}
