import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, signToken, json } from './_shared.js';
import { normalizeAccount } from './account.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { account?: string; email?: string; password?: string };
  const account = normalizeAccount(body.account ?? body.email);
  const password = String(body.password || '');
  if (!account || !password) return json(res, 400, { ok: false, error: '请输入账号和密码' });

  const s = getServiceSupabase();
  if (!s) return json(res, 500, { ok: false, error: '预览环境后端未配置：缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY' });

  const { data, error } = await s.auth.signInWithPassword({ email: account.authEmail, password });
  if (error || !data.user) {
    return json(res, 401, { ok: false, error: account.isEmail ? '邮箱或密码错误' : '账号或密码错误' });
  }

  const token = signToken({ sub: data.user.id, email: data.user.email, account: account.account }, 30 * 24 * 3600 * 1000);
  return json(res, 200, { ok: true, token, user: { id: data.user.id, email: data.user.email, account: account.account } });
}
