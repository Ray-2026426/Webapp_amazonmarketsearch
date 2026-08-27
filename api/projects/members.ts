import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase, getUserSupabase, verifyToken, json } from '../auth/_shared.js';

type MemberRole = 'owner' | 'editor' | 'viewer';

const VALID_ROLES: MemberRole[] = ['owner', 'editor', 'viewer'];

interface MemberRow {
  user_id: string;
  role: string;
  email?: string | null;
  account?: string | null;
  created_at?: string;
}

/**
 * 当前用户在项目中的角色：
 * - service_role 模式：手动查 project_members，owner_id bootstrap 视为 owner。
 * - user token 模式：RLS 已生效，仍手动查一次以获得统一语义。
 */
async function currentRole(s: SupabaseClient, projectId: string, userId: string): Promise<MemberRole | null> {
  const { data, error } = await s
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!error && data && VALID_ROLES.includes(data.role as MemberRole)) {
    return data.role as MemberRole;
  }
  // bootstrap：项目 owner_id 但成员行缺失（旧 001/002 迁移数据）
  const { data: ownerRow, error: ownerError } = await s
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!ownerError && ownerRow && ownerRow.owner_id === userId) return 'owner';
  return null;
}

/** 成员列表（owner/editor/viewer 均可读，owner 优先排序）。 */
async function listMembers(s: SupabaseClient, projectId: string): Promise<MemberRow[]> {
  const { data, error } = await s.rpc('project_members_with_info', { p_project_id: projectId });
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberRow[];
}

/** 按邮箱/账号解析 Supabase 用户 id；找不到返回 null。 */
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as {
    token?: string;
    supabaseAccessToken?: string;
    projectId?: string;
    action?: string;
    email?: string;
    userId?: string;
    role?: string;
  };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const projectId = String(body.projectId || '').trim();
  if (!projectId) return json(res, 400, { ok: false, error: '缺少项目 ID' });

  const s = getServiceSupabase() ?? getUserSupabase(body.supabaseAccessToken);
  if (!s) return json(res, 200, { ok: true, cloudDisabled: true, members: [], myRole: 'owner' });

  const action = String(body.action || 'list');
  try {
    const role = await currentRole(s, projectId, auth.userId);
    if (!role) return json(res, 403, { ok: false, error: '你不是该项目成员' });

    if (action === 'list') {
      const members = await listMembers(s, projectId);
      return json(res, 200, { ok: true, members, myRole: role });
    }

    // 以下操作仅 owner
    if (role !== 'owner') return json(res, 403, { ok: false, error: '只有项目负责人可以管理成员' });

    if (action === 'invite') {
      const email = String(body.email || '').trim();
      const targetRole = (String(body.role || 'viewer').toLowerCase() as MemberRole);
      if (!email) return json(res, 400, { ok: false, error: '请输入对方邮箱' });
      if (!VALID_ROLES.includes(targetRole) || targetRole === 'owner') {
        return json(res, 400, { ok: false, error: '角色只能是 editor 或 viewer' });
      }
      const targetId = await resolveUserIdByEmail(s, email);
      if (!targetId) return json(res, 404, { ok: false, error: '该邮箱尚未注册云账号' });
      if (targetId === auth.userId) return json(res, 400, { ok: false, error: '不能邀请自己' });
      await upsertMember(s, projectId, targetId, targetRole);
      const members = await listMembers(s, projectId);
      return json(res, 200, { ok: true, members, myRole: role });
    }

    if (action === 'remove') {
      const targetId = String(body.userId || '').trim();
      if (!targetId) return json(res, 400, { ok: false, error: '缺少成员 ID' });
      if (targetId === auth.userId) return json(res, 400, { ok: false, error: '不能移除自己，请先转让负责人' });
      const members = await listMembers(s, projectId);
      const target = members.find((m) => m.user_id === targetId);
      if (!target) return json(res, 404, { ok: false, error: '成员不存在' });
      if (target.role === 'owner') return json(res, 400, { ok: false, error: '不能移除项目负责人，请先转让负责人' });
      await deleteMember(s, projectId, targetId);
      const updated = await listMembers(s, projectId);
      return json(res, 200, { ok: true, members: updated, myRole: role });
    }

    if (action === 'setRole') {
      const targetId = String(body.userId || '').trim();
      const targetRole = (String(body.role || '').toLowerCase() as MemberRole);
      if (!targetId) return json(res, 400, { ok: false, error: '缺少成员 ID' });
      if (!VALID_ROLES.includes(targetRole) || targetRole === 'owner') {
        return json(res, 400, { ok: false, error: '角色只能是 editor 或 viewer' });
      }
      if (targetId === auth.userId) return json(res, 400, { ok: false, error: '不能修改自己的角色' });
      const members = await listMembers(s, projectId);
      const target = members.find((m) => m.user_id === targetId);
      if (!target) return json(res, 404, { ok: false, error: '成员不存在' });
      if (target.role === 'owner') return json(res, 400, { ok: false, error: '不能修改项目负责人角色' });
      await upsertMember(s, projectId, targetId, targetRole);
      const updated = await listMembers(s, projectId);
      return json(res, 200, { ok: true, members: updated, myRole: role });
    }

    return json(res, 400, { ok: false, error: '未知操作' });
  } catch (e) {
    return json(res, 500, { ok: false, error: e instanceof Error ? e.message : '成员管理失败' });
  }
}
