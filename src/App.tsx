import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import TabBar from './components/TabBar'
import Wallpaper from './components/Wallpaper'
import { ensureDefaults } from './db/db'
import MessagesPage from './pages/MessagesPage'
import ContactsPage from './pages/ContactsPage'
import MomentsPage from './pages/MomentsPage'
import MePage from './pages/MePage'
import ChatPage from './pages/ChatPage'
import CharacterEditPage from './pages/CharacterEditPage'
import CharacterProfilePage from './pages/CharacterProfilePage'
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
    <Routes>
      <Route element={<TabLayout />}>
        <Route index element={<MessagesPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="moments" element={<MomentsPage />} />
        <Route path="me" element={<MePage />} />
      </Route>
      <Route path="chat/:convId" element={<ChatPage />} />
      <Route path="character/new" element={<CharacterEditPage />} />
      <Route path="character/:id" element={<CharacterProfilePage />} />
      <Route path="character/:id/edit" element={<CharacterEditPage />} />
      <Route path="me/api" element={<ApiSettingsPage />} />
      <Route path="me/profile" element={<ProfileEditPage />} />
      <Route path="me/theme" element={<ThemeSettingsPage />} />
      <Route path="me/stickers" element={<StickerSettingsPage />} />
      <Route path="me/backup" element={<BackupPage />} />
      <Route path="import" element={<ImportPage />} />
      {/* 旧入口，保留以免已有链接失效 */}
      <Route path="lorebooks" element={<Navigate to="/contacts?tab=lorebooks" replace />} />
      <Route path="lorebook/new" element={<LorebookEditPage />} />
      <Route path="lorebook/:id" element={<LorebookDetailPage />} />
      <Route path="lorebook/:id/edit" element={<LorebookEditPage />} />
      <Route path="world/new" element={<WorldEditPage />} />
      <Route path="world/:id" element={<WorldDetailPage />} />
      <Route path="world/:id/edit" element={<WorldEditPage />} />
      <Route path="*" element={<MessagesPage />} />
    </Routes>
    </>
  )
}
