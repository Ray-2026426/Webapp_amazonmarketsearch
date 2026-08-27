import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, getUserSupabase, verifyToken, json } from '../auth/_shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string; supabaseAccessToken?: string; projects?: unknown[] };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const projects = Array.isArray(body.projects) ? body.projects : [];
  if (projects.length === 0) return json(res, 200, { ok: true, pushed: 0 });

  const s = getServiceSupabase() ?? getUserSupabase(body.supabaseAccessToken);
  if (!s) return json(res, 200, { ok: true, pushed: 0, cloudDisabled: true });

  const rows = projects.flatMap((p) => {
    const proj = p as { id?: string; updatedAt?: string };
    if (!proj.id) return [];
    return {
      id: proj.id,
      user_id: auth.userId,
      owner_id: auth.userId,
      data: p,
      updated_at: proj.updatedAt || new Date().toISOString(),
    };
  });
  if (rows.length === 0) return json(res, 200, { ok: true, pushed: 0 });

  const { error } = await s.from('projects').upsert(rows, { onConflict: 'id' });
  if (error) return json(res, 500, { ok: false, error: error.message });
  const memberRows = rows.map((row) => ({ project_id: row.id, user_id: auth.userId, role: 'owner' }));
  const { error: memberError } = await s.from('project_members').upsert(memberRows, { onConflict: 'project_id,user_id' });
  if (memberError) return json(res, 500, { ok: false, error: memberError.message });
  return json(res, 200, { ok: true, pushed: rows.length });
}
