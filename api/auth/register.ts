import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPublicSupabase, getServiceSupabase, localAccountUser, signToken, json } from './_shared.js';
import { accountError, normalizeAccount } from './account.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { account?: string; email?: string; password?: string };
  const account = normalizeAccount(body.account ?? body.email);
  const password = String(body.password || '');
  if (!account) return json(res, 400, { ok: false, error: accountError() });
  if (password.length < 6) return json(res, 400, { ok: false, error: '密码至少 6 位' });

  const s = getServiceSupabase();
  if (!s) {
    const publicSupabase = getPublicSupabase();
    if (!publicSupabase) {
      const user = localAccountUser(account.account);
      const token = signToken({ sub: user.id, email: user.email, account: user.account, mode: 'local' }, 30 * 24 * 3600 * 1000);
      return json(res, 200, { ok: true, token, user, cloudDisabled: true });
    }
    const { data, error } = await publicSupabase.auth.signUp({
      email: account.authEmail,
      password,
      options: { data: { account: account.account, login_type: account.isEmail ? 'email' : 'account' } },
    });
    if (error) {
      const already = /already registered|already been registered|already exists/i.test(error.message) || error.status === 422;
      return json(res, already ? 409 : 500, { ok: false, error: already ? '该账号已注册' : (error.message || '注册失败') });
    }
    const user = data.user;
    if (!user) return json(res, 500, { ok: false, error: '注册失败' });
    if (!data.session) {
      return json(res, 409, {
        ok: false,
        error: account.isEmail
          ? '注册需要先完成邮箱确认，确认后再登录'
          : '当前后端需要邮箱确认，纯数字账号需要关闭 Supabase 邮箱确认或配置 SERVICE_ROLE_KEY',
      });
    }
    const token = signToken({ sub: user.id, email: user.email, account: account.account }, 30 * 24 * 3600 * 1000);
    return json(res, 200, {
      ok: true,
      token,
      supabaseAccessToken: data.session.access_token,
      user: { id: user.id, email: user.email, account: account.account },
    });
  }

  const { data, error } = await s.auth.admin.createUser({
    email: account.authEmail,
    password,
    email_confirm: true,
    user_metadata: { account: account.account, login_type: account.isEmail ? 'email' : 'account' },
  });
  if (error) {
    const already = /already registered|already been registered/i.test(error.message) || error.status === 422;
    return json(res, already ? 409 : 500, { ok: false, error: already ? '该账号已注册' : (error.message || '注册失败') });
  }
  const user = data.user;
  if (!user) return json(res, 500, { ok: false, error: '注册失败' });

  const token = signToken({ sub: user.id, email: user.email, account: account.account }, 30 * 24 * 3600 * 1000);
  return json(res, 200, { ok: true, token, user: { id: user.id, email: user.email, account: account.account } });
}
