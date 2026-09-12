// 认证：应用自己的账号体系。注册/登录走后端 API，后端统一用 service_role 访问
// 同一个 Supabase 数据库，并按 app_users.id 隔离数据。客户端不直接接触 Supabase。

export interface SessionUser {
  id: string;
  username: string;
  email?: string;
  avatarDataUrl?: string;
  role?: 'admin' | 'user';
}

const SESSION_KEY = 'amzdev_session';
const TOKEN_KEY = 'amzdev_auth_token';
const SUPABASE_TOKEN_KEY = 'amzdev_supabase_access_token';
const SAVED_CREDS_KEY = 'amzdev_saved_creds';
const AVATAR_KEY_PREFIX = 'amzdev_avatar_';

function adminEmails(): string[] {
  const raw = String(import.meta.env?.VITE_ADMIN_EMAILS ?? '').trim();
  return raw
    ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
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
    const avatar = localStorage.getItem(`${AVATAR_KEY_PREFIX}${s.id}`);
    return avatar ? { ...s, avatarDataUrl: avatar } : s;
  } catch {
    return null;
  }
}

/**
 * 写入本地会话。
 * 管理员身份**优先采信服务端**（登录/注册/me 返回的 isAdmin，来源是服务端 ADMIN_EMAILS 白名单）；
 * 只有服务端没给这一项时才回退到构建期注入的 VITE_ADMIN_EMAILS（兼容老响应）。
 */
function writeSession(user: { id: string; username: string; email?: string; isAdmin?: boolean }): void {
  const session: SessionUser = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.isAdmin === true || (user.isAdmin !== false && isAdminEmail(user.email)) ? 'admin' : 'user',
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * 用已有 token 向服务端确认一次管理员身份。
 * 场景：管理员白名单（ADMIN_EMAILS）改过之后，用户刷新页面即可生效 —— 不用退出重登，
 * 更不用为了加一个管理员而重新部署（VITE_* 是构建期注入，改了必须重打包）。
 * 失败时静默保留本地会话，不影响离线/后端不可用的情形。
 */
export async function refreshAdminFlag(): Promise<SessionUser | null> {
  const current = getCurrentUser();
  const token = getAuthToken();
  if (!current || !token) return current;
  try {
    const res = await fetch('/api/auth/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return current;
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      user?: { id: string; email?: string; account?: string; isAdmin?: boolean };
    };
    if (!body.ok || !body.user || body.user.isAdmin === undefined) return current;
    writeSession({
      id: body.user.id || current.id,
      username: body.user.account || current.username,
      email: body.user.email || current.email,
      isAdmin: body.user.isAdmin === true,
    });
    return getCurrentUser();
  } catch {
    return current;
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
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string; supabaseAccessToken?: string; user?: { id: string; email?: string; account?: string; isAdmin?: boolean } };
    if (!res.ok || !body.ok || !body.token || !body.user) {
      return { success: false, error: body.error || '注册失败' };
    }
    writeToken(body.token);
    writeSupabaseToken(body.supabaseAccessToken);
    writeSession({ id: body.user.id, username: body.user.account || body.user.email || account, email: body.user.email, isAdmin: body.user.isAdmin });
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
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string; supabaseAccessToken?: string; user?: { id: string; email?: string; account?: string; isAdmin?: boolean } };
    if (!res.ok || !body.ok || !body.token || !body.user) {
      return { success: false, error: body.error || '登录失败' };
    }
    writeToken(body.token);
    writeSupabaseToken(body.supabaseAccessToken);
    writeSession({ id: body.user.id, username: body.user.account || body.user.email || account, email: body.user.email, isAdmin: body.user.isAdmin });
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
