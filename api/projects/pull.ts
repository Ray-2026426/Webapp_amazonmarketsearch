import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, verifyToken, json } from '../auth/_shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const s = getServiceSupabase();
  if (!s) return json(res, 500, { ok: false, error: '后端未配置' });

  const { data, error } = await s
    .from('projects')
    .select('data')
    .eq('owner_id', auth.userId)
    .order('updated_at', { ascending: false });
  if (error) return json(res, 500, { ok: false, error: error.message });

  const projects = ((data ?? []) as { data: unknown }[]).map((r) => r.data);
  return json(res, 200, { ok: true, projects });
}