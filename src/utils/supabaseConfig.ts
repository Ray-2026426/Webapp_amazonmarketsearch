// 云端（Supabase）配置：优先读应用内 localStorage 配置，避免依赖 Vercel 环境变量。
export interface SupabaseConfig {
  url: string;
  key: string;
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
