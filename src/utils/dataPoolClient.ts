// M5 · 数据池客户端（§15.28：用户密钥存在服务端、**按账号**，网关自己按 JWT 取）。
//
// 密钥流向（这里是最关键的一段，别改成假功能）：
//   1) 用户自己的 Key 存在服务端 `public.user_provider_keys`（主键 user_id+provider），
//      **按账号**：换设备 / 换浏览器登录同一账号就能取到（写入走 mcpConfig.saveUserKey）；
//   2) 网关 `/api/data/mcp` 收到请求后，用 JWT 里的 userId 自己去库里取该 provider 的 Key；
//   3) **客户端不传 Key**：请求体里没有 userKey 字段 —— 少一条能把明文带出浏览器的通道；
//   4) 网关解析顺序：库里该用户的 Key → 迁移期兼容（请求体 userKey，仅旧客户端会带）→ 都没有则拒绝。
//
// 硬约束：
//   - 只走同源 HTTPS 相对路径，任何 Key 都不进 URL query（query 会进历史/代理日志/Referer）；
//   - 平台 Key 永远不会出现在浏览器里 —— 政策 A 之后平台 Key 也不作为 MCP 数据兜底；
//   - 未登录时不抛错，返回 viaGateway=false，让调用方自己决定回退策略。
//
// 与旧路径的关系（迁移期）：旧实现是浏览器直接把用户 Key 随请求体带给网关（withUserKey 通道）。
// 那条通道**已删除**：服务端既然按账号取 Key，客户端再传一份就只是多一次明文在网络上流动的机会。

import { getAuthToken } from './auth';
import { migrateLegacyLocalKeys, getUserKeyStatus, type McpProviderKind } from './mcpConfig';
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
 * 通过服务端数据池调用外部能力。
 * 未登录时**不抛错**，而是返回 viaGateway=false —— 让调用方自己决定回退策略（游客模式）。
 *
 * **客户端不传 Key**：服务端按 JWT 里的 userId 取该用户自己的 Key（§15.28）。
 * 调用前先补一次旧本机密钥迁移：老设备上还留着旧明文时，先把它写进账号，否则这次调用会因"没配 Key"被拒。
 */
export async function callDataPool(input: DataPoolCallInput): Promise<DataPoolCallResult> {
  const token = getAuthToken();
  if (!token) {
    return { ok: false, error: '未登录：平台数据池需要登录后使用', viaGateway: false };
  }
  // 一次性、幂等：把老设备上残留的旧明文 Key 迁到账号里（成功后才删本机副本）
  await migrateLegacyLocalKeys();
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
  /** 这次验证用的是谁的 Key（普通 MCP 调用必须是 user；没配就是 none）—— 服务端回报的标签 */
  keySource: 'user' | 'platform' | 'none';
  /** 给用户看的一句话（不含任何 Key 片段） */
  message: string;
}

/**
 * 「验证」按钮的唯一实现：验证**你账号里存的那把 Key**（§15.28）。
 *
 * 与旧实现的区别：以前这里把浏览器里的明文 Key 随请求体带上；现在只发 `provider` + `endpoint`，
 * 网关按 JWT 里的 userId 自己取 Key（客户端不接触明文，也不传 Key）。仍然统一走网关的 `verify`：
 *   - 账号里配了 Key → 网关用**你的** Key 做一次 MCP 握手（只握手，不调业务工具、不记用量、不占配额）；
 *   - 没配 → 网关明确提示先填写自己的 Key；
 *   - 自定义 MCP → 连地址一起交给网关（服务端会校验目标地址，避免把网关变成内网探测器）。
 *
 * 返回体只有 `keySource` 与一句话。
 */
export async function verifyDataPoolProvider(input: {
  provider: McpProviderKind;
  /** 自定义 MCP 的地址（内置数据源留空：地址由服务端决定） */
  endpoint?: string;
}): Promise<ProviderVerifyResult> {
  const token = getAuthToken();
  if (!token) return { ok: false, keySource: 'none', message: '未登录：数据池需要登录后使用' };
  await migrateLegacyLocalKeys();
  const configured = getUserKeyStatus(input.provider).configured;
  const fallbackSource: ProviderVerifyResult['keySource'] = configured ? 'user' : 'none';
  const endpoint = input.provider === 'custom' ? (input.endpoint ?? '').trim() : '';
  if (input.provider === 'custom' && !endpoint) {
    return { ok: false, keySource: fallbackSource, message: '自定义 MCP 需要先填地址' };
  }
  try {
    const res = await fetch('/api/data/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, provider: input.provider, endpoint }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      keySource?: 'user' | 'platform' | 'none';
      message?: string;
      error?: string;
    };
    return {
      ok: Boolean(body.ok) && res.ok,
      keySource: body.keySource ?? fallbackSource,
      message: body.message || body.error || `验证失败（HTTP ${res.status}）`,
    };
  } catch (e) {
    return { ok: false, keySource: fallbackSource, message: e instanceof Error ? e.message : '网络错误' };
  }
}
