# 自带密钥（BYO Key）模型 —— 决策、链路与安全红线

> 本文记录 2026-09 的两轮**用户决策变更**，第二轮的结论是当前口径（§15.28）：
>
> 1. 第一轮（§15.26）用户原话：「需要其他用户也能填key，后续我们再考虑做付费，那时候再关闭mcp入口，
>    换成计费模式。」→ 推翻旧的**决策 A**（"数据池密钥只在服务端，浏览器不保存任何密钥"），
>    改为 **BYO Key**：所有用户都能填自己的 MCP Key。
> 2. 第二轮（§15.28）用户原话：「我的mcp没有跟着账号走吗，需要跟着账号」→ 推翻第一轮里
>    "用户 Key 只存浏览器 localStorage"的做法：**密钥的唯一真相改成服务端按账号存**。
>    同时确认**政策 A**：平台 Key **不再**作为 MCP 数据的兜底。
>
> 之所以单独成文：这条改动**看起来像"放宽了安全约束"**（密钥确实落库了），实际上是"把约束从
> '不许有输入框/不许落库'换成了逐条可验证的密钥流向约束"。写下来是为了让后来的人知道**为什么改**，
> 以及**哪些红线一条都不能破**。

## 1. 一句话链路

```
用户在「设置 → MCP 数据」填自己的 Key
  → 客户端 POST /api/data/keySet（同源；body 只有 provider + value + token，**没有 userId**）
  → 服务端按 JWT 里的 userId 写入 public.user_provider_keys（主键 user_id + provider）
  → 需要外部数据时，客户端只发 tool/args（**不传 Key**）
  → 网关用 JWT 的 userId 自己去库里取该 provider 的 Key（→ 上游 secret-key 请求头）
  → 用量记账只记 keySource: 'user' | 'none'（'platform' 是历史口径，代码里已无这条路径）
```

## 2. 谁存哪、怎么传、网关怎么选、记账记什么

| 环节 | 事实 | 代码位置 |
| --- | --- | --- |
| 用户 Key 存哪 | 服务端 `public.user_provider_keys`（`user_id` + `provider` 唯一），RLS 全部拒绝、只有 `service_role` 能读写；**跟着账号走** | `supabase/migrations/all_in_one.sql`（011 区块）、`api/data/[action].ts`（keySet/keyClear/keyList） |
| 本机存什么 | 只有**非密钥**配置：id / 名称 / 地址 / 启用 / kind；另加"配没配 + 指纹"的**状态缓存**（进程内） | `src/utils/mcpConfig.ts`（`loadMcpSettings` / `loadUserKeyStatuses`） |
| 平台 Key 存哪 | 管理员的「配置中心」仍写 `app_config`（另一条链路，本期未动）；**MCP 数据不再读它**（政策 A，`resolvePlatformSecret` 已删除） | `api/admin/[action].ts`（配置中心） |
| 怎么传 | 同源 `POST /api/data/keySet`；**绝不进 URL query、绝不进请求头到本站**；调数据池时**根本不传 Key** | `src/utils/mcpConfig.ts`（`saveUserKey`）、`src/utils/dataPoolClient.ts` |
| 网关怎么选 | ①库里该用户（按 JWT 的 userId）的 Key → ②迁移期兼容：请求体 `userKey`（旧客户端）→ ③都没有则明确报"请填写你自己的 Key" | `api/data/[action].ts`（`resolveRequestSecret`） |
| 谁来认人 | `verifyToken(token)`（JWT 的 `sub`）；**任何地方都不读客户端传来的 userId** | `api/data/[action].ts`（handler 入口） |
| 记账记什么 | `UsageEvent.keySource: 'user' \| 'platform' \| 'none'`（字面量标签），落库列 `key_source` | `src/utils/usageAccounting.ts` |

