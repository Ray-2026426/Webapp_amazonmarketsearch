import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPublicSupabase, getServiceSupabase, localAccountUser, signToken, verifyToken, json, isAdminEmail } from './_shared.js';
import { accountError, normalizeAccount } from './account.js';

/**
 * 管理员身份由**服务端**说了算（ADMIN_EMAILS 白名单）。
 * 前端不再依赖构建期注入的 VITE_ADMIN_EMAILS：那样既要把管理员邮箱打进公开 JS 包，
 * 又必须重新部署才能生效（改一次管理员=改一次代码）。这里直接把 isAdmin 发给前端。
 */
function withAdmin<T extends { email?: string | null }>(user: T) {
  return { ...user, isAdmin: isAdminEmail(user?.email) };
}

async function login(req: VercelRequest, res: VercelResponse, body: Record<string, unknown>) {
  const account = normalizeAccount((body.account ?? body.email) as string | undefined);
  const password = String(body.password || '');
  if (!account || !password) return json(res, 400, { ok: false, error: '请输入账号和密码' });

  const service = getServiceSupabase();
  const s = service ?? getPublicSupabase();
  if (!s) {
    const user = localAccountUser(account.account);
    const token = signToken({ sub: user.id, email: user.email, account: user.account, mode: 'local' }, 30 * 24 * 3600 * 1000);
    return json(res, 200, { ok: true, token, user: withAdmin(user), cloudDisabled: true });
  }

  const { data, error } = await s.auth.signInWithPassword({ email: account.authEmail, password });
  if (error || !data.user) {
    return json(res, 401, { ok: false, error: account.isEmail ? '邮箱或密码错误' : '账号或密码错误' });
  }

  const token = signToken({ sub: data.user.id, email: data.user.email, account: account.account }, 30 * 24 * 3600 * 1000);
  return json(res, 200, {
    ok: true,
    token,
    supabaseAccessToken: data.session?.access_token,
    user: withAdmin({ id: data.user.id, email: data.user.email, account: account.account }),
  });
}

/**
 * 注册邀请码闸门（服务端唯一实现）。
 *
 * 为什么必须有：数据池密钥都在服务端，**任何能注册的人都能用这些密钥去抓数据**（花的是账号主人的钱）。
 * 所以：
 *   - 配了 `SIGNUP_INVITE_CODE` → 必须带对邀请码才能注册；
 *   - 线上（VERCEL_ENV=production）没配 → **直接关闭注册**（fail closed，宁可挡住也不能漏）；
 *   - 本地开发没配 → 放行，否则没法自己试。
 */
function inviteGate(provided: unknown): { ok: boolean; status: number; error: string } {
  const expected = String(process.env.SIGNUP_INVITE_CODE || '').trim();
  const given = String(provided ?? '').trim();
  if (expected) {
    if (given && given === expected) return { ok: true, status: 0, error: '' };
    return { ok: false, status: 403, error: '邀请码不正确（内测阶段需要邀请码才能注册）' };
  }
  if (process.env.VERCEL_ENV === 'production') {
    return {
      ok: false,
      status: 403,
      error: '本环境未配置注册邀请码，注册已关闭：管理员在 Vercel 配置 SIGNUP_INVITE_CODE 后才会开放',
    };
  }
  return { ok: true, status: 0, error: '' };
}

async function register(req: VercelRequest, res: VercelResponse, body: Record<string, unknown>) {
  const account = normalizeAccount((body.account ?? body.email) as string | undefined);
  const password = String(body.password || '');
  if (!account) return json(res, 400, { ok: false, error: accountError() });
  if (password.length < 6) return json(res, 400, { ok: false, error: '密码至少 6 位' });

  const gate = inviteGate(body.inviteCode);
  if (!gate.ok) return json(res, gate.status, { ok: false, error: gate.error });

  const s = getServiceSupabase();
  if (!s) {
    const publicSupabase = getPublicSupabase();
    if (!publicSupabase) {
      const user = localAccountUser(account.account);
      const token = signToken({ sub: user.id, email: user.email, account: user.account, mode: 'local' }, 30 * 24 * 3600 * 1000);
      return json(res, 200, { ok: true, token, user: withAdmin(user), cloudDisabled: true });
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
      user: withAdmin({ id: user.id, email: user.email, account: account.account }),
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
  return json(res, 200, { ok: true, token, user: withAdmin({ id: user.id, email: user.email, account: account.account }) });
}

/**
 * 用当前 JWT 换回"我是不是管理员"。
 * 用途：管理员白名单（ADMIN_EMAILS）改过之后，已登录的用户刷新页面即可生效，
 * 不必退出重登，更不必重新部署。
 */
async function me(req: VercelRequest, res: VercelResponse, body: Record<string, unknown>) {
  const token = String(body.token || req.headers['x-auth-token'] || '');
  const auth = await verifyToken(token);
  if (!auth) return json(res, 401, { ok: false, error: '登录已过期，请重新登录' });
  return json(res, 200, {
    ok: true,
    user: withAdmin({ id: auth.userId, email: auth.email }),
  });
}

const handlers: Record<string, (req: VercelRequest, res: VercelResponse, body: Record<string, unknown>) => Promise<void>> = {
  login,
  register,
  me,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const pathname = String(req.url || '').split('?')[0];
  const action = String(pathname.split('/').filter(Boolean).pop() ?? '').toLowerCase();
  const fn = handlers[action];
  if (!fn) return json(res, 400, { ok: false, error: `未知操作: ${action}` });
  await fn(req, res, body);
}
