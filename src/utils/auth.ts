// Local authentication — stores users in localStorage (no backend needed)

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
  /** JPEG Data URL，体积已压缩 */
  avatarDataUrl?: string;
}

/** 当前登录会话（与 User 中头像同步） */
export interface SessionUser {
  id: string;
  username: string;
  avatarDataUrl?: string;
}

const USERS_KEY = 'amzdev_users';
const SESSION_KEY = 'amzdev_session';
const SAVED_CREDS_KEY = 'amzdev_saved_creds';

/** 部分内置浏览器/非 HTTPS 环境没有 crypto.randomUUID，会导致注册直接报错 */
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

function hashPassword(password: string): string {
  let hash = 0;
  const str = password + 'amzdev_salt_2024';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function getUsers(): User[] {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveUsers(users: User[]): void {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch (e) {
    const msg = e instanceof DOMException && e.name === 'QuotaExceededError'
      ? '浏览器存储已满，无法保存账号，请清理站点数据后重试'
      : '无法写入本地存储（可能被禁用或无痕模式限制），请检查浏览器设置';
    throw new Error(msg);
  }
}

function sessionPayload(user: User): SessionUser {
  return {
    id: user.id,
    username: user.username,
    ...(user.avatarDataUrl ? { avatarDataUrl: user.avatarDataUrl } : {}),
  };
}

function writeSession(user: User): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessionPayload(user)));
}

export function register(
  username: string,
  password: string
): { success: boolean; error?: string } {
  try {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length < 2) {
      return { success: false, error: '用户名至少需要 2 个字符' };
    }
    if (password.length < 6) {
      return { success: false, error: '密码至少需要 6 位' };
    }

    const parsed = getUsers();
    const users = Array.isArray(parsed) ? parsed : [];
    if (users.find(u => u.username.toLowerCase() === trimmed.toLowerCase())) {
      return { success: false, error: '该用户名已被注册' };
    }

    const newUser: User = {
      id: createUserId(),
      username: trimmed,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    saveUsers(users);
    return { success: true };
  } catch (e) {
    console.error('register', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : '注册失败，请重试',
    };
  }
}

export function login(
  username: string,
  password: string
): { success: boolean; user?: User; error?: string } {
  try {
    const trimmed = username.trim();
    const raw = getUsers();
    const users = Array.isArray(raw) ? raw : [];
    const user = users.find(u => u.username.toLowerCase() === trimmed.toLowerCase());
    if (!user) {
      return { success: false, error: '用户名不存在' };
    }
    if (user.passwordHash !== hashPassword(password)) {
      return { success: false, error: '密码错误' };
    }
    try {
      writeSession(user);
    } catch (e) {
      console.error('login session', e);
      return {
        success: false,
        error: '无法写入登录状态（本地存储可能被禁用），请更换浏览器或关闭无痕模式',
      };
    }
    return { success: true, user };
  } catch (e) {
    console.error('login', e);
    return { success: false, error: '登录过程异常，请重试' };
  }
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getCurrentUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionUser;
    if (!s?.id || !s?.username) return null;
    return s;
  } catch {
    return null;
  }
}

/** 更新头像并写回账号库与当前会话（仅注册用户使用） */
export function updateUserAvatar(
  userId: string,
  dataUrl: string | null
): { ok: boolean; error?: string } {
  try {
    const users = Array.isArray(getUsers()) ? getUsers() : [];
    const u = users.find((x) => x.id === userId);
    if (!u) return { ok: false, error: '用户不存在' };
    if (dataUrl === null || dataUrl === '') {
      delete u.avatarDataUrl;
    } else {
      u.avatarDataUrl = dataUrl;
    }
    saveUsers(users);
    const sess = getCurrentUser();
    if (sess?.id === userId) {
      writeSession(u);
    }
    return { ok: true };
  } catch (e) {
    console.error('updateUserAvatar', e);
    return { ok: false, error: e instanceof Error ? e.message : '保存失败' };
  }
}

export interface SavedCredentials {
  username: string;
  password: string;
}

export function saveCreds(username: string, password: string): void {
  localStorage.setItem(SAVED_CREDS_KEY, JSON.stringify({ username, password }));
}

export function loadCreds(): SavedCredentials | null {
  try {
    const raw = localStorage.getItem(SAVED_CREDS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearCreds(): void {
  localStorage.removeItem(SAVED_CREDS_KEY);
}
