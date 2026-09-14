import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * M0：本地开发环境补齐 /api 路由。
 *
 * 背景：vite.config.ts 原本只代理 /api-proxy/*，而 server/sellerspriteMcpProxy.ts 只挂 /api/sellersprite*，
 * 导致 `npm run dev` 下 /api/auth/*、/api/projects/*、/api/health 全部 404 —— 本地根本没法登录。
 *
 * 做法：把 api/**\/*.ts 按 Vercel 的约定映射为本地中间件（含 [action].ts 动态段），
 * 用 Vite 的 ssrLoadModule 就地编译 TS，并适配 Vercel 请求/响应对象（req.query / req.body / res.status().json()）。
 * 这样本地与线上行为一致，不必强制团队改用 vercel dev。
 */

type AnyHandler = (req: any, res: any) => unknown | Promise<unknown>;

const SKIP_PREFIXES = ['/api/sellersprite']; // 由 sellerspriteMcpProxy 插件处理

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      const raw = Buffer.concat(chunks).toString('utf8');
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
        try {
          return resolve(JSON.parse(raw));
        } catch {
          return resolve(raw);
        }
      }
      return resolve(raw);
    });
    req.on('error', () => resolve(undefined));
  });
}

/** 给原生 ServerResponse 补上 Vercel 的 res.status().json() 便捷方法 */
function decorateResponse(res: ServerResponse): ServerResponse & {
  status: (code: number) => typeof res;
  json: (body: unknown) => typeof res;
  send: (body: unknown) => typeof res;
} {
  const anyRes = res as any;
  if (!anyRes.status) {
    anyRes.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    anyRes.json = (body: unknown) => {
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
      return res;
    };
    anyRes.send = (body: unknown) => {
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        res.end(body as any);
      } else {
        anyRes.json(body);
      }
      return res;
    };
  }
  return anyRes;
}

/** 把 /api/a/b 解析为 api/a/b.ts 或 api/a/[action].ts */
function resolveApiFile(root: string, segments: string[]): string | null {
  const apiDir = path.join(root, 'api');
  const exact = path.join(apiDir, ...segments) + '.ts';
  if (fs.existsSync(exact)) return exact;
  if (segments.length >= 1) {
    const dynamic = path.join(apiDir, ...segments.slice(0, -1), '[action].ts');
    if (fs.existsSync(dynamic)) return dynamic;
  }
  return null;
}

export function devApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'kairo-dev-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const root = server.config.root;

      // 把 .env / .env.local 里的服务端变量注入 dev server 进程（仅服务端，不暴露给浏览器）
      for (const [k, v] of Object.entries(env)) {
        if (v && process.env[k] === undefined) process.env[k] = v;
      }

      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        const pathname = url.split('?')[0];
        if (!pathname.startsWith('/api/')) return next();
        if (SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return next();

        const segments = pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
        if (segments.length === 0) return next();

        const file = resolveApiFile(root, segments);
        if (!file) return next();

        try {
          const mod = (await server.ssrLoadModule(file)) as { default?: AnyHandler };
          const handler = mod.default;
          if (typeof handler !== 'function') {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: false, error: `${path.relative(root, file)} 没有 default 导出` }));
          }

          // 适配 Vercel 请求对象
          const anyReq = req as any;
          anyReq.body = await readBody(req);
          const q: Record<string, string | string[]> = {};
          const search = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
          for (const [k, v] of new URLSearchParams(search)) {
            if (q[k] === undefined) q[k] = v;
            else if (Array.isArray(q[k])) (q[k] as string[]).push(v);
            else q[k] = [q[k] as string, v];
          }
          anyReq.query = q;
          anyReq.cookies = {};

          await handler(anyReq, decorateResponse(res));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // eslint-disable-next-line no-console
          console.error(`[dev-api] ${pathname} 处理失败:`, message);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: `本地 API 执行失败: ${message}` }));
          }
        }
      });
    },
  };
}
