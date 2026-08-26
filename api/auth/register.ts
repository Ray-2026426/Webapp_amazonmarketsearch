import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, signToken, json } from './_shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { email?: string; password?: string };
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { ok: false, error: '邮箱格式无效' });
  if (password.length < 6) return json(res, 400, { ok: false, error: '密码至少 6 位' });

  const s = getServiceSupabase();
  if (!s) return json(res, 500, { ok: false, error: '后端未配置' });

  const { data, error } = await s.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {},
  });
  if (error) {
    const already = /already registered|already been registered/i.test(error.message) || error.status === 422;
    return json(res, already ? 409 : 500, { ok: false, error: already ? '该邮箱已注册' : (error.message || '注册失败') });
  }
  const user = data.user;
  if (!user) return json(res, 500, { ok: false, error: '注册失败' });

  const token = signToken({ sub: user.id, email: user.email }, 30 * 24 * 3600 * 1000);
  return json(res, 200, { ok: true, token, user: { id: user.id, email: user.email } });
}