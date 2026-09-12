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
  DEFAULT_TTL_SECONDS,
  type PoolCacheEntry,
  type PoolDataType,
} from '../../src/utils/poolCache';
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
 * 进程内缓存：serverless 实例可能被回收，因此这是"尽力而为"的缓存（命中率低于持久化缓存，
 * 但零成本且不会串数据）。持久化缓存（Supabase 表）列为后续项，接口不变。
 */
const CACHE = new Map<string, PoolCacheEntry>();
const USAGE: UsageEvent[] = [];
const MAX_USAGE_IN_MEMORY = 2000;

function cacheList(): PoolCacheEntry[] {
  return [...CACHE.values()];
}

function putCache(entry: PoolCacheEntry | null): void {
  if (!entry) return;
  CACHE.set(entry.key, entry);
  const { kept } = pruneCache(cacheList(), { maxEntries: 500 });
  CACHE.clear();
  for (const e of kept) CACHE.set(e.key, e);
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

  // ② 缓存
  const type = (String(body.type || 'other') as PoolDataType) ?? 'other';
  const key = buildCacheKey(type, { provider, tool, args, projectId });
  const decision = decideCache(cacheList(), key);
  if (decision.hit && decision.entry) {
    const bumped = bumpHit(decision.entry);
    CACHE.set(bumped.key, bumped);
    await recordUsage(
      createUsageEvent({ workspaceId, userId: auth.userId, projectId, tool: usageTool, provider, ok: true, cacheHit: true, calls: 0 })
    );
    return json(res, 200, { ok: true, cached: true, cacheReason: decision.reason, data: decision.entry.value, ttlSeconds: DEFAULT_TTL_SECONDS[type] });
  }

  // ③ 调外部 + ④ 写缓存 + 记账
  const started = Date.now();
  const result = await callMcp(provider, tool, args);
  const durationMs = Date.now() - started;
  const ttlSeconds = Number(body.ttlSeconds ?? 0) || DEFAULT_TTL_SECONDS[type];
  if (result.ok) {
    putCache(makeCacheEntry({ key, type, value: result.data, ok: true, ttlSeconds }));
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
  if (!result.ok) return json(res, 502, { ok: false, error: result.error, cacheReason: decision.reason });
  return json(res, 200, { ok: true, cached: false, cacheReason: decision.reason, data: result.data, durationMs, ttlSeconds });
}

/** 状态：哪些 provider 在服务端已配置（只回布尔与指纹，不回密钥） */
async function handleStatus(_req: VercelRequest, res: VercelResponse) {
  const providers: Record<string, { configured: boolean; fingerprint: string; hasCustomUrl: boolean }> = {};
  for (const p of Object.keys(PROVIDER_ENV_KEY) as ProviderName[]) {
    const secret = await resolveProviderSecret(p);
    providers[p] = {
      configured: secret.length > 0,
      fingerprint: secret ? `${secret.slice(0, 3)}…${secret.slice(-4)}` : '',
      hasCustomUrl: Boolean(env(PROVIDER_ENV_URL[p])),
    };
  }
  const { kept } = pruneCache(cacheList(), { maxEntries: 500 });
  return json(res, 200, {
    ok: true,
    providers,
    cache: { entries: kept.length, types: Object.keys(DEFAULT_TTL_SECONDS) },
    usage: describeUsage(summarizeUsage(USAGE, { limit: 20 })),
    note: '密钥只在服务端；前端通过 /api/data/* 调用，永不接触密钥',
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
  status: (req, res) => handleStatus(req, res),
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
