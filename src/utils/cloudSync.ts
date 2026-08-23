// 云端同步层（Phase 3）：匿名登录 + 项目 push/pull/merge。
import { getSupabase } from './supabaseClient';
import type { ResearchProject } from '../types/researchProject';

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
}

/** 建立匿名云会话（需要 Supabase 项目开启匿名登录）。 */
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
  data: ResearchProject;
  updated_at: string;
}

export async function pushProjects(projects: ResearchProject[]): Promise<number> {
  const s = getSupabase();
  if (!s || projects.length === 0) return 0;
  const ok = await ensureCloudSession();
  if (!ok) throw new Error('云会话建立失败（请确认 Supabase 已开启匿名登录）');
  const { data } = await s.auth.getUser();
  if (!data.user) throw new Error('未获取到云用户');
  const rows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    user_id: data.user!.id,
    data: p,
    updated_at: p.updatedAt,
  }));
  const { error } = await s.from('projects').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return rows.length;
}

export async function pullProjects(): Promise<ResearchProject[]> {
  const s = getSupabase();
  if (!s) return [];
  const ok = await ensureCloudSession();
  if (!ok) throw new Error('云会话建立失败');
  const { data, error } = await s
    .from('projects')
    .select('data')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { data: ResearchProject }[]).map((r) => r.data);
}

/** 本地与云端按 id 合并，updatedAt 更新者优先。 */
export async function syncProjects(local: ResearchProject[]): Promise<SyncResult> {
  if (!getSupabase()) return { ok: false, pushed: 0, pulled: 0, error: '未配置云端' };
  try {
    const cloud = await pullProjects();
    const merged = new Map<string, ResearchProject>();
    for (const p of local) merged.set(p.id, p);
    for (const p of cloud) {
      const l = merged.get(p.id);
      if (!l || (p.updatedAt && l.updatedAt && p.updatedAt > l.updatedAt)) merged.set(p.id, p);
    }
    const mergedList = [...merged.values()];
    const pushed = await pushProjects(mergedList);
    return { ok: true, pushed, pulled: cloud.length };
  } catch (e) {
    return { ok: false, pushed: 0, pulled: 0, error: e instanceof Error ? e.message : '同步失败' };
  }
}
