# 管理员账号与默认 Key 配置（Vercel 环境变量）

> 管理员 = 邮箱在 `ADMIN_EMAILS` / `VITE_ADMIN_EMAILS` 里的用户。
> 管理员登录后自动预填这些 Key；管理员可在「设置 → API / MCP」修改并同步到服务器，作为其他账号的默认值。

## 1. 管理员账号（必配）

Vercel → 项目 `webapp-amazonmarketsearch` → **Settings → Environment Variables**（Preview + Production 都勾）：

| 变量名 | 值 |
| --- | --- |
| `ADMIN_EMAILS` | `ljh15874760218@gmail.com` |

> 前端 build 会注入 `VITE_ADMIN_EMAILS`（本地 `.env.local` 已有兜底），后端读 `ADMIN_EMAILS`。二者配一个即可（推荐都配）。

## 2. 默认 AI / MCP Key（选配，管理员登录后自动预填）

| 变量名 | 值（示例，来自 .env.local） |
| --- | --- |
| `DEEPSEEK_API_KEY` | （你的 DeepSeek Key，没有先留空） |
| `SELLERSPRITE_SECRET_KEY` | `51ebe95758734929acf80c61704e2dda` |
| `XYDC_SECRET_KEY` | `mcp_407eba6698f9e99d23ecaad5364e4be6` |

> 说明：这些 Key 也写在 `.env.local`（本地开发），但 `.env.local` 按安全原则**不提交 Git**，所以 Vercel 生产/预览环境要单独在平台配置。

## 3. 生效步骤

1. 添加上述环境变量（Preview + Production 都勾）
2. 回到 **Deployments** → 点 **Redeploy** 重新部署
3. 部署变绿后，用 `ljh15874760218@gmail.com` 登录
4. 进「设置 → API / MCP」确认 Key 已自动预填

## 4. 安全提示

- 请在聊天里**轮换**已暴露的卖家精灵 / 西柚密钥（它们在对话中出现过）。
- 密钥只存服务端 / 管理员本机，不提交 Git。
