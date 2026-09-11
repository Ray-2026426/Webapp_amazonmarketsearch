// 云同步层：客户端只和后端 API 通信，后端用 service_role 按 owner_id 隔离数据。
import { migrateProject } from './projectStore';
import { getAuthToken, getSupabaseAccessToken } from './auth';
import type { ResearchProject } from '../types/researchProject';

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  deleted: number;
  conflicts: number;
  projects: ResearchProject[];
  cloudDisabled?: boolean;
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
    body: JSON.stringify({ ...payload, token, supabaseAccessToken: getSupabaseAccessToken() }),
  });
  const body = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    const err = (body as { error?: string }).error;
    throw new Error(err || '请求失败');
  }
  return body;
}

export interface PullOutcome {
  projects: ResearchProject[];
  cloudDisabled: boolean;
}

export async function pullProjects(): Promise<PullOutcome> {
  const body = await postJson<{ ok?: boolean; projects?: unknown[]; cloudDisabled?: boolean }>('/api/projects/pull', {});
  return {
    projects: body.ok
      ? ((body.projects ?? []) as unknown[])
          .map((r) => migrateProject(r))
          .filter((p): p is ResearchProject => p !== null)
      : [],
    cloudDisabled: Boolean(body.cloudDisabled),
  };
}

export interface PushOutcome {
  pushed: number;
  cloudDisabled: boolean;
  /** 云端版本比本地新而被拒绝的项目：key 为项目 id，value 为云端完整项目（含 cloudRevision）。 */
  conflicts: { id: string; cloud: unknown }[];
}

export async function pushProjects(projects: ResearchProject[]): Promise<PushOutcome> {
  if (projects.length === 0) return { pushed: 0, cloudDisabled: false, conflicts: [] };
  const body = await postJson<{ ok?: boolean; pushed?: number; cloudDisabled?: boolean; conflicts?: { id: string; cloud: unknown }[] }>(
    '/api/projects/push',
    { projects }
  );
  return {
    pushed: body.ok ? (body.pushed ?? 0) : 0,
    cloudDisabled: Boolean(body.cloudDisabled),
    conflicts: body.ok ? (body.conflicts ?? []) : [],
  };
}

export interface CloudDeleteResult {
  deleted: number;
  cloudDisabled: boolean;
}

export async function deleteCloudProjects(projectIds: string[]): Promise<CloudDeleteResult> {
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return { deleted: 0, cloudDisabled: false };
  const body = await postJson<{ ok?: boolean; deleted?: number; cloudDisabled?: boolean }>('/api/projects/delete', { ids });
  return body.ok ? { deleted: body.deleted ?? 0, cloudDisabled: Boolean(body.cloudDisabled) } : { deleted: 0, cloudDisabled: false };
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      // cloudRevision 是服务端乐观锁元数据，内容相同但 revision 不同不算分叉。
      if (key === 'cloudRevision') continue;
      output[key] = canonicalize(input[key]);
    }
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

/** 判断项目是否属于某个待删 id（含其冲突副本），用于删除后彻底剔除，避免「删了复活」。 */
function matchesPendingDeletion(p: ResearchProject, deletedSet: Set<string>): boolean {
  if (deletedSet.has(p.id)) return true;
  // 冲突副本 id 形如 `${原始id}_conflict_{side}_{stamp}`，剥离后半段后是否能命中待删 id
  const conflictIdx = p.id.indexOf('_conflict_');
  if (conflictIdx >= 0) {
    const baseId = p.id.slice(0, conflictIdx);
    if (deletedSet.has(baseId)) return true;
  }
  return false;
}

/** 过滤掉待删项目及其冲突副本（用于最终持久化前的硬剔除，杜绝复活）。 */
export function dropPendingDeletions(
  projects: ResearchProject[],
  pendingDeletionIds: string[]
): ResearchProject[] {
  const deletedSet = new Set(pendingDeletionIds);
  return projects.filter((p) => !matchesPendingDeletion(p, deletedSet));
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
/** 把服务端拒绝的冲突项目（云端版本）回灌合并，保留本地冲突副本。返回合并结果与冲突数。 */
export function reconcilePushConflicts(
  merged: ResearchProject[],
  cloudWinners: ResearchProject[]
): ProjectMergeResult {
  if (cloudWinners.length === 0) return { projects: merged, conflicts: 0 };
  return mergeProjectSets(merged, cloudWinners);
}

/** Pull, merge, preserve conflicts, apply pending deletions, then push with optimistic concurrency. */
export async function syncProjects(
  local: ResearchProject[],
  pendingDeletionIds: string[] = []
): Promise<SyncResult> {
  if (!getAuthToken()) {
    return { ok: false, pushed: 0, pulled: 0, deleted: 0, conflicts: 0, projects: local, error: '未登录' };
  }
  try {
    const deletion = await deleteCloudProjects(pendingDeletionIds);
    const pull = await pullProjects();
    const cloud = pull.projects;
    const deletedSet = new Set(pendingDeletionIds);
    const merge = mergeProjectSets(
      local.filter((p) => !matchesPendingDeletion(p, deletedSet)),
      cloud.filter((p) => !matchesPendingDeletion(p, deletedSet))
    );
    const pushOutcome = await pushProjects(merge.projects);
    // 任一环节报告云后端关闭，即整体标记为未启用（避免掩盖跨设备不同步的根因）。
    const cloudDisabled = deletion.cloudDisabled || pull.cloudDisabled || pushOutcome.cloudDisabled;
    let conflicts = merge.conflicts;

    // 乐观并发：服务端拒绝的冲突项目，用云端版本替换本地，并保留本地冲突副本后二次推送。
    if (pushOutcome.conflicts.length > 0) {
      const cloudWinners = pushOutcome.conflicts
        .map((c) => migrateProject(c.cloud))
        .filter((p): p is ResearchProject => p !== null);
      const mergedAgain = reconcilePushConflicts(merge.projects, cloudWinners);
      conflicts += mergedAgain.conflicts;
      await pushProjects(mergedAgain.projects);
      return {
        ok: true,
        pushed: pushOutcome.pushed + mergedAgain.projects.length,
        pulled: cloud.length,
        deleted: deletion.deleted,
        conflicts,
        // 硬剔除待删项目及其冲突副本，杜绝「删了复活」
        projects: dropPendingDeletions(mergedAgain.projects, pendingDeletionIds),
        cloudDisabled,
      };
    }

    return {
      ok: true,
      pushed: pushOutcome.pushed,
      pulled: cloud.length,
      deleted: deletion.deleted,
      conflicts,
      projects: dropPendingDeletions(merge.projects, pendingDeletionIds),
      cloudDisabled,
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
