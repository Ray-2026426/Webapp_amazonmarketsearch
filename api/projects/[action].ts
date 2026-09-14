import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase, getUserSupabase, verifyToken, json } from '../auth/_shared.js';

// ---------- 成员管理 ----------
type MemberRole = 'owner' | 'editor' | 'viewer';
const VALID_ROLES: MemberRole[] = ['owner', 'editor', 'viewer'];

interface MemberRow {
  user_id: string;
  role: string;
  email?: string | null;
  account?: string | null;
  created_at?: string;
}

async function currentRole(s: SupabaseClient, projectId: string, userId: string): Promise<MemberRole | null> {
  const { data, error } = await s
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!error && data && VALID_ROLES.includes(data.role as MemberRole)) return data.role as MemberRole;
  const { data: ownerRow, error: ownerError } = await s.from('projects').select('owner_id').eq('id', projectId).maybeSingle();
  if (!ownerError && ownerRow && ownerRow.owner_id === userId) return 'owner';
  return null;
}

async function listMembers(s: SupabaseClient, projectId: string): Promise<MemberRow[]> {
  const { data, error } = await s.rpc('project_members_with_info', { p_project_id: projectId });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberRow[];
}

async function resolveUserIdByEmail(s: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await s.rpc('find_user_id_by_email', { target_email: email.trim().toLowerCase() });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

async function upsertMember(s: SupabaseClient, projectId: string, userId: string, role: MemberRole): Promise<void> {
  const { error } = await s.from('project_members').upsert(
    { project_id: projectId, user_id: userId, role },
    { onConflict: 'project_id,user_id' }
  );
  if (error) throw new Error(error.message);
}

async function deleteMember(s: SupabaseClient, projectId: string, userId: string): Promise<void> {
  const { error } = await s.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

async function members(req: VercelRequest, s: SupabaseClient, res: VercelResponse, auth: { userId: string }, body: Record<string, unknown>) {
  const projectId = String(body.projectId || '').trim();
  if (!projectId) return json(res, 400, { ok: false, error: '缺少项目 ID' });
  const action = String(body.action || 'list');
  try {
    const role = await currentRole(s, projectId, auth.userId);
    if (!role) return json(res, 403, { ok: false, error: '你不是该项目成员' });
    if (action === 'list') return json(res, 200, { ok: true, members: await listMembers(s, projectId), myRole: role });
    if (role !== 'owner') return json(res, 403, { ok: false, error: '只有项目负责人可以管理成员' });

    if (action === 'invite') {
      const email = String(body.email || '').trim();
      const targetRole = String(body.role || 'viewer').toLowerCase() as MemberRole;
      if (!email) return json(res, 400, { ok: false, error: '请输入对方邮箱' });
      if (!VALID_ROLES.includes(targetRole) || targetRole === 'owner') return json(res, 400, { ok: false, error: '角色只能是 editor 或 viewer' });
      const targetId = await resolveUserIdByEmail(s, email);
      if (!targetId) return json(res, 404, { ok: false, error: '该邮箱尚未注册云账号' });
      if (targetId === auth.userId) return json(res, 400, { ok: false, error: '不能邀请自己' });
      await upsertMember(s, projectId, targetId, targetRole);
      return json(res, 200, { ok: true, members: await listMembers(s, projectId), myRole: role });
    }
    if (action === 'remove') {
      const targetId = String(body.userId || '').trim();
      if (!targetId) return json(res, 400, { ok: false, error: '缺少成员 ID' });
      if (targetId === auth.userId) return json(res, 400, { ok: false, error: '不能移除自己，请先转让负责人' });
      const membersList = await listMembers(s, projectId);
      const target = membersList.find((m) => m.user_id === targetId);
      if (!target) return json(res, 404, { ok: false, error: '成员不存在' });
      if (target.role === 'owner') return json(res, 400, { ok: false, error: '不能移除项目负责人，请先转让负责人' });
      await deleteMember(s, projectId, targetId);
      return json(res, 200, { ok: true, members: await listMembers(s, projectId), myRole: role });
    }
    if (action === 'setRole') {
      const targetId = String(body.userId || '').trim();
      const targetRole = String(body.role || '').toLowerCase() as MemberRole;
      if (!targetId) return json(res, 400, { ok: false, error: '缺少成员 ID' });
      if (!VALID_ROLES.includes(targetRole) || targetRole === 'owner') return json(res, 400, { ok: false, error: '角色只能是 editor 或 viewer' });
      if (targetId === auth.userId) return json(res, 400, { ok: false, error: '不能修改自己的角色' });
      const membersList = await listMembers(s, projectId);
      const target = membersList.find((m) => m.user_id === targetId);
      if (!target) return json(res, 404, { ok: false, error: '成员不存在' });
      if (target.role === 'owner') return json(res, 400, { ok: false, error: '不能修改项目负责人角色' });
      await upsertMember(s, projectId, targetId, targetRole);
      return json(res, 200, { ok: true, members: await listMembers(s, projectId), myRole: role });
    }
    return json(res, 400, { ok: false, error: '未知操作' });
  } catch (e) {
    return json(res, 500, { ok: false, error: e instanceof Error ? e.message : '成员管理失败' });
  }
}

// ---------- 推送（乐观并发） ----------
interface PushRow {
  id?: string;
  updatedAt?: string;
  cloudRevision?: number;
}

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

  const { data: existing, error: findError } = await s.from('projects').select('id, revision').eq('id', id).maybeSingle();
  if (findError) return { status: 'error', error: findError.message };
  if (!existing) {
    const { error: insertError } = await s.from('projects').insert({ id, user_id: userId, owner_id: userId, data, updated_at: updatedAt, revision: 1 });
    if (insertError) return { status: 'error', error: insertError.message };
    return { status: 'ok', revision: 1 };
  }
  const { data: updated, error: updateError } = await s
    .from('projects')
    .update({ data, updated_at: updatedAt, revision: existing.revision + 1 })
    .eq('id', id)
    .eq('revision', expected)
    .select('revision');
  if (updateError) return { status: 'error', error: updateError.message };
  if (updated && updated.length > 0) return { status: 'ok', revision: (updated[0] as { revision: number }).revision };
  const { data: currentRow, error: readError } = await s.from('projects').select('data, revision').eq('id', id).maybeSingle();
  if (readError) return { status: 'error', error: readError.message };
  return { status: 'conflict', current: currentRow ? { ...(currentRow.data as object), cloudRevision: currentRow.revision } : undefined };
}

async function push(req: VercelRequest, s: SupabaseClient, res: VercelResponse, auth: { userId: string }, body: Record<string, unknown>) {
  const projects = Array.isArray(body.projects) ? body.projects : [];
  if (projects.length === 0) return json(res, 200, { ok: true, pushed: 0, conflicts: [] });
  const service = getServiceSupabase();
  let pushed = 0;
  const conflicts: { id: string; cloud: unknown }[] = [];
  const errors: string[] = [];
  for (const raw of projects) {
    const row = raw as PushRow;
    if (!row.id) continue;
    const result = service ? await pushOneService(s, row, auth.userId) : await pushOneUser(s, row, auth.userId);
    if (result.status === 'ok') {
      pushed += 1;
    } else if (result.status === 'conflict') {
      conflicts.push({ id: row.id, cloud: result.current });
    } else {
      errors.push(`${row.id}: ${result.error}`);
    }
  }
  if (errors.length > 0) return json(res, 500, { ok: false, error: errors.join('；') });
  return json(res, 200, { ok: true, pushed, conflicts });
}

// ---------- 拉取（成员可见） ----------
async function pull(req: VercelRequest, s: SupabaseClient, res: VercelResponse, auth: { userId: string }) {
  const service = getServiceSupabase();
  let rows: { data: unknown; revision?: number }[] = [];
  if (service) {
    const { data: owned, error: ownedError } = await service.from('projects').select('data, revision').eq('owner_id', auth.userId);
    if (ownedError) return json(res, 500, { ok: false, error: ownedError.message });
    const { data: memberProjects, error: memberError } = await service.from('project_members').select('project_id').eq('user_id', auth.userId);
    if (memberError) return json(res, 500, { ok: false, error: memberError.message });
    const memberIds = [...new Set(((memberProjects ?? []) as { project_id: string }[]).map((r) => r.project_id))];
    let shared: { data: unknown; revision?: number }[] = [];
    if (memberIds.length > 0) {
      const { data: sharedRows, error: sharedError } = await service.from('projects').select('data, revision').in('id', memberIds);
      if (sharedError) return json(res, 500, { ok: false, error: sharedError.message });
      shared = (sharedRows ?? []) as { data: unknown; revision?: number }[];
    }
    rows = [...((owned ?? []) as { data: unknown; revision?: number }[]), ...shared];
  } else {
    const { data, error } = await s.from('projects').select('data, revision').order('updated_at', { ascending: false });
    if (error) return json(res, 500, { ok: false, error: error.message });
    rows = (data ?? []) as { data: unknown; revision?: number }[];
  }
  const seen = new Set<string>();
  const projects: unknown[] = [];
  for (const row of rows) {
    const raw = row.data as { id?: string } | null;
    if (!raw || typeof raw.id !== 'string' || seen.has(raw.id)) continue;
    seen.add(raw.id);
    projects.push({ ...raw, cloudRevision: row.revision ?? undefined });
  }
  projects.sort((a, b) => ((b as { updatedAt?: string }).updatedAt || '').localeCompare((a as { updatedAt?: string }).updatedAt || ''));
  return json(res, 200, { ok: true, projects });
}

// ---------- 删除 ----------
async function del(req: VercelRequest, s: SupabaseClient, res: VercelResponse, auth: { userId: string }, body: Record<string, unknown>) {
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter((x) => typeof x === 'string' && x))] as string[];
  if (ids.length === 0) return json(res, 200, { ok: true, deleted: 0 });
  const { data, error } = await s.from('projects').delete().in('id', ids).eq('owner_id', auth.userId);
  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true, deleted: (data ?? []).length });
}

const handlers: Record<string, (req: VercelRequest, s: SupabaseClient, res: VercelResponse, auth: { userId: string }, body: Record<string, unknown>) => Promise<unknown>> = {
  pull,
  push,
  delete: del,
  members,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as Record<string, unknown> & { token?: string; supabaseAccessToken?: string };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  // action 从路径最后一段取，需剥离 query（如 pull?action=pull 取 pull）
  const pathname = String(req.url || '').split('?')[0];
  const action = String(pathname.split('/').filter(Boolean).pop() ?? '').toLowerCase();
  const fn = handlers[action];
  if (!fn) return json(res, 400, { ok: false, error: `未知操作: ${action}` });

  const service = getServiceSupabase();
  const s = service ?? getUserSupabase(body.supabaseAccessToken);
  if (!s) return json(res, 200, { ok: true, projects: [], pushed: 0, deleted: 0, members: [], myRole: 'owner', cloudDisabled: true });

  await fn(req, s, res, { userId: auth.userId }, body);
}
