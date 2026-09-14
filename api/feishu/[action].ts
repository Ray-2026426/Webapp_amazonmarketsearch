import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createDocxWithMarkdown, getAppAccessToken, getAppCredentials, getRedirectUri, sendJson } from './_shared.js';

/** 开始飞书用户 OAuth：跳转到飞书授权页  GET /api/feishu/oauth/start?return_to= */
async function start(req: VercelRequest, res: VercelResponse) {
  const creds = getAppCredentials();
  if (!creds) return sendJson(res, 503, { error: '服务端未配置 FEISHU_APP_ID / FEISHU_APP_SECRET', needConfig: true });
  const returnTo = String(req.query.return_to || '/');
  const state = Buffer.from(JSON.stringify({ return_to: returnTo, ts: Date.now() }), 'utf8').toString('base64url');
  const redirectUri = getRedirectUri(req);
  const scope = ['docx:document', 'docx:document:readonly', 'offline_access'].join(' ');
  const url = new URL('https://open.feishu.cn/open-apis/authen/v1/authorize');
  url.searchParams.set('app_id', creds.appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  res.statusCode = 302;
  res.setHeader('Location', url.toString());
  res.end();
}

function redirectWithPayload(res: VercelResponse, returnTo: string, payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  let target = returnTo || '/';
  try {
    const u = new URL(target, 'https://placeholder.local');
    if (u.origin === 'https://placeholder.local') target = u.pathname + u.search;
  } catch {
    target = '/';
  }
  const sep = target.includes('#') ? '&' : '#';
  const loc = `${target}${sep}feishu_oauth=${encodeURIComponent(encoded)}`;
  res.statusCode = 302;
  res.setHeader('Location', loc);
  res.end();
}

async function callback(req: VercelRequest, res: VercelResponse) {
  const returnFallback = '/';
  let returnTo = returnFallback;
  try {
    const stateRaw = String(req.query.state || '');
    if (stateRaw) {
      try {
        const parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')) as { return_to?: string };
        if (parsed.return_to) returnTo = parsed.return_to;
      } catch { /* ignore */ }
    }
    const errQ = String(req.query.error || '');
    if (errQ) return redirectWithPayload(res, returnTo, { error: errQ });
    const code = String(req.query.code || '');
    if (!code) return redirectWithPayload(res, returnTo, { error: '缺少授权 code' });

    const creds = getAppCredentials();
    if (!creds) return redirectWithPayload(res, returnTo, { error: '服务端未配置飞书应用凭证' });
    const appAccessToken = await getAppAccessToken(creds.appId, creds.appSecret);

    let access_token = '';
    let refresh_token = '';
    let expires_in = 7200;
    let name = '';

    const oidcRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${appAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code }),
    });
    const oidcData = (await oidcRes.json()) as {
      code?: number; msg?: string; data?: { access_token?: string; refresh_token?: string; expires_in?: number; name?: string };
    };
    if (oidcData.code === 0 && oidcData.data?.access_token) {
      access_token = oidcData.data.access_token;
      refresh_token = oidcData.data.refresh_token || '';
      expires_in = oidcData.data.expires_in || 7200;
      name = oidcData.data.name || '';
    } else {
      const legacyRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/access_token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${appAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code }),
      });
      const legacyData = (await legacyRes.json()) as {
        code?: number; msg?: string; data?: { access_token?: string; refresh_token?: string; expires_in?: number; name?: string };
      };
      if (legacyData.code !== 0 || !legacyData.data?.access_token) {
        return redirectWithPayload(res, returnTo, { error: legacyData.msg || oidcData.msg || '换取 token 失败' });
      }
      access_token = legacyData.data.access_token;
      refresh_token = legacyData.data.refresh_token || '';
      expires_in = legacyData.data.expires_in || 7200;
      name = legacyData.data.name || '';
    }
    return redirectWithPayload(res, returnTo, { access_token, refresh_token, expires_in, name });
  } catch (e) {
    return redirectWithPayload(res, returnTo, { error: e instanceof Error ? e.message : '授权回调异常' });
  }
}

async function refresh(req: VercelRequest, res: VercelResponse) {
  const creds = getAppCredentials();
  if (!creds) return sendJson(res, 503, { error: '服务端未配置 FEISHU_APP_ID / FEISHU_APP_SECRET', needConfig: true });
  const refresh_token = String(req.body?.refresh_token || '');
  if (!refresh_token) return sendJson(res, 400, { error: '缺少 refresh_token' });
  try {
    const appAccessToken = await getAppAccessToken(creds.appId, creds.appSecret);
    const tryRefresh = async (url: string) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${appAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token }),
      });
      return (await r.json()) as { code?: number; msg?: string; data?: { access_token?: string; refresh_token?: string; expires_in?: number; name?: string } };
    };
    let data = await tryRefresh('https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token');
    if (data.code !== 0 || !data.data?.access_token) {
      data = await tryRefresh('https://open.feishu.cn/open-apis/authen/v1/refresh_access_token');
    }
    if (data.code !== 0 || !data.data?.access_token) {
      return sendJson(res, 401, { error: data.msg || '刷新 token 失败', needAuth: true });
    }
    return sendJson(res, 200, {
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token || refresh_token,
      expires_in: data.data.expires_in || 7200,
      name: data.data.name || '',
    });
  } catch (e) {
    return sendJson(res, 500, { error: e instanceof Error ? e.message : '刷新失败' });
  }
}

async function create(req: VercelRequest, res: VercelResponse) {
  if (!getAppCredentials()) {
    return sendJson(res, 503, { error: '服务端未配置 FEISHU_APP_ID / FEISHU_APP_SECRET。请到 Vercel 环境变量填写后再试。', needConfig: true });
  }
  const title = String(req.body?.title || 'Kairo 报告').slice(0, 100);
  const markdown = String(req.body?.markdown || '');
  const access_token = String(req.body?.access_token || '');
  if (!access_token) return sendJson(res, 401, { error: '缺少 access_token', needAuth: true });
  if (!markdown.trim()) return sendJson(res, 400, { error: '报告内容为空' });
  try {
    const result = await createDocxWithMarkdown(access_token, title, markdown);
    return sendJson(res, 200, { url: result.url, document_id: result.documentId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '创建文档失败';
    const needAuth = /token|auth|401|99991663|99991668/i.test(msg);
    return sendJson(res, needAuth ? 401 : 500, { error: msg, needAuth });
  }
}

const handlers: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  start,
  callback,
  refresh,
  create,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 支持 GET（oauth/start、oauth/callback）与 POST（oauth/refresh、docs/create）
  const pathname = String(req.url || '').split('?')[0];
  const action = String(pathname.split('/').filter(Boolean).pop() ?? '').toLowerCase();
  const fn = handlers[action];
  if (!fn) return sendJson(res, 404, { error: `未知操作: ${action}` });
  if (action === 'start' || action === 'callback') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  } else {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  }
  await fn(req, res);
}
