# 自带密钥（BYO Key）模型 —— 决策、链路与安全红线

> 本文记录 2026-09 的**用户决策变更**：旧口径「数据池密钥只在服务端，浏览器不保存任何密钥」
> （下称**决策 A**）被用户推翻。用户原话：
>
> 「需要其他用户也能填key，后续我们再考虑做付费，那时候再关闭mcp入口，换成计费模式。」
>
> 新口径叫 **BYO Key**（Bring Your Own Key）：**所有用户**都能在界面上填自己的 MCP Key，
> 平台 Key 降级为**兜底**（团队共享）；以后进入付费阶段再关闭 MCP 入口改计费 —— 现在不做。
>
> 之所以单独成文：这条改动**看起来像"放宽了安全约束"**，实际上是"把约束从'不许有输入框'
> 换成了逐条可验证的密钥流向约束"。写下来是为了让后来的人知道**为什么改**，以及**哪些红线一条都不能破**。

## 1. 一句话链路

```
用户在「设置 → MCP 数据」填自己的 Key
  → 只写 localStorage（amzdev_mcp_settings 的 providers[].secretKey）
  → 调数据池时随**同源 POST 请求体**（userKey 字段）带给网关 /api/data/*
  → 网关解析顺序：① 本次请求的用户 Key → ② 服务端 app_config / 环境变量里的平台 Key
  → 用户 Key 只在当次请求内使用（放进上游 secret-key 请求头），用完即弃
  → 用量记账只记 keySource: 'user' | 'platform'（绝不记 Key）
```

## 2. 谁存哪、怎么传、网关怎么选、记账记什么

| 环节 | 事实 | 代码位置 |
| --- | --- | --- |
| 用户 Key 存哪 | 只有他自己的浏览器 `localStorage`（按登录用户分键），`secretKey` 字段 | `src/utils/mcpConfig.ts`（`getUserKeyForProvider`） |
| 平台 Key 存哪 | 服务端 `app_config`（`key:<provider>`）或环境变量；**永不进浏览器** | `api/admin/[action].ts`（配置中心 set） |
| 怎么传 | 同源 `POST /api/data/mcp`，Key 放**请求体** `userKey`；**绝不进 URL query、绝不进请求头到本站** | `src/utils/dataPoolClient.ts`（`withUserKey`） |
| 网关怎么选 | ①请求携带的用户 Key（合法才用）→ ②平台 Key → ③都没有则明确报"未配置" | `src/utils/mcpRequestKey.ts` + `api/data/[action].ts`（`resolveRequestSecret`） |
| 记账记什么 | `UsageEvent.keySource: 'user' \| 'platform' \| 'none'`（字面量标签），落库列 `key_source` | `src/utils/usageAccounting.ts` |

**为什么只让平台 Key 在"用户没带 Key"时才读**：最小暴露面。用户自带 Key 时，服务端连
`app_config` 都不查一次，少一次密钥进入内存的机会。

## 3. 安全红线（逐条）

1. **不写库**：用户 Key 不得写 `app_config`，不得写任何表。浏览器侧保存只写 localStorage，
   旧的"管理员保存时把浏览器密钥推到服务端"那段代码已整段删除。
2. **不写日志**：网关零 `console.*`；上游报错文本先过 `redactText` 才准往外抛（外部 MCP 经常把 Key
   原样回显在错误里，这是被忽略过的真实泄密路径）。
3. **不进响应体**：任何 `json(res, …)` 都不含 Key；`/api/data/status` **连平台 Key 的指纹都不回**
   （指纹也是可拿来核对的秘密片段，而它是给所有登录用户看的）。
4. **不进 URL query**：Key 只进请求体（到本站）与上游请求头（到 MCP）。query 会进浏览器历史、
   代理日志、Referer。（AI 那边 Gemini 的 `?key=` 是它自己的协议，属于另一条链路，不在本条范围内。）
5. **服务端基本校验**：`sanitizeUserKey` 去掉首尾空白、长度上限 512、拒绝控制字符；
   不合法一律当作"未提供"静默回退平台 Key —— **不报错、不回细节**（错误信息本身就是泄露）。
