/**
 * 本地代理：把浏览器请求转发到卖家精灵 MCP（Streamable HTTP）。
 * 密钥只放在服务端环境变量，不会暴露到前端。
 */
import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

type JsonRpc = {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/** 解析 MCP 返回：可能是纯 JSON，也可能是 SSE（data: ...） */
function parseMcpHttpBody(text: string): JsonRpc | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as JsonRpc;
    } catch {
      /* fall through */
    }
  }
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter((l) => l && l !== '[DONE]');
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(dataLines[i]) as JsonRpc;
      if (obj && (obj.result !== undefined || obj.error !== undefined || obj.method)) {
        return obj;
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

function extractToolPayload(result: unknown): unknown {
  if (result == null) return null;
  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }
  if (typeof result !== 'object') return result;
  const r = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  if (r.structuredContent !== undefined) return r.structuredContent;
  if (Array.isArray(r.content)) {
    const texts = r.content
      .filter((c) => c && (c.type === 'text' || c.text != null))
      .map((c) => String(c.text ?? ''));
    const joined = texts.join('\n').trim();
    if (!joined) return result;
    try {
      return JSON.parse(joined);
    } catch {
      return joined;
    }
  }
  return result;
}

async function mcpFetch(
  url: string,
  secretKey: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  }
): Promise<{ ok: boolean; status: number; text: string; sessionId?: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'secret-key': secretKey,
    ...(init.headers ?? {}),
  };
  const res = await fetch(url, {
    method: init.method ?? 'POST',
    headers,
    body: init.body,
  });
  const sessionId = res.headers.get('mcp-session-id') || undefined;
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, sessionId };
}

async function callSellerSpriteTool(
  mcpUrl: string,
  secretKey: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const rpcBody = {
    jsonrpc: '2.0' as const,
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  // 路径 1：直接 tools/call（兼容较新的无会话 / 会话可选服务）
  const direct = await mcpFetch(mcpUrl, secretKey, {
    method: 'POST',
    headers: {
      'MCP-Protocol-Version': '2025-03-26',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': toolName,
    },
    body: JSON.stringify(rpcBody),
  });

  let parsed = parseMcpHttpBody(direct.text);
  if (direct.ok && parsed?.result !== undefined && !parsed.error) {
    return extractToolPayload(parsed.result);
  }

  // 路径 2：initialize → initialized → tools/call（带会话）
  const initRes = await mcpFetch(mcpUrl, secretKey, {
    method: 'POST',
    headers: { 'MCP-Protocol-Version': '2025-03-26' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'amz-market-research-app', version: '1.0.0' },
      },
    }),
  });

  const sessionId = initRes.sessionId;
  if (!initRes.ok && !sessionId) {
    const errMsg =
      parsed?.error?.message ||
      (direct.text || initRes.text || '').slice(0, 300) ||
      `MCP 初始化失败 (${initRes.status})`;
    throw new Error(errMsg);
  }

  if (sessionId) {
    await mcpFetch(mcpUrl, secretKey, {
      method: 'POST',
      headers: {
        'MCP-Protocol-Version': '2025-03-26',
        'Mcp-Session-Id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
  }

  const callRes = await mcpFetch(mcpUrl, secretKey, {
    method: 'POST',
    headers: {
      'MCP-Protocol-Version': '2025-03-26',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': toolName,
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(rpcBody),
  });

  parsed = parseMcpHttpBody(callRes.text);
  if (!callRes.ok || parsed?.error) {
    throw new Error(
      parsed?.error?.message ||
        callRes.text.slice(0, 300) ||
        `MCP 调用失败 (${callRes.status})`
    );
  }
  if (parsed?.result === undefined) {
    throw new Error('MCP 返回为空，请检查密钥或站点/ASIN 是否正确');
  }
  return extractToolPayload(parsed.result);
}

function createHandler(env: Record<string, string>): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/sellersprite')) return next();

    const secretKey = (env.SELLERSPRITE_SECRET_KEY || env.VITE_SELLERSPRITE_SECRET_KEY || '').trim();
    const mcpUrl = (env.SELLERSPRITE_MCP_URL || 'https://mcp.sellersprite.com/mcp').trim();

    if (req.method === 'GET' && (req.url === '/api/sellersprite/status' || req.url.startsWith('/api/sellersprite/status?'))) {
      return sendJson(res, 200, {
        ok: Boolean(secretKey),
        configured: Boolean(secretKey),
        mcpUrl,
        message: secretKey
          ? '卖家精灵 MCP 已配置，可在页面内直接抓取评论/关键词'
          : '未配置 SELLERSPRITE_SECRET_KEY：请在项目根目录 .env.local 填写后重启 npm run dev',
      });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: '仅支持 POST' });
    }

    if (!secretKey) {
      return sendJson(res, 503, {
        error: '未配置卖家精灵密钥。请在 .env.local 写入 SELLERSPRITE_SECRET_KEY=你的密钥 后重启开发服务。',
      });
    }

    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const tool = String(body.tool || '');
      const args = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, unknown>;

      if (tool !== 'review' && tool !== 'traffic_keyword') {
        return sendJson(res, 400, { error: '仅支持 tool: review | traffic_keyword' });
      }

      const data = await callSellerSpriteTool(mcpUrl, secretKey, tool, args);
      return sendJson(res, 200, { ok: true, data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return sendJson(res, 502, { error: msg });
    }
  };
}

export function sellerspriteMcpProxyPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'sellersprite-mcp-proxy',
    configureServer(server) {
      server.middlewares.use(createHandler(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createHandler(env));
    },
  };
}
