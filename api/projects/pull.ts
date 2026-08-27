import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, getUserSupabase, verifyToken, json } from '../auth/_shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string; supabaseAccessToken?: string };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const service = getServiceSupabase();
  const s = service ?? getUserSupabase(body.supabaseAccessToken);
  if (!s) return json(res, 200, { ok: true, projects: [], cloudDisabled: true });

  let rows: { data: unknown; revision?: number }[] = [];
  if (service) {
    // service_role 模式：RLS 被绕过，手动扩展可见范围 = 自己拥有的 + 自己是成员的项目。
    const { data: owned, error: ownedError } = await service
      .from('projects')
      .select('data, revision')
      .eq('owner_id', auth.userId);
    if (ownedError) return json(res, 500, { ok: false, error: ownedError.message });
    const { data: memberProjects, error: memberError } = await service
      .from('project_members')
      .select('project_id')
      .eq('user_id', auth.userId);
    if (memberError) return json(res, 500, { ok: false, error: memberError.message });
    const memberIds = [...new Set(((memberProjects ?? []) as { project_id: string }[]).map((r) => r.project_id))];
    let shared: { data: unknown; revision?: number }[] = [];
    if (memberIds.length > 0) {
      const { data: sharedRows, error: sharedError } = await service
        .from('projects')
        .select('data, revision')
        .in('id', memberIds);
      if (sharedError) return json(res, 500, { ok: false, error: sharedError.message });
      shared = (sharedRows ?? []) as { data: unknown; revision?: number }[];
    }
    rows = [...((owned ?? []) as { data: unknown; revision?: number }[]), ...shared];
  } else {
    // user token 模式：RLS（projects_select_member）已过滤出可读项目，直接取。
    const { data, error } = await s
      .from('projects')
      .select('data, revision')
      .order('updated_at', { ascending: false });
    if (error) return json(res, 500, { ok: false, error: error.message });
    rows = (data ?? []) as { data: unknown; revision?: number }[];
  }

  // 去重（自己拥有且同时是成员的项目只保留一份），并把云端 revision 合并回项目数据。
  const seen = new Set<string>();
  const projects: unknown[] = [];
  for (const row of rows) {
    const raw = row.data as { id?: string } | null;
    if (!raw || typeof raw.id !== 'string' || seen.has(raw.id)) continue;
    seen.add(raw.id);
    projects.push({ ...raw, cloudRevision: row.revision ?? undefined });
  }
  projects.sort((a, b) => {
    const au = (a as { updatedAt?: string }).updatedAt || '';
    const bu = (b as { updatedAt?: string }).updatedAt || '';
    return bu.localeCompare(au);
  });
  return json(res, 200, { ok: true, projects });
}
