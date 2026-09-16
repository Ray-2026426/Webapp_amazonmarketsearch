// M5 · 平台数据池网关（PRD §11.2「商用核心」/ §15.28 密钥跟着账号走）。
//
// 一次业务调用在这里完成四件事，顺序固定：
//   1) 解析密钥（**必须用户自带 Key**，见下方"密钥口径"）
//   2) 查缓存（按数据类型 TTL，命中直接返回并把 cacheHit 记进用量）
//   3) 配额校验（超限直接拒绝，不浪费外部调用）
//   4) 调外部 MCP → 写缓存 → 记一条用量事件（成功/失败都记，并带上 keySource 标签）
//
// 密钥口径（BYO Key + 政策 A，2026-09 用户拍板）：
//   ① 用户自己的 Key 存在服务端 `user_provider_keys`（主键 user_id+provider），**跟着账号走**：
//      换设备 / 换浏览器登录同一账号就能取到；user_id 一律取自 JWT（verifyToken），
//      绝不接受客户端传来的 userId（跨账号隔离靠这一条）；
//   ② 迁移期兼容：本次请求体里若还带着 `userKey`（旧客户端），作为兜底来源使用，用完即弃；
//   ③ 都没有 → 如实报"请填写你自己的 Key"。**平台 Key 不再作为 MCP 数据的兜底**（政策 A）。
//
// 安全红线（破了就是事故，逐条都有测试守着）：
//   · 任何返回值里都不含密钥明文（只给"配没配 + 指纹"，指纹走 maskKey）；
//   · 密钥明文只允许落在 `user_provider_keys` 这一张表（键 set/clear 动作），
//     绝不写 app_config、绝不写日志（含 console）、绝不出现在任何响应体里；
//   · 上游把 Key 回显在报错里时统一过 redactText 抹掉；
//   · 上游只把 Key 放**请求头**（secret-key），绝不拼进 URL query；
//   · 非法密钥（空 / 超长 / 含控制字符）一律拒绝，错误信息本身也要脱敏。

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, verifyToken, isAdminEmail, json } from '../auth/_shared.js';
import {
  buildCacheKey,
  decideCache,
  makeCacheEntry,
  bumpHit,
  pruneCache,
  isFresh,
  DEFAULT_TTL_SECONDS,
  type PoolCacheEntry,
  type PoolDataType,
} from '../../src/utils/poolCache.js';
import { entryToCacheRow, rowToCacheEntry, prunePlan, summarizeCacheRows } from '../../src/utils/poolCacheStore.js';
import {
  createUsageEvent,
  checkQuota,
  summarizeUsage,
  filterUsageByRange,
  describeUsage,
  type UsageEvent,
  type UsageTool,
} from '../../src/utils/usageAccounting.js';
import { decideProviderKeySource, resolveProviderKey, sanitizeUserKey, type ProviderKeySource } from '../../src/utils/mcpRequestKey.js';
import { redactText, maskKey, type KeyStatus } from '../../src/utils/keyMasking.js';
import { classifyDbError, missingTableName, SOURCE_MIGRATION_FILE } from '../../src/utils/migrationSql.js';
import { validateRelayTarget } from '../../src/utils/aiEndpoints.js';

/* ───────────── 密钥（只在服务端） ───────────── */

type ProviderName = 'sellersprite' | 'xydc' | 'lingxing' | 'sorftime';
/** 密钥表里允许的 provider：四家内置 + 自定义 MCP（custom 只在「验证自定义端点」时用到） */
type KeyProvider = ProviderName | 'custom';

const PROVIDERS: ProviderName[] = ['sellersprite', 'xydc', 'lingxing', 'sorftime'];
const KEY_PROVIDERS: KeyProvider[] = [...PROVIDERS, 'custom'];

function keyProviderFor(raw: unknown): KeyProvider | null {
  const v = String(raw ?? '').trim() as KeyProvider;
  return KEY_PROVIDERS.includes(v) ? v : null;
}

const PROVIDER_ENV_URL: Record<ProviderName, string> = {
  sellersprite: 'SELLERSPRITE_MCP_URL',
  xydc: 'XYDC_MCP_URL',
  lingxing: 'LINGXING_MCP_URL',
  sorftime: 'SORFTIME_MCP_URL',
};

/** 各 provider 的默认 MCP 端点（可用环境变量覆盖；前端永远不接触） */
const PROVIDER_DEFAULT_URL: Record<ProviderName, string> = {
  sellersprite: 'https://mcp.sellersprite.com/mcp',
  xydc: 'https://mcp.xydc.com/mcp',
  lingxing: 'https://openmcp.lingxing.com/mcp-servers/lingxing-mcp',
  sorftime: 'https://mcp.sorftime.com/mcp',
};

