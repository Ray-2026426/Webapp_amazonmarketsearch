import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, getUserSupabase, verifyToken, json } from '../auth/_shared.js';

const BUCKET = 'project-assets';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string; supabaseAccessToken?: string; storagePath?: string };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const storagePath = String(body.storagePath || '').trim();
  if (!storagePath.startsWith(`${BUCKET}/`)) return json(res, 400, { ok: false, error: '无效的存储路径' });
  const path = storagePath.slice(BUCKET.length + 1);
  if (!path) return json(res, 400, { ok: false, error: '无效的存储路径' });

  const service = getServiceSupabase();
  const s = service ?? getUserSupabase(body.supabaseAccessToken);
  if (!s) return json(res, 200, { ok: false, cloudDisabled: true, error: '云同步未配置' });

  const { data, error } = await s.storage.from(BUCKET).remove([path]);
  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true, removed: (data ?? []).length });
}
