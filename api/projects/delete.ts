import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, verifyToken, json } from '../auth/_shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string; ids?: string[] };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter((x) => typeof x === 'string' && x))] as string[];
  if (ids.length === 0) return json(res, 200, { ok: true, deleted: 0 });

  const s = getServiceSupabase();
  if (!s) return json(res, 200, { ok: true, deleted: 0, cloudDisabled: true });

  const { error } = await s.from('projects').delete().in('id', ids).eq('owner_id', auth.userId);
  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true, deleted: ids.length });
}
