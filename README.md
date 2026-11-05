# 聆聆 AI · Lingling AI

微信式聊天 + AI 角色陪伴的移动端 Web 应用（React + TypeScript + Vite + Tailwind CSS v4 + React Router + Dexie/IndexedDB）。

> 当前版本：**V0.1 第二轮（导入与世界书）**。尚未接入真实 AI，详见下方「已完成 / 未完成」。

## 启动

```bash
npm install
npm run dev        # 开发，手机同一 Wi‑Fi 下访问终端打印的 Network 地址
npm test           # 导入解析器单元测试
npm run build      # 类型检查 + 构建
npm run preview
```

仓库已配置 GitHub Actions（`.github/workflows/deploy.yml`）：每次推送和 PR 都会自动类型检查、运行测试并构建；合并到 `main` 后发布到 GitHub Pages，可直接用手机浏览器预览（需在仓库 Settings → Pages 中把 Source 设为 GitHub Actions）。

## 已完成

- 四个底部导航：消息 / 联系人 / 动态 / 我的（路由真实切换，使用 HashRouter 便于静态托管）
- Winter Letter 主题变量、毛玻璃、安全区适配
- 角色：创建 / 编辑 / 查看 / 删除（含头像上传压缩），保存在 IndexedDB
- 会话列表：搜索、置顶、删除（长按）、草稿标记、未读数、最新消息摘要
- 单聊：发送文字（Enter 换行，按钮发送）、历史恢复、时间分隔、草稿自动保存、输入框自适应、「回到底部」、长按复制 / 删除（软删除）
- 我的：个人资料、API 配置保存（Base URL / Key / 模型 / 参数）、数据统计
- 数据层：Dexie 数据库 v1，已建立 characters / conversations / messages / messageVersions / memories / moments / stickers / worlds / settings 表，并预留版本与迁移入口

## 第二轮：角色导入、世界书

入口：联系人页右上角「导入」图标；「⋯」菜单里有世界书管理和导入世界书；联系人列表顶部的「世界书」行进入世界书管理。

**支持的导入格式**

| 格式 | 角色 | 世界书 |
|---|---|---|
| SillyTavern 角色卡 JSON V2（`spec: chara_card_v2`） | ✅ | 卡内 `character_book` 一并导入并自动关联 |
| SillyTavern 角色卡 V3 JSON | ✅ 按 V2 字段读取，额外字段保留 | 同上 |
| SillyTavern 角色卡 V1（扁平字段） | ✅ | — |
| SillyTavern 世界书 JSON（World Info 导出，`entries` 为对象或数组） | — | ✅ |
| 组合 JSON：`{ "characters": [...], "lorebooks" 或 "worldbooks": [...] }`，可用名称或下标互相引用 | ✅ | ✅ 并按引用建立关联 |
| 通用 JSON（`name`/`昵称`/`性格`/`说话风格`/`背景故事`/`开场白` 等常见键名，也支持 JSON 数组） | ✅ | — |
| Markdown | ✅ 按标题拆段，在预览中选择每段归属 | ✅ 每个标题一个条目，标题即关键词 |
| TXT | ✅ 按「性格：」「【背景故事】」这类行拆段 | ✅ 整体作为一个条目 |

**暂不支持**：PNG / WebP 图片角色卡（图片内嵌数据）、CharX、YAML、ZIP、Word、PDF。单个文件上限 5 MB。

**规则**
- 先预览后保存，可逐个取消勾选、改名称、改字段；保存在一个事务内，失败时不写入任何数据。
- 重名（与已有数据或本批次内）会提示，可选「跳过」或「仍然导入为新的一份」，不会覆盖已有数据。
- 无法映射的字段原样保留在 `extensions`（角色：`extensions.sillytavern` / `extensions.unmapped`；世界书条目同理）。
- 开场白、示例对话保存在角色设定里，**不会**写入聊天记录或记忆。
- TXT / Markdown 不做 AI 推测，只按标题和字段名拆段，由用户确认归属。
- 角色 ↔ 世界书为多对多关联，使用稳定 ID（`characterLorebooks` 表），解除关联不会删除世界书；删除角色只解除关联。
- 世界书暂时不影响 AI 回复。`getCharacterLorebooks()` 已预留为后续上下文注入接口。

**数据库升级**：Dexie v1 → v2，只新增 `lorebooks`、`characterLorebooks` 两张表，角色新增字段均为可选，已有联系人和聊天记录不做任何改写。

## 未完成（不是伪功能，界面上已标注）

- 真实 AI 回复、API 连接测试、停止生成、重新生成（第二轮）
- 群聊、朋友圈、自定义表情包、记忆提取（V0.2）
- 世界书条目的在线编辑、世界书注入 AI 上下文
- 备份 / 恢复 `.lingling`（V0.3）
- 引用回复、收藏、编辑消息、撤回、多选、消息搜索（V0.1 后续轮次）

## 目录

```
src/
  db/          schema.ts（表与类型）· db.ts（实例与设置）· repo.ts（读写操作）
  import/      parse.ts（角色 / 世界书解析，纯函数）· types.ts
  services/ai/ provider.ts（AI 适配层接口，第二轮实现）
  store/       profile.ts（订阅 IndexedDB 的设置 hook）
  components/  Avatar · NavBar · TabBar · Sheet · ui
  pages/       Messages · Contacts · Moments · Me · Chat · CharacterEdit/Profile · ApiSettings · ProfileEdit
               Import · Lorebooks · LorebookDetail
scripts/       test-import.ts（npm test）
  lib/         util.ts · usePress.ts
```

## 隐私与 API Key

API Key 仅保存在当前浏览器的 IndexedDB，不进入代码或仓库。纯前端调用时浏览器会直接把密钥与聊天内容发给你配置的 API 服务；这不等同于可信后端对密钥的保护。

## AI 服务（双模式）

- **聆聆默认服务**：无需 API Key。前端与后端代码已完成，**后端尚未部署**；部署前，界面会显示「尚未开通」，不会生成任何回复。说明与部署步骤见 [`docs/default-service.md`](docs/default-service.md)。
- **使用自己的 API**：兼容 OpenAI 格式，可以浏览器直连（个人测试），也可以通过自建代理使用。见 [`docs/ai-proxy.md`](docs/ai-proxy.md)。
- 仓库与前端代码中不包含任何密钥。
