import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppAccessToken, getAppCredentials, sendJson } from '../_shared';

/**
 * 刷新 user_access_token
 * POST { refresh_token }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const creds = getAppCredentials();
  if (!creds) {
    return sendJson(res, 503, {
      error: '服务端未配置 FEISHU_APP_ID / FEISHU_APP_SECRET',
      needConfig: true,
    });
  }

  const refresh_token = String(req.body?.refresh_token || '');
  if (!refresh_token) {
    return sendJson(res, 400, { error: '缺少 refresh_token' });
  }

  try {
    const appAccessToken = await getAppAccessToken(creds.appId, creds.appSecret);

    const tryRefresh = async (url: string) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token,
        }),
      });
      return (await r.json()) as {
        code?: number;
        msg?: string;
        data?: {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          name?: string;
        };
      };
    };

    let data = await tryRefresh(
      'https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token'
    );
    if (data.code !== 0 || !data.data?.access_token) {
      data = await tryRefresh(
        'https://open.feishu.cn/open-apis/authen/v1/refresh_access_token'
      );
    }

    if (data.code !== 0 || !data.data?.access_token) {
      return sendJson(res, 401, {
        error: data.msg || '刷新 token 失败',
        needAuth: true,
      });
    }

    return sendJson(res, 200, {
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token || refresh_token,
      expires_in: data.data.expires_in || 7200,
      name: data.data.name || '',
    });
  } catch (e) {
    return sendJson(res, 500, {
      error: e instanceof Error ? e.message : '刷新失败',
    });
  }
}
