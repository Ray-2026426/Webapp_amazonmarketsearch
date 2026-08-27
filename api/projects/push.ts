import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase, getUserSupabase, verifyToken, json } from '../auth/_shared.js';

interface PushRow {
  id?: string;
  updatedAt?: string;
  cloudRevision?: number;
}

/** 尝试用云端 revision 做原子乐观写入；成功返回 revision，冲突返回 { conflict, current }。 */
async function pushOneService(
  s: SupabaseClient,
  row: PushRow,
  userId: string
): Promise<{ status: 'ok'; revision: number } | { status: 'conflict'; current?: unknown } | { status: 'error'; error: string }> {
  const expected = typeof row.cloudRevision === 'number' && row.cloudRevision > 0 ? row.cloudRevision : 1;
  const { data, error } = await s.rpc('push_project_if_revision', {
    p_id: row.id,
    p_expected_revision: expected,
    p_user_id: userId,
    p_data: row,
    p_updated_at: row.updatedAt || new Date().toISOString(),
  });
  if (error) return { status: 'error', error: error.message };
  const result = (data ?? {}) as { ok?: boolean; revision?: number; conflict?: boolean; current?: unknown; error?: string };
  if (result.ok && typeof result.revision === 'number') return { status: 'ok', revision: result.revision };
  if (result.conflict) return { status: 'conflict', current: result.current };
  return { status: 'error', error: result.error || '推送失败' };
}

async function pushOneUser(
  s: SupabaseClient,
  row: PushRow,
  userId: string
): Promise<{ status: 'ok'; revision: number } | { status: 'conflict'; current?: unknown } | { status: 'error'; error: string }> {
  const id = String(row.id || '');
  const expected = typeof row.cloudRevision === 'number' && row.cloudRevision > 0 ? row.cloudRevision : 1;
  const updatedAt = row.updatedAt || new Date().toISOString();
  const data = { ...row, cloudRevision: undefined };

  // 1) 是否存在
  const { data: existing, error: findError } = await s
    .from('projects')
    .select('id, revision')
    .eq('id', id)
    .maybeSingle();
  if (findError) return { status: 'error', error: findError.message };

  if (!existing) {
    const { error: insertError } = await s.from('projects').insert({
      id,
      user_id: userId,
      owner_id: userId,
      data,
      updated_at: updatedAt,
      revision: 1,
    });
    if (insertError) return { status: 'error', error: insertError.message };
    return { status: 'ok', revision: 1 };
  }

  // 2) 乐观并发：带 expected revision 更新，0 行 = 冲突
  const { data: updated, error: updateError } = await s
    .from('projects')
    .update({ data, updated_at: updatedAt, revision: existing.revision + 1 })
    .eq('id', id)
    .eq('revision', expected)
    .select('revision');
  if (updateError) return { status: 'error', error: updateError.message };
  if (updated && updated.length > 0) {
    return { status: 'ok', revision: (updated[0] as { revision: number }).revision };
  }

  // 冲突：读回云端当前版本
  const { data: currentRow, error: readError } = await s
    .from('projects')
    .select('data, revision')
    .eq('id', id)
    .maybeSingle();
  if (readError) return { status: 'error', error: readError.message };
  return {
    status: 'conflict',
    current: currentRow ? { ...(currentRow.data as object), cloudRevision: currentRow.revision } : undefined,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string; supabaseAccessToken?: string; projects?: unknown[] };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const projects = Array.isArray(body.projects) ? body.projects : [];
  if (projects.length === 0) return json(res, 200, { ok: true, pushed: 0, conflicts: [] });

  const service = getServiceSupabase();
  const s = service ?? getUserSupabase(body.supabaseAccessToken);
  if (!s) return json(res, 200, { ok: true, pushed: 0, conflicts: [], cloudDisabled: true });

  let pushed = 0;
  const conflicts: { id: string; cloud: unknown }[] = [];
  const errors: string[] = [];
  for (const raw of projects) {
    const row = raw as PushRow;
    if (!row.id) continue;
    const result = service
      ? await pushOneService(s, row, auth.userId)
      : await pushOneUser(s, row, auth.userId);
    if (result.status === 'ok') {
      pushed += 1;
      continue;
    }
    if (result.status === 'conflict') {
      conflicts.push({ id: row.id, cloud: result.current });
    } else {
      errors.push(`${row.id}: ${result.error}`);
    }
  }
  if (errors.length > 0) return json(res, 500, { ok: false, error: errors.join('；') });
  return json(res, 200, { ok: true, pushed, conflicts });
}