function env(name: string): string {
  return (process.env[name] || '').trim();
}

/* ───────────── 用户密钥表（跨设备的唯一真相） ─────────────
 *
 * 政策 A + 跨设备（2026-09 用户原话：「我的mcp没有跟着账号走吗，需要跟着账号」）：
 * 用户自己的 MCP Key 只有**一个**存放处 —— `public.user_provider_keys`，
 * 主键 (user_id, provider)。它替代了上一轮"只存浏览器 localStorage"的做法。
 *
 * 三条不容许动摇的实现约束：
 *   ① user_id 只能来自 JWT（verifyToken），本文件里**没有**任何一处读客户端传来的 userId；
 *   ② 只有 service_role 能读写这张表（迁移里 RLS 策略全部拒绝），因此前端拿不到明文；
 *   ③ 对外只回 maskKey 产出的指纹，明文只在本进程的局部变量里存在。
 */

/** 读某用户某数据源的 Key（明文，只在服务端内存里传递；拿不到就回空串） */
async function readUserProviderKey(userId: string, provider: KeyProvider): Promise<string> {
  const s = getServiceSupabase();
  if (!s || !userId) return '';
  try {
    const { data } = await s
      .from('user_provider_keys')
      .select('value')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();
    return typeof data?.value === 'string' ? data.value.trim() : '';
  } catch {
    return '';
  }
}

/** 该用户的密钥存储是否可用（缺表时给出"跑一次迁移"的可照做提示，而不是一句泛泛的失败） */
function keyStoreIssue(error: unknown): { needsMigration: boolean; error: string } {
  const kind = classifyDbError(error as { code?: string; message?: string } | null);
  if (kind === 'missing-table') {
    const table = missingTableName(String((error as { message?: string })?.message || '')) || 'user_provider_keys';
    return {
      needsMigration: true,
      error: `数据库还没迁移（缺表 ${table}）：去 Supabase → SQL Editor 执行 ${SOURCE_MIGRATION_FILE}（可重复执行，不会破坏已有数据）。`,
    };
  }
  const message = (error as { message?: string })?.message || '密钥存储不可用';
  return { needsMigration: false, error: redactText(message) };
}

/**
 * 本次请求用谁的 Key —— **唯一的解析入口**（政策 A：只认用户自己的 Key）：
 *   ① 该用户在服务端的 Key（user_provider_keys：跨设备、跟着账号）；
 *   ② 迁移期兼容：本次请求体里的 `userKey`（旧客户端还在传，用完即弃，不落库）；
 *   ③ 都没有 → source='none'，调用方如实报"请填写你自己的 Key"。
 *
 * 返回的 key 只在本函数调用栈里往下传（→ 上游请求头），不进响应体、不进日志。
 */
async function resolveRequestSecret(
  provider: KeyProvider,
  userId: string,
  legacyUserKeyRaw?: unknown
): Promise<{ key: string; source: ProviderKeySource }> {
  const stored = await readUserProviderKey(userId, provider);
  if (stored) return { key: stored, source: 'user' };

  // 兼容旧路径：旧版客户端把用户 Key 随请求体带上来。校验口径与存储路径共用 sanitizeUserKey，
  // 非法（空 / 超长 / 控制字符）一律当作"没提供"。
  return resolveProviderKey({ userKey: decideProviderKeySource(legacyUserKeyRaw).userKey });
}

function resolveProviderUrl(provider: ProviderName): string {
  return env(PROVIDER_ENV_URL[provider]) || PROVIDER_DEFAULT_URL[provider];
}

/* ───────────── 缓存与用量（进程内；无 service_role 时降级但可用） ───────────── */

/**
 * 缓存双后端（M5 技术债收口）：
 * - **有 service_role** → 以 Supabase `pool_cache` 表为准（持久化：serverless 实例回收也不丢，
 *   多实例之间共享，命中率才是真的）；
 * - **没有 service_role**（本地开发/未配置云端）→ 退回进程内 Map（尽力而为，行为不变）。
 * 读取顺序：先看进程内（零延迟）→ 未命中再查表 → 表里新鲜就回填进程内。
 * 写入顺序：两边都写（进程内保温 + 表里持久化）。任何一步失败都不影响业务（缓存不是关键路径）。
 */
const CACHE = new Map<string, PoolCacheEntry>();
const USAGE: UsageEvent[] = [];
const MAX_USAGE_IN_MEMORY = 2000;

function cacheList(): PoolCacheEntry[] {
  return [...CACHE.values()];
}

function rememberLocally(entry: PoolCacheEntry | null): void {
  if (!entry) return;
  CACHE.set(entry.key, entry);
  const { kept } = pruneCache(cacheList(), { maxEntries: 500 });
  CACHE.clear();
  for (const e of kept) CACHE.set(e.key, e);
}

