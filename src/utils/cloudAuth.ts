import type { User } from '@supabase/supabase-js';
import { getSupabase, resetSupabaseClient } from './supabaseClient';
import { saveSupabaseConfig } from './supabaseConfig';

export interface CloudAuthState {
  configured: boolean;
  user: User | null;
  isAnonymous: boolean;
  label: string;
}

export async function getCloudAuthState(): Promise<CloudAuthState> {
  const s = getSupabase();
  if (!s) {
    return { configured: false, user: null, isAnonymous: false, label: '未配置云端' };
  }
  const { data, error } = await s.auth.getUser();
  if (error || !data.user) {
    return { configured: true, user: null, isAnonymous: false, label: '未登录云账号' };
  }
  const user = data.user;
  const isAnonymous = Boolean(user.is_anonymous);
  return {
    configured: true,
    user,
    isAnonymous,
    label: isAnonymous ? '匿名云会话' : user.email || user.id,
  };
}

export async function signInCloudEmail(email: string, password: string): Promise<void> {
  const s = getSupabase();
  if (!s) throw new Error('请先保存 Supabase 云端配置');
  const { error } = await s.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signUpCloudEmail(email: string, password: string): Promise<void> {
  const s = getSupabase();
  if (!s) throw new Error('请先保存 Supabase 云端配置');
  const { error } = await s.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOutCloud(): Promise<void> {
  const s = getSupabase();
  if (!s) return;
  const { error } = await s.auth.signOut();
  if (error) throw new Error(error.message);
}

interface BackendCloudSessionResponse {
  ok?: boolean;
  error?: string;
  supabaseUrl?: string;
  publishableKey?: string;
  session?: {
    access_token?: string;
    refresh_token?: string;
  };
}

export async function connectBackendCloudSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/cloud/session', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as BackendCloudSessionResponse;
    if (!res.ok || !body.ok || !body.supabaseUrl || !body.publishableKey || !body.session?.access_token || !body.session.refresh_token) {
      return false;
    }
    saveSupabaseConfig({ url: body.supabaseUrl, key: body.publishableKey });
    resetSupabaseClient();
    const s = getSupabase();
    if (!s) return false;
    const { error } = await s.auth.setSession({
      access_token: body.session.access_token,
      refresh_token: body.session.refresh_token,
    });
    return !error;
  } catch {
    return false;
  }
}
