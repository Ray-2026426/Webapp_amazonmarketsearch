# M0 环境修复清单（Kairo）

> 目标：让**登录、注册、云同步**在预览版与生产版都恢复正常；让"登录失败"变成"能指出缺哪一项配置"。
> 预计耗时：**15-25 分钟**（其中大部分是在 Supabase / Vercel 控制台点几下）。

---

## 一、根因（已更正：不是项目被删，而是被"闲置自动暂停"）

> **2026-09 更新（用户核实后更正）**：Supabase 项目**不是被删除，而是被免费额度闲置自动暂停**（约 7 天无活动触发）。你在控制台 **Resume** 后：
> - 项目 DNS 立即恢复解析 ✅（`fbldvwzoqlewoistybto.supabase.co` → Cloudflare IP）
> - Auth 服务正常响应 ✅（返回标准的"缺 apikey"提示，说明服务在跑）
> - 数据、备份、存储对象完好 ✅（Supabase 原话："所有数据，包括备份和存储对象，均安全无虞"）
>
> **我此前的误判**：看到该域名 `DNS name does not exist`，就断言"项目已被删除"。事实上**暂停的项目子域名同样会停止解析**，两种解释都成立，而我选了更严重的那种。教训：下不可逆结论前，先排除暂停/欠费/迁移这类可恢复情形。

**因此真正需要解决的是两件事**：

1. **它还会再犯**——免费项目闲置约 7 天会再次自动暂停。必须做保活（见第八节，已实现）；
2. **它表现为不可诊断**——"登录失败"看不出是密码错、配置缺，还是项目被暂停（已用 `/api/health` 解决）。

**顺带发现**：生产环境里存在一组 **Vercel Postgres（Neon）集成**变量（`POSTGRES_URL` / `POSTGRES_HOST` / `POSTGRES_PASSWORD` 等）。当前 App 代码**没有使用**它们（应用走 Supabase 客户端）。→ 若确认无用，可在 Vercel 里**删除该集成**；也可保留备用。

---

## 二、云端步骤（本次多数**不需要执行**）

| 原步骤 | 现在是否需要 |
| --- | --- |
| 步骤 1：新建 Supabase 项目 | ❌ **不需要**（项目 Resume 后活着） |
| 步骤 2：跑 `all_in_one.sql` 迁移 | ❌ **不需要**（数据与表结构完好） |
| 步骤 3：抄 4 个值 | ❌ **不需要**（环境变量没变） |
| 步骤 4：Vercel 配环境变量 | ❌ **不需要**（生产/预览的变量都还在，且指向同一活着的项目） |
| 步骤 5：更新本地 `.env.local` | ⚠️ **可选**：补 `SUPABASE_SERVICE_ROLE_KEY` 与 `APP_JWT_SECRET`（本地缺这两项时，注册与管理接口会受限） |

> 以下原始步骤 1-5 保留备查，**仅在"项目真的被删除"时**按它执行：

### （备查）步骤 1：新建 Supabase 项目

1. 打开 https://supabase.com/dashboard ，用你的账号登录；
2. 顺手先看一眼旧项目还在不在（Settings → General）：如果只是**暂停（Paused）**，直接 Restore 即可（**本次就是这种情况**）；确认已删除时再新建；
3. **New project**：名称建议 `kairo-prod`，区域选 **Southeast Asia (Singapore)** 或 **Northeast Asia (Tokyo)**，设置强数据库密码并保存好。

### （备查）步骤 2：跑数据库迁移

在项目左侧 **SQL Editor** → New query，把仓库里 `supabase/migrations/all_in_one.sql` 的**全部内容**粘贴进去 → Run。
（含：`projects` / `project_members` 表、成员权限 RPC、`push_project_if_revision` 乐观锁、Storage bucket 与策略。）

### （备查）步骤 3：抄下 4 个值

| 值 | 位置 |
| --- | --- |
| `SUPABASE_URL` | Settings → API → Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Settings → API → publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → **service_role** key（⚠️ 服务端专用） |
| `APP_JWT_SECRET` | 自己生成 ≥32 位随机串 |

### （备查）步骤 4：Vercel 环境变量（三个环境都要勾）

Settings → Environment Variables：`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`APP_JWT_SECRET`、`ADMIN_EMAILS`、`SELLERSPRITE_SECRET_KEY`、`DEEPSEEK_API_KEY`——每个变量在 **Production / Preview / Development 三个环境都勾上**。

### （备查）步骤 5：更新本地 `.env.local`

改成对应项目的值；`.env.local` 只在本机使用，**不要提交**（已由 `.gitignore` 挡住）。

---

## 三、验证（两个入口，都要过）

### 入口 A：线上（Vercel）

1. 重新部署一次（Vercel → Deployments → Redeploy，或推一次提交触发）；
2. 打开 `https://<你的域名>/api/health` → 期望看到：

