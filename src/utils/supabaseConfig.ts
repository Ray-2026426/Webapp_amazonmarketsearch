// 云端（Supabase）配置：优先读应用内 localStorage 配置，避免依赖 Vercel 环境变量。
export interface SupabaseConfig {
  url: string;
  key: string;
}

export function validateSupabaseConfig(cfg: SupabaseConfig): string | null {
  const urlText = cfg.url.trim();
  const keyText = cfg.key.trim();
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return 'Supabase URL 格式无效';
  }
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(localHost && url.protocol === 'http:')) {
    return 'Supabase URL 必须使用 HTTPS（本机 localhost 除外）';
  }
  if (!keyText) return 'Publishable Key 不能为空';
  if (keyText.startsWith('sb_secret_') || keyText.toLowerCase().includes('service_role')) {
    return '禁止在浏览器中使用 Secret / Service Role Key，请改用 Publishable Key';
  }
  const parts = keyText.split('.');
  if (parts.length === 3) {
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const payload = JSON.parse(atob(padded)) as { role?: string };
      if (payload.role === 'service_role') {
        return '禁止在浏览器中使用 Service Role Key，请改用 anon / Publishable Key';
      }
    } catch {
      // Supabase also supports opaque publishable keys; only reject a decoded service role.
    }
  }
  return null;
}

const CONFIG_KEY = 'amzdev_supabase_config';

export function loadSupabaseConfig(): SupabaseConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SupabaseConfig>;
    if (p && typeof p.url === 'string' && typeof p.key === 'string' && p.url && p.key) {
      return { url: p.url, key: p.key };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveSupabaseConfig(cfg: SupabaseConfig | null): void {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
}