/** 读缓存：先进程内，再持久化表（表里已过期的行顺手删掉，避免越积越多） */
async function readCacheEntry(key: string, nowIso: string): Promise<PoolCacheEntry | null> {
  const local = CACHE.get(key);
  if (local && isFresh(local, nowIso)) return local;

  const s = getServiceSupabase();
  if (!s) return null;
  try {
    const { data, error } = await s.from('pool_cache').select('*').eq('key', key).maybeSingle();
    if (error || !data) return null;
    const entry = rowToCacheEntry(data);
    if (!entry) return null;
    if (!isFresh(entry, nowIso)) {
      // 过期即删（best-effort）：留着只会让下次查询更慢
      void s.from('pool_cache').delete().eq('key', key).then(undefined, () => undefined);
      return null;
    }
    rememberLocally(entry);
    return entry;
  } catch {
    return null;
  }
}

/** 写缓存：进程内 + 持久化表（upsert by key） */
async function writeCacheEntry(entry: PoolCacheEntry | null): Promise<void> {
  if (!entry) return;
  rememberLocally(entry);
  const s = getServiceSupabase();
  if (!s) return;
  try {
    await s.from('pool_cache').upsert(entryToCacheRow(entry));
  } catch {
    /* 写表失败不影响本次返回：进程内已经有 */
  }
}

/** 记一次命中：进程内 + 表里的 hits 自增（用于管理员看"缓存省了多少次调用"） */
async function bumpCacheHitEntry(entry: PoolCacheEntry): Promise<PoolCacheEntry> {
  const bumped = bumpHit(entry);
  rememberLocally(bumped);
  const s = getServiceSupabase();
  if (s) {
    try {
      await s.from('pool_cache').update({ hits: bumped.hits }).eq('key', bumped.key);
    } catch {
      /* ignore */
    }
  }
  return bumped;
}

/** 缓存概览（管理员面板）：有表看表，没表看进程内 */
async function summarizeCache(nowIso: string): Promise<ReturnType<typeof summarizeCacheRows>> {
  const s = getServiceSupabase();
  if (!s) return summarizeCacheRows(cacheList(), nowIso);
  try {
    const { data, error } = await s.from('pool_cache').select('*').limit(2000);
    if (error || !data) return summarizeCacheRows(cacheList(), nowIso);
    return summarizeCacheRows(data, nowIso);
  } catch {
    return summarizeCacheRows(cacheList(), nowIso);
  }
}

/** 清理过期缓存（管理员可触发；返回删了多少行） */
async function pruneExpiredCache(nowIso: string): Promise<{ deleted: number; backend: 'postgres' | 'memory' }> {
  const s = getServiceSupabase();
  if (!s) {
    const { kept, expired } = pruneCache(cacheList(), { maxEntries: 500, nowIso });
    CACHE.clear();
    for (const e of kept) CACHE.set(e.key, e);
    return { deleted: expired, backend: 'memory' };
  }
  try {
    const { expiredBefore } = prunePlan(nowIso);
    const { data } = await s.from('pool_cache').delete().lte('expires_at', expiredBefore).select('key');
    return { deleted: Array.isArray(data) ? data.length : 0, backend: 'postgres' };
  } catch {
    return { deleted: 0, backend: 'postgres' };
  }
}


async function recordUsage(event: UsageEvent): Promise<void> {
  USAGE.push(event);
  if (USAGE.length > MAX_USAGE_IN_MEMORY) USAGE.splice(0, USAGE.length - MAX_USAGE_IN_MEMORY);
  // 有 service_role 时落库（表见 008_usage_events.sql）；没有就只留内存，管理员面板仍可看
  const s = getServiceSupabase();
  if (!s) return;
  // 记的是 `keySource` 这个**字面量标签**（user/platform/none），绝不是 Key 本身：
  // 这张表里永远不该出现任何密钥片段，付费阶段只靠这个标签区分"用户自付 / 平台承担"。
  const base = {
    id: event.id,
    workspace_id: event.workspaceId,
    user_id: event.userId,
    project_id: event.projectId ?? null,
    tool: event.tool,
    provider: event.provider,
    ok: event.ok,
    cache_hit: Boolean(event.cacheHit),
    calls: event.calls,
    input_tokens: event.inputTokens ?? null,
    output_tokens: event.outputTokens ?? null,
    duration_ms: event.durationMs ?? null,
    error: event.error ?? null,
  };
  try {
    const { error } = await s.from('usage_events').insert({ ...base, key_source: event.keySource ?? null });
    // key_source 列需要迁移（008 之后的增量）；线上还没跑迁移时退化为不带该列的写入，
    // 标记仍然保留在内存事件与接口返回里 —— 记账不能因为少一列就整条丢掉。
    if (error) await s.from('usage_events').insert(base);
  } catch {
    /* 记账失败不能挡住业务：内存里已经有一份 */
  }
}

