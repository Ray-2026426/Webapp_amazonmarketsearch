// 云同步层：客户端只和后端 API 通信，后端用 service_role 按 owner_id 隔离数据。
import { migrateProject } from './projectStore';
import { getAuthToken } from './auth';
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

async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new Error('未登录');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, token }),
  });
  const body = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    const err = (body as { error?: string }).error;
    throw new Error(err || '请求失败');
  }
  return body;
}

export async function pullProjects(): Promise<ResearchProject[]> {
  const body = await postJson<{ ok?: boolean; projects?: unknown[] }>('/api/projects/pull', {});
  if (!body.ok) return [];
  return ((body.projects ?? []) as unknown[])
    .map((r) => migrateProject(r))
    .filter((p): p is ResearchProject => p !== null);
}

export async function pushProjects(projects: ResearchProject[]): Promise<number> {
  if (projects.length === 0) return 0;
  const body = await postJson<{ ok?: boolean; pushed?: number }>('/api/projects/push', { projects });
  return body.ok ? (body.pushed ?? 0) : 0;
}

export async function deleteCloudProjects(projectIds: string[]): Promise<number> {
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const body = await postJson<{ ok?: boolean; deleted?: number }>('/api/projects/delete', { ids });
  return body.ok ? (body.deleted ?? 0) : 0;
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

function isConflictCopyId(id: string): boolean {
  return id.includes('_conflict_');
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

    if (isConflictCopyId(remote.id)) {
      const newer = (remote.updatedAt || '') >= (current.updatedAt || '') ? remote : current;
      merged.set(remote.id, newer);
      continue;
    }

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
  if (!getAuthToken()) {
    return { ok: false, pushed: 0, pulled: 0, deleted: 0, conflicts: 0, projects: local, error: '未登录' };
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