import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, verifyToken, isAdminEmail, json } from '../auth/_shared.js';

function env(name: string): string {
  return (process.env[name] || '').trim();
}

async function get(req: VercelRequest, res: VercelResponse, auth: { userId: string; email: string }) {
  if (!isAdminEmail(auth.email)) return json(res, 403, { ok: false, error: '非管理员' });
  const s = getServiceSupabase();
  if (!s) {
    return json(res, 200, {
      ok: true,
      cloudDisabled: true,
      keys: {
        deepseek: env('DEEPSEEK_API_KEY'),
        sellersprite: env('SELLERSPRITE_SECRET_KEY'),
        xydc: env('XYDC_SECRET_KEY'),
        lingxing: env('LINGXING_SECRET_KEY'),
      },
    });
  }
  const { data } = await s.auth.admin.getUserById(auth.userId);
  const meta = (data?.user?.user_metadata?.appKeys ?? {}) as Record<string, string>;
  const keys = {
    deepseek: String(meta.deepseek || env('DEEPSEEK_API_KEY') || '').trim(),
    sellersprite: String(meta.sellersprite || env('SELLERSPRITE_SECRET_KEY') || '').trim(),
    xydc: String(meta.xydc || env('XYDC_SECRET_KEY') || '').trim(),
    lingxing: String(meta.lingxing || env('LINGXING_SECRET_KEY') || '').trim(),
  };
  return json(res, 200, { ok: true, keys });
}

async function save(req: VercelRequest, res: VercelResponse, auth: { userId: string; email: string }, body: Record<string, unknown>) {
  if (!isAdminEmail(auth.email)) return json(res, 403, { ok: false, error: '非管理员' });
  const s = getServiceSupabase();
  if (!s) return json(res, 200, { ok: true, cloudDisabled: true });

  const incoming = (body.keys ?? {}) as Record<string, string>;
  const allowed = ['deepseek', 'sellersprite', 'xydc', 'lingxing'];
  const appKeys: Record<string, string> = {};
  for (const k of allowed) {
    const v = String(incoming[k] ?? '').trim();
    if (v) appKeys[k] = v;
  }
  const { error } = await s.auth.admin.updateUserById(auth.userId, { user_metadata: { appKeys } });
  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true });
}

const handlers: Record<string, (req: VercelRequest, res: VercelResponse, auth: { userId: string; email: string }, body: Record<string, unknown>) => Promise<unknown>> = {
  get,
  save,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as Record<string, unknown> & { token?: string };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const pathname = String(req.url || '').split('?')[0];
  const action = String(pathname.split('/').filter(Boolean).pop() ?? '').toLowerCase();
  const fn = handlers[action];
  if (!fn) return json(res, 400, { ok: false, error: `未知操作: ${action}` });
  await fn(req, res, { userId: auth.userId, email: auth.email }, body);
}