```json
{
  "ok": true,
  "ready": true,
  "config": {
    "supabaseUrlConfigured": true,
    "supabaseHost": "<你的新项目>.supabase.co",
    "publishableKeyConfigured": true,
    "serviceRoleKeyConfigured": true,
    "jwtSecretConfigured": true,
    "adminEmailsConfigured": true,
    "missing": [],
    "warnings": []
  }
}
```

3. **再测连通性**：打开 `https://<你的域名>/api/health?probe=1` → `probe.reachable` 应为 `true`；若为 `false`，`hint` 会直接告诉你原因（域名不存在 / 迁移未执行 / RLS 限制）；
4. 回到站点**注册一个新账号 → 登录 → 新建一个项目 → 刷新页面确认还在**。

### 入口 B：本地（`npm run dev`）

1. 本地开发现在也支持 `/api/*` 了（本次新增 `server/devApiPlugin.ts`，把 `api/**/*.ts` 映射为本地中间件）；
2. `npm run dev` 后打开 http://localhost:3000/api/health → 应与线上同样的 JSON；
3. 注册/登录走一遍。

> 如果不想用本地中间件，也可以改用 `vercel dev`；两者等效。

---

## 四、验收标准（M0 Done 的定义）

- [ ] 打开站点能**正常登录**（项目 Resume 后应已恢复；若仍失败，按第五节排查）
- [ ] `/api/health` 返回 `ready: true` 且 `missing: []`（需先推送本次代码并部署）
- [ ] `/api/health?probe=1` 返回 `probe.reachable: true`
- [ ] `/api/keepalive` 返回 `alive: true`，且 Vercel → Cron Jobs 能看到它
- [ ] 预览版**可以注册并登录**（不再报"登录失败"）
- [ ] 生产版**可以注册并登录**
- [ ] 本地 `npm run dev` **可以注册并登录**
- [ ] 新建项目 → 刷新/换浏览器登录后**项目还在**（云同步生效）
- [ ] 管理员账号能看到"设置 → 数据池"，且密钥保存后重登仍在
- [ ] 三个环境（Production / Preview / Development）配置一致，互不污染

---

## 五、本次已完成的代码侧改动（无需你操作）

| 文件 | 改动 | 目的 |
| --- | --- | --- |
| `api/auth/_shared.ts` | **删除硬编码的默认 Supabase URL / Publishable Key**；新增 `hasSupabaseConfig()` 与 `getCloudConfigStatus()` | 未配置时明确报"未配置"，不再静默连某个固定项目；提供可诊断的状态 |
| `api/health.ts` | **新增**配置自检端点（`?probe=1` 附带连通性探测） | 把"登录失败"变成"指出缺哪项配置 / 服务是否可达"；**永不回显密钥** |
| `api/keepalive.ts` | **新增**保活端点（每日 Cron 调用） | **根治本次故障**：防止免费项目闲置再次自动暂停 |
| `vercel.json` | 新增 `crons`：每日 02:00 调 `/api/keepalive` | 同上 |
| `server/devApiPlugin.ts` | **新增**本地 `/api/*` 中间件（支持 `[action].ts` 动态段） | 修复 `npm run dev` 下登录/云同步全部 404 的问题 |
| `vite.config.ts` | 挂载 `devApiPlugin` | 同上 |
| `.gitignore` | **新增**（实测验证） | 仓库是公开的，挡住 `.env.local`、`.vercel*`（含生产 service_role key）等敏感文件 |

验证记录：`tsc --noEmit` 通过；测试套件 8/8 通过（progress 22、cloudSync 9、authAccount 4、aiConfig、members 3、optimistic 11、assets 7、lookOptimize 10）；生产构建 exit 0（2682 模块）。

---

## 六、防复发：保活（本次故障的根治）

**根因**：Supabase 免费项目闲置约 7 天自动暂停。**已实现保活**：

| 项 | 内容 |
| --- | --- |
| 端点 | `api/keepalive.ts` —— 只做一次 `select id limit 1` 的轻量查询，让项目产生"活动" |
| 调度 | `vercel.json` 新增 `crons`：`{ "path": "/api/keepalive", "schedule": "0 2 * * *" }`（每天 02:00 一次） |
| 安全 | 若配置了 `CRON_SECRET`，会校验 `Authorization: Bearer <secret>`；不回显任何密钥 |
| 读取方式 | 也可手动访问 `https://<你的域名>/api/keepalive` 看 `alive: true/false` |

**部署后请确认**：Vercel → 项目 → **Cron Jobs** 面板能看到 `/api/keepalive`，且首次执行成功（`alive: true`）。

**备选方案**（任选其一即可，保活是"防暂停"、不是"防删除"）：

1. **升级 Supabase Pro**（约 $25/月）：不再自动暂停，额度也更大——若你打算长期用、且不想操心，这是最省心的；
2. **外部监控兜底**：用 UptimeRobot / 阿里云云监控 每 5-10 分钟 GET 一次 `https://<域名>/api/health`，既是保活也是可用性告警；
3. **接受暂停 + 快速恢复**：知道怎么恢复就行（控制台 Resume，数据不丢）——但每次暂停期间用户都用不了，不推荐。

