import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase, getUserSupabase, verifyToken, json } from '../auth/_shared.js';

const BUCKET = 'project-assets';

async function upload(s: SupabaseClient, res: VercelResponse, body: Record<string, unknown>) {
  const { projectId, name, text, contentType } = body as { projectId?: string; name?: string; text?: string; contentType?: string };
  const pid = String(projectId || '').trim();
  const nm = String(name || '').trim();
  const txt = String(text ?? '');
  if (!pid || !nm) return json(res, 400, { ok: false, error: '缺少项目或文件名' });
  if (txt.length > 4 * 1024 * 1024) return json(res, 413, { ok: false, error: '文件过大（上限 4MB）' });
  const path = `${pid.replace(/[^A-Za-z0-9_-]/g, '')}/${nm.replace(/[^A-Za-z0-9._-]/g, '')}`;
  const ct = String(contentType || 'text/plain; charset=utf-8');
  const { error } = await s.storage.from(BUCKET).upload(path, new Blob([txt], { type: ct }), { contentType: ct, upsert: true });
  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true, storagePath: `${BUCKET}/${path}` });
}

async function download(s: SupabaseClient, res: VercelResponse, body: Record<string, unknown>) {
  const storagePath = String(body.storagePath || '').trim();
  if (!storagePath.startsWith(`${BUCKET}/`)) return json(res, 400, { ok: false, error: '无效的存储路径' });
  const path = storagePath.slice(BUCKET.length + 1);
  if (!path) return json(res, 400, { ok: false, error: '无效的存储路径' });
  const { data, error } = await s.storage.from(BUCKET).download(path);
  if (error) return json(res, 404, { ok: false, error: '文件不存在或无权访问' });
  const text = await data.text().catch(() => null);
  if (text === null) return json(res, 500, { ok: false, error: '读取文件失败' });
  return json(res, 200, { ok: true, text });
}

async function purge(s: SupabaseClient, res: VercelResponse, body: Record<string, unknown>) {
  const projectId = String(body.projectId || '').trim();
  if (!projectId) return json(res, 400, { ok: false, error: '缺少项目 ID' });
  const { data: entries, error: listError } = await s.storage.from(BUCKET).list(projectId, { limit: 1000 });
  if (listError) return json(res, 500, { ok: false, error: listError.message });
  const listAll: string[] = [];
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

async function del(s: SupabaseClient, res: VercelResponse, body: Record<string, unknown>) {
  const storagePath = String(body.storagePath || '').trim();
  if (!storagePath.startsWith(`${BUCKET}/`)) return json(res, 400, { ok: false, error: '无效的存储路径' });
  const path = storagePath.slice(BUCKET.length + 1);
  if (!path) return json(res, 400, { ok: false, error: '无效的存储路径' });
  const { data, error } = await s.storage.from(BUCKET).remove([path]);
  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true, removed: (data ?? []).length });
}

const handlers: Record<string, (s: SupabaseClient, res: VercelResponse, body: Record<string, unknown>) => Promise<void>> = {
  upload,
  download,
  purge,
  delete: del,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as Record<string, unknown> & { token?: string; supabaseAccessToken?: string; action?: string };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  // action 优先级：body.action > URL 最后一段（动态路由 /api/assets/{action}）
  const action = String(body.action || (req.url?.split('/').filter(Boolean).pop() ?? '')).toLowerCase();
  const fn = handlers[action];
  if (!fn) return json(res, 400, { ok: false, error: `未知操作: ${action}` });

  const service = getServiceSupabase();
  const s = service ?? getUserSupabase(body.supabaseAccessToken);
  if (!s) return json(res, 200, { ok: false, cloudDisabled: true, error: '云同步未配置' });

  await fn(s, res, body);
}