/* ───────────── MCP 调用 ───────────── */

interface McpRpc {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpPostResult {
  result?: unknown;
  error?: { message?: string };
  sessionId?: string;
}

const SS_TOOL_NAMES: Record<string, string> = {
  review: 'review',
  traffic_keyword: 'traffic_keyword',
  keyword_miner: 'keyword_miner',
  keyword_research: 'keyword_research',
  aba_research_weekly: 'aba_research_weekly',
};

function parseMcpHttpBody(text: string): Pick<McpPostResult, 'result' | 'error'> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as Pick<McpPostResult, 'result' | 'error'>;
    } catch {
      /* fall through to SSE parsing */
    }
  }
  const payloads = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]');
  for (let i = payloads.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(payloads[i]) as Pick<McpPostResult, 'result' | 'error'>;
      if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) return parsed;
    } catch {
      /* continue */
    }
  }
  return null;
}

function compactMcpError(status: number, text: string): string {
  const parsed = parseMcpHttpBody(text);
  const message = parsed?.error?.message || text.replace(/\s+/g, ' ').trim().slice(0, 200);
  return redactText(`MCP 请求失败（HTTP ${status}）：${message || '上游未返回错误详情'}`);
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * 一次 JSON-RPC 请求。
 * `secret` 由调用方解析好传进来（密钥解析只在一个地方发生，避免散开）。
 * 密钥只出现在 **请求头**：绝不拼进 URL query（query 会进代理日志与 Referer）。
 * 上游报错文本一律过 `redactText`：外部服务经常把 Key 原样回显在错误里。
 */
async function mcpPost(
  endpoint: string,
  secret: string,
  method: string,
  params?: Record<string, unknown>,
  id = 1,
  sessionId?: string
): Promise<McpPostResult | null> {
  const body: McpRpc = {
    jsonrpc: '2.0',
    ...(method.startsWith('notifications/') ? {} : { id }),
    method,
    ...(params ? { params } : {}),
  };
  let res: Response;
  try {
    res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(secret ? { 'secret-key': secret } : {}),
        'MCP-Protocol-Version': '2025-03-26',
        ...(method === 'tools/call' ? { 'Mcp-Method': 'tools/call', 'Mcp-Name': String(params?.name || '') } : {}),
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new Error(aborted ? 'MCP 请求超时：上游 12 秒内没有响应' : (e instanceof Error ? redactText(e.message) : 'MCP 网络请求失败'));
  }
  const text = await res.text();
  if (!res.ok) throw new Error(compactMcpError(res.status, text));
  const parsed = parseMcpHttpBody(text);
  return parsed ? { ...parsed, sessionId: res.headers.get('mcp-session-id') || undefined } : null;
}

const MCP_INIT_PARAMS = { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'kairo', version: '1.0' } };

/** 只做握手（验证用）：不调任何业务工具，因此不计费也不产生业务副作用 */
async function mcpHandshake(endpoint: string, secret: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const init = await mcpPost(endpoint, secret, 'initialize', MCP_INIT_PARAMS, 0);
    if (init?.error) return { ok: false, error: redactText(init.error.message || 'MCP initialize 失败') };
    if (init?.sessionId) {
      await mcpPost(endpoint, secret, 'notifications/initialized', undefined, 1, init.sessionId);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? redactText(e.message) : 'MCP 握手失败' };
  }
}

/** 验证用：优先标准握手；如果服务端不吃纯握手，再用只读 tools/list 探测端点是否可用 */
async function mcpVerifyConnection(endpoint: string, secret: string): Promise<{ ok: boolean; error?: string }> {
  const handshake = await mcpHandshake(endpoint, secret);
  if (handshake.ok) return handshake;
  try {
    const listed = await mcpPost(endpoint, secret, 'tools/list', undefined, 9);
    if (listed?.error) return { ok: false, error: redactText(listed.error.message || 'MCP tools/list 失败') };
    if (listed?.result !== undefined) return { ok: true };
  } catch (e) {
    const listError = e instanceof Error ? redactText(e.message) : '';
    return { ok: false, error: handshake.error || listError || 'MCP 验证失败' };
  }
  return handshake;
}

