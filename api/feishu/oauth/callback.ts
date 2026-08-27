import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAppAccessToken, getAppCredentials } from '../_shared.js';

/**
 * OAuth 回调：code 换 user_access_token，再回跳前端并在 hash 写入 token
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const returnFallback = '/';
  let returnTo = returnFallback;

  try {
    const stateRaw = String(req.query.state || '');
    if (stateRaw) {
      try {
        const parsed = JSON.parse(
          Buffer.from(stateRaw, 'base64url').toString('utf8')
        ) as { return_to?: string };
        if (parsed.return_to) returnTo = parsed.return_to;
      } catch {
        /* ignore */
      }
    }

    const errQ = String(req.query.error || '');
    if (errQ) {
      return redirectWithPayload(res, returnTo, { error: errQ });
    }

    const code = String(req.query.code || '');
    if (!code) {
      return redirectWithPayload(res, returnTo, { error: '缺少授权 code' });
    }

    const creds = getAppCredentials();
    if (!creds) {
      return redirectWithPayload(res, returnTo, {
        error: '服务端未配置飞书应用凭证',
      });
    }

    const appAccessToken = await getAppAccessToken(creds.appId, creds.appSecret);

    // 优先用 OIDC 接口；失败再试旧版
    let access_token = '';
    let refresh_token = '';
    let expires_in = 7200;
    let name = '';

    const oidcRes = await fetch(
      'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
        }),
      }
    );
    const oidcData = (await oidcRes.json()) as {
      code?: number;
      msg?: string;
      data?: {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        name?: string;
      };
    };

    if (oidcData.code === 0 && oidcData.data?.access_token) {
      access_token = oidcData.data.access_token;
      refresh_token = oidcData.data.refresh_token || '';
      expires_in = oidcData.data.expires_in || 7200;
      name = oidcData.data.name || '';
    } else {
      const legacyRes = await fetch(
        'https://open.feishu.cn/open-apis/authen/v1/access_token',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${appAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
          }),
        }
      );
      const legacyData = (await legacyRes.json()) as {
        code?: number;
        msg?: string;
        data?: {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          name?: string;
        };
      };
      if (legacyData.code !== 0 || !legacyData.data?.access_token) {
        return redirectWithPayload(res, returnTo, {
          error: legacyData.msg || oidcData.msg || '换取 token 失败',
        });
      }
      access_token = legacyData.data.access_token;
      refresh_token = legacyData.data.refresh_token || '';
      expires_in = legacyData.data.expires_in || 7200;
      name = legacyData.data.name || '';
    }

    return redirectWithPayload(res, returnTo, {
      access_token,
      refresh_token,
      expires_in,
      name,
    });
  } catch (e) {
    return redirectWithPayload(res, returnTo, {
      error: e instanceof Error ? e.message : '授权回调异常',
    });
  }
}

function redirectWithPayload(
  res: VercelResponse,
  returnTo: string,
  payload: Record<string, unknown>
) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  let target = returnTo || '/';
  try {
    const u = new URL(target, 'https://placeholder.local');
    // 只允许同站相对路径或当前部署域名（防止开放重定向）
    if (u.origin === 'https://placeholder.local') {
      target = u.pathname + u.search;
    }
  } catch {
    target = '/';
  }
  const sep = target.includes('#') ? '&' : '#';
  const loc = `${target}${sep}feishu_oauth=${encodeURIComponent(encoded)}`;
  res.statusCode = 302;
  res.setHeader('Location', loc);
  res.end();
}
