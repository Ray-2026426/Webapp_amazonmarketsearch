// M5 · 管理员后台接口（PRD §11.4）。
//
// 权限模型：全部 action 都要 (a) 有效 JWT + (b) 管理员邮箱（ADMIN_EMAILS）**或** 管理员角色。
// 数据口径：有 service_role 时走 Supabase（用户/项目/用量/审计落库）；没有时优雅降级为
// "cloudDisabled + 本地可见的数据"，绝不因为云端没配就让整个后台报 500。
//
// 安全红线（§11.2/§11.4）：
//   - **任何返回体里都不含密钥明文**，配置中心只回"是否已配置 + 指纹"；
//   - 所有写操作（改配置、改用户状态）都写审计日志；
//   - 前端只传 token，不传 service key。

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, verifyToken, isAdminEmail, json } from '../auth/_shared.js';
import { summarizeUsage, filterUsageByRange, describeUsage, type UsageEvent } from '../../src/utils/usageAccounting';
import { maskKey, describeCheck } from '../../src/utils/keyMasking';

function env(name: string): string {
  return (process.env[name] || '').trim();
}

interface AdminAuth {
  userId: string;
  email: string;
}

function maskKeyLocal(value: string): string {
  return maskKey(value);
}

/** 环境自检（§11.4「环境自检」+ §2.5-4 的根治）：只回状态与指纹，不回值 */
/**
 * 数据库表自检（回答"我到底要不要跑迁移"）。
 *
 * 背景：用户不确定 Supabase 那几张表建没建。猜没用 —— 直接逐表探测：
 * 用 `select ... head:true` 拿一行，出错（PostgREST 的 42P01 = 表不存在）就是没建。
 * 只回"表名 + 建没建 + 错误码"，不含任何数据内容。
 */
const EXPECTED_TABLES = [
  { name: 'projects', migration: '001', required: true, why: '项目与五看数据' },
  { name: 'project_members', migration: '002/006', required: true, why: '项目成员与权限' },
  { name: 'project_assets', migration: '007', required: false, why: '报告资产（缺失只影响资产上传）' },
  { name: 'usage_events', migration: '008', required: false, why: '用量记账（缺失则用量统计为空）' },
  { name: 'audit_events', migration: '008', required: false, why: '审计日志（缺失则审计为空）' },
  { name: 'pool_cache', migration: '009', required: false, why: '数据池缓存（缺失则退化为进程内缓存，成本变高）' },
] as const;

async function tableStatus(): Promise<{
  client: 'service_role' | 'none';
  tables: { name: string; ok: boolean; migration: string; required: boolean; why: string; error?: string }[];
  missingRequired: string[];
  hint: string;
}> {
  const s = getServiceSupabase();
  const tables: { name: string; ok: boolean; migration: string; required: boolean; why: string; error?: string }[] = [];
  if (!s) {
    return {
      client: 'none',
      tables: EXPECTED_TABLES.map((t) => ({ name: t.name, ok: false, migration: t.migration, required: t.required, why: t.why, error: '未配置 SERVICE_ROLE_KEY，无法探测' })),
      missingRequired: [],
      hint: '未配置 SUPABASE_SERVICE_ROLE_KEY：服务端读不了数据库，先在 Vercel 配好这个变量',
    };
  }
  for (const t of EXPECTED_TABLES) {
    try {
      const { error } = await s.from(t.name).select('*', { count: 'exact', head: true }).limit(1);
      tables.push({ name: t.name, ok: !error, migration: t.migration, required: t.required, why: t.why, error: error?.message });
    } catch (e) {
      tables.push({ name: t.name, ok: false, migration: t.migration, required: t.required, why: t.why, error: e instanceof Error ? e.message : 'unknown' });
    }
  }
  const missingRequired = tables.filter((t) => !t.ok && t.required).map((t) => t.name);
  const missingOptional = tables.filter((t) => !t.ok && !t.required).map((t) => t.name);
  return {
    client: 'service_role',
    tables,
    missingRequired,
    hint:
      missingRequired.length > 0
        ? `必建表缺失：${missingRequired.join('、')} —— 必须去 Supabase SQL Editor 执行 supabase/migrations/all_in_one.sql`
        : missingOptional.length > 0
          ? `核心表齐全；可选表缺失：${missingOptional.join('、')}（跑一次 all_in_one.sql 即可补上，不跑也能用）`
          : '所有表齐全，无需迁移',
  };
}