/** 握手 + 调业务工具 */
async function callMcp(
  provider: ProviderName,
  tool: string,
  args: Record<string, unknown>,
  secret: string,
  endpointOverride?: string
): Promise<{ ok: boolean; data?: unknown; error?: string; calls: number }> {
  const endpoint = (endpointOverride || resolveProviderUrl(provider)).trim();
  let calls = 0;
  const toolName = provider === 'sellersprite' ? SS_TOOL_NAMES[tool] || tool : tool;
  try {
    calls += 1;
    const direct = await mcpPost(endpoint, secret, 'tools/call', { name: toolName, arguments: args }, 1);
    if (direct?.error) throw new Error(redactText(direct.error.message || 'MCP 调用失败'));
    if (direct?.result !== undefined) return { ok: true, data: (direct.result as Record<string, unknown>)?.content ?? direct.result, calls };
  } catch {
    // 部分 MCP 服务必须先建会话；直连失败后按标准会话流程重试。
  }
  try {
    calls += 1;
    const init = await mcpPost(endpoint, secret, 'initialize', MCP_INIT_PARAMS, 2);
    if (init?.error) throw new Error(redactText(init.error.message || 'MCP initialize 失败'));
    if (init?.sessionId) {
      calls += 1;
      await mcpPost(endpoint, secret, 'notifications/initialized', undefined, 3, init.sessionId);
    }
    calls += 1;
    const r = await mcpPost(endpoint, secret, 'tools/call', { name: toolName, arguments: args }, 4, init?.sessionId);
    if (r?.error) throw new Error(redactText(r.error.message || 'MCP 调用失败'));
    return { ok: true, data: (r?.result as Record<string, unknown>)?.content ?? r?.result, calls };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? redactText(e.message) : 'MCP 调用失败', calls };
  }
}

/* ───────────── 路由 ───────────── */

async function handleMcp(req: VercelRequest, res: VercelResponse, auth: { userId: string; email: string; workspaceId: string }, body: Record<string, unknown>) {
  const provider = String(body.provider || 'sellersprite') as ProviderName;
  const tool = String(body.tool || '').trim();
  const args = (body.args ?? {}) as Record<string, unknown>;
  const projectId = body.projectId ? String(body.projectId) : undefined;
  const workspaceId = String(body.workspaceId || auth.workspaceId || 'default');
  const usageTool = (String(body.usageTool || 'other') as UsageTool) ?? 'other';
  if (!tool) return json(res, 400, { ok: false, error: '缺少 tool' });
  if (!PROVIDERS.includes(provider)) return json(res, 400, { ok: false, error: `未知 provider：${provider}` });

  // ① 必须先确认用户自带 Key，再允许读缓存或打上游。
  //    来源优先级见 resolveRequestSecret：库里的（按 JWT 的 userId）→ 请求体里的（迁移期兼容）→ none。
  const { key: secret, source: keySource } = await resolveRequestSecret(provider, auth.userId, body.userKey);
  if (!secret) {
    return json(res, 400, {
      ok: false,
      error: `${provider} 需要填写你自己的 Key：请在「设置 → MCP 数据」里填写（按账号保存，换设备登录自动带上）`,
      keySource,
    });
  }

  // ② 配额
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthEvents = filterUsageByRange(USAGE, monthStart.toISOString(), new Date(Date.now() + 86_400_000).toISOString());
  const quotaLimit = Number(body.monthlyLimit ?? 0) || null;
  const quota = checkQuota({ events: monthEvents, userId: auth.userId, monthlyLimit: quotaLimit });
  if (!quota.allowed) {
    return json(res, 429, { ok: false, error: quota.reason, quota });
  }

  // ③ 缓存（持久化表优先，进程内兜底）
  const type = (String(body.type || 'other') as PoolDataType) ?? 'other';
  const key = buildCacheKey(type, { provider, tool, args, projectId });
  const nowIso = new Date().toISOString();
  const hitEntry = await readCacheEntry(key, nowIso);
  if (hitEntry) {
    const bumped = await bumpCacheHitEntry(hitEntry);
    await recordUsage(
      createUsageEvent({
        workspaceId,
        userId: auth.userId,
        projectId,
        tool: usageTool,
        provider,
        ok: true,
        cacheHit: true,
        calls: 0,
        keySource,
      })
    );
    return json(res, 200, {
      ok: true,
      cached: true,
      cacheReason: `缓存命中（创建于 ${bumped.createdAt}，命中 ${bumped.hits} 次）`,
      data: bumped.value,
      keySource,
      ttlSeconds: DEFAULT_TTL_SECONDS[type],
    });
  }

  // ④ 调外部 → 写缓存 → 记账（成功失败都记，并带上"用的谁的 Key"）
  const started = Date.now();
  const result = await callMcp(provider, tool, args, secret);
  const durationMs = Date.now() - started;
  const ttlSeconds = Number(body.ttlSeconds ?? 0) || DEFAULT_TTL_SECONDS[type];
  if (result.ok) {
    await writeCacheEntry(makeCacheEntry({ key, type, value: result.data, ok: true, ttlSeconds, nowIso }));
  }
  await recordUsage(
    createUsageEvent({
      workspaceId,
      userId: auth.userId,
      projectId,
      tool: usageTool,
      provider,
      ok: result.ok,
      cacheHit: false,
      calls: result.calls,
      durationMs,
      error: result.ok ? undefined : result.error,
      keySource,
    })
  );
  if (!result.ok) {
    return json(res, 502, { ok: false, error: result.error, keySource, cacheReason: '未命中缓存（本次为真实调用）' });
  }
  return json(res, 200, {
    ok: true,
    cached: false,
    cacheReason: '未命中缓存（本次为真实调用）',
    data: result.data,
    durationMs,
    keySource,
    ttlSeconds,
  });
}

