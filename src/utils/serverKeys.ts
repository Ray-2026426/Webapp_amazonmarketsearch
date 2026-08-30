// 管理员 Key 的前端缓存：后端 settings API 下发，存 localStorage，供 MCP/AI 默认值读取。
export interface ServerKeys {
  deepseek?: string;
  sellersprite?: string;
  xydc?: string;
  lingxing?: string;
  sorftime?: string;
}

const STORAGE_KEY = 'amzdev_admin_keys';

export function loadServerKeys(): ServerKeys {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as ServerKeys;
  } catch {
    return {};
  }
}

export function saveServerKeys(keys: ServerKeys): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys ?? {}));
}

export function getDefaultServerKey(name: keyof ServerKeys): string {
  return String(loadServerKeys()[name] ?? '').trim();
}

export async function fetchServerKeys(token: string): Promise<ServerKeys> {
  try {
    const res = await fetch('/api/settings/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; keys?: ServerKeys };
    return body.ok && body.keys ? body.keys : {};
  } catch {
    return {};
  }
}

export async function pushServerKeys(token: string, keys: ServerKeys): Promise<boolean> {
  try {
    const res = await fetch('/api/settings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, keys }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return Boolean(body.ok);
  } catch {
    return false;
  }
}
