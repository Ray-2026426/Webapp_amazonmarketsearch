import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadSupabaseConfig } from './supabaseConfig';

let cached: SupabaseClient | null | undefined;

/** 动态获取客户端：优先应用内配置（localStorage），其次环境变量。 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const cfg = loadSupabaseConfig();
  const url = cfg?.url || (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
  const key = cfg?.key || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';
  cached =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        })
      : null;
  return cached;
}

/** 配置变更后重置客户端，使其下次按新配置重建。 */
export function resetSupabaseClient(): void {
  cached = undefined;
}

export function isCloudConfigured(): boolean {
  return getSupabase() !== null;
}
