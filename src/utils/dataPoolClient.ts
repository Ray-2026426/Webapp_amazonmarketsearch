// M5 · 数据池客户端（BYO Key：用户自带密钥，2026-09 用户决策变更）。
//
// 密钥流向（这里是最关键的一段，别改成假功能）：
//   1) 用户可能在设置页给某个数据源填了自己的 Key → 只存在他的 localStorage（mcpConfig）；
//   2) 需要外部数据时，把**该数据源的用户 Key** 随请求体带给同源网关 `/api/data/*`；
//   3) 网关解析顺序：① 本次请求携带的用户 Key → ② 服务端 app_config / 环境变量里的平台 Key；
//   4) 用户 Key 只在当次请求内使用：不落库、不落日志、不进任何返回体。
//
// 硬约束：
//   - 只走同源 HTTPS 相对路径，**Key 只进请求体**，绝不进 URL query（query 会进历史/代理日志/Referer）；
//   - 平台 Key 永远不会出现在浏览器里 —— 客户端能拿到的 Key 只有用户自己填的那一个；
//   - 未登录时不抛错，返回 viaGateway=false，让调用方自己决定回退策略。
//
// 与旧路径的关系（迁移期）：旧实现是浏览器直接用 MCP 密钥调用（密钥存在浏览器里）。
// 现在规则是"**能走网关就走网关**"：登录用户一律走网关，网关负责选 Key（自己的还是平台的）。

import { getAuthToken } from './auth';
import { getUserKeyForProvider, type McpProviderKind } from './mcpConfig';
import type { PoolDataType } from './poolCache';
import type { UsageTool } from './usageAccounting';

export type DataPoolProvider = 'sellersprite' | 'xydc' | 'lingxing' | 'sorftime';

/** 取本机为该数据源填的 Key（读不到就返回空串 = 走平台兜底） */
function localUserKey(provider: McpProviderKind): string {
  try {
    return getUserKeyForProvider(provider);
  } catch {
    return '';
  }
}

export interface DataPoolCallInput {
  provider: DataPoolProvider;
  tool: string;
  args: Record<string, unknown>;
  /** 数据类型（决定 TTL 与缓存键） */
  type?: PoolDataType;
  /** 记账分类 */
  usageTool?: UsageTool;
  projectId?: string;
  workspaceId?: string;
  /** 月配额（0/undefined = 不限） */
  monthlyLimit?: number;
  /** 覆盖 TTL（秒） */
  ttlSeconds?: number;
}

export interface DataPoolCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** 是否命中服务端缓存 */
  cached?: boolean;
  cacheReason?: string;
  durationMs?: number;
  /** 本次用的是谁的 Key（服务端回报的标签，**不是 Key 本身**） */
  keySource?: 'user' | 'platform' | 'none';
  /** 走了网关还是被跳过（未登录） */
  viaGateway: boolean;
}

/** 是否具备走网关的条件（有登录 token） */
export function canUseDataPool(): boolean {
  return Boolean(getAuthToken());
}

/**
 * 给发往 `/api/data/*` 的请求体补上"本机为该 provider 填的 Key"（没填就不加字段）。
 *
 * 单独导出的原因：Listing 抓取执行器等调用点自己拼请求体，必须走**同一个**函数，
 * 否则会出现"有的路径用了用户自己的 Key、有的路径偷偷用了平台 Key"这种最难查的账。
 */
export function withUserKey<T extends Record<string, unknown>>(provider: McpProviderKind, payload: T): T {
  const userKey = localUserKey(provider);
  return (userKey ? { ...payload, userKey } : payload) as T;
}

/**
 * 通过服务端数据池调用外部能力。
 * 未登录时**不抛错**，而是返回 viaGateway=false —— 让调用方自己决定回退策略（游客模式）。
 *
 * 本机填了该数据源的 Key 就随**请求体**带上（网关优先用它，用完即弃）。
 */
export async function callDataPool(input: DataPoolCallInput): Promise<DataPoolCallResult> {
  const token = getAuthToken();
  if (!token) {
    return { ok: false, error: '未登录：平台数据池需要登录后使用', viaGateway: false };
  }
  try {
    const res = await fetch('/api/data/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        withUserKey(input.provider, {
          token,
          provider: input.provider,
          tool: input.tool,
          args: input.args,
          type: input.type ?? 'other',
          usageTool: input.usageTool ?? 'other',
          projectId: input.projectId,
          workspaceId: input.workspaceId ?? 'default',
          monthlyLimit: input.monthlyLimit ?? 0,
          ttlSeconds: input.ttlSeconds,
        })
      ),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: unknown;
      error?: string;
      cached?: boolean;
      cacheReason?: string;
      durationMs?: number;
      keySource?: 'user' | 'platform' | 'none';
      quota?: { reason?: string };
    };
    if (!res.ok || body.ok === false) {
      return {
        ok: false,
        error: body.error || body.quota?.reason || `数据池调用失败（HTTP ${res.status}）`,
        keySource: body.keySource,
        viaGateway: true,
      };
    }
    return {
      ok: true,
      data: body.data,
      cached: body.cached,
      cacheReason: body.cacheReason,
      durationMs: body.durationMs,
      keySource: body.keySource,
      viaGateway: true,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误', viaGateway: true };
  }
}