6. **只在同源 HTTPS 传输**：客户端只用相对路径 `/api/data/*`。

## 4. 「验证」按钮的语义

旧实现是**假验证**：`testMcpProvider` → `checkDataPoolReady` 只查"服务端数据池配没配卖家精灵"，
既不看用户填了什么，也不看是哪个数据源。现在统一走 `POST /api/data/verify`：

- 本机填了 Key → 网关用**你的** Key 做一次 MCP `initialize` 握手；
- 没填 → 用平台 Key 握手，界面如实显示"用的是平台 Key"；
- 自定义 MCP → 地址一起交给网关，服务端先过 `validateRelayTarget`（与 AI 转发同一套 SSRF 底线），
  且**只转发 initialize，不转发 tools/call**（网关不变成任意 MCP 代理）；
- 只握手：**不记用量、不占配额、不写缓存**（点一下"验证"不该花掉一次额度）。

## 5. 守卫口径：从什么变成什么（为什么不是放松）

| | 旧守卫（决策 A） | 新守卫（BYO Key） |
| --- | --- | --- |
| 面板里的 Key 输入框 | **不得存在**（只允许自定义 MCP 有） | **必须存在，且每个数据源都有**（同一段 JSX，不按 kind 分叉）；已填要掩码显示（`maskKey`）+ 清除按钮 + 一行"只存本机"提示（≤30 字） |
| 浏览器持有平台密钥 | 禁止 | **仍然禁止**（`getDefaultServerKey` 必须回空串、不得有 `resolveSellerSpriteAuth`、平台 Key 不得被写进 localStorage） |
| 用户 Key 写库 | （隐式：没有输入框） | **显式断言**：浏览器不得 push 到服务端、网关对 `app_config` 只允许 `select`、`usage_events` 写入字段名里不得出现密钥字段 |
| 用户 Key 写日志 / 进响应体 | （隐式） | **显式断言**：网关零 console、错误先 `redactText`、返回体不含密钥字段、状态接口不回指纹 |
| 用户 Key 进 URL query | （隐式） | **显式断言**：数据池链路的客户端文件里不得出现 `?key=` / `?userKey=` 拼串 |
| 解析顺序 | 管理员配置 → 环境变量 | **用户 Key 优先、平台兜底**：纯函数单测 + 源码级断言（平台 Key 只在用户没带时才读） |

所以这不是"放宽"，是**把原来靠"没有输入框"顺带保证的安全，换成 6 条各自可测的显式约束**。
断言数从 9 条涨到 15 条（`tests/securityKeys.test.ts`），另加 9 条行为测试（`tests/dataPoolKeyFlow.test.ts`）。

## 6. 遗留项（已如实记录，不要假装已完成）

1. **`usage_events` 需要一个增量迁移加 `key_source` 列**（`supabase/migrations/**` 本轮不在授权范围内，
   未改动）。当前网关的写入是"先带 `key_source` 插一次，失败（列不存在）则退化为不带该列再插一次"，
   所以迁移前后都不会丢记账；迁移一落地，成本归因自动开始持久化。
2. `src/utils/sellerspriteApi.ts` 里的 `testMcpProvider` / `checkDataPoolReady` 已被设置页弃用
   （改为 `verifyDataPoolProvider`），但该文件本轮不在授权范围内，两个旧函数仍留在原处未被删除。
3. BYO Key 目前只覆盖数据池（MCP）这条链路；AI 供应商的 Key 一直是用户自己在界面填的，口径不变。
4. **缓存仍按数据类型共享**（`pool_cache` 的键里没有 Key 来源）：也就是说"用户自带 Key 抓到的数据"
   会进公共缓存，别人可能直接命中。本轮**刻意没有改**（数据池共享缓存是原有设计，改了会显著降低命中率），
   但付费阶段要重新拍板：是否把 `user` 来源的调用排除在共享缓存之外（记 `keySource` 就是为了这一步有据可依）。
