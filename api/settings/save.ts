import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, verifyToken, isAdminEmail, json } from '../auth/_shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string; keys?: Record<string, string> };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });
  if (!isAdminEmail(auth.email)) return json(res, 403, { ok: false, error: '非管理员' });

  const s = getServiceSupabase();
  if (!s) return json(res, 500, { ok: false, error: '后端未配置' });

  const incoming = body.keys ?? {};
  const allowed = ['deepseek', 'sellersprite', 'xydc', 'lingxing'];
  const appKeys: Record<string, string> = {};
  for (const k of allowed) {
    const v = String(incoming[k] ?? '').trim();
    if (v) appKeys[k] = v;
  }

  const { error } = await s.auth.admin.updateUserById(auth.userId, {
    user_metadata: { appKeys },
  });
  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true });
}