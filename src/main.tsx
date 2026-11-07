import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { handleIncoming, watchIncomingShare } from './ios/incoming'

watchIncomingShare()
// 先处理快捷指令回跳等外部参数（最多等 1.5 秒，失败也照常打开）
void Promise.race([handleIncoming(), new Promise((r) => setTimeout(r, 1500))]).finally(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
))