/**
 * 状态：**当前登录用户自己**在服务端配了哪些 provider（只回布尔 + 指纹）+ 缓存概览。
 *
 * §15.28 之后这里不再回答"服务端配没配平台 Key"：平台 Key 已不作为 MCP 数据的兜底（政策 A），
 * 继续回报它只会让用户误以为"不填也能用"。现在只回报**他自己的**密钥状态，
 * 指纹走 maskKey（前 3 末 4）—— 那是给他自己核对用的，不是别人的秘密。
 */
async function handleStatus(_req: VercelRequest, res: VercelResponse, auth: { userId: string }, body: Record<string, unknown>) {
  const providers: Record<string, { configured: boolean; fingerprint: string; hasCustomUrl: boolean }> = {};
  for (const p of PROVIDERS) {
    const own = await readUserProviderKey(auth.userId, p);
    providers[p] = {
      configured: own.length > 0,
      fingerprint: maskKey(own),
      hasCustomUrl: Boolean(env(PROVIDER_ENV_URL[p])),
    };
  }
  const nowIso = new Date().toISOString();
  const cacheSummary = await summarizeCache(nowIso);
  const pruning = body?.prune === true ? await pruneExpiredCache(nowIso) : null;
  const usingDb = Boolean(getServiceSupabase());
  return json(res, 200, {
    ok: true,
    providers,
    cache: {
      backend: usingDb ? 'postgres' : 'memory',
      entries: cacheSummary.entries,
      fresh: cacheSummary.fresh,
      expired: cacheSummary.expired,
      hits: cacheSummary.hits,
      hitRate: cacheSummary.hitRate,
      byType: cacheSummary.byType,
      types: Object.keys(DEFAULT_TTL_SECONDS),
    },
    pruned: pruning,
    usage: describeUsage(summarizeUsage(USAGE, { limit: 20 })),
    note: usingDb
      ? 'MCP 普通调用必须使用用户自带 Key；用户 Key 按账号存在服务端（换设备登录自动带上），明文不回传、不落日志；缓存持久化在 Supabase pool_cache'
      : 'MCP 普通调用必须使用用户自带 Key；当前无 service_role，密钥无法随账号保存（只能在此设备临时填写）；缓存退回进程内',
  });
}

/**
 * 验证（「验证」按钮的唯一后端实现）：**按密钥来源分别验证**。
 *
 * 与 `mcp` 的区别（刻意做成两件事）：
 *   - 只做 MCP `initialize` 握手，不调任何业务工具；
 *   - **不写缓存、不记用量、不占配额** —— 点一下"验证"不该花掉一次额度，也不该污染账单；
 *   - 返回体只有 `keySource` 与一句话，**连指纹都不回**（指纹也是可核对的秘密片段）。
 *
 * 校验的就是**该用户在服务端存的那把 Key**（custom 用 'custom' 这一格）；请求体里若是旧客户端
 * 还带着 userKey，则按迁移期兼容路径使用。明文只在这一次握手请求里出现，用完即弃。
 *
 * 自定义 MCP：地址由用户提供，所以必须过 `validateRelayTarget`（与 AI 转发同一套 SSRF 底线），
 * 且这里只转发 initialize，绝不转发 tools/call —— 网关不变成"任意 MCP 代理"。
 */
