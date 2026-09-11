import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCloudConfigStatus, getPublicSupabase, json } from './auth/_shared.js';

/**
 * 保活端点（M0 新增）。
 *
 * 背景：Supabase 免费项目在闲置约 7 天后会被**自动暂停**（本项目已发生过一次：
 * 表现为全环境登录失败、项目子域名停止解析，看起来像"项目被删了"）。
 * 由 Vercel Cron 每日调用一次本端点，让项目保持"活跃"，避免再次被暂停。
 *
 * 配置：vercel.json 的 crons 已指向本端点。
 * 安全：只做一次轻量查询，不回显任何密钥；若配置了 CRON_SECRET，会校验 Authorization 头。
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret) {
    const auth = String(req.headers.authorization || '');
    if (auth !== `Bearer ${secret}`) {
      return json(res, 401, { ok: false, error: 'unauthorized' });
    }
  }

  const status = getCloudConfigStatus();
  if (!status.ready) {
    return json(res, 200, { ok: true, skipped: true, reason: 'Supabase 未配置，跳过保活' });
  }

  const started = Date.now();
  try {
    // 最轻量的活跃信号：只取 1 行、只取主键
    const client = getPublicSupabase();
    const { error } = await client!.from('projects').select('id').limit(1);
    return json(res, 200, {
      ok: true,
      alive: !error,
      ms: Date.now() - started,
      host: status.supabaseHost,
      error: error ? error.message : null,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    // 保活失败也返回 200，避免 cron 反复告警；错误信息保留便于排查
    return json(res, 200, {
      ok: true,
      alive: false,
      ms: Date.now() - started,
      host: status.supabaseHost,
      error: e instanceof Error ? e.message : String(e),
      checkedAt: new Date().toISOString(),
    });
  }
}
