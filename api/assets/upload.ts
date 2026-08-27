import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceSupabase, getUserSupabase, verifyToken, json } from '../auth/_shared.js';

const BUCKET = 'project-assets';

function assetPath(projectId: string, name: string): string {
  return `${String(projectId || '').replace(/[^A-Za-z0-9_-]/g, '')}/${String(name || '').replace(/[^A-Za-z0-9._-]/g, '')}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = (req.body ?? {}) as { token?: string; supabaseAccessToken?: string; projectId?: string; name?: string; text?: string; contentType?: string };
  const auth = verifyToken(String(body.token || ''));
  if (!auth) return json(res, 401, { ok: false, error: '未登录' });

  const projectId = String(body.projectId || '').trim();
  const name = String(body.name || '').trim();
  const text = String(body.text ?? '');
  if (!projectId || !name) return json(res, 400, { ok: false, error: '缺少项目或文件名' });
  if (text.length > 4 * 1024 * 1024) return json(res, 413, { ok: false, error: '文件过大（上限 4MB）' });

  const service = getServiceSupabase();
  const s = service ?? getUserSupabase(body.supabaseAccessToken);
  if (!s) return json(res, 200, { ok: false, cloudDisabled: true, error: '云同步未配置' });

  const path = assetPath(projectId, name);
  const contentType = String(body.contentType || 'text/plain; charset=utf-8');
  const { error } = await s.storage.from(BUCKET).upload(path, new Blob([text], { type: contentType }), {
    contentType,
    upsert: true,
  });
  if (error) return json(res, 500, { ok: false, error: error.message });
  return json(res, 200, { ok: true, storagePath: `${BUCKET}/${path}` });
}
