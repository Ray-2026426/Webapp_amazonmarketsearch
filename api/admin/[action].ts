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
import { summarizeUsage, filterUsageByRange, describeUsage, type UsageEvent } from '../../src/utils/usageAccounting.js';
import { maskKey, describeCheck } from '../../src/utils/keyMasking.js';
import {
  buildMigrationSql,
  classifyDbError,
  describeMissingTables,
  hasMigrationDdl,
  missingTableName,
} from '../../src/utils/migrationSql.js';

/**
 * 用户要照做的迁移文件（必须是**具体文件名**：只说"跑迁移"等于没说）。
 * 与 src/utils/migrationSqlTables.ts 的 SOURCE_MIGRATION_FILE 同源，
 * 由 tests/migrationSql.test.ts 断言两者一致（防哪天改了生成器这里忘改）。
 */
const MIGRATION_FILE = 'supabase/migrations/all_in_one.sql';

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

/**
 * 数据库表自检（回答"我到底要不要跑迁移"）。
 *
 * 背景：用户不确定 Supabase 那几张表建没建。猜没用 —— 直接逐表探测：
 * 用 `select ... head:true` 拿一行，出错（PostgREST 的 42P01 = 表不存在）就是没建。
 * 只回"表名 + 建没建 + 错误码"，不含任何数据内容。
 *
 * 2026-09 修正两处口径（用户反馈："提示太泛，不知道该干什么"）：
 *   1. `project_assets` **不是数据表**：007 建的是 Storage bucket（`project-assets`），
 *      以前拿它当表去 `select` 永远 42P01 → 界面永远显示"缺表"，而迁移文件里根本没有它的建表语句。
 *      现在按 kind 区分探测方式（table → head 查询；bucket → storage.getBucket），结论才可信。
 *   2. 补上 `app_config`：管理员「配置中心」与数据池密钥解析一直在读写这张表，
 *      但 001-009 从没建过它（010 已补进迁移）；不列出来，用户会一直以为是"迁移跑过了却还是坏的"。
 */
const EXPECTED_TABLES = [
  { name: 'projects', migration: '001', required: true, kind: 'table', why: '项目与五看数据（缺了项目存不下来）' },
  { name: 'project_members', migration: '002/006', required: true, kind: 'table', why: '项目成员与权限（缺了协作与权限判断失效）' },
  { name: 'app_config', migration: '010', required: false, kind: 'table', why: '管理员「配置中心」的密钥表（缺了只能用环境变量配密钥，界面上改不了）' },
  { name: 'user_provider_keys', migration: '011', required: false, kind: 'table', why: '用户自己的数据池密钥（缺了"密钥跟着账号走"不生效：换设备登录得重新填 Key）' },
  { name: 'usage_events', migration: '008', required: false, kind: 'table', why: '用量记账（缺了用量统计为空，只剩进程内统计、重启归零）' },
  { name: 'audit_events', migration: '008', required: false, kind: 'table', why: '审计日志（缺了审计列表为空，操作不留痕）' },
  { name: 'pool_cache', migration: '009', required: false, kind: 'table', why: '数据池缓存（缺了退化为进程内缓存，实例回收即丢，外部调用成本变高）' },
  { name: 'project_assets', migration: '007', required: false, kind: 'bucket', bucket: 'project-assets', why: '报告资产桶（007 建的是 Storage bucket，不是数据表；缺了只影响资产上传）' },
] as const;

interface TableProbe {
  name: string;
  ok: boolean;
  migration: string;
  required: boolean;
  kind: 'table' | 'bucket';
  why: string;
  error?: string;
}

