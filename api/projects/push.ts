import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, verifyToken, json } from '../auth/_shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string; projects?: unknown[] };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const projects = Array.isArray(body.projects) ? body.projects : [];
  if (projects.length === 0) return json(res, 200, { ok: true, pushed: 0 });

  const s = getServiceSupabase();
  if (!s) return json(res, 500, { ok: false, error: '后端未配置' });

  const rows = projects.map((p) => {
    const proj = p as { id?: string; updatedAt?: string };
    return {
      id: proj.id,
      owner_id: auth.userId,
      data: p,
      updated_at: proj.updatedAt || new Date().toISOString(),
    };
  });

  const { error } = await s.from('projects').upsert(rows, { onConflict: 'id' });
  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true, pushed: rows.length });
}