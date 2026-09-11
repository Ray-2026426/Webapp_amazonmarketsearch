import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// M0（2026-09）：不再硬编码任何默认 Supabase 项目。
// 历史问题：此处曾写死一个默认 URL / Publishable Key，导致「未配置环境变量时静默连到某个固定项目」；
// 该项目失效后全环境（生产 / 预览 / 本地）一起登录失败，且前端只能报"登录失败"，无法诊断。
// 现在：未配置 → 明确视为「未配置」，由 /api/health 与前端诊断面板给出原因，绝不猜一个库去连。

function env(name: string): string {
  return (process.env[name] || '').trim();
}

function supabaseUrl(): string {
  return env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
}

function supabasePublishableKey(): string {
  return (
    env('SUPABASE_PUBLISHABLE_KEY') ||
    env('VITE_SUPABASE_PUBLISHABLE_KEY') ||
    env('SUPABASE_ANON_KEY') ||
    env('VITE_SUPABASE_ANON_KEY')
  );
}

/** Supabase 是否具备最小可用配置（URL + 可发布 Key） */
export function hasSupabaseConfig(): boolean {
  return Boolean(supabaseUrl() && supabasePublishableKey());
}

export function getServiceSupabase(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getPublicSupabase(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getUserSupabase(accessToken?: string | null): SupabaseClient | null {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  const token = String(accessToken || '').trim();
  if (!url || !key || !token) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function hashPassword(password: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha256').toString('hex');
  return `pbkdf2$${s}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const salt = parts[1];
  const expected = parts[2];
  const actual = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function getJwtSecret(): string {
  return env('APP_JWT_SECRET') || env('SUPABASE_JWT_SECRET') || 'dev-insecure-secret';
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

export function signToken(payload: Record<string, unknown>, ttlMs: number): string {
  const secret = getJwtSecret();
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function localAccountUser(account: string): { id: string; email: string; account: string } {
  const normalized = String(account || '').trim().toLowerCase();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex');
  return {
    id: `local_${digest.slice(0, 32)}`,
    email: `${normalized || 'user'}@local.amzdev`,
    account: normalized || 'user',
  };
}

export function verifyToken(token: string): { userId: string; email: string } | null {
  const secret = getJwtSecret();
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expect = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  if (sig !== expect) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as { sub?: string; email?: string; exp?: number };
    if (payload.exp && Date.now() > payload.exp) return null;
    if (!payload.sub) return null;
    return { userId: String(payload.sub), email: String(payload.email || '') };
  } catch {
    return null;
  }
}

export function json(res: import('@vercel/node').VercelResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}
export function isAdminEmail(email?: string | null): boolean {
  const raw = env('ADMIN_EMAILS') || env('VITE_ADMIN_EMAILS');
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email) && list.includes(String(email).trim().toLowerCase());
}

/**
 * 云配置自检（M0）：只返回"是否就绪 + 主机名 + 缺失项"，**绝不回显任何密钥**。
 * 用途：/api/health 与前端「设置 → 诊断」面板，把"登录失败"变成"能指出缺哪一项配置"。
 */
export interface CloudConfigStatus {
  ready: boolean;
  supabaseUrlConfigured: boolean;
  /** 仅主机名，不含路径与密钥，可安全展示 */
  supabaseHost: string;
  publishableKeyConfigured: boolean;
  serviceRoleKeyConfigured: boolean;
  jwtSecretConfigured: boolean;
  /** true 表示正在使用不安全的开发默认密钥（生产必须配置 APP_JWT_SECRET） */
  jwtSecretIsInsecureFallback: boolean;
  adminEmailsConfigured: boolean;
  dataPoolKeys: Record<string, boolean>;
  missing: string[];
  warnings: string[];
}

export function getCloudConfigStatus(): CloudConfigStatus {
  const url = supabaseUrl();
  let host = '';
  try {
    host = url ? new URL(url).host : '';
  } catch {
    host = '';
  }
  const publishable = Boolean(supabasePublishableKey());
  const serviceRole = Boolean(env('SUPABASE_SERVICE_ROLE_KEY'));
  const jwtSecret = Boolean(env('APP_JWT_SECRET') || env('SUPABASE_JWT_SECRET'));
  const adminEmails = Boolean(env('ADMIN_EMAILS') || env('VITE_ADMIN_EMAILS'));
  const dataPoolKeys: Record<string, boolean> = {
    sellersprite: Boolean(env('SELLERSPRITE_SECRET_KEY') || env('VITE_DEFAULT_SELLERSPRITE_SECRET_KEY')),
    deepseek: Boolean(env('DEEPSEEK_API_KEY') || env('VITE_DEFAULT_AI_KEY')),
    lingxing: Boolean(env('LINGXING_SECRET_KEY')),
    xydc: Boolean(env('XYDC_SECRET_KEY') || env('VITE_DEFAULT_XYDC_SECRET_KEY')),
    sorftime: Boolean(env('SORFTIME_SECRET_KEY')),
  };

  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!publishable) missing.push('SUPABASE_PUBLISHABLE_KEY');
  if (!serviceRole) missing.push('SUPABASE_SERVICE_ROLE_KEY（缺此项：注册会走邮箱确认流程，可能失败）');
  if (!jwtSecret) missing.push('APP_JWT_SECRET（缺此项：登录令牌使用不安全的开发默认密钥）');
  if (!adminEmails) missing.push('ADMIN_EMAILS（缺此项：无人被识别为管理员）');
  for (const [k, v] of Object.entries(dataPoolKeys)) {
    if (!v) missing.push(`数据池密钥 ${k}`);
  }

  const warnings: string[] = [];
  if (!serviceRole && url && publishable) {
    warnings.push('缺少 SERVICE_ROLE_KEY：登录仍可用，但注册/管理接口会受限');
  }
  if (!jwtSecret) {
    warnings.push('APP_JWT_SECRET 未配置，正在使用 dev-insecure-secret（不可用于生产）');
  }

  return {
    ready: Boolean(url && publishable),
    supabaseUrlConfigured: Boolean(url),
    supabaseHost: host,
    publishableKeyConfigured: publishable,
    serviceRoleKeyConfigured: serviceRole,
    jwtSecretConfigured: jwtSecret,
    jwtSecretIsInsecureFallback: !jwtSecret,
    adminEmailsConfigured: adminEmails,
    dataPoolKeys,
    missing,
    warnings,
  };
}
