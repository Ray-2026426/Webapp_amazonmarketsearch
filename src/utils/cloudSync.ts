// 云端同步层（Phase 3）：云身份 + 项目 push/pull/merge。
import { getSupabase } from './supabaseClient';
import { migrateProject } from './projectStore';
import type { ResearchProject } from '../types/researchProject';

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  deleted: number;
  conflicts: number;
  projects: ResearchProject[];
  error?: string;
}

export interface ProjectMergeResult {
  projects: ResearchProject[];
  conflicts: number;
}

const CLOUD_LOGIN_REQUIRED =
  '请先在「云端设置」登录云账号；如需沿用旧匿名模式，需要在 Supabase Auth 开启 Anonymous sign-ins';

/** 确保存在云会话：优先复用邮箱账号会话，未登录时尝试旧匿名模式作为兼容回退。 */
export async function ensureCloudSession(): Promise<boolean> {
  const s = getSupabase();
  if (!s) return false;
  const { data } = await s.auth.getSession();
  if (data.session) return true;
  const { error } = await s.auth.signInAnonymously();
  if (error) {
    console.error('anonymous sign-in failed:', error.message);
    return false;
  }
  return true;
}

interface ProjectRow {
  id: string;
  user_id: string;
  owner_id: string;
  data: ResearchProject;
  updated_at: string;
}

interface ProjectMemberRow {
  project_id: string;
  user_id: string;
  role: 'owner';
}

interface LegacyProjectRow {
  id: string;
  user_id: string;
  data: ResearchProject;
  updated_at: string;
}

export function buildCloudProjectRows(
  projects: ResearchProject[],
  cloudUserId: string
): { rows: ProjectRow[]; legacyRows: LegacyProjectRow[]; members: ProjectMemberRow[] } {
  const rows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    user_id: cloudUserId,
    owner_id: cloudUserId,
    data: p,
    updated_at: p.updatedAt,
  }));
  return {
    rows,
    legacyRows: rows.map(({ owner_id: _ownerId, ...r }) => r),
    members: rows.map((r) => ({
      project_id: r.id,
      user_id: r.owner_id,
      role: 'owner',
    })),
  };
}

function isMissingCloudPermissionsSchema(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('owner_id') ||
    text.includes('project_members') ||
    text.includes('schema cache') ||
    text.includes('relation "project_members" does not exist')
  );
}

export async function pushProjects(projects: ResearchProject[]): Promise<number> {
  const s = getSupabase();
  if (!s || projects.length === 0) return 0;
  const ok = await ensureCloudSession();
  if (!ok) throw new Error(CLOUD_LOGIN_REQUIRED);
  const { data } = await s.auth.getUser();
  if (!data.user) throw new Error('未获取到云用户');
  const { rows, legacyRows, members } = buildCloudProjectRows(projects, data.user.id);
  const { error } = await s.from('projects').upsert(rows, { onConflict: 'id' });
  if (error) {
    if (!isMissingCloudPermissionsSchema(error.message)) throw new Error(error.message);
    const { error: legacyError } = await s.from('projects').upsert(legacyRows, { onConflict: 'id' });
    if (legacyError) throw new Error(legacyError.message);
    return legacyRows.length;
  }
  const { error: memberError } = await s.from('project_members').upsert(members, { onConflict: 'project_id,user_id' });
  if (memberError && !isMissingCloudPermissionsSchema(memberError.message)) {
    throw new Error(memberError.message);
  }
  return rows.length;
}

export async function pullProjects(): Promise<ResearchProject[]> {
  const s = getSupabase();
  if (!s) return [];
  const ok = await ensureCloudSession();
  if (!ok) throw new Error(CLOUD_LOGIN_REQUIRED);
  const { data, error } = await s
    .from('projects')
    .select('data')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { data: unknown }[])
    .map((r) => migrateProject(r.data))
    .filter((p): p is ResearchProject => p !== null);
}

export async function deleteCloudProjects(projectIds: string[]): Promise<number> {
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const s = getSupabase();
  if (!s) throw new Error('未配置云端');
  const ok = await ensureCloudSession();
  if (!ok) throw new Error(CLOUD_LOGIN_REQUIRED);
  const { error } = await s.from('projects').delete().in('id', ids);
  if (error) throw new Error(error.message);
  return ids.length;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) output[key] = canonicalize(input[key]);
    return output;
  }
  return value;
}

function sameProject(a: ResearchProject, b: ResearchProject): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function conflictCopy(project: ResearchProject, side: 'local' | 'cloud'): ResearchProject {
  const stamp = (project.updatedAt || 'unknown').replace(/[^0-9A-Za-z]/g, '').slice(0, 20);
  return {
    ...project,
    id: `${project.id}_conflict_${side}_${stamp || 'unknown'}`,
    name: `${project.name}（冲突副本）`,
    status: 'draft',
    version: 1,
  };
}

/**
 * Merge whole-project snapshots. A higher version wins. When both sides changed
 * to the same version, keep the newer snapshot as the primary project and save
 * the other side as a deterministic conflict copy instead of silently losing it.
 */
export function mergeProjectSets(
  local: ResearchProject[],
  cloud: ResearchProject[]
): ProjectMergeResult {
  const merged = new Map<string, ResearchProject>();
  let conflicts = 0;
  for (const p of local) merged.set(p.id, p);
  for (const remote of cloud) {
    const current = merged.get(remote.id);
    if (!current) {
      merged.set(remote.id, remote);
      continue;
    }
    if (sameProject(current, remote)) continue;

    if (current.version !== remote.version) {
      if (remote.version > current.version) merged.set(remote.id, remote);
      continue;
    }

    conflicts += 1;
    const remoteWins = (remote.updatedAt || '') > (current.updatedAt || '');
    const winner = remoteWins ? remote : current;
    const loser = remoteWins ? current : remote;
    const loserSide = remoteWins ? 'local' : 'cloud';
    merged.set(remote.id, winner);
    const copy = conflictCopy(loser, loserSide);
    if (!merged.has(copy.id)) merged.set(copy.id, copy);
  }
  return {
    projects: [...merged.values()].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    conflicts,
  };
}

/** Pull, merge, preserve conflicts, apply pending deletions, then push. */
export async function syncProjects(
  local: ResearchProject[],
  pendingDeletionIds: string[] = []
): Promise<SyncResult> {
  if (!getSupabase()) {
    return { ok: false, pushed: 0, pulled: 0, deleted: 0, conflicts: 0, projects: local, error: '未配置云端' };
  }
  try {
    const deleted = await deleteCloudProjects(pendingDeletionIds);
    const cloud = await pullProjects();
    const deletedSet = new Set(pendingDeletionIds);
    const merge = mergeProjectSets(
      local.filter((p) => !deletedSet.has(p.id)),
      cloud.filter((p) => !deletedSet.has(p.id))
    );
    const pushed = await pushProjects(merge.projects);
    return {
      ok: true,
      pushed,
      pulled: cloud.length,
      deleted,
      conflicts: merge.conflicts,
      projects: merge.projects,
    };
  } catch (e) {
    return {
      ok: false,
      pushed: 0,
      pulled: 0,
      deleted: 0,
      conflicts: 0,
      projects: local,
      error: e instanceof Error ? e.message : '同步失败',
    };
  }
}
