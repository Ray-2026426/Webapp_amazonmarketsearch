// 项目资产（Storage）客户端封装：大型报告正文入云，避免撑爆 projects.data jsonb。
// 走后端 API（service_role / user token），与云同步同一认证通道。
import { getAuthToken, getSupabaseAccessToken } from './auth';

export const ASSET_BUCKET = 'project-assets';

/** 报告正文超过该阈值时，从 projects.data.cloudData.reports 移出、转存 Storage。 */
export const REPORT_STORAGE_THRESHOLD = 20_000;

/** 报告正文的稳定存储路径（按 reportId 派生，upsert 覆盖，幂等）。 */
export function reportStoragePath(projectId: string, reportId: string): string {
  const safeProject = String(projectId || '').replace(/[^A-Za-z0-9_-]/g, '');
  const safeReport = String(reportId || '').replace(/[^A-Za-z0-9_-]/g, '');
  return `${ASSET_BUCKET}/reports/${safeProject}/${safeReport}.md`;
}

export function reportPathInBucket(storagePath: string): string {
  return String(storagePath || '').startsWith(`${ASSET_BUCKET}/`)
    ? String(storagePath || '').slice(ASSET_BUCKET.length + 1)
    : String(storagePath || '');
}

async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new Error('未登录');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, token, supabaseAccessToken: getSupabaseAccessToken() }),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || '请求失败');
  return body;
}

/** 上传文本资产；返回 storagePath，失败返回 null（调用方降级保留内联正文）。 */
export async function uploadProjectAssetText(
  projectId: string,
  name: string,
  text: string,
  contentType = 'text/markdown; charset=utf-8'
): Promise<string | null> {
  if (!text) return null;
  try {
    const body = await postJson<{ ok?: boolean; storagePath?: string; cloudDisabled?: boolean }>('/api/assets/upload', {
      projectId,
      name,
      text,
      contentType,
    });
    return body.ok ? (body.storagePath ?? null) : null;
  } catch {
    return null;
  }
}

/** 下载文本资产；失败返回 null。 */
export async function downloadProjectAssetText(storagePath: string): Promise<string | null> {
  if (!storagePath) return null;
  try {
    const body = await postJson<{ ok?: boolean; text?: string }>('/api/assets/download', { storagePath });
    return body.ok ? (body.text ?? null) : null;
  } catch {
    return null;
  }
}

/** 级联删除某项目全部资产（删除项目时调用）。 */
export async function purgeProjectAssets(projectId: string): Promise<{ ok: boolean; removed: number }> {
  try {
    const body = await postJson<{ ok?: boolean; removed?: number }>('/api/assets/purge', { projectId });
    return { ok: Boolean(body.ok), removed: body.removed ?? 0 };
  } catch {
    return { ok: false, removed: 0 };
  }
}

/** 删除单个资产（删除报告/附件时调用）。 */
export async function deleteProjectAsset(storagePath: string): Promise<boolean> {
  if (!storagePath) return false;
  try {
    const body = await postJson<{ ok?: boolean }>('/api/assets/delete', { storagePath });
    return Boolean(body.ok);
  } catch {
    return false;
  }
}
