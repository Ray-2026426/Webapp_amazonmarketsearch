import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, verifyToken, isAdminEmail, json } from '../auth/_shared';

function env(name: string): string {
  return (process.env[name] || '').trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });
  if (!isAdminEmail(auth.email)) return json(res, 403, { ok: false, error: '非管理员' });

  const s = getServiceSupabase();
  if (!s) return json(res, 500, { ok: false, error: '后端未配置' });

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