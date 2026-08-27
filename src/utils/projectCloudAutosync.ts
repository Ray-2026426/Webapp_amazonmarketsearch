import { getAuthToken } from './auth';
import { clearPendingCloudDeletions, loadPendingCloudDeletions } from './cloudDeletionStore';
import { loadProjects, persistProjects } from './projectStore';
import { hydrateProjectsForCloud, restoreCloudDataToLocal } from './projectCloudBundle';
import { syncProjects, type SyncResult } from './cloudSync';

export interface ProjectCloudSyncResult {
  ok: boolean;
  error?: string;
  result?: SyncResult;
  restored?: number;
}

export async function syncUserProjectsToCloud(userId: string): Promise<ProjectCloudSyncResult> {
  if (!userId) return { ok: false, error: '缺少用户' };
  if (!getAuthToken()) {
    return { ok: false, error: '未登录' };
  }
  try {
    const local = await loadProjects(userId);
    const hydrated = await hydrateProjectsForCloud(userId, local);
    const pendingDeletions = await loadPendingCloudDeletions(userId);
    const res = await syncProjects(hydrated, pendingDeletions);
    if (!res.ok) return { ok: false, error: res.error };
    await persistProjects(userId, res.projects);
    const restored = await restoreCloudDataToLocal(userId, res.projects);
    if (pendingDeletions.length > 0 && !res.cloudDisabled && res.deleted >= pendingDeletions.length) {
      await clearPendingCloudDeletions(userId, pendingDeletions);
    }
    return { ok: true, result: res, restored };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '自动同步失败' };
  }
}