async function handleVerify(
  _req: VercelRequest,
  res: VercelResponse,
  auth: { userId: string },
  body: Record<string, unknown>
) {
  const providerRaw = String(body.provider || '');
  const isCustom = providerRaw === 'custom';
  const keyProvider = keyProviderFor(providerRaw);
  if (!keyProvider) return json(res, 400, { ok: false, error: `未知 provider：${providerRaw}` });
  // 内置数据源用自己那格 Key；自定义 MCP 用 'custom' 那格（地址由用户填，Key 也必须是他自己填的）
  const provider = (isCustom ? 'sellersprite' : providerRaw) as ProviderName;

  const { key: secret, source: keySource } = await resolveRequestSecret(keyProvider, auth.userId, body.userKey);

  let endpointOverride = '';
  if (isCustom) {
    const check = validateRelayTarget(String(body.endpoint || ''));
    if (!check.ok) {
      return json(res, 400, {
        ok: false,
        keySource,
        error: `自定义 MCP 地址不可用：${check.reason}（平台网关要能连到它；本机地址请在本机自行确认）`,
      });
    }
    endpointOverride = check.url;
  }

  if (!secret && !isCustom) {
    return json(res, 200, {
      ok: false,
      keySource,
      message: `${provider} 没有可用的密钥：请填写你自己的 Key（存在你的账号里，换设备登录自动带上）`,
    });
  }

  // 自定义 MCP 可能本来就不需要 Key（公开端点）：不带凭证也验证一次，如实回报结果
  const handshake = await mcpVerifyConnection(endpointOverride || resolveProviderUrl(provider), secret);
  if (!handshake.ok) {
    if (isCustom && !secret && /HTTP 40[13]/.test(handshake.error ?? '')) {
      return json(res, 200, { ok: false, keySource, message: '端点要求鉴权：请填一个你自己的 Key（存在你的账号里）再验证' });
    }
    return json(res, 200, { ok: false, keySource, message: handshake.error || '握手失败' });
  }
  return json(res, 200, {
    ok: true,
    keySource,
    message: keySource === 'user' ? '连接成功（用的是你自己的 Key）' : '连接成功（自定义 MCP，未带 Key）',
  });
}

/* ───────────── 密钥三个动作（keyList / keySet / keyClear） ─────────────
 *
 * 为什么要有它们：这是"密钥跟着账号走"的客户端入口。三个动作共享同一条铁律 ——
 * **user_id 一律取自 JWT（handler 里 auth.userId 由 verifyToken 产出），不接受客户端传的 userId**。
 * 因此 A 既读不到、也改不了、更清不掉 B 的密钥（配合迁移里"RLS 全部拒绝 + 只有 service_role"）。
 */

/** 列出当前用户在各 provider 上的密钥状态：只有 `configured` + 指纹（maskKey），**绝不含明文** */
async function handleKeyList(_req: VercelRequest, res: VercelResponse, auth: { userId: string }) {
  const keys: Record<string, KeyStatus> = {};
  for (const p of KEY_PROVIDERS) keys[p] = { configured: false, fingerprint: '' };

  const s = getServiceSupabase();
  if (!s) {
    return json(res, 200, {
      ok: false,
      keys,
      error: '服务端未配置 SERVICE_ROLE_KEY：密钥无法随账号保存',
    });
  }
  try {
    const { data, error } = await s.from('user_provider_keys').select('provider, value').eq('user_id', auth.userId);
    if (error) {
      const issue = keyStoreIssue(error);
      return json(res, 200, { ok: false, keys, needsMigration: issue.needsMigration, error: issue.error });
    }
    for (const row of Array.isArray(data) ? data : []) {
      const p = String(row?.provider || '');
      if (!KEY_PROVIDERS.includes(p as KeyProvider)) continue;
      const value = typeof row?.value === 'string' ? row.value.trim() : '';
      keys[p] = { configured: value.length > 0, fingerprint: maskKey(value) };
    }
    return json(res, 200, { ok: true, keys });
  } catch (e) {
    const issue = keyStoreIssue(e);
    return json(res, 200, { ok: false, keys, needsMigration: issue.needsMigration, error: issue.error });
  }
}

