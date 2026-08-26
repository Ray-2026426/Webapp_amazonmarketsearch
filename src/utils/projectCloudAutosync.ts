import { isCloudConfigured } from './supabaseClient';
import { loadProjects, persistProjects } from './projectStore';
import { hydrateProjectsForCloud, restoreCloudDataToLocal } from './projectCloudBundle';
import { syncProjects } from './cloudSync';
import { connectBackendCloudSession } from './cloudAuth';

export async function syncUserProjectsToCloud(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!userId) return { ok: false, error: '缺少用户' };
  if (!isCloudConfigured()) {
    const connected = await connectBackendCloudSession();
    if (!connected) return { ok: false, error: '未配置云端' };
  }
  try {
    const local = await loadProjects(userId);
    const hydrated = await hydrateProjectsForCloud(userId, local);
    const res = await syncProjects(hydrated);
    if (!res.ok) return { ok: false, error: res.error };
    await persistProjects(userId, res.projects);
    await restoreCloudDataToLocal(userId, res.projects);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '自动同步失败' };
  }
}
