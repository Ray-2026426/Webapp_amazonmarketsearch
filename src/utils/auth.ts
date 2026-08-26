// 认证：以 Supabase 邮箱账号作为唯一身份来源。
// 每个用户拥有独立的 Supabase auth.uid()，RLS 依据该 uid 隔离项目数据。
// 本地 session 只是该身份的一份缓存，不再维护本地账号密码表。

import { getSupabase } from './supabaseClient';

export interface SessionUser {
  id: string;
  username: string;
  email?: string;
  avatarDataUrl?: string;
  role?: 'admin' | 'user';
}

const SESSION_KEY = 'amzdev_session';
const SAVED_CREDS_KEY = 'amzdev_saved_creds';
const AVATAR_KEY_PREFIX = 'amzdev_avatar_';

const DEFAULT_ADMIN_EMAILS = ['ljh15874760218@gmail.com'];

function adminEmails(): string[] {
  const raw = String(import.meta.env?.VITE_ADMIN_EMAILS ?? '').trim();
  const extra = raw
    ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  return [...DEFAULT_ADMIN_EMAILS, ...extra];
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

export function isAdminSession(user: SessionUser | null | undefined): boolean {
  return Boolean(user) && (user.role === 'admin' || isAdminEmail(user.email));
}
function readSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionUser;
    if (!s?.id || !s?.username) return null;
    // 旧版本地账号 session 没有 email；强制重新走 Supabase 登录。
    if (!s.email) return null;
    const avatar = localStorage.getItem(`${AVATAR_KEY_PREFIX}${s.id}`);
    return avatar ? { ...s, avatarDataUrl: avatar } : s;
  } catch {
    return null;
  }
}

function writeSession(user: { id: string; username: string; email?: string }): void {
  const session: SessionUser = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: isAdminEmail(user.email) ? 'admin' : 'user',
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getCurrentUser(): SessionUser | null {
  return readSession();
}

export interface RegisterResult {
  success: boolean;
  requiresEmailConfirmation?: boolean;
  error?: string;
}

export async function register(email: string, password: string): Promise<RegisterResult> {
  const s = getSupabase();
  if (!s) return { success: false, error: '云端未配置，无法注册' };
  const trimmed = email.trim();
  const { data, error } = await s.auth.signUp({ email: trimmed, password });
  if (error) return { success: false, error: error.message };
  if (!data.user) return { success: false, error: '注册失败，未返回用户信息' };
  if (data.session) {
    writeSession({ id: data.user.id, username: data.user.email ?? trimmed, email: data.user.email ?? trimmed });
    return { success: true, requiresEmailConfirmation: false };
  }
  return { success: true, requiresEmailConfirmation: true };
}
export interface LoginResult {
  success: boolean;
  user?: SessionUser;
  error?: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const s = getSupabase();
  if (!s) return { success: false, error: '云端未配置，无法登录' };
  const trimmed = email.trim();
  const { data, error } = await s.auth.signInWithPassword({ email: trimmed, password });
  if (error) return { success: false, error: error.message };
  if (!data.user) return { success: false, error: '登录失败，未返回用户信息' };
  writeSession({ id: data.user.id, username: data.user.email ?? trimmed, email: data.user.email ?? trimmed });
  return { success: true, user: getCurrentUser() ?? undefined };
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
  const s = getSupabase();
  if (s) void s.auth.signOut().catch(() => {});
}
export interface SavedCredentials {
  email: string;
  password: string;
}

export function saveCreds(email: string, password: string): void {
  localStorage.setItem(SAVED_CREDS_KEY, JSON.stringify({ email, password }));
}

export function loadCreds(): SavedCredentials | null {
  try {
    const raw = localStorage.getItem(SAVED_CREDS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedCredentials;
  } catch {
    return null;
  }
}

export function clearCreds(): void {
  localStorage.removeItem(SAVED_CREDS_KEY);
}
export function updateUserAvatar(
  userId: string,
  dataUrl: string | null
): { ok: boolean; error?: string } {
  try {
    if (dataUrl) localStorage.setItem(`${AVATAR_KEY_PREFIX}${userId}`, dataUrl);
    else localStorage.removeItem(`${AVATAR_KEY_PREFIX}${userId}`);
    const sess = getCurrentUser();
    if (sess?.id === userId) {
      const next = dataUrl ? { ...sess, avatarDataUrl: dataUrl } : { ...sess, avatarDataUrl: undefined };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    }
    return { ok: true };
  } catch {
    return { ok: false, error: '保存头像失败' };
  }
}
export function createUserId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}