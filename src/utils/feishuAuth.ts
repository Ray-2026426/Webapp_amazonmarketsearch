const STORAGE_KEY = 'kairo_feishu_oauth_v1';

export type FeishuTokenBundle = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  userName?: string;
};

function readRaw(): FeishuTokenBundle | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeishuTokenBundle;
    if (!parsed?.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRaw(bundle: FeishuTokenBundle | null) {
  if (!bundle) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
}

export function getFeishuTokens(): FeishuTokenBundle | null {
  return readRaw();
}

export function clearFeishuTokens() {
  writeRaw(null);
}

export function isFeishuAuthorized(): boolean {
  const t = readRaw();
  return Boolean(t?.accessToken && t?.refreshToken);
}

/** OAuth 回跳：从 URL hash 写入 token，并清掉敏感参数 */
export function consumeOAuthCallbackFromUrl(): { ok: boolean; error?: string } {
  if (typeof window === 'undefined') return { ok: false };
  const hash = window.location.hash || '';
  if (!hash.includes('feishu_oauth=')) return { ok: false };

  try {
    const m = hash.match(/feishu_oauth=([^&]+)/);
    if (!m?.[1]) return { ok: false, error: '授权回跳缺少参数' };
    const json = decodeURIComponent(atob(m[1]));
    const data = JSON.parse(json) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      name?: string;
      error?: string;
    };
    if (data.error) return { ok: false, error: data.error };
    if (!data.access_token || !data.refresh_token) {
      return { ok: false, error: '授权未返回有效 token' };
    }
    writeRaw({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 7200) * 1000,
      userName: data.name,
    });
    // 清掉 hash，避免刷新重复消费 / 泄漏
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState({}, '', clean);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '解析授权失败' };
  }
}

export function startFeishuOAuth(returnTo?: string) {
  const origin = window.location.origin;
  const back = returnTo || `${origin}/`;
  const url = `/api/feishu/oauth/start?return_to=${encodeURIComponent(back)}`;
  window.location.href = url;
}

async function refreshIfNeeded(): Promise<FeishuTokenBundle | null> {
  let bundle = readRaw();
  if (!bundle?.refreshToken) return null;
  // 提前 2 分钟刷新
  if (bundle.expiresAt > Date.now() + 120_000) return bundle;

  try {
    const res = await fetch('/api/feishu/oauth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: bundle.refreshToken }),
    });
    const data = await res.json();
    if (!res.ok || !data?.access_token) {
      clearFeishuTokens();
      return null;
    }
    bundle = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || bundle.refreshToken,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 7200) * 1000,
      userName: data.name || bundle.userName,
    };
    writeRaw(bundle);
    return bundle;
  } catch {
    return bundle;
  }
}

export type CreateFeishuDocResult =
  | { ok: true; url: string; documentId: string }
  | { ok: false; error: string; needAuth?: boolean; needConfig?: boolean };

export async function createFeishuDocFromMarkdown(
  title: string,
  markdown: string
): Promise<CreateFeishuDocResult> {
  const bundle = await refreshIfNeeded();
  if (!bundle?.accessToken) {
    return { ok: false, error: '尚未授权飞书，请先完成授权', needAuth: true };
  }

  try {
    const res = await fetch('/api/feishu/docs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        markdown,
        access_token: bundle.accessToken,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data?.needAuth) {
      clearFeishuTokens();
      return { ok: false, error: data?.error || '授权已失效，请重新授权', needAuth: true };
    }
    if (res.status === 503 || data?.needConfig) {
      return {
        ok: false,
        error: data?.error || '服务端未配置飞书 App ID/Secret',
        needConfig: true,
      };
    }
    if (!res.ok || !data?.url) {
      return { ok: false, error: data?.error || `创建失败（${res.status}）` };
    }
    return { ok: true, url: data.url, documentId: data.document_id || '' };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : '网络错误，无法连接飞书接口',
    };
  }
}
