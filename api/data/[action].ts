// M5 · 平台数据池网关（PRD §11.2「商用核心」）。
//
// 一次业务调用在这里完成四件事，顺序固定：
//   1) 解析密钥（**必须用户自带 Key**，见 src/utils/mcpRequestKey.ts）
//   2) 查缓存（按数据类型 TTL，命中直接返回并把 cacheHit 记进用量）
//   3) 配额校验（超限直接拒绝，不浪费外部调用）
//   4) 调外部 MCP → 写缓存 → 记一条用量事件（成功/失败都记，并带上 keySource 标签）
//
// 密钥口径（BYO Key，2026-09 用户决策变更："需要其他用户也能填 key"）：
//   ① 本次请求携带的用户 Key（浏览器本机保存，随请求体带来）→ 只在**当次请求内**使用；
//   ② 没有用户 Key → 明确报"请填写自己的 Key"，不再回退平台默认 Key。
//
// 安全红线（破了就是事故，逐条都有测试守着）：
//   · 任何返回值里都不含密钥（连平台 Key 的指纹也不给：那是可暴力核对的信息）；
//   · 用户 Key **绝不写库**（不写 app_config、不写任何表）、**绝不写日志**（含 console）、
//     **绝不出现在任何响应体里**；上游把 Key 回显在报错里时统一过 redactText 抹掉；
//   · 上游只把 Key 放**请求头**（secret-key），绝不拼进 URL query；
//   · 非法用户 Key（空 / 超长 / 含控制字符）一律当作"没提供"，不报错泄露细节。

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
import { decideProviderKeySource, resolveProviderKey, type ProviderKeySource } from '../../src/utils/mcpRequestKey.js';
import { redactText } from '../../src/utils/keyMasking.js';
import { validateRelayTarget } from '../../src/utils/aiEndpoints.js';

/* ───────────── 密钥（只在服务端） ───────────── */

type ProviderName = 'sellersprite' | 'xydc' | 'lingxing' | 'sorftime';

const PROVIDER_ENV_KEY: Record<ProviderName, string> = {
  sellersprite: 'SELLERSPRITE_SECRET_KEY',
  xydc: 'XYDC_SECRET_KEY',
  lingxing: 'LINGXING_SECRET_KEY',
  sorftime: 'SORFTIME_SECRET_KEY',
};

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

/** 平台 Key（**只有平台来源**：app_config → 环境变量）。用户自带的 Key 走 resolveRequestSecret */
async function resolvePlatformSecret(provider: ProviderName): Promise<string> {
  // 1) 管理员在「配置中心」保存的（Supabase app_config: key:<provider>）
  const s = getServiceSupabase();
  if (s) {
    try {
      const { data } = await s.from('app_config').select('value').eq('key', `key:${provider}`).maybeSingle();
      const fromDb = typeof data?.value === 'string' ? data.value.trim() : '';
      if (fromDb) return fromDb;
    } catch {
      /* 表可能还没建：回退环境变量 */
    }
  }
  // 2) 环境变量
  return env(PROVIDER_ENV_KEY[provider]);
}

/**
 * 本次请求用谁的 Key —— **唯一的解析入口**，现在只接受用户自带 Key：
 *   ① `decideProviderKeySource`（纯函数）先看用户带来的 Key 是否可用；
 *   ② 没有用户 Key → source='none'，调用方如实报"请填写自己的 Key"。
 *
 * 返回的 key 只在本函数调用栈里往下传（→ 上游请求头），不落库、不落日志、不进响应体。
 */
