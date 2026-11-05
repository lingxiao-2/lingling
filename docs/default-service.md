# 聆聆默认 AI 服务（双模式）

## 两种模式

| | 聆聆默认服务 | 使用自己的 API |
|---|---|---|
| 用户需要什么 | 什么都不需要 | 兼容 OpenAI 格式的服务商、API Key、模型名 |
| 密钥在哪里 | 官方密钥只在服务端（Cloudflare Worker 的 Secret） | 本设备浏览器（直连），或你自己部署的代理 |
| 额度 | 每台设备每天免费 N 条，另有 IP 与全站上限 | 由你的服务商账户决定 |
| 当前状态 | **前端与后端代码已完成，后端尚未部署** | **已可真实使用** |

两种模式共用同一套聊天界面、角色人设、世界、世界书、上下文构建（`src/services/ai/context.ts`）、回复引擎（`replyEngine.ts`）与聊天记录；区别只在请求发往哪里（`resolveTarget()`）。切换模式不会删除或修改任何数据。

## 架构

```
iPhone Safari（GitHub Pages 静态前端）
   │  POST /v1/chat/completions
   │  头：X-Lingling-Device（匿名设备 ID），不含任何密钥
   ▼
Cloudflare Worker（server/lingling-service-worker.js）
   ├─ 校验来源网站（ALLOWED_ORIGINS）与设备 ID 格式
   ├─ 校验消息格式、条数（≤ 80）与总字数（MAX_INPUT_CHARS）
   ├─ 额度：设备 / IP / 全站 每日计数（KV），任一用完即拒绝
   ├─ 固定模型（UPSTREAM_MODEL），限制 max_tokens 与 temperature
   ├─ 用 UPSTREAM_API_KEY 请求模型服务商，流式原样转发
   └─ 上游失败：退回本次计数，不透传上游错误详情
```

- 前端只知道服务的**公开地址**，构建时由仓库变量 `LINGLING_SERVICE_URL` 注入为 `VITE_LINGLING_SERVICE_URL`。未设置时，前端显示「尚未开通」，**不会生成任何回复**。
- 官方密钥不会出现在前端、仓库或构建产物中。
- Worker 不记录聊天内容、密钥或请求头。
- `GET /v1/quota` 返回该设备今日的已用 / 剩余额度，「AI 服务」设置页会显示。

## 滥用防护

| 措施 | 配置 | 作用 |
|---|---|---|
| 来源白名单 | `ALLOWED_ORIGINS` | 浏览器跨域只允许你的网站（注意：命令行工具可以伪造 Origin，所以还需要下面几项） |
| 设备额度 | `FREE_DAILY_MESSAGES`（默认 30） | 普通用户的免费额度 |
| IP 额度 | `IP_DAILY_LIMIT`（默认 150） | 防止通过清除浏览器数据来不断刷新设备 ID |
| 全站上限 | `GLOBAL_DAILY_LIMIT`（默认 3000） | **限制每天的最大花费**，超出后提示「明天再试或改用自己的 API」 |
| 输入上限 | `MAX_INPUT_CHARS`（默认 24000）、≤ 80 条消息 | 防止超长上下文消耗大量费用 |
| 输出上限 | `MAX_TOKENS`（默认 600）、`TEMPERATURE_MAX` | 控制单次花费 |
| 固定模型 | `UPSTREAM_MODEL` | 前端无法指定更贵的模型 |
| 维护开关 | `SERVICE_ENABLED=false` | 出现异常时立即停止服务 |

还可以考虑的加强措施（尚未实现）：Cloudflare WAF 速率限制规则、Cloudflare Turnstile 人机验证、把计数改为 Durable Objects（严格计数）、用户账号体系。

## 第二阶段：部署需要你决定的事

1. **后端平台**：推荐 Cloudflare Workers（与现有代理模板一致）。
   - KV 免费版每天只有 **1,000 次写入**，每条消息会写入 3 次计数，因此免费版每天约支持 **330 条消息**。
   - 更大的用量需要 Workers 付费计划（以 Cloudflare 官网当前价格为准），或改用 Durable Objects / D1 计数。
2. **模型服务商与模型**：例如 DeepSeek、OpenAI 或其它兼容 OpenAI 格式的服务。需要你注册账户、充值并创建一个**专用**密钥，最好在服务商后台设置用量上限。
3. **预算**：每日花费约等于 每日消息数 ×（输入 tokens × 输入单价 + 输出 tokens × 输出单价）。
   - 聆聆每次请求会附带角色设定、世界书和最近的聊天记录，**输入通常远多于输出**，是费用的主要来源。
   - 请先确定每日预算，再反推 `GLOBAL_DAILY_LIMIT` 与 `FREE_DAILY_MESSAGES`。
4. **免费额度**：每台设备每天多少条。

## 第二阶段部署步骤（确认上述事项后）

1. Cloudflare → Workers & Pages → Create Worker（如 `lingling-service`），粘贴 `server/lingling-service-worker.js`。
2. Storage & Databases → KV → 创建命名空间（如 `lingling-quota`），在 Worker 的 Bindings 中以变量名 `QUOTA` 绑定。
3. 在 Variables and Secrets 中配置 `UPSTREAM_BASE_URL`、`UPSTREAM_API_KEY`（Secret）、`UPSTREAM_MODEL`、`ALLOWED_ORIGINS`，以及需要调整的额度变量。
4. 在 GitHub 仓库 Settings → Secrets and variables → Actions → **Variables** 中新建 `LINGLING_SERVICE_URL`，值为 Worker 地址（例如 `https://lingling-service.xxx.workers.dev`）。这是公开地址，用 Variable，不要用 Secret。
5. 重新运行部署工作流（或推送任意提交），前端就会显示「已开通」。
6. 在 iPhone 上打开「我的 → AI 服务」，选择默认服务并点「测试连接」。