/** 数据池状态（哪些 provider 在服务端已配置；只回布尔与指纹，不含密钥） */
export async function fetchDataPoolStatus(): Promise<{
  ok: boolean;
  providers?: Record<string, { configured: boolean; fingerprint: string }>;
  cache?: { entries: number; types: string[] };
  usage?: string;
  error?: string;
}> {
  const token = getAuthToken();
  if (!token) return { ok: false, error: '未登录' };
  try {
    const res = await fetch('/api/data/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.ok === false) return { ok: false, error: String(body.error || `HTTP ${res.status}`) };
    return {
      ok: true,
      providers: body.providers as Record<string, { configured: boolean; fingerprint: string }>,
      cache: body.cache as { entries: number; types: string[] },
      usage: typeof body.usage === 'string' ? body.usage : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误' };
  }
}

/** 自己的用量（普通用户只看自己；管理员看全量，见 /api/admin/usage） */
export async function fetchMyUsage(fromIso?: string): Promise<{ ok: boolean; describe?: string; error?: string }> {
  const token = getAuthToken();
  if (!token) return { ok: false, error: '未登录' };
  try {
    const res = await fetch('/api/data/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, from: fromIso }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; describe?: string; error?: string };
    return res.ok && body.ok !== false ? { ok: true, describe: body.describe } : { ok: false, error: body.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误' };
  }
}

export interface ProviderVerifyResult {
  ok: boolean;
  /** 这次验证用的是谁的 Key（填了自己的就是 user，没填就是 platform） */
  keySource: 'user' | 'platform' | 'none';
  /** 给用户看的一句话（不含任何 Key 片段） */
  message: string;
}

/**
 * 「验证」按钮的唯一实现：**按密钥来源分别验证**。
 *
 * 为什么不能沿用旧实现：以前的 `testMcpProvider` → `checkDataPoolReady` 只查"服务端数据池
 * 配没配卖家精灵"，既不看你在界面上填了什么，也不看这个数据源是谁。BYO Key 之后必须回答
 * "这次用的是谁的 Key、它到底能不能用"，所以统一走网关的 `verify`：
 *   - 本机填了 Key → 网关用**你的** Key 做一次 MCP 握手（只握手，不调业务工具、不记用量、不占配额）；
 *   - 没填 → 网关用平台 Key 握手，界面据此显示"用的是平台 Key"；
 *   - 自定义 MCP → 连地址一起交给网关（服务端会校验目标地址，避免把网关变成内网探测器）。
 *
 * 明文 Key 只在这一次请求体里出现（同源），返回体只有 `keySource` 与一句话。
 */
export async function verifyDataPoolProvider(input: {
  provider: McpProviderKind;
  /** 自定义 MCP 的地址（内置数据源留空：地址由服务端决定） */
  endpoint?: string;
}): Promise<ProviderVerifyResult> {
  const token = getAuthToken();
  if (!token) return { ok: false, keySource: 'none', message: '未登录：数据池需要登录后使用' };
  const userKey = localUserKey(input.provider);
  const endpoint = input.provider === 'custom' ? (input.endpoint ?? '').trim() : '';
  if (input.provider === 'custom' && !endpoint) {
    return { ok: false, keySource: userKey ? 'user' : 'none', message: '自定义 MCP 需要先填地址' };
  }
  try {
    const res = await fetch('/api/data/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        provider: input.provider,
        endpoint,
        ...(userKey ? { userKey } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      keySource?: 'user' | 'platform' | 'none';
      message?: string;
      error?: string;
    };
    const keySource = body.keySource ?? (userKey ? 'user' : 'platform');
    return {
      ok: Boolean(body.ok) && res.ok,
      keySource,
      message: body.message || body.error || `验证失败（HTTP ${res.status}）`,
    };
  } catch (e) {
    return { ok: false, keySource: userKey ? 'user' : 'platform', message: e instanceof Error ? e.message : '网络错误' };
  }
}