async function resolveRequestSecret(
  provider: ProviderName,
  userKeyRaw: unknown
): Promise<{ key: string; source: ProviderKeySource }> {
  const decision = decideProviderKeySource(userKeyRaw);
  void provider;
  return resolveProviderKey({ userKey: decision.userKey });
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
  if (!Object.keys(PROVIDER_ENV_KEY).includes(provider)) return json(res, 400, { ok: false, error: `未知 provider：${provider}` });

  // ① 必须先确认用户自带 Key，再允许读缓存或打上游。
  const { key: secret, source: keySource } = await resolveRequestSecret(provider, body.userKey);
  if (!secret) {
    return json(res, 400, {
      ok: false,
      error: `${provider} 需要填写你自己的 Key：请在「设置 → MCP 数据」里填写（只存本机浏览器，不上传服务器保存）`,
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

/** 状态：哪些 provider 在服务端已配置（**只回布尔**）+ 缓存概览 */
async function handleStatus(_req: VercelRequest, res: VercelResponse, _auth: unknown, body: Record<string, unknown>) {
  const providers: Record<string, { configured: boolean; hasCustomUrl: boolean }> = {};
  for (const p of Object.keys(PROVIDER_ENV_KEY) as ProviderName[]) {
    const secret = await resolvePlatformSecret(p);
    providers[p] = {
      configured: secret.length > 0,
      // 这里**不再回指纹**：数据池状态是给所有登录用户看的，而平台 Key 的"首 3 末 4"
      // 也是可以拿来核对的秘密片段。管理员要看指纹请走管理员后台自带的环境自检。
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
      ? 'MCP 普通调用必须使用用户自带 Key；用户 Key 只在当次请求内使用（不落库、不落日志）；缓存持久化在 Supabase pool_cache'
      : 'MCP 普通调用必须使用用户自带 Key；用户 Key 只在当次请求内使用（不落库、不落日志）；当前无 service_role，缓存退回进程内',
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
 * 自定义 MCP：地址由用户提供，所以必须过 `validateRelayTarget`（与 AI 转发同一套 SSRF 底线），
 * 且这里只转发 initialize，绝不转发 tools/call —— 网关不变成"任意 MCP 代理"。
 */
async function handleVerify(_req: VercelRequest, res: VercelResponse, _auth: unknown, body: Record<string, unknown>) {
  const providerRaw = String(body.provider || '');
  const isCustom = providerRaw === 'custom';
  const provider = (isCustom ? 'sellersprite' : providerRaw) as ProviderName;
  if (!isCustom && !Object.keys(PROVIDER_ENV_KEY).includes(providerRaw)) {
    return json(res, 400, { ok: false, error: `未知 provider：${providerRaw}` });
  }
  // 来源标签先算好再返回：返回体里只出现 'user' / 'platform' 这两个字面量，
  // 不出现任何与 Key 值相关的表达式（见 tests/securityKeys.test.ts 的"不得进响应体"守卫）。
  const requestedSource = decideProviderKeySource(body.userKey).source;

  let endpointOverride = '';
  if (isCustom) {
    const check = validateRelayTarget(String(body.endpoint || ''));
    if (!check.ok) {
      return json(res, 400, {
        ok: false,
        keySource: requestedSource,
        error: `自定义 MCP 地址不可用：${check.reason}（平台网关要能连到它；本机地址请在本机自行确认）`,
      });
    }
    endpointOverride = check.url;
  }

  const { key: secret, source: keySource } = await resolveRequestSecret(provider, body.userKey);
  if (!secret && !isCustom) {
    return json(res, 200, {
      ok: false,
      keySource,
      message: `${provider} 没有可用的密钥：请填写你自己的 Key（只存本机浏览器）`,
    });
  }

  // 自定义 MCP 可能本来就不需要 Key（公开端点）：不带凭证也验证一次，如实回报结果
  const handshake = await mcpVerifyConnection(endpointOverride || resolveProviderUrl(provider), secret);
  if (!handshake.ok) {
    if (isCustom && !secret && /HTTP 40[13]/.test(handshake.error ?? '')) {
      return json(res, 200, { ok: false, keySource, message: '端点要求鉴权：请填一个你自己的 Key（只存本机）再验证' });
    }
    return json(res, 200, { ok: false, keySource, message: handshake.error || '握手失败' });
  }
  return json(res, 200, {
    ok: true,
    keySource,
    message: keySource === 'user' ? '连接成功（用的是你自己的 Key）' : '连接成功（自定义 MCP，未带 Key）',
  });
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

const handlers: Record<string, (req: VercelRequest, res: VercelResponse, auth: { userId: string; email: string; workspaceId: string }, body: Record<string, unknown>) => Promise<unknown>> = {
  mcp: handleMcp,
  status: (req, res, _auth, body) => handleStatus(req, res, _auth, body),
  usage: handleUsage,
  verify: (req, res, _auth, body) => handleVerify(req, res, _auth, body),
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action || (req.url || '').split('/').pop() || '').split('?')[0];
  const fn = handlers[action];
  if (!fn) return json(res, 404, { ok: false, error: `未知 action：${action}`, actions: Object.keys(handlers) });

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {};
  const token = String((body as Record<string, unknown>).token || req.headers['x-auth-token'] || '');
  const auth = await verifyToken(token);
  if (!auth) return json(res, 401, { ok: false, error: '未登录或 token 无效' });
  try {
    return await fn(req, res, { ...auth, workspaceId: String((body as Record<string, unknown>).workspaceId || 'default') }, body as Record<string, unknown>);
  } catch (e) {
    if (action === 'verify') {
      const incoming = body as Record<string, unknown>;
      const verifyKeySource = decideProviderKeySource(incoming.userKey).source;
      return json(res, 200, {
        ok: false,
        keySource: verifyKeySource,
        message: e instanceof Error ? redactText(e.message) : 'MCP 验证内部错误',
      });
    }
    return json(res, 500, { ok: false, error: e instanceof Error ? e.message : '数据池内部错误' });
  }
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
