// M5 · 数据池客户端（PRD §11.2：前端永不接触密钥）。
//
// 登录用户在浏览器里需要外部数据时，走这里 → `/api/data/mcp` → 服务端用管理员密钥调用 MCP。
// 前端只传 tool/args/token，从不传密钥；返回体里也只有业务数据。
//
// 与旧路径的关系（迁移期）：旧实现是浏览器直接用 MCP 密钥调用（密钥存在浏览器里）。
// 现在规则是"**能走网关就走网关**"：
//   - 有登录 token → 走网关（无密钥可用，也不需要）；
//   - 没有 token（游客/演示）→ 由调用方决定回退到旧路径，旧路径保留但在设置页明确标注为"临时/不安全"。
// 这样"密钥不出服务端"在**登录用户这条主链路上已经成立**，不必先为游客策略拍板。

import { getAuthToken } from './auth';
import type { PoolDataType } from './poolCache';
import type { UsageTool } from './usageAccounting';

export type DataPoolProvider = 'sellersprite' | 'xydc' | 'lingxing' | 'sorftime';

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
  /** 走了网关还是被跳过（未登录） */
  viaGateway: boolean;
}

/** 是否具备走网关的条件（有登录 token） */
export function canUseDataPool(): boolean {
  return Boolean(getAuthToken());
}

/**
 * 通过服务端数据池调用外部能力。
 * 未登录时**不抛错**，而是返回 viaGateway=false —— 让调用方自己决定回退策略（游客模式）。
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
      body: JSON.stringify({
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
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: unknown;
      error?: string;
      cached?: boolean;
      cacheReason?: string;
      durationMs?: number;
      quota?: { reason?: string };
    };
    if (!res.ok || body.ok === false) {
      return {
        ok: false,
        error: body.error || body.quota?.reason || `数据池调用失败（HTTP ${res.status}）`,
        viaGateway: true,
      };
    }
    return {
      ok: true,
      data: body.data,
      cached: body.cached,
      cacheReason: body.cacheReason,
      durationMs: body.durationMs,
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
