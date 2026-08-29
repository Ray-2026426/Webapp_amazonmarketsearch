import { getAuthToken, getSupabaseAccessToken } from './auth';

export type MemberRole = 'owner' | 'editor' | 'viewer';

export interface ProjectMemberInfo {
  user_id: string;
  role: MemberRole;
  email?: string | null;
  account?: string | null;
  created_at?: string;
  pending?: boolean;
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

const PENDING_INVITES_KEY_PREFIX = 'amzdev_pending_invites:';

function pendingKey(projectId: string): string {
  return `${PENDING_INVITES_KEY_PREFIX}${projectId}`;
}

function readPendingInvites(projectId: string): ProjectMemberInfo[] {
  try {
    const raw = localStorage.getItem(pendingKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item?.pending) : [];
  } catch {
    return [];
  }
}

function savePendingInvites(projectId: string, invites: ProjectMemberInfo[]): void {
  localStorage.setItem(pendingKey(projectId), JSON.stringify(invites));
}

function mergePending(projectId: string, members: ProjectMemberInfo[]): ProjectMemberInfo[] {
  const registeredEmails = new Set(members.map((m) => (m.email || '').toLowerCase()).filter(Boolean));
  return [
    ...members,
    ...readPendingInvites(projectId).filter((m) => !registeredEmails.has((m.email || '').toLowerCase())),
  ];
}

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
    return {
      ok: true,
      members: mergePending(projectId, body.members ?? []),
      myRole: body.myRole ?? null,
      cloudDisabled: body.cloudDisabled,
    };
  } catch (e) {
    return { ok: false, members: mergePending(projectId, []), myRole: null, error: e instanceof Error ? e.message : '获取成员失败' };
  }
}

export async function inviteProjectMember(
  projectId: string,
  email: string,
  role: Exclude<MemberRole, 'owner'>
): Promise<MembersResult> {
  const normalizedEmail = email.trim().toLowerCase();
  try {
    const body = await postMembers<{ ok?: boolean; members?: ProjectMemberInfo[]; myRole?: MemberRole; error?: string }>(
      { projectId, action: 'invite', email: normalizedEmail, role }
    );
    if (!body.ok) return { ok: false, members: [], myRole: null, error: body.error };
    return { ok: true, members: mergePending(projectId, body.members ?? []), myRole: body.myRole ?? null };
  } catch (e) {
    const message = e instanceof Error ? e.message : '邀请失败';
    if (/尚未注册|not registered|not found/i.test(message)) {
      const pending = readPendingInvites(projectId).filter((m) => (m.email || '').toLowerCase() !== normalizedEmail);
      pending.push({
        user_id: `pending:${normalizedEmail}`,
        role,
        email: normalizedEmail,
        account: '待注册成员',
        created_at: new Date().toISOString(),
        pending: true,
      });
      savePendingInvites(projectId, pending);
      const latest = await fetchProjectMembers(projectId);
      return latest.ok ? latest : { ok: true, members: pending, myRole: 'owner' };
    }
    return { ok: false, members: [], myRole: null, error: message };
  }
}

export async function removeProjectMember(projectId: string, userId: string): Promise<MembersResult> {
  try {
    if (userId.startsWith('pending:')) {
      savePendingInvites(projectId, readPendingInvites(projectId).filter((m) => m.user_id !== userId));
      const latest = await fetchProjectMembers(projectId);
      return latest.ok ? latest : { ok: true, members: readPendingInvites(projectId), myRole: 'owner' };
    }
    const body = await postMembers<{ ok?: boolean; members?: ProjectMemberInfo[]; myRole?: MemberRole; error?: string }>(
      { projectId, action: 'remove', userId }
    );
    if (!body.ok) return { ok: false, members: [], myRole: null, error: body.error };
    return { ok: true, members: mergePending(projectId, body.members ?? []), myRole: body.myRole ?? null };
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
    if (userId.startsWith('pending:')) {
      const pending = readPendingInvites(projectId).map((m) => (m.user_id === userId ? { ...m, role } : m));
      savePendingInvites(projectId, pending);
      const latest = await fetchProjectMembers(projectId);
      return latest.ok ? latest : { ok: true, members: pending, myRole: 'owner' };
    }
    const body = await postMembers<{ ok?: boolean; members?: ProjectMemberInfo[]; myRole?: MemberRole; error?: string }>(
      { projectId, action: 'setRole', userId, role }
    );
    if (!body.ok) return { ok: false, members: [], myRole: null, error: body.error };
    return { ok: true, members: mergePending(projectId, body.members ?? []), myRole: body.myRole ?? null };
  } catch (e) {
    return { ok: false, members: [], myRole: null, error: e instanceof Error ? e.message : '修改角色失败' };
  }
}
