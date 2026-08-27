import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, getUserSupabase, verifyToken, json } from '../auth/_shared.js';

const BUCKET = 'project-assets';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string; supabaseAccessToken?: string; projectId?: string };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const projectId = String(body.projectId || '').trim();
  if (!projectId) return json(res, 400, { ok: false, error: '缺少项目 ID' });

  const service = getServiceSupabase();
  const s = service ?? getUserSupabase(body.supabaseAccessToken);
  if (!s) return json(res, 200, { ok: false, cloudDisabled: true, error: '云同步未配置' });

  // 级联删除：清空该项目前缀下的全部对象（owner 权限由 RLS / service_role 保证）。
  const listAll: string[] = [];
  // storage list 按目录返回，需要逐层收集顶层对象；本项目资产扁平存放，列出 projectId 前缀即可。
  const { data: entries, error: listError } = await s.storage.from(BUCKET).list(projectId, { limit: 1000 });
  if (listError) return json(res, 500, { ok: false, error: listError.message });
  for (const entry of entries ?? []) {
    if (entry.id) listAll.push(`${projectId}/${entry.name}`);
  }
  let removed = 0;
  if (listAll.length > 0) {
    const { data, error: removeError } = await s.storage.from(BUCKET).remove(listAll);
    if (removeError) return json(res, 500, { ok: false, error: removeError.message });
    removed = (data ?? []).length;
  }
  return json(res, 200, { ok: true, removed });
}