/** 保存/替换当前用户在某个 provider 上的密钥（写自己的那一行；校验不过一律拒绝，不回细节） */
async function handleKeySet(_req: VercelRequest, res: VercelResponse, auth: { userId: string }, body: Record<string, unknown>) {
  const provider = keyProviderFor(body.provider);
  if (!provider) return json(res, 400, { ok: false, error: `未知 provider：${String(body.provider ?? '')}` });

  // 与请求级解析共用同一份校验：去首尾空白 / 非空 / 长度 ≤512 / 拒绝控制字符。
  const value = sanitizeUserKey(body.value);
  if (!value) {
    return json(res, 400, { ok: false, error: '密钥不合法：不能为空、长度不超过 512、且不能包含控制字符' });
  }

  const s = getServiceSupabase();
  if (!s) return json(res, 200, { ok: false, error: '服务端未配置 SERVICE_ROLE_KEY：密钥无法随账号保存' });
  try {
    // upsert by (user_id, provider)：一个用户一个数据源只留一条，换 Key 是覆盖不是追加
    const { error } = await s
      .from('user_provider_keys')
      .upsert({ user_id: auth.userId, provider, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,provider' });
    if (error) {
      const issue = keyStoreIssue(error);
      return json(res, 200, { ok: false, needsMigration: issue.needsMigration, error: issue.error });
    }
    // 只回状态与指纹：明文到此为止，绝不回传
    return json(res, 200, { ok: true, provider, configured: true, fingerprint: maskKey(value) });
  } catch (e) {
    const issue = keyStoreIssue(e);
    return json(res, 200, { ok: false, needsMigration: issue.needsMigration, error: issue.error });
  }
}

/** 清除当前用户在某个 provider 上的密钥（只删自己那一行） */
async function handleKeyClear(_req: VercelRequest, res: VercelResponse, auth: { userId: string }, body: Record<string, unknown>) {
  const provider = keyProviderFor(body.provider);
  if (!provider) return json(res, 400, { ok: false, error: `未知 provider：${String(body.provider ?? '')}` });

  const s = getServiceSupabase();
  if (!s) return json(res, 200, { ok: false, error: '服务端未配置 SERVICE_ROLE_KEY：密钥无法随账号保存' });
  try {
    const { error } = await s.from('user_provider_keys').delete().eq('user_id', auth.userId).eq('provider', provider);
    if (error) {
      const issue = keyStoreIssue(error);
      return json(res, 200, { ok: false, needsMigration: issue.needsMigration, error: issue.error });
    }
    return json(res, 200, { ok: true, provider, configured: false, fingerprint: '' });
  } catch (e) {
    const issue = keyStoreIssue(e);
    return json(res, 200, { ok: false, needsMigration: issue.needsMigration, error: issue.error });
  }
}

/** 用量（管理员看全量；普通用户只能看自己） */
async function handleUsage(req: VercelRequest, res: VercelResponse, auth: { userId: string; email: string }, body: Record<string, unknown>) {
  const admin = isAdminEmail(auth.email);
  const fromIso = String(body.from || new Date(Date.now() - 30 * 86_400_000).toISOString());
  const toIso = String(body.to || new Date(Date.now() + 86_400_000).toISOString());
  const scoped = admin ? USAGE : USAGE.filter((e) => e.userId === auth.userId);
  const range = filterUsageByRange(scoped, fromIso, toIso);
  const summary = summarizeUsage(range, { limit: Number(body.limit ?? 100) || 100 });
  return json(res, 200, { ok: true, scope: admin ? 'all' : 'self', summary, describe: describeUsage(summary) });
}

interface GatewayAuth {
  userId: string;
  email: string;
  workspaceId: string;
}

const handlers: Record<string, (req: VercelRequest, res: VercelResponse, auth: GatewayAuth, body: Record<string, unknown>) => Promise<unknown>> = {
  mcp: handleMcp,
  status: (req, res, auth, body) => handleStatus(req, res, auth, body),
  usage: handleUsage,
  verify: (req, res, auth, body) => handleVerify(req, res, auth, body),
  // §15.28 密钥跟着账号走：这三个动作让客户端**不再接触明文**，只读写"自己的那一行"
  keyList: (req, res, auth) => handleKeyList(req, res, auth),
  keySet: (req, res, auth, body) => handleKeySet(req, res, auth, body),
  keyClear: (req, res, auth, body) => handleKeyClear(req, res, auth, body),
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action || (req.url || '').split('/').pop() || '').split('?')[0];
  const fn = handlers[action];
  if (!fn) return json(res, 404, { ok: false, error: `未知 action：${action}`, actions: Object.keys(handlers) });

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {};
  const token = String((body as Record<string, unknown>).token || req.headers['x-auth-token'] || '');
  // userId 的唯一来源：JWT。客户端传什么 userId 都不看（跨账号隔离的第一道保证）。
  const auth = await verifyToken(token);
  if (!auth) return json(res, 401, { ok: false, error: '未登录或 token 无效' });
  try {
    return await fn(req, res, { ...auth, workspaceId: String((body as Record<string, unknown>).workspaceId || 'default') }, body as Record<string, unknown>);
  } catch (e) {
    if (action === 'verify') {
      const incoming = body as Record<string, unknown>;
      const kp = keyProviderFor(incoming.provider);
      const verifyKeySource = kp
        ? (await resolveRequestSecret(kp, auth.userId, incoming.userKey)).source
        : ('none' as ProviderKeySource);
      return json(res, 200, {
        ok: false,
        keySource: verifyKeySource,
        message: e instanceof Error ? redactText(e.message) : 'MCP 验证内部错误',
      });
    }
    return json(res, 500, { ok: false, error: e instanceof Error ? redactText(e.message) : '数据池内部错误' });
  }
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