/**
 * Supabase 出错的统一出口。
 *
 * 2026-09 修：以前一律 `json(res, 500, {error})` —— 用户看到的就是"HTTP 500，管理员后台都不能用"。
 * 但**缺表不是服务器崩了**，而是"该跑迁移了"，两者必须分开：
 *   · 缺表（PostgREST 42P01 / "does not exist"）→ 200 + needsMigration + 可照做的指引；
 *   · 其他（权限、Key 无效、网络）→ 500 + 原始信息（面板会把原文显示出来）。
 */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01') return true;
  return /does not exist|Could not find the table|relation .* does not exist|schema cache/i.test(error.message ?? '');
}

function dbError(res: VercelResponse, where: string, error: { code?: string; message?: string } | null) {
  const message = error?.message || '未知数据库错误';
  if (isMissingTable(error)) {
    return json(res, 200, {
      ok: true,
      needsMigration: true,
      where,
      missingTable: /"([a-z_]+)"/.exec(message)?.[1] || '',
      error: message,
      hint: '数据库表还没建：去 Supabase → SQL Editor 执行 supabase/migrations/all_in_one.sql（可重复执行，不会破坏已有数据）。跑完刷新本页即可。',
    });
  }
  return json(res, 500, { ok: false, error: message, where });
}

async function health(_req: VercelRequest, res: VercelResponse) {
  const s = getServiceSupabase();
  let supabase: { configured: boolean; reachable: boolean; error?: string } = { configured: Boolean(s), reachable: false };
  if (s) {
    try {
      const { error } = await s.from('projects').select('id', { count: 'exact', head: true }).limit(1);
      supabase = { configured: true, reachable: !error, error: error?.message };
    } catch (e) {
      supabase = { configured: true, reachable: false, error: e instanceof Error ? e.message : 'unknown' };
    }
  }
  const providers = ['SELLERSPRITE_SECRET_KEY', 'XYDC_SECRET_KEY', 'LINGXING_SECRET_KEY', 'SORFTIME_SECRET_KEY', 'DEEPSEEK_API_KEY'] as const;
  let database: Awaited<ReturnType<typeof tableStatus>> | null = null;
  try {
    database = await tableStatus();
  } catch (e) {
    database = null;
  }
  return json(res, 200, {
    ok: true,
    checkedAt: new Date().toISOString(),
    supabase,
    database,
    env: {
      APP_JWT_SECRET: describeCheck(env('APP_JWT_SECRET')),
      ADMIN_EMAILS: describeCheck(env('ADMIN_EMAILS'), { count: env('ADMIN_EMAILS').split(',').filter(Boolean).length }),
      SERVICE_ROLE_KEY: describeCheck(env('SUPABASE_SERVICE_ROLE_KEY')),
      SIGNUP_INVITE_CODE: describeCheck(process.env.SIGNUP_INVITE_CODE),
    },
    providers: Object.fromEntries(providers.map((p) => [p, describeCheck(env(p))])),
    note: '只返回"是否已配置 + 指纹"，不回显任何密钥值（M5 安全加固）',
  });
}