**为什么密钥必须落库**：不落库就"换设备/换浏览器登录同一账号 Key 就没了"，用户只能重填一遍，
还会以为"我填的东西被弄丢了"。跨设备是用户明确要的能力，所以落库是**唯一**的正确选择。
代价（也如实写下来）：服务端从此握有用户明文密钥，因此 RLS 必须"全部拒绝"、只有 `service_role` 能读，
对外一律只回 `maskKey` 指纹。

## 3. 安全红线（逐条）

1. **只有一处真相**：明文只允许落在 `user_provider_keys`（键写入动作 `keySet`）。
   不得写 `app_config`、不得留在浏览器 localStorage（迁移期例外见 §5）、不得进日志、不得进响应体。
2. **不写日志**：网关零 `console.*`；错误信息一律先过 `redactText`（外部 MCP 经常把 Key 原样回显在
   错误里，这是被忽略过的真实泄密路径）。**用户自己的 Key 也不许出现在日志/审计详情里**。
3. **不进响应体**：任何 `json(res, …)` 里只有 `configured` + `maskKey(...)` 指纹（或空串）；
   `/api/data/status` 只回报**调用者自己**的密钥状态（平台 Key 状态不再回报 —— 政策 A 之后它不参与取数）。
4. **不进 URL query**：Key 只进同源 POST 请求体。query 会进浏览器历史、代理日志、Referer。
   （AI 那边 Gemini 的 `?key=` 是它自己的协议，属于另一条链路，不在本条范围内。）
5. **跨账号隔离**：`user_id` 一律取自 JWT；`keySet/keyClear/keyList` 的 upsert / delete / select
   全部按 `auth.userId` 过滤。A 既读不到、也改不了、更清不掉 B 的密钥。
6. **服务端校验**：`sanitizeUserKey` 去首尾空白、长度 ≤512、拒绝控制字符；客户端保存前用**同一份**
   实现自检，服务端再校验一次（不合法就拒绝，错误信息本身也脱敏）。
7. **只在同源 HTTPS 传输**：客户端只用相对路径 `/api/data/*`。

## 4. 「验证」按钮的语义

`POST /api/data/verify`，**只发 provider（+ 自定义 MCP 的地址）**：

- 账号里配了 Key → 网关用你的 Key 做一次 MCP `initialize` 握手；
- 没配 → 网关明确提示先填写自己的 Key（不走平台 Key）；
- 自定义 MCP → 地址一起交给网关，服务端先过 `validateRelayTarget`（与 AI 转发同一套 SSRF 底线），
  且**只转发 initialize，不转发 tools/call**（网关不变成任意 MCP 代理）；
- 只握手：**不记用量、不占配额、不写缓存**（点一下"验证"不该花掉一次额度）。

## 5. 旧本机密钥怎么迁移

第一轮的浏览器明文（`amzdev_mcp_settings__<userId>` 的 `providers[].secretKey`，以及分账号之前
共享的那份 `amzdev_mcp_settings`）会被**一次性**迁到账号里：

- **触发时机**：① 打开「设置 → MCP 数据」（`loadUserKeyStatuses` 里先迁再拉状态）；
  ② 任何一次数据池调用 / Listing 抓取之前（`dataPoolClient` / `listingFetchExecutor` 先 `ensure` 一次）
  —— 老设备不打开设置也能用；③ 每次触发都是幂等的（同一页面只跑一遍，失败的下次再试）。
- **成功**：逐条 `keySet` 写进账号，然后**删除本机副本**（写完即删，不留两处真相），提示一句
  `已把 N 个旧密钥迁到你的账号（本机副本已删除）`。
- **失败**：**保留**本机副本并如实告知（`已迁移 N 个…还有 M 个没成功：本机副本已保留，请检查登录状态后重试`），
  绝不静默丢密钥。
