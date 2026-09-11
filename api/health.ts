import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCloudConfigStatus, getPublicSupabase, json } from './auth/_shared.js';

/**
 * M0 配置自检端点。
 *
 * 目的：把"登录失败"这种不可诊断的笼统错误，变成"明确指出缺哪一项配置"。
 * 安全：只返回「是否配置 / 主机名 / 缺失项」，**永不回显任何密钥值**。
 *
 * GET /api/health             → 配置自检（快，不发外部请求）
 * GET /api/health?probe=1     → 附带一次 Supabase 连通性探测
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });

  const status = getCloudConfigStatus();
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';

  const body: Record<string, unknown> = {
    ok: true,
    service: 'kairo',
    environment: env,
    gitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
    ready: status.ready,
    config: status,
  };

  const wantProbe = String((req.query?.probe as string) || '') === '1';
  if (wantProbe) {
    if (!status.ready) {
      body.probe = { attempted: false, reachable: false, reason: '未配置 SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY' };
    } else {
      const started = Date.now();
      try {
        const client = getPublicSupabase();
        // 最轻量的连通性探测：只取 1 行、只要 PK；失败即视为不可达
        const { error } = await client!.from('projects').select('id').limit(1);
        body.probe = {
          attempted: true,
          reachable: !error,
          ms: Date.now() - started,
          error: error ? error.message : null,
          hint: error
            ? 'Supabase 可达但查询失败：通常是数据库迁移未执行（请跑 supabase/migrations/all_in_one.sql）或 RLS 限制'
            : null,
        };
      } catch (e) {
        body.probe = {
          attempted: true,
          reachable: false,
          ms: Date.now() - started,
          error: e instanceof Error ? e.message : String(e),
          hint: '无法连接 Supabase：请确认 SUPABASE_URL 指向的项目仍然存在（域名可解析）且未被暂停',
        };
      }
    }
  }

  return json(res, 200, body);
}
