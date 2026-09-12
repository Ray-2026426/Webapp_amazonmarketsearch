// M5 · 平台数据池网关（PRD §11.2「商用核心」）。
//
// 一次业务调用在这里完成四件事，顺序固定：
//   1) 解析密钥（**只在服务端**：管理员在 Supabase user_metadata.appKeys 里存的，或本机环境变量）
//   2) 查缓存（按数据类型 TTL，命中直接返回并把 cacheHit 记进用量）
//   3) 配额校验（超限直接拒绝，不浪费外部调用）
//   4) 调外部 MCP → 写缓存 → 记一条用量事件（成功/失败都记）
//
// 安全口径：本模块的任何返回值里都**不含密钥**；前端只拿业务数据。
// 密钥解析顺序：管理员配置（服务端可读）→ 环境变量 → 没有就明确报"未配置"。

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
} from '../../src/utils/poolCache';
import { entryToCacheRow, rowToCacheEntry, prunePlan, summarizeCacheRows } from '../../src/utils/poolCacheStore';
import {
  createUsageEvent,
  checkQuota,
  summarizeUsage,
  filterUsageByRange,
  describeUsage,
  type UsageEvent,
  type UsageTool,
} from '../../src/utils/usageAccounting';

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
  lingxing: 'https://mcp.lingxing.com/mcp',
  sorftime: 'https://mcp.sorftime.com/mcp',
};

function env(name: string): string {
  return (process.env[name] || '').trim();
}

async function resolveProviderSecret(provider: ProviderName): Promise<string> {
  // 1) 管理员在服务端保存的（Supabase user_metadata.appKeys）
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
  try {
    await s.from('usage_events').insert({
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
    });
  } catch {
    /* 记账失败不能挡住业务：内存里已经有一份 */
  }
}

/* ───────────── MCP 调用 ───────────── */

interface McpRpc {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

const SS_TOOL_NAMES: Record<string, string> = {
  review: 'review',
  traffic_keyword: 'traffic_keyword',
  keyword_miner: 'keyword_miner',
  keyword_research: 'keyword_research',
  aba_research_weekly: 'aba_research_weekly',
};

async function callMcp(provider: ProviderName, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string; calls: number }> {
  const secret = await resolveProviderSecret(provider);
  if (!secret) {
    return { ok: false, error: `${provider} 未在服务端配置密钥（管理员可在设置→数据池配置，或设置环境变量 ${PROVIDER_ENV_KEY[provider]}）`, calls: 0 };
  }
  const endpoint = resolveProviderUrl(provider);
  const call = async (method: string, params?: Record<string, unknown>, id = 1) => {
    const body: McpRpc = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'secret-key': secret,
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
    // SSE 或 JSON 都兼容：取最后一个含 result/error 的 JSON 行
    const lines = text.split('\n').filter((l) => l.trim().startsWith('{'));
    const parsed = lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : null;
    return parsed as { result?: unknown; error?: { message?: string } } | null;
  };

  let calls = 0;
  try {
    calls += 1;
    const init = await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'kairo', version: '1.0' } }, 0);
    if (init?.error) throw new Error(init.error.message || 'MCP initialize 失败');
    calls += 1;
    const toolName = provider === 'sellersprite' ? SS_TOOL_NAMES[tool] || tool : tool;
    const r = await call('tools/call', { name: toolName, arguments: args }, 2);
    if (r?.error) throw new Error(r.error.message || 'MCP 调用失败');
    return { ok: true, data: (r?.result as Record<string, unknown>)?.content ?? r?.result, calls };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'MCP 调用失败', calls };
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

  // ① 配额
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthEvents = filterUsageByRange(USAGE, monthStart.toISOString(), new Date(Date.now() + 86_400_000).toISOString());
  const quotaLimit = Number(body.monthlyLimit ?? 0) || null;
  const quota = checkQuota({ events: monthEvents, userId: auth.userId, monthlyLimit: quotaLimit });
  if (!quota.allowed) {
    return json(res, 429, { ok: false, error: quota.reason, quota });
  }

  // ② 缓存（持久化表优先，进程内兜底）
  const type = (String(body.type || 'other') as PoolDataType) ?? 'other';
  const key = buildCacheKey(type, { provider, tool, args, projectId });
  const nowIso = new Date().toISOString();
  const hitEntry = await readCacheEntry(key, nowIso);
  if (hitEntry) {
    const bumped = await bumpCacheHitEntry(hitEntry);
    await recordUsage(
      createUsageEvent({ workspaceId, userId: auth.userId, projectId, tool: usageTool, provider, ok: true, cacheHit: true, calls: 0 })
    );
    return json(res, 200, {
      ok: true,
      cached: true,
      cacheReason: `缓存命中（创建于 ${bumped.createdAt}，命中 ${bumped.hits} 次）`,
      data: bumped.value,
      ttlSeconds: DEFAULT_TTL_SECONDS[type],
    });
  }

  // ③ 调外部 + ④ 写缓存 + 记账
  const started = Date.now();
  const result = await callMcp(provider, tool, args);
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
    })
  );
  if (!result.ok) return json(res, 502, { ok: false, error: result.error, cacheReason: '未命中缓存（本次为真实调用）' });
  return json(res, 200, { ok: true, cached: false, cacheReason: '未命中缓存（本次为真实调用）', data: result.data, durationMs, ttlSeconds });
}

/** 状态：哪些 provider 在服务端已配置（只回布尔与指纹，不回密钥）+ 缓存概览 */
async function handleStatus(_req: VercelRequest, res: VercelResponse, _auth: unknown, body: Record<string, unknown>) {
  const providers: Record<string, { configured: boolean; fingerprint: string; hasCustomUrl: boolean }> = {};
  for (const p of Object.keys(PROVIDER_ENV_KEY) as ProviderName[]) {
    const secret = await resolveProviderSecret(p);
    providers[p] = {
      configured: secret.length > 0,
      fingerprint: secret ? `${secret.slice(0, 3)}…${secret.slice(-4)}` : '',
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
      ? '密钥只在服务端；缓存持久化在 Supabase pool_cache（实例回收不丢）'
      : '密钥只在服务端；当前无 service_role，缓存退回进程内（实例回收会丢，接口不变）',
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
