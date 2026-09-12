// M5 安全加固：前端**不再保存密钥**，只保存"服务端配没配 + 指纹"。
//
// 改动前：`/api/settings/get` 把密钥明文下发，这里存进 localStorage，MCP 直接在浏览器里带密钥调用。
// 后果：任何能打开浏览器的人都能取走密钥；XSS 一次就全泄露。
//
// 现在：
//   - 只缓存状态（configured + fingerprint），用于设置页显示"服务端已配置（sk-…cdef）"；
//   - `getDefaultServerKey` 一律返回空串（保留函数签名是为了不破坏调用点，语义已变为"前端拿不到密钥"）；
//   - 旧版存过明文的浏览器，用 `migrateLegacyKeys` 一次性把明文推给服务端并**删除本地副本**。

import { describeKeys, type KeyStatus } from './keyMasking';

export type ServerKeyName = 'deepseek' | 'sellersprite' | 'xydc' | 'lingxing' | 'sorftime';

export type ServerKeys = Partial<Record<ServerKeyName, string>>;
export type ServerKeyStatuses = Record<string, KeyStatus>;

/** 旧版存明文用的键（迁移后会被删除） */
const LEGACY_STORAGE_KEY = 'amzdev_admin_keys';
/** 新版只存状态（不是秘密） */
const STATUS_STORAGE_KEY = 'amzdev_admin_key_status';

export function loadKeyStatuses(): ServerKeyStatuses {
  try {
    const raw = JSON.parse(localStorage.getItem(STATUS_STORAGE_KEY) || '{}') as ServerKeyStatuses;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function saveKeyStatuses(statuses: ServerKeyStatuses): void {
  try {
    localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(statuses ?? {}));
  } catch {
    /* ignore */
  }
}

/** 旧版明文缓存（只为迁移用；新代码不要读它） */
export function loadLegacyKeys(): ServerKeys {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '{}') as ServerKeys;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** 删除本地明文副本（迁移成功或用户确认后调用） */
export function clearLegacyKeys(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 前端**不再持有**密钥：这个函数保留是为了兼容既有调用点，永远返回空串。
 * 需要密钥的调用必须走服务端网关（/api/data/*）。
 */
export function getDefaultServerKey(_name: keyof ServerKeys): string {
  return '';
}

/** 取服务端密钥状态（只回状态与指纹，不回值） */
export async function fetchServerKeyStatuses(token: string): Promise<ServerKeyStatuses> {
  try {
    const res = await fetch('/api/settings/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; keys?: ServerKeyStatuses };
    if (!body.ok || !body.keys) return {};
    // 防御：万一服务端将来"手滑"回了明文，这里也不会把它存进 localStorage（只留指纹）
    const safe: ServerKeyStatuses = {};
    for (const [k, v] of Object.entries(body.keys)) {
      safe[k] = {
        configured: Boolean((v as KeyStatus)?.configured ?? v),
        fingerprint: String((v as KeyStatus)?.fingerprint ?? '').trim(),
      };
    }
    saveKeyStatuses(safe);
    return safe;
  } catch {
    return {};
  }
}

/** 兼容旧名（设置页老代码调用） */
export async function fetchServerKeys(token: string): Promise<ServerKeyStatuses> {
  return fetchServerKeyStatuses(token);
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

export interface LegacyMigrationResult {
  migrated: boolean;
  names: ServerKeyName[];
  message: string;
}

/**
 * 一次性迁移：把浏览器里残留的明文密钥推到服务端，然后删掉本地副本。
 * 只在真的有明文时才动作；推不上去就**保留**本地副本并如实告知（不能悄悄丢密钥）。
 */
export async function migrateLegacyKeys(token: string): Promise<LegacyMigrationResult> {
  const legacy = loadLegacyKeys();
  const names = (Object.keys(legacy) as ServerKeyName[]).filter((k) => String(legacy[k] || '').trim().length > 0);
  if (names.length === 0) {
    return { migrated: false, names: [], message: '本地没有残留的明文密钥（无需迁移）' };
  }
  const ok = await pushServerKeys(token, legacy);
  if (!ok) {
    return {
      migrated: false,
      names,
      message: `发现 ${names.length} 个本地明文密钥，但推送到服务端失败：已保留本地副本，请检查登录状态后重试（不要手动清空）`,
    };
  }
  clearLegacyKeys();
  const statuses = await fetchServerKeyStatuses(token);
  return {
    migrated: true,
    names,
    message: `已把 ${names.length} 个密钥迁移到服务端并清除浏览器副本（当前服务端状态：${Object.entries(statuses)
      .map(([k, v]) => `${k}=${v.configured ? '已配置' : '未配置'}`)
      .join('、')}）`,
  };
}

/** 便捷状态查询（设置页显示用） */
export function keyStatusSummary(name: ServerKeyName): string {
  const s = loadKeyStatuses()[name];
  if (!s) return '未知（尚未从服务端读取）';
  return s.configured ? `服务端已配置（${s.fingerprint}）` : '服务端未配置';
}

/** 给测试用的纯函数：把任意对象规整成"只有状态"的结构 */
export function toStatusOnly(values: Record<string, unknown>): ServerKeyStatuses {
  return describeKeys(values);
}
