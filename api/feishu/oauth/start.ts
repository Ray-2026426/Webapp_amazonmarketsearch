import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppCredentials, getRedirectUri, sendJson } from '../_shared.js';

/**
 * 开始飞书用户 OAuth：跳转到飞书授权页
 * GET /api/feishu/oauth/start?return_to=
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const creds = getAppCredentials();
  if (!creds) {
    return sendJson(res, 503, {
      error: '服务端未配置 FEISHU_APP_ID / FEISHU_APP_SECRET',
      needConfig: true,
    });
  }

  const returnTo = String(req.query.return_to || '/');
  const state = Buffer.from(
    JSON.stringify({ return_to: returnTo, ts: Date.now() }),
    'utf8'
  ).toString('base64url');

  const redirectUri = getRedirectUri(req);
  // 用户身份授权（创建文档到本人云空间）
  const scope = [
    'docx:document',
    'docx:document:readonly',
    'offline_access',
  ].join(' ');

  const url = new URL('https://open.feishu.cn/open-apis/authen/v1/authorize');
  url.searchParams.set('app_id', creds.appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);

  res.statusCode = 302;
  res.setHeader('Location', url.toString());
  res.end();
}