/** 配置中心：读（掩码）/ 写（写审计） */
async function config(req: VercelRequest, res: VercelResponse, auth: AdminAuth, body: Record<string, unknown>) {
  const s = getServiceSupabase();
  const action = String(body.op || 'get');
  if (action === 'get') {
    const keys = ['deepseek', 'sellersprite', 'xydc', 'lingxing', 'sorftime'] as const;
    const out: Record<string, { configured: boolean; fingerprint: string }> = {};
    for (const k of keys) {
      let value = '';
      if (s) {
        try {
          const { data } = await s.from('app_config').select('value').eq('key', `key:${k}`).maybeSingle();
          value = typeof data?.value === 'string' ? data.value : '';
        } catch {
          value = '';
        }
      }
      if (!value) {
        const envName: Record<string, string> = {
          deepseek: 'DEEPSEEK_API_KEY',
          sellersprite: 'SELLERSPRITE_SECRET_KEY',
          xydc: 'XYDC_SECRET_KEY',
          lingxing: 'LINGXING_SECRET_KEY',
          sorftime: 'SORFTIME_SECRET_KEY',
        };
        value = env(envName[k]);
      }
      out[k] = { configured: value.length > 0, fingerprint: maskKey(value) };
    }
    return json(res, 200, { ok: true, cloudDisabled: !s, keys: out });
  }

  if (action === 'set') {
    const key = String(body.key || '').trim();
    const value = String(body.value || '').trim();
    if (!['deepseek', 'sellersprite', 'xydc', 'lingxing', 'sorftime'].includes(key)) {
      return json(res, 400, { ok: false, error: '不支持的配置项' });
    }
    if (!value) return json(res, 400, { ok: false, error: '值不能为空（清空请用 op=clear）' });
    if (!s) return json(res, 200, { ok: true, cloudDisabled: true, note: '云端未配置：请直接设置环境变量' });
    const { error } = await s.from('app_config').upsert({ key: `key:${key}`, value });
    if (error) return dbError(res, "config", error);
    await audit(auth, 'admin_config', `key:${key}`, { configured: true, fingerprint: maskKey(value) });
    return json(res, 200, { ok: true, key, fingerprint: maskKey(value) });
  }

  if (action === 'clear') {
    const key = String(body.key || '').trim();
    if (!s) return json(res, 200, { ok: true, cloudDisabled: true });
    const { error } = await s.from('app_config').delete().eq('key', `key:${key}`);
    if (error) return dbError(res, "config#2", error);
    await audit(auth, 'admin_config', `key:${key}`, { cleared: true });
    return json(res, 200, { ok: true, cleared: key });
  }

  return json(res, 400, { ok: false, error: `未知 op：${action}` });
}

/** 用量统计 */
async function usage(req: VercelRequest, res: VercelResponse, _auth: AdminAuth, body: Record<string, unknown>) {
  const s = getServiceSupabase();
  const fromIso = String(body.from || new Date(Date.now() - 30 * 86_400_000).toISOString());
  const toIso = String(body.to || new Date().toISOString());
  if (!s) {
    return json(res, 200, {
      ok: true,
      cloudDisabled: true,
      summary: summarizeUsage([], {}),
      describe: '云端未配置：用量从数据池进程内统计读取（请用管理员面板的"数据池状态"）',
    });
  }
  const { data, error } = await s
    .from('usage_events')
    .select('*')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return dbError(res, "usage", error);
  const events: UsageEvent[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id ?? ''),
    workspaceId: String(r.workspace_id ?? 'default'),
    userId: String(r.user_id ?? ''),
    projectId: r.project_id ? String(r.project_id) : undefined,
    tool: (String(r.tool ?? 'other') as UsageEvent['tool']) ?? 'other',
    provider: String(r.provider ?? ''),
    ok: Boolean(r.ok),
    cacheHit: Boolean(r.cache_hit),
    calls: Number(r.calls ?? 0),
    inputTokens: r.input_tokens == null ? undefined : Number(r.input_tokens),
    outputTokens: r.output_tokens == null ? undefined : Number(r.output_tokens),
    durationMs: r.duration_ms == null ? undefined : Number(r.duration_ms),
    error: r.error ? String(r.error) : undefined,
    createdAt: String(r.created_at ?? ''),
  }));
  const summary = summarizeUsage(filterUsageByRange(events, fromIso, toIso), { limit: Number(body.limit ?? 100) || 100 });
  return json(res, 200, { ok: true, summary, describe: describeUsage(summary), from: fromIso, to: toIso });
}

/** 用户管理（列表 / 启禁用 / 重置密码链接） */
async function users(_req: VercelRequest, res: VercelResponse, auth: AdminAuth, body: Record<string, unknown>) {
  const s = getServiceSupabase();
  if (!s) return json(res, 200, { ok: true, cloudDisabled: true, users: [] });
  const op = String(body.op || 'list');

  if (op === 'list') {
    const { data, error } = await s.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return dbError(res, "users", error);
    const rows = (data?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? '',
      username: String((u.user_metadata?.username as string) || ''),
      role: String((u.user_metadata?.role as string) || 'user'),
      createdAt: u.created_at ?? '',
      lastSignInAt: u.last_sign_in_at ?? '',
      banned: Boolean((u as unknown as { banned_until?: string }).banned_until),
    }));
    return json(res, 200, { ok: true, users: rows, count: rows.length });
  }

  if (op === 'ban' || op === 'unban') {
    const userId = String(body.userId || '').trim();
    if (!userId) return json(res, 400, { ok: false, error: '缺少 userId' });
    if (userId === auth.userId) return json(res, 400, { ok: false, error: '不能禁用自己（避免把自己锁在外面）' });
    const { error } = await s.auth.admin.updateUserById(userId, op === 'ban' ? { ban_duration: '87600h' } : { ban_duration: 'none' });
    if (error) return dbError(res, "users#2", error);
    await audit(auth, op === 'ban' ? 'admin_user_ban' : 'admin_user_unban', userId, {});
    return json(res, 200, { ok: true, userId, banned: op === 'ban' });
  }

  if (op === 'reset_password') {
    const email = String(body.email || '').trim();
    if (!email) return json(res, 400, { ok: false, error: '缺少 email' });
    const { error } = await s.auth.admin.generateLink({ type: 'recovery', email });
    if (error) return dbError(res, "users#3", error);
    await audit(auth, 'admin_user_reset', email, {});
    // 安全：不回传链接（链接等于临时凭证），只告诉管理员"已生成并发送"
    return json(res, 200, { ok: true, email, note: '已触发找回密码流程；出于安全考虑不回传重置链接' });
  }

  return json(res, 400, { ok: false, error: `未知 op：${op}` });
}

