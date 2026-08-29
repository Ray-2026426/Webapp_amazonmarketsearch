// 认证：应用自己的账号体系。注册/登录走后端 API，后端统一用 service_role 访问
// 同一个 Supabase 数据库，并按 app_users.id 隔离数据。客户端不直接接触 Supabase。

export interface SessionUser {
  id: string;
  username: string;
  email?: string;
  avatarDataUrl?: string;
  nickname?: string;
  role?: 'admin' | 'user';
}

const SESSION_KEY = 'amzdev_session';
const TOKEN_KEY = 'amzdev_auth_token';
const SUPABASE_TOKEN_KEY = 'amzdev_supabase_access_token';
const SAVED_CREDS_KEY = 'amzdev_saved_creds';
const AVATAR_KEY_PREFIX = 'amzdev_avatar_';
const PROFILE_KEY_PREFIX = 'amzdev_account_profile_';
const DEFAULT_ADMIN_EMAILS = ['ljh15874760218@gmail.com'];

function adminEmails(): string[] {
  const raw = String(import.meta.env?.VITE_ADMIN_EMAILS ?? '').trim();
  return raw
    ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ADMIN_EMAILS;
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
    if (!getAuthToken()) return null;
    const profile = readAccountProfile(s.id);
    const avatar = profile.avatarDataUrl ?? localStorage.getItem(`${AVATAR_KEY_PREFIX}${s.id}`) ?? undefined;
    return {
      ...s,
      nickname: profile.nickname || s.nickname || s.username,
      avatarDataUrl: avatar,
    };
  } catch {
    return null;
  }
}

function writeSession(user: { id: string; username: string; email?: string; role?: 'admin' | 'user' }): void {
  const profile = readAccountProfile(user.id);
  const session: SessionUser = {
    id: user.id,
    username: user.username,
    email: user.email,
    nickname: profile.nickname || user.username,
    role: user.role === 'admin' || isAdminEmail(user.email) ? 'admin' : 'user',
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export interface AccountProfile {
  nickname: string;
  avatarDataUrl?: string;
}

function readAccountProfile(userId: string): AccountProfile {
  try {
    const raw = localStorage.getItem(`${PROFILE_KEY_PREFIX}${userId}`);
    if (!raw) return { nickname: '' };
    const parsed = JSON.parse(raw) as Partial<AccountProfile>;
    return {
      nickname: String(parsed.nickname ?? '').trim(),
      avatarDataUrl: typeof parsed.avatarDataUrl === 'string' ? parsed.avatarDataUrl : undefined,
    };
  } catch {
    return { nickname: '' };
  }
}

export function updateAccountProfile(
  userId: string,
  profile: Partial<AccountProfile>
): { ok: boolean; user?: SessionUser; error?: string } {
  try {
    const current = getCurrentUser();
    const nextProfile: AccountProfile = {
      ...readAccountProfile(userId),
      ...profile,
      nickname: String(profile.nickname ?? readAccountProfile(userId).nickname ?? '').trim(),
    };
    if (!nextProfile.nickname && current?.id === userId) nextProfile.nickname = current.username;
    localStorage.setItem(`${PROFILE_KEY_PREFIX}${userId}`, JSON.stringify(nextProfile));
    if (nextProfile.avatarDataUrl) localStorage.setItem(`${AVATAR_KEY_PREFIX}${userId}`, nextProfile.avatarDataUrl);
    else localStorage.removeItem(`${AVATAR_KEY_PREFIX}${userId}`);
    if (current?.id === userId) {
      const nextUser = {
        ...current,
        nickname: nextProfile.nickname || current.username,
        avatarDataUrl: nextProfile.avatarDataUrl,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextUser));
      return { ok: true, user: nextUser };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: '保存账号信息失败' };
  }
}

function writeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function writeSupabaseToken(token?: string): void {
  if (token) localStorage.setItem(SUPABASE_TOKEN_KEY, token);
  else localStorage.removeItem(SUPABASE_TOKEN_KEY);
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSupabaseAccessToken(): string | null {
  try {
    return localStorage.getItem(SUPABASE_TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SUPABASE_TOKEN_KEY);
}

export function getCurrentUser(): SessionUser | null {
  return readSession();
}
export interface RegisterResult {
  success: boolean;
  error?: string;
}

export async function register(account: string, password: string): Promise<RegisterResult> {
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string; supabaseAccessToken?: string; user?: { id: string; email?: string; account?: string; role?: 'admin' | 'user' } };
    if (!res.ok || !body.ok || !body.token || !body.user) {
      return { success: false, error: body.error || '注册失败' };
    }
    writeToken(body.token);
    writeSupabaseToken(body.supabaseAccessToken);
    writeSession({ id: body.user.id, username: body.user.account || body.user.email || account, email: body.user.email, role: body.user.role });
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '注册失败' };
  }
}
export interface LoginResult {
  success: boolean;
  user?: SessionUser;
  error?: string;
}

export async function login(account: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string; supabaseAccessToken?: string; user?: { id: string; email?: string; account?: string; role?: 'admin' | 'user' } };
    if (!res.ok || !body.ok || !body.token || !body.user) {
      return { success: false, error: body.error || '登录失败' };
    }
    writeToken(body.token);
    writeSupabaseToken(body.supabaseAccessToken);
    writeSession({ id: body.user.id, username: body.user.account || body.user.email || account, email: body.user.email, role: body.user.role });
    return { success: true, user: getCurrentUser() ?? undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '登录失败' };
  }
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
  clearToken();
}
export interface SavedCredentials {
  account: string;
  email?: string;
  password: string;
}

export function saveCreds(account: string, password: string): void {
  localStorage.setItem(SAVED_CREDS_KEY, JSON.stringify({ account, password }));
}

export function loadCreds(): SavedCredentials | null {
  try {
    const raw = localStorage.getItem(SAVED_CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedCredentials;
    if (!parsed.account && parsed.email) return { account: parsed.email, email: parsed.email, password: parsed.password };
    return parsed;
  } catch {
    return null;
  }
}

export function clearCreds(): void {
  localStorage.removeItem(SAVED_CREDS_KEY);
}

export async function changePassword(password: string): Promise<{ ok: boolean; error?: string }> {
  const next = password.trim();
  if (next.length < 6) return { ok: false, error: '密码至少 6 位' };
  try {
    const token = getAuthToken();
    if (!token) return { ok: false, error: '未登录' };
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, supabaseAccessToken: getSupabaseAccessToken(), password: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) return { ok: false, error: body.error || '修改密码失败' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '修改密码失败' };
  }
}

export function updateUserAvatar(
  userId: string,
  dataUrl: string | null
): { ok: boolean; error?: string } {
  try {
    const profile = readAccountProfile(userId);
    const res = updateAccountProfile(userId, { ...profile, avatarDataUrl: dataUrl ?? undefined });
    if (!res.ok) return { ok: false, error: res.error };
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
