# 飞书推送（可选）

在 Vercel 项目环境变量中配置：

- `FEISHU_APP_ID`：飞书开放平台应用 App ID
- `FEISHU_APP_SECRET`：App Secret
- `FEISHU_REDIRECT_URI`（可选）：默认自动用当前域名 `/api/feishu/oauth/callback`

飞书开放平台需配置重定向白名单：

- `https://webapp-amazonmarketsearch.vercel.app/api/feishu/oauth/callback`
- 本地调试（可选）：`http://localhost:3000/api/feishu/oauth/callback`

权限建议：`docx:document`、`offline_access`

未配置时，「推送到飞书」会提示配置；「复制 Markdown / 下载 .md」仍可用。