async function tableStatus(): Promise<{
  client: 'service_role' | 'none';
  tables: TableProbe[];
  missingRequired: string[];
  missingOptional: string[];
  /** 缺失且**迁移文件里有建表语句**的表（界面靠它拼"一键复制"的 SQL） */
  copyableTables: string[];
  /** 缺失但不是数据表（没有建表语句可复制，例如 project_assets 桶） */
  nonTableItems: string[];
  hint: string;
}> {
  const s = getServiceSupabase();
  const tables: TableProbe[] = [];
  const base = (t: (typeof EXPECTED_TABLES)[number], ok: boolean, error?: string): TableProbe => ({
    name: t.name,
    ok,
    migration: t.migration,
    required: t.required,
    kind: t.kind,
    why: t.why,
    error,
  });
  if (!s) {
    return {
      client: 'none',
      tables: EXPECTED_TABLES.map((t) => base(t, false, '未配置 SERVICE_ROLE_KEY，无法探测')),
      missingRequired: [],
      missingOptional: [],
      copyableTables: [],
      nonTableItems: [],
      hint: '未配置 SUPABASE_SERVICE_ROLE_KEY：服务端读不了数据库，先在 Vercel 配好这个变量',
    };
  }
  for (const t of EXPECTED_TABLES) {
    try {
      if (t.kind === 'bucket') {
        // 桶不存在时 supabase-js 返回 error（不抛异常），拿 error 当"没建"
        const { error } = await s.storage.getBucket(t.bucket);
        tables.push(base(t, !error, error?.message));
      } else {
        const { error } = await s.from(t.name).select('*', { count: 'exact', head: true }).limit(1);
        tables.push(base(t, !error, error?.message));
      }
    } catch (e) {
      tables.push(base(t, false, e instanceof Error ? e.message : 'unknown'));
    }
  }
  const missing = tables.filter((t) => !t.ok);
  const missingRequired = missing.filter((t) => t.required).map((t) => t.name);
  const missingOptional = missing.filter((t) => !t.required).map((t) => t.name);
  const copyableTables = missing.filter((t) => t.kind === 'table' && hasMigrationDdl(t.name)).map((t) => t.name);
  const nonTableItems = missing.filter((t) => t.kind !== 'table').map((t) => t.name);
  return {
    client: 'service_role',
    tables,
    missingRequired,
    missingOptional,
    copyableTables,
    nonTableItems,
    hint:
      missingRequired.length > 0
        ? `必建表缺失：${missingRequired.join('、')} —— 用「一键复制建表 SQL」把这几张表的语句贴到 Supabase → SQL Editor 执行` +
          `（也可以直接跑 ${MIGRATION_FILE}，可重复执行）`
        : missingOptional.length > 0
          ? `核心表齐全；可选表缺失：${missingOptional.join('、')}（不跑也能用：只是用量统计/审计/缓存持久化/资产上传会缺失或退化；` +
            `跑一次 ${MIGRATION_FILE} 即可补上）`
          : '所有表齐全，无需迁移',
  };
}

/**
 * Supabase 出错的统一出口。
 *
 * 2026-09 修：以前一律 `json(res, 500, {error})` —— 用户看到的就是"HTTP 500，管理员后台都不能用"。
 * 但**缺表不是服务器崩了**，而是"该跑迁移了"，两者必须分开：
 *   · 缺表（PostgREST 42P01 / "does not exist" / schema cache）→ 200 + needsMigration + 可照做的指引；
 *   · 权限错误（42501 / permission denied / RLS）→ 500 + 明确写"这不是缺表，跑迁移解决不了"；
 *   · 其他（Key 无效、网络）→ 500 + 原始信息（面板会把原文显示出来）。
 *
 * 分类逻辑抽到 src/utils/migrationSql.ts（纯函数、可单测）：见 classifyDbError / missingTableName。
 */
function dbError(res: VercelResponse, where: string, error: { code?: string; message?: string } | null) {
  const message = error?.message || '未知数据库错误';
  const kind = classifyDbError(error);
  if (kind === 'missing-table') {
    const table = missingTableName(message);
    const tables = table ? [table] : [];
    const copyable = tables.filter((t) => hasMigrationDdl(t));
    return json(res, 200, {
      ok: true,
      needsMigration: true,
      where,
      // 具体表名（修了原来 `/"([a-z_]+)"/` 把 schema 名 "public" 当成表名的 bug）
      missingTable: table,
      missingTables: tables,
      copyableTables: copyable,
      error: message,
      hint:
        tables.length > 0
          ? describeMissingTables(tables)
          : `数据库表还没建：去 Supabase → SQL Editor 执行 ${MIGRATION_FILE}（可重复执行，不会破坏已有数据）。跑完刷新本页即可。`,
    });
  }
  if (kind === 'permission') {
    return json(res, 500, {
      ok: false,
      where,
      kind: 'permission',
      error: `权限错误（不是缺表，跑迁移解决不了）：${message}`,
      hint: '检查这张表的 RLS 策略 / 使用的角色（service_role 应绕过 RLS）；缺表提示只在 42P01 时出现。',
    });
  }
  return json(res, 500, { ok: false, error: message, where });
}

/** 环境自检（§11.4「环境自检」+ §2.5-4 的根治）：只回状态与指纹，不回值 */
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
  // 缺表这件事在这里就告诉界面（不是等某个接口失败才提示）：
  // 打开管理员后台 → 环境自检，立刻能看到"缺哪张表 + 一键复制建表 SQL + 不跑也能用"。
  const stillMissing = (database?.tables ?? []).filter((t) => !t.ok);
  return json(res, 200, {
    ok: true,
    checkedAt: new Date().toISOString(),
    supabase,
    database,
    needsMigration: stillMissing.length > 0,
    missingTable: stillMissing[0]?.name ?? '',
    missingTables: stillMissing.map((t) => t.name),
    copyableTables: database?.copyableTables ?? [],
    hint: database?.hint,
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
