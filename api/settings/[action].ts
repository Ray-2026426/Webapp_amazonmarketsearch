import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, verifyToken, isAdminEmail, json } from '../auth/_shared.js';
import { describeKeys, maskKey } from '../../src/utils/keyMasking.js';

function env(name: string): string {
  return (process.env[name] || '').trim();
}

/**
 * M5 安全加固（PRD §11.2「**平台**密钥只在服务端，前端永不接触」；§15.26 之后口径精确化）：
 * 这个接口**不再返回密钥明文**，只返回"配没配 + 指纹"（掩码口径见 src/utils/keyMasking.ts）。
 *
 * 为什么必须改：旧实现把 deepseek/sellersprite 的 Key 明文返回给浏览器，
 * 前端还会写进 localStorage——任何拿到浏览器的人都能取走密钥。
 * 现在前端拿不到密钥，所有需要密钥的调用一律走服务端网关（/api/data/*）。
 */
const KEY_NAMES = ['deepseek', 'sellersprite', 'xydc', 'lingxing', 'sorftime'] as const;
type KeyName = (typeof KEY_NAMES)[number];

function envKeys(): Record<KeyName, string> {
  return {
    deepseek: env('DEEPSEEK_API_KEY'),
    sellersprite: env('SELLERSPRITE_SECRET_KEY'),
    xydc: env('XYDC_SECRET_KEY'),
    lingxing: env('LINGXING_SECRET_KEY'),
    sorftime: env('SORFTIME_SECRET_KEY'),
  };
}

async function get(req: VercelRequest, res: VercelResponse, auth: { userId: string; email: string }) {
  if (!isAdminEmail(auth.email)) return json(res, 403, { ok: false, error: '非管理员' });
  const s = getServiceSupabase();
  if (!s) {
    return json(res, 200, {
      ok: true,
      cloudDisabled: true,
      keys: describeKeys(envKeys()),
      note: '仅返回"是否已配置"与指纹，不回显密钥值；实际调用走服务端数据池 /api/data/*',
    });
  }
  const { data } = await s.auth.admin.getUserById(auth.userId);
  const meta = (data?.user?.user_metadata?.appKeys ?? {}) as Record<string, string>;
  const keys: Record<KeyName, string> = {
    deepseek: String(meta.deepseek || env('DEEPSEEK_API_KEY') || '').trim(),
    sellersprite: String(meta.sellersprite || env('SELLERSPRITE_SECRET_KEY') || '').trim(),
    xydc: String(meta.xydc || env('XYDC_SECRET_KEY') || '').trim(),
    lingxing: String(meta.lingxing || env('LINGXING_SECRET_KEY') || '').trim(),
    sorftime: String(meta.sorftime || env('SORFTIME_SECRET_KEY') || '').trim(),
  };
  // 只回"是否已配置 + 指纹"，绝不回显明文（M5 安全加固）
  return json(res, 200, {
    ok: true,
    keys: describeKeys(keys),
    note: '仅返回"是否已配置"与指纹，不回显密钥值；实际调用走服务端数据池 /api/data/*',
  });
}

async function save(req: VercelRequest, res: VercelResponse, auth: { userId: string; email: string }, body: Record<string, unknown>) {
  if (!isAdminEmail(auth.email)) return json(res, 403, { ok: false, error: '非管理员' });
  const s = getServiceSupabase();
  if (!s) return json(res, 200, { ok: true, cloudDisabled: true });

  const incoming = (body.keys ?? {}) as Record<string, string>;
  const allowed = ['deepseek', 'sellersprite', 'xydc', 'lingxing', 'sorftime'];
  const { data } = await s.auth.admin.getUserById(auth.userId);
  const appKeys = {
    ...(((data?.user?.user_metadata?.appKeys ?? {}) as Record<string, string>) || {}),
  };
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
