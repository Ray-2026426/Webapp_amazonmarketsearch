// 项目成员管理客户端封装（PRD Phase 3：成员邀请/移除/角色调整）。
import { getAuthToken, getSupabaseAccessToken } from './auth';

export type MemberRole = 'owner' | 'editor' | 'viewer';

export interface ProjectMemberInfo {
  user_id: string;
  role: MemberRole;
  email?: string | null;
  account?: string | null;
  created_at?: string;
}

export interface MembersResult {
  ok: boolean;
  members: ProjectMemberInfo[];
  myRole: MemberRole | null;
  cloudDisabled?: boolean;
  error?: string;
}

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: '负责人',
  editor: '可编辑',
  viewer: '只读',
};

async function postMembers<T>(payload: Record<string, unknown>): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new Error('未登录');
  const res = await fetch('/api/projects/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, token, supabaseAccessToken: getSupabaseAccessToken() }),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || '成员操作失败');
  }
  return body;
}

export async function fetchProjectMembers(projectId: string): Promise<MembersResult> {
  try {
    const body = await postMembers<{ ok?: boolean; members?: ProjectMemberInfo[]; myRole?: MemberRole; cloudDisabled?: boolean; error?: string }>(
      { projectId, action: 'list' }
    );
    if (!body.ok) return { ok: false, members: [], myRole: null, error: body.error };
    return { ok: true, members: body.members ?? [], myRole: body.myRole ?? null, cloudDisabled: body.cloudDisabled };
  } catch (e) {
    return { ok: false, members: [], myRole: null, error: e instanceof Error ? e.message : '获取成员失败' };
  }
}

export async function inviteProjectMember(
  projectId: string,
  email: string,
  role: Exclude<MemberRole, 'owner'>
): Promise<MembersResult> {
  try {
    const body = await postMembers<{ ok?: boolean; members?: ProjectMemberInfo[]; myRole?: MemberRole; error?: string }>(
      { projectId, action: 'invite', email, role }
    );
    if (!body.ok) return { ok: false, members: [], myRole: null, error: body.error };
    return { ok: true, members: body.members ?? [], myRole: body.myRole ?? null };
  } catch (e) {
    return { ok: false, members: [], myRole: null, error: e instanceof Error ? e.message : '邀请失败' };
  }
}

export async function removeProjectMember(projectId: string, userId: string): Promise<MembersResult> {
  try {
    const body = await postMembers<{ ok?: boolean; members?: ProjectMemberInfo[]; myRole?: MemberRole; error?: string }>(
      { projectId, action: 'remove', userId }
    );
    if (!body.ok) return { ok: false, members: [], myRole: null, error: body.error };
    return { ok: true, members: body.members ?? [], myRole: body.myRole ?? null };
  } catch (e) {
    return { ok: false, members: [], myRole: null, error: e instanceof Error ? e.message : '移除失败' };
  }
}

export async function setProjectMemberRole(
  projectId: string,
  userId: string,
  role: Exclude<MemberRole, 'owner'>
): Promise<MembersResult> {
  try {
    const body = await postMembers<{ ok?: boolean; members?: ProjectMemberInfo[]; myRole?: MemberRole; error?: string }>(
      { projectId, action: 'setRole', userId, role }
    );
    if (!body.ok) return { ok: false, members: [], myRole: null, error: body.error };
    return { ok: true, members: body.members ?? [], myRole: body.myRole ?? null };
  } catch (e) {
    return { ok: false, members: [], myRole: null, error: e instanceof Error ? e.message : '修改角色失败' };
  }
}