- **防护**：分账号之前的**共享**那份明文只有管理员会话才认（否则同一台电脑换个账号登录，
  就会把上一个用户的 Key 写进新账号 —— 那等于把别人的额度送人）；另外 `saveMcpSettings`
  在迁移完成前会把还没迁走的旧明文原样保留，避免"先点了保存、迁移却没跑"把 Key 弄丢。
- **已知缺口**：真正的"登录成功那一刻"由 `src/App.tsx` 触发（那里已有另一条 `migrateLegacyKeys`
  用于管理员密钥），本轮的 MCP 迁移没有插进 App.tsx（不在本次授权文件范围内），因此走的是
  "进设置页 / 调数据池"这两条等价时机。

## 6. 守卫口径：从什么变成什么（为什么不是放松）

| | 第一轮（§15.26） | 现在（§15.28） |
| --- | --- | --- |
| 用户 Key 存哪 | 只存本机 `localStorage` | **服务端** `user_provider_keys`（按账号，跨设备） |
| 面板里的 Key 区 | 输入框 + 掩码显示本机明文 + "清除本机密钥" | 未配置→输入框；已配置→`已配置（指纹）`+ 替换 / 清除；输入框写完即清空（**页面永不含明文**） |
| 客户端是否传 Key | 随请求体 `userKey`（唯一通道 `withUserKey`） | **完全不传**（`withUserKey` 已删除）；网关按 JWT 自己取 |
| 平台 Key | 用户没填时兜底 | **不作兜底**（政策 A）：`resolvePlatformSecret` 整段删除，网关不再碰 `app_config` |
| 用户 Key 写库 | 禁止 | **只允许**写 `user_provider_keys`（RLS 全部拒绝 + 只有 `service_role`）；断言从"不许写库"改为"只许写这张表" |
| 跨账号隔离 | 隐式 | **显式断言**：`user_id` 只认 JWT、三个动作都按 `auth.userId` 过滤、源码里不得出现 `body.userId` |
| 明文外泄面 | 不落库、不写日志、不进响应体、不进 query | 同上四条**依旧**成立（落库不等于可以外泄）；另加"指纹只能是 `maskKey` 产物或空串" |

断言数：`tests/securityKeys.test.ts` 15 → **17** 条；`tests/dataPoolKeyFlow.test.ts` 9 → **13** 条
（含"请求体里没有 userKey""keySet 不带 userId""迁移成功即删本机副本""失败保留副本""指纹不采纳明文"）。
全量 `node tests/runAll.mjs`：49 套件 / 535 断言 / 0 failed。

## 7. 遗留项（已如实记录，不要假装已完成）

1. **`api/admin/[action].ts` 的缺表自检清单里没有 `user_provider_keys`**（该文件不在本轮授权范围）。
   数据库没跑 011 时，管理员后台的环境自检**不会**主动报这一张表；但 MCP 面板会报
   （`keyList` 返回 `needsMigration: true` + 指向 `supabase/migrations/all_in_one.sql` 的可照做提示）。
2. **`usage_events.key_source` 列的增量迁移**（§15.26 的遗留）已在 008 区块内补齐，本轮无新增遗留。
3. **自定义 MCP 共用一格密钥**：设置页可以有多个「自定义 MCP」条目，但它们共用 `provider = 'custom'`
   那一格 Key。这是刻意的（服务端只认 provider，不认条目标题）；要按条目分开需要给表加一个
   `entry_id` 维度，本期没做。
4. **共享缓存仍在**：`pool_cache` 的键里没有 Key 来源 —— 用户自带 Key 抓到的数据会进公共缓存，
   别人可能直接命中。本轮**刻意没改**（改了会显著降低命中率），但付费阶段要重新拍板。
5. **`src/utils/sellerspriteApi.ts` 的 `getSellerSpriteStatus`** 为了不再读本机密钥，改成向
   `/api/data/status` 问"当前用户配没配卖家精灵"——它是本轮唯一的越界改动（该文件不在授权清单里），
   不改就会 TypeScript 编译不过且会永远报"尚未配置"。