> ⚠️ 注意：Vercel Cron 的可用频率取决于你的 Vercel 套餐（Hobby 计划限制较严，通常每日一次；若你的套餐不支持 cron，请改用备选方案 2）。

---

## 七、遗留事项（不在 M0，但要知道）

1. **国内底座迁移**：已按你的决定后置（PRD §17）。守住三条护栏：前端不直接 import Supabase、新代码一律走 `api/*`、认证 token 逻辑保持独立——将来只改服务端。
2. **前端「设置 → 诊断」面板**：`/api/health` 已就绪，面板 UI 待接（M0 收尾或 M1 早期），届时用户可自助看到配置状态。
3. **Vercel Postgres 集成**：确认是否删除（当前代码未使用）。
4. **`main` 分支保持不动**，等确认后再合并或覆盖。

---

## 七、如何把改动推到 `phase-0`（这一步需要你在本机做）

### 为什么不是我推

本工作区**不是 git 仓库**，系统里也**没有任何 GitHub 凭据**（无 SSH key、无 `.git-credentials`、凭据管理器为空），且当前沙箱**无法让 git 连外网**（`schannel: SEC_E_NO_CREDENTIALS`）。所以推送只能由你在本机执行。我已把「防泄密」的前置工作做好。

### ⚠️ 先看这条：仓库是**公开**的

这个仓库公开可读，而工作区里有 **`.env.local`**（含真实密钥）与 **`.vercel-local/env-production.txt`**（含生产 `SUPABASE_SERVICE_ROLE_KEY`）。
本次已新增 `.gitignore` 并**实测验证**：`.env.local`、`.vercel*`、`node_modules/`、`dist/`、`*.log` 全部被忽略，而 `src/`、`api/`、`docs/` 正常纳入。

推送前**务必**在 `git status` 里确认看不到 `.env.local` / `.vercel-local`。

## 七、推送状态（2026-09 更新）

### 当前状态：**本地提交已就绪，只差凭据**

| 项 | 状态 |
| --- | --- |
| 本地 Git 仓库 | ✅ 已初始化，远端已接，`http.sslBackend=openssl` 已设（绕开 schannel 报错） |
| `phase-0` 分支 | ✅ 已基于远端建立，HEAD 指向它（**`main` 完全没动**） |
| 提交 | ✅ 已提交 **`052f64f`**，领先 `origin/phase-0` **1 个提交**（64 文件，+7414/−5951） |
| 推送管道 | ✅ **已验证可用**（假凭据测试返回 GitHub 服务端拒绝，而非网络/管道错误） |
| GitHub 凭据 | ❌ **没有**（无 SSH key、无 token、凭据管理器为空）→ 因此还推不上去 |

### 推送二选一

**方式 1（你在本机推，最稳）** —— 前提：你本机装了 Git。

```powershell
cd "D:\AI WorkSpace\2.Apps\Web App_亚马逊市场调研"
git show --stat HEAD          # 先核对提交内容
git push origin phase-0       # 只推 phase-0，不碰 main
```

**方式 2（把 token 交给 AI 推）** —— 前提：你愿意提供一个 GitHub 令牌。

1. 打开 GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** → Generate new token；
2. 设置：**Repository access = Only select repositories** → 只勾 `Webapp_amazonmarketsearch`；**Permissions → Contents = Read and write**；**Expiration 建议 1 天**；
3. 把 token 发给我，我执行 `git push origin phase-0`；
4. **推完请立刻 Revoke 该 token**（因为它会出现在本次会话记录里）。

> ⚠️ 注意：GitHub 已不支持用账号密码推送，必须是 token（或 SSH key）。另外仓库是**公开**的，推送前请确认 `git show --stat HEAD` 里没有你不想公开的内容。

### 若想撤销/调整这次本地提交

```powershell
git reset --soft phase-0      # 撤销提交、保留改动（重新挑文件再提交）
git reset --hard phase-0      # 完全丢弃本次提交（工作区文件也回退，慎用）
```

---

## 附：最初准备的完整推送流程（已执行过，留档备查）

```powershell
# 1) 初始化并接上远端（拉取是只读操作，公开仓库不需要凭据）
git init
git remote add origin https://github.com/Ray-2026426/Webapp_amazonmarketsearch.git
git fetch origin phase-0:phase-0

# 2) 把 HEAD 切到 phase-0，但【不动工作区文件】
git symbolic-ref HEAD refs/heads/phase-0
git reset --mixed phase-0

# 3) 暂存 + 检查（确认没有密钥）
git add -A
git status

# 4) 提交并推到 phase-0（不碰 main）
git commit -m "M0: ..."
git push origin phase-0
```

**`main` 分支保持不动**，等后续确认后再合并或覆盖。

---