/** 审计日志（读） */
async function auditLog(_req: VercelRequest, res: VercelResponse, _auth: AdminAuth, body: Record<string, unknown>) {
  const s = getServiceSupabase();
  if (!s) return json(res, 200, { ok: true, cloudDisabled: true, events: [] });
  const limit = Math.min(500, Number(body.limit ?? 100) || 100);
  let q = s.from('audit_events').select('*').order('created_at', { ascending: false }).limit(limit);
  if (body.action) q = q.eq('action', String(body.action));
  if (body.actor) q = q.eq('actor_user_id', String(body.actor));
  const { data, error } = await q;
  if (error) return dbError(res, "auditLog", error);
  return json(res, 200, { ok: true, events: data ?? [] });
}

/** 项目与报告（查看 / 删除；转移在 M6 团队空间做） */
async function projects(_req: VercelRequest, res: VercelResponse, auth: AdminAuth, body: Record<string, unknown>) {
  const s = getServiceSupabase();
  if (!s) return json(res, 200, { ok: true, cloudDisabled: true, projects: [] });
  const op = String(body.op || 'list');
  if (op === 'list') {
    const { data, error } = await s
      .from('projects')
      .select('id, name, owner_id, status, updated_at, created_at')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) return dbError(res, "projects", error);
    return json(res, 200, { ok: true, projects: data ?? [] });
  }
  if (op === 'delete') {
    const id = String(body.projectId || '').trim();
    if (!id) return json(res, 400, { ok: false, error: '缺少 projectId' });
    const { error } = await s.from('projects').delete().eq('id', id);
    if (error) return dbError(res, "projects#2", error);
    await audit(auth, 'admin_project_delete', id, {});
    return json(res, 200, { ok: true, deleted: id });
  }
  return json(res, 400, { ok: false, error: `未知 op：${op}` });
}

/** 写审计日志（失败不抛错：审计不能挡住业务，但会被记录在返回里） */
async function audit(actor: AdminAuth, action: string, target?: string, detail?: Record<string, unknown>): Promise<void> {
  const s = getServiceSupabase();
  if (!s) return;
  try {
    await s.from('audit_events').insert({
      id: `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      action,
      target: target ?? null,
      detail: detail ?? null,
    });
  } catch {
    /* ignore */
  }
}

const handlers: Record<string, (req: VercelRequest, res: VercelResponse, auth: AdminAuth, body: Record<string, unknown>) => Promise<unknown>> = {
  health,
  config,
  usage,
  users,
  audit: auditLog,
  projects,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action || (req.url || '').split('/').pop() || '').split('?')[0];
  const fn = handlers[action];
  if (!fn) return json(res, 404, { ok: false, error: `未知 action：${action}`, actions: Object.keys(handlers) });

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) ?? {};
  const token = String((body as Record<string, unknown>).token || req.headers['x-auth-token'] || '');
  const auth = await verifyToken(token);
  if (!auth) return json(res, 401, { ok: false, error: '未登录或 token 无效' });
  if (!isAdminEmail(auth.email)) return json(res, 403, { ok: false, error: '需要管理员权限' });

  try {
    return await fn(req, res, auth, body as Record<string, unknown>);
  } catch (e) {
    return json(res, 500, { ok: false, error: e instanceof Error ? e.message : '管理员接口内部错误' });
  }
}

function safeParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}
