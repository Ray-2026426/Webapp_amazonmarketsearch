import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 临时诊断接口（`GET /api/diag`）。
 *
 * 为什么需要它：管理员后台在线上返回 **FUNCTION_INVOCATION_FAILED** —— 那是 Vercel 平台级错误，
 * 意味着函数在 `try/catch` 之外就崩了（通常是**模块加载阶段**），所以我在业务代码里加多少错误处理
 * 都看不到原因。这个文件的作用就是"什么依赖都不静态引入"，把每一步都用 **动态 import + try/catch**
 * 试一遍，把真实错误原文吐出来。
 *
 * 安全：不读任何表数据、不回显任何密钥，只回"模块能不能加载 + 错误原文 + 环境布尔量"。
 * 定位完成后应删除本文件。
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const steps: { step: string; ok: boolean; detail: string }[] = [];

  const probe = async (step: string, fn: () => Promise<string>) => {
    try {
      steps.push({ step, ok: true, detail: await fn() });
    } catch (e) {
      const err = e as { name?: string; message?: string; code?: string };
      steps.push({
        step,
        ok: false,
        detail: `${err?.name ?? 'Error'}${err?.code ? ` [${err.code}]` : ''}: ${err?.message ?? String(e)}`,
      });
    }
  };

  // ① 已知在线上可用的写法（带 .js）作为对照
  await probe("import './auth/_shared.js'（带扩展名，登录在用）", async () => {
    const m = (await import('./auth/_shared.js')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });

  // ② 崩掉那三个文件用的写法（无扩展名）—— 这是头号嫌疑
  await probe("import '../src/utils/usageAccounting'（无扩展名，admin 用的写法）", async () => {
    const m = (await import('../src/utils/usageAccounting')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });
  await probe("import '../src/utils/usageAccounting.js'（带扩展名）", async () => {
    const m = (await import('../src/utils/usageAccounting.js')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });
  await probe("import '../src/utils/keyMasking'（无扩展名）", async () => {
    const m = (await import('../src/utils/keyMasking')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });
  await probe("import '../src/utils/keyMasking.js'（带扩展名）", async () => {
    const m = (await import('../src/utils/keyMasking.js')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });
  await probe("import '../src/utils/aiEndpoints.js'", async () => {
    const m = (await import('../src/utils/aiEndpoints.js')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });
  await probe("import '../src/utils/poolCache.js'", async () => {
    const m = (await import('../src/utils/poolCache.js')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });
  await probe("import '../src/utils/poolCacheStore.js'", async () => {
    const m = (await import('../src/utils/poolCacheStore.js')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });
  await probe("import '../src/utils/mcpRequestKey.js'", async () => {
    const m = (await import('../src/utils/mcpRequestKey.js')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });
  await probe("import './data/[action].js'（数据池函数本体）", async () => {
    const m = (await import('./data/[action].js')) as Record<string, unknown>;
    return `OK，导出 ${Object.keys(m).length} 项`;
  });

  // ③ Supabase：能不能建客户端、能不能查表（只做 head 查询，不取数据）
  await probe('Supabase 客户端 + projects 表探测', async () => {
    const shared = (await import('./auth/_shared.js')) as unknown as {
      getServiceSupabase: () => {
        from: (t: string) => {
          select: (c: string, o: unknown) => { limit: (n: number) => Promise<{ error: { message?: string } | null }> };
        };
      } | null;
    };
    const s = shared.getServiceSupabase();
    if (!s) return '未配置 SERVICE_ROLE_KEY（服务端读不了库）';
    const { error } = await s.from('projects').select('id', { count: 'exact', head: true }).limit(1);
    return error ? `查询报错：${error.message}` : 'projects 表可读';
  });

  return res.status(200).json({
    ok: true,
    when: new Date().toISOString(),
    runtime: {
      node: process.version,
      vercelEnv: process.env.VERCEL_ENV ?? '(未设置)',
      gitCommit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || '(未知)',
    },
    env: {
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      APP_JWT_SECRET: Boolean(process.env.APP_JWT_SECRET),
      ADMIN_EMAILS: Boolean(process.env.ADMIN_EMAILS),
      SIGNUP_INVITE_CODE: Boolean(process.env.SIGNUP_INVITE_CODE),
    },
    steps,
    note: '临时诊断接口：只报告模块能否加载与错误原文，不读取任何表数据、不回显任何密钥。定位完成后会删除。',
  });
}
