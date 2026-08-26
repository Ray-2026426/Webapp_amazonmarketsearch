import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, signToken, json } from './_shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { email?: string; password?: string };
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return json(res, 400, { ok: false, error: '请输入邮箱和密码' });

  const s = getServiceSupabase();
  if (!s) return json(res, 500, { ok: false, error: '后端未配置' });

  const { data, error } = await s.auth.signInWithPassword({ email, password });
  if (error || !data.user) return json(res, 401, { ok: false, error: '邮箱或密码错误' });

  const token = signToken({ sub: data.user.id, email: data.user.email }, 30 * 24 * 3600 * 1000);
  return json(res, 200, { ok: true, token, user: { id: data.user.id, email: data.user.email } });
}