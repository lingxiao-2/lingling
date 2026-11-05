# 聆聆 AI · 模型接入与安全代理

## 为什么需要代理

聆聆部署在 GitHub Pages，是一个**纯静态网站，没有自己的服务器**。所以：

- 前端代码里**不能**也**不会**写入任何 API Key，仓库里也没有。
- 「个人测试模式」下，API Key 保存在你这台设备的浏览器里（IndexedDB）。每次聊天时，浏览器会直接把密钥和聊天内容发给服务商。
  - 能接触这台设备或这个浏览器的人、浏览器扩展、被篡改的页面，都有可能取得密钥。
  - 静态网站无法像真正的后端那样把密钥藏起来，这是技术上的限制。
  - 部分服务商不允许浏览器直接请求（CORS），会出现「无法连接」。
  - 只建议在自己的设备上使用，并使用额度受限、可以随时作废的密钥。
- 「安全代理模式」下，密钥只保存在你自己部署的代理上，浏览器只持有一个「访问口令」。口令泄露时，别人最多只能在你设定的限制内调用代理，拿不到服务商密钥，你也可以随时更换口令。

## 部署 Cloudflare Workers 代理（免费额度通常足够个人使用，可在手机浏览器上完成）

1. 登录 <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker**，起名如 `lingling-proxy`，点 **Deploy**。
2. 点 **Edit code**，把仓库中 [`proxy/cloudflare-worker.js`](../proxy/cloudflare-worker.js) 的全部内容粘贴进去，**Deploy**。
3. 打开 Worker 的 **Settings → Variables and Secrets**，添加：

   | 名称 | 类型 | 示例 |
   |---|---|---|
   | `UPSTREAM_BASE_URL` | Text | `https://api.deepseek.com/v1` |
   | `UPSTREAM_API_KEY` | **Secret** | 你的服务商密钥 |
   | `ACCESS_TOKEN` | **Secret** | 自己设定的一长串随机口令 |
   | `ALLOWED_ORIGINS` | Text | `https://lingxiao-2.github.io` |
   | `ALLOWED_MODELS` | Text（可选） | `deepseek-chat` |
   | `MAX_TOKENS` | Text（可选） | `2048` |

4. 在聆聆「我的 → API 设置」中选择 **安全代理**，填写：
   - 代理地址：`https://lingling-proxy.<你的子域>.workers.dev`
   - 访问口令：上面设置的 `ACCESS_TOKEN`
   - 模型名称：例如 `deepseek-chat`
5. 点「测试连接」。

建议另外在 Cloudflare 中为该 Worker 配置速率限制（Security → WAF → Rate limiting rules），并在服务商后台设置用量上限。

## 代理做了什么

- 只接受 `POST /v1/chat/completions`，只允许 `ALLOWED_ORIGINS` 中的网站来源（CORS）。
- 校验 `X-Lingling-Token`，口令不对一律拒绝。
- 只转发 `model / messages / temperature / max_tokens / stream`，`max_tokens` 不超过 `MAX_TOKENS`；可限制模型。
- 用 `UPSTREAM_API_KEY` 请求服务商，原样转发结果（包括流式输出），不会把密钥返回给浏览器。

## 上下文由什么组成

每次回复时，聆聆会把以下内容发给模型（代码见 `src/services/ai/context.ts`）：

1. 角色人设：简介、性格、说话风格、背景故事、与你的关系
2. 角色所在的世界：名称、简介、设定
3. 世界书：角色关联、以及所在世界关联的世界书中，被最近 6 条消息里的关键词触发的条目，再加上常驻条目，总量有上限
4. 示例对话：只作为语气参考，并明确告诉模型这不是真实发生过的对话
5. 聊天记录：本会话中未删除、当前生效版本的消息，从最新往前约 6000 字

其它角色的聊天记录、未关联的世界书，都不会被发送。
