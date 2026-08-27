import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function env(name: string): string {
  return (process.env[name] || '').trim();
}

export function getServiceSupabase(): SupabaseClient | null {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getPublicSupabase(): SupabaseClient | null {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_PUBLISHABLE_KEY') || env('VITE_SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY');
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
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
