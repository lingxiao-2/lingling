# 聆聆 AI · Lingling AI

微信式聊天 + AI 角色陪伴的移动端 Web 应用（React + TypeScript + Vite + Tailwind CSS v4 + React Router + Dexie/IndexedDB）。

> 当前版本：**V0.1 第一轮基础工程**。尚未接入真实 AI，详见下方「已完成 / 未完成」。

## 启动

```bash
npm install
npm run dev        # 开发，手机同一 Wi‑Fi 下访问终端打印的 Network 地址
npm run build      # 类型检查 + 构建
npm run preview
```

仓库已配置 GitHub Actions（`.github/workflows/deploy.yml`）：每次推送都会自动类型检查并构建；合并到 `main` 后发布到 GitHub Pages，可直接用手机浏览器预览（需在仓库 Settings → Pages 中把 Source 设为 GitHub Actions）。

## 已完成

- 四个底部导航：消息 / 联系人 / 动态 / 我的（路由真实切换，使用 HashRouter 便于静态托管）
- Winter Letter 主题变量、毛玻璃、安全区适配
- 角色：创建 / 编辑 / 查看 / 删除（含头像上传压缩），保存在 IndexedDB
- 会话列表：搜索、置顶、删除（长按）、草稿标记、未读数、最新消息摘要
- 单聊：发送文字（Enter 换行，按钮发送）、历史恢复、时间分隔、草稿自动保存、输入框自适应、「回到底部」、长按复制 / 删除（软删除）
- 我的：个人资料、API 配置保存（Base URL / Key / 模型 / 参数）、数据统计
- 数据层：Dexie 数据库 v1，已建立 characters / conversations / messages / messageVersions / memories / moments / stickers / worlds / settings 表，并预留版本与迁移入口

## 未完成（不是伪功能，界面上已标注）

- 真实 AI 回复、API 连接测试、停止生成、重新生成（第二轮）
- 群聊、朋友圈、自定义表情包、记忆提取、角色卡导入（V0.2）
- 备份 / 恢复 `.lingling`（V0.3）
- 引用回复、收藏、编辑消息、撤回、多选、消息搜索（V0.1 后续轮次）

## 目录

```
src/
  db/          schema.ts（表与类型）· db.ts（实例与设置）· repo.ts（读写操作）
  services/ai/ provider.ts（AI 适配层接口，第二轮实现）
  store/       profile.ts（订阅 IndexedDB 的设置 hook）
  components/  Avatar · NavBar · TabBar · Sheet · ui
  pages/       Messages · Contacts · Moments · Me · Chat · CharacterEdit/Profile · ApiSettings · ProfileEdit
  lib/         util.ts · usePress.ts
```

## 隐私与 API Key

API Key 仅保存在当前浏览器的 IndexedDB，不进入代码或仓库。纯前端调用时浏览器会直接把密钥与聊天内容发给你配置的 API 服务；这不等同于可信后端对密钥的保护。
