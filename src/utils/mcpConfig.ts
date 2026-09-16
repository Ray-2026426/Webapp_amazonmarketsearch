/** MCP 数据源配置（可多家）+ 应用功能开关 */
//
// §15.28（2026-09 用户原话：「我的mcp没有跟着账号走吗，需要跟着账号」）：
//   用户自己的 MCP Key 不再存本机 —— 它由服务端按账号存（表 public.user_provider_keys），
//   换设备 / 换浏览器登录同一账号就能取到。页面**永远看不到明文**，只拿"配没配 + 指纹"。
//
// 所以本文件只保存**非密钥**配置：id / 名称 / 地址 / 启用 / kind。三条硬约束（改了就是事故）：
//   ① 平台 Key 绝不注入浏览器：不从 env / 服务端读取任何 Key 来预填输入框；
//   ② 本机**不保存任何明文密钥**：只有一次性迁移路径会短暂读出旧副本，写进账号成功后立刻删除；
//   ③ 密钥读写只走同源 /api/data/keyList | keySet | keyClear（服务端按 JWT 的 userId 认人）。
import { getAuthToken, getCurrentUser, isAdminSession } from './auth';
import { maskKey } from './keyMasking';
import { sanitizeUserKey } from './mcpRequestKey';

const MCP_KEY = 'amzdev_mcp_settings';
const FEATURES_KEY = 'amzdev_feature_flags';

export const DEFAULT_SELLERSPRITE_MCP_URL = 'https://mcp.sellersprite.com/mcp';
/** 经 Vite / Vercel 反代，避免浏览器跨域 */
export const SELLERSPRITE_MCP_PROXY_PATH = '/api-proxy/sellersprite-mcp';

export const DEFAULT_LINGXING_MCP_URL = 'https://openmcp.lingxing.com/mcp-servers/lingxing-mcp';
export const LINGXING_MCP_PROXY_PATH = '/api-proxy/lingxing-mcp';

export const DEFAULT_XYDC_MCP_URL = 'https://mcp.xydc.com/mcp';
export const XYDC_MCP_PROXY_PATH = '/api-proxy/xydc-mcp';

export const DEFAULT_SORFTIME_MCP_URL = 'https://mcp.sorftime.com';
export const SORFTIME_MCP_PROXY_PATH = '/api-proxy/sorftime-mcp';

export type McpProviderKind = 'sellersprite' | 'lingxing' | 'xydc' | 'sorftime' | 'custom';

/** 服务端密钥表里的 provider 取值：与本文件的 kind 一一对应（custom = 自定义 MCP 的那一格） */
export const MCP_KEY_PROVIDERS: McpProviderKind[] = ['sellersprite', 'xydc', 'lingxing', 'sorftime', 'custom'];

function getMcpSettingsKey(): string {
  const user = getCurrentUser();
  return user?.id ? `${MCP_KEY}__${user.id}` : MCP_KEY;
}

function canUseAdminMcpDefaults(): boolean {
  return isAdminSession(getCurrentUser());
}

/** 单条 MCP 数据源（**不含密钥**：密钥在服务端，按账号存） */
export interface McpProviderEntry {
  id: string;
  /** 展示名称，如「卖家精灵」「自建中转」 */
  name: string;
  kind: McpProviderKind;
  /**
   * MCP 地址。
   * 卖家精灵 / 西柚 / 领星 / Sorftime：留空 = 走本应用反代（推荐）。
   * 其他：填完整 URL（需可跨域，或填你自己的同源代理路径）。
   */
  mcpUrl: string;
  enabled: boolean;
}

function providerKindLabel(kind: McpProviderKind): string {
  if (kind === 'sellersprite') return '卖家精灵';
  if (kind === 'lingxing') return '领星';
  if (kind === 'xydc') return '西柚洞察';
  if (kind === 'sorftime') return 'Sorftime';
  return '自定义 MCP';
}

export interface McpSettings {
  /** @deprecated 兼容旧版：镜像卖家精灵条目的地址（非密钥，留着你也不用管） */
  mcpUrl: string;
  providers: McpProviderEntry[];
}

export interface AppFeatureFlags {
  /** 市场大盘「市场准入评估」评分卡，默认关闭 */
  showMarketScorecard: boolean;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createSellerSpriteProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `ss_${uid()}`,
    name: partial?.name || '卖家精灵',
    kind: 'sellersprite',
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function createLingXingProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `lx_${uid()}`,
    name: partial?.name || '领星',
    kind: 'lingxing',
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function createCustomProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `custom_${uid()}`,
    name: partial?.name || '自定义 MCP',
    kind: 'custom',
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function createXydcProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `xydc_${uid()}`,
    name: partial?.name || '西柚洞察',
    kind: 'xydc',
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function createSorftimeProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `sorf_${uid()}`,
    name: partial?.name || 'Sorftime',
    kind: 'sorftime',
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function parseProviderKind(raw: unknown): McpProviderKind {
  if (raw === 'lingxing') return 'lingxing';
  if (raw === 'xydc') return 'xydc';
  if (raw === 'sorftime') return 'sorftime';
  if (raw === 'custom') return 'custom';
  return 'sellersprite';
}

/** 保证四家内置数据源默认存在（Key 一律由服务端按账号管理，这里不涉及） */
function ensureBuiltinProviders(providers: McpProviderEntry[]): McpProviderEntry[] {
  const list = [...providers];
  if (!list.some((p) => p.kind === 'lingxing')) {
    list.unshift(createLingXingProvider());
  }
  if (!list.some((p) => p.kind === 'sellersprite')) {
    const lxIdx = list.findIndex((p) => p.kind === 'lingxing');
    list.splice(lxIdx >= 0 ? lxIdx + 1 : 0, 0, createSellerSpriteProvider());
  }
  if (!list.some((p) => p.kind === 'xydc')) {
    list.push(createXydcProvider());
  }
  if (!list.some((p) => p.kind === 'sorftime')) {
    list.push(createSorftimeProvider());
  }
  return list;
}

/** 归一化：**只取非密钥字段**（旧的 secretKey 读进来就被丢掉，唯一例外是迁移路径） */
function normalizeProviders(raw: Partial<McpSettings>): McpProviderEntry[] {
  const source = Array.isArray(raw.providers) ? raw.providers : [];
  if (source.length > 0) {
    const mapped = source.map((p) => {
      const kind = parseProviderKind(p.kind);
      return {
        id: p.id || uid(),
        name: String(p.name || providerKindLabel(kind)).trim(),
        kind,
        mcpUrl: String(p.mcpUrl ?? '').trim(),
        enabled: p.enabled !== false,
      };
    });
    return ensureBuiltinProviders(mapped);
  }
  // 旧版：只有 mcpUrl → 迁成完整四家
  return ensureBuiltinProviders([createSellerSpriteProvider({ mcpUrl: String(raw.mcpUrl ?? '').trim() })]);
}

function loadMcpSettingsRaw(): McpSettings {
  try {
    const storageKey = getMcpSettingsKey();
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<McpSettings>;
      const providers = normalizeProviders(parsed);
      const ss = providers.find((p) => p.kind === 'sellersprite' && p.enabled)
        || providers.find((p) => p.kind === 'sellersprite')
        || providers[0];
      return { mcpUrl: ss?.mcpUrl || '', providers };
    }
    const legacyRaw = canUseAdminMcpDefaults() ? localStorage.getItem(MCP_KEY) : null;
    if (legacyRaw) {
      localStorage.setItem(storageKey, legacyRaw);
      const parsed = JSON.parse(legacyRaw) as Partial<McpSettings>;
      const providers = normalizeProviders(parsed);
      const ss = providers.find((p) => p.kind === 'sellersprite' && p.enabled)
        || providers.find((p) => p.kind === 'sellersprite')
        || providers[0];
      return { mcpUrl: ss?.mcpUrl || '', providers };
    }
  } catch {
    /* ignore */
  }
  return {
    mcpUrl: '',
    providers: [
      createLingXingProvider(),
      createSellerSpriteProvider(),
      createXydcProvider(),
      createSorftimeProvider(),
    ],
  };
}

export function loadMcpSettings(): McpSettings {
  return loadMcpSettingsRaw();
}

/**
 * 管理员默认 MCP：四家齐全 + 结构对齐（换版本后仍可用）。会写回 localStorage。
 * 注意：只保证结构，不涉及任何密钥（密钥在服务端按账号存）。
 */
export function ensureAdminMcpDefaults(): McpSettings {
  if (!canUseAdminMcpDefaults()) {
    return loadMcpSettingsRaw();
  }
  const current = loadMcpSettingsRaw();
  saveMcpSettings(current);
  return current;
}

export function isOfficialSellerSpriteMcpUrl(url: string): boolean {
  const u = url.trim().toLowerCase().replace(/\/+$/, '');
  if (!u) return true;
  return /mcp\.sellersprite\.com/i.test(u);
}

/** 卖家精灵实际请求 endpoint：官方地址一律走同源反代 */
export function getSellerSpriteEndpoint(mcpUrl?: string): string {
  const custom = (mcpUrl ?? '').trim().replace(/\/+$/, '');
  if (!custom || isOfficialSellerSpriteMcpUrl(custom)) {
    return SELLERSPRITE_MCP_PROXY_PATH;
  }
  return custom;
}

/** @deprecated 用 getActiveSellerSpriteProvider + getSellerSpriteEndpoint */
export function getEffectiveMcpEndpoint(settings?: McpSettings | null): string {
  const s = settings ?? loadMcpSettings();
  const ss = getActiveSellerSpriteProvider(s);
  return getSellerSpriteEndpoint(ss?.mcpUrl);
}

/** 当前用于抓数的卖家精灵配置（优先启用中的第一条） */
export function getActiveSellerSpriteProvider(settings?: McpSettings | null): McpProviderEntry | null {
  const s = settings ?? loadMcpSettings();
  const list = s.providers?.length ? s.providers : normalizeProviders(s);
  return list.find((p) => p.kind === 'sellersprite' && p.enabled) || list.find((p) => p.kind === 'sellersprite') || null;
}

/** 当前用于抓数的领星配置（优先启用中的第一条） */
export function getActiveLingXingProvider(settings?: McpSettings | null): McpProviderEntry | null {
  const s = settings ?? loadMcpSettings();
  const list = s.providers?.length ? s.providers : normalizeProviders(s);
  return list.find((p) => p.kind === 'lingxing' && p.enabled) || list.find((p) => p.kind === 'lingxing') || null;
}

/** 当前用于抓数的西柚洞察配置（优先启用中的第一条） */
export function getActiveXydcProvider(settings?: McpSettings | null): McpProviderEntry | null {
  const s = settings ?? loadMcpSettings();
  const list = s.providers?.length ? s.providers : normalizeProviders(s);
  return list.find((p) => p.kind === 'xydc' && p.enabled) || list.find((p) => p.kind === 'xydc') || null;
}

export function getActiveSorftimeProvider(settings?: McpSettings | null): McpProviderEntry | null {
  const s = settings ?? loadMcpSettings();
  const list = s.providers?.length ? s.providers : normalizeProviders(s);
  return list.find((p) => p.kind === 'sorftime' && p.enabled) || list.find((p) => p.kind === 'sorftime') || null;
}

export function isOfficialLingXingMcpUrl(url: string): boolean {
  const u = url.trim().toLowerCase().replace(/\/+$/, '');
  if (!u) return true;
  return /openmcp\.lingxing\.com/i.test(u) || /mcp\.lingxing\.com/i.test(u);
}

/** 领星实际请求 endpoint：官方地址一律走同源反代 */
export function getLingXingEndpoint(mcpUrl?: string): string {
  const custom = (mcpUrl ?? '').trim().replace(/\/+$/, '');
  if (!custom || isOfficialLingXingMcpUrl(custom)) {
    return LINGXING_MCP_PROXY_PATH;
  }
  return custom;
}

export function isOfficialXydcMcpUrl(url: string): boolean {
  const u = url.trim().toLowerCase().replace(/\/+$/, '');
  if (!u) return true;
  return /mcp\.xydc\.com/i.test(u);
}

/** 西柚实际请求 endpoint：官方地址一律走同源反代 */
export function getXydcEndpoint(mcpUrl?: string): string {
  const custom = (mcpUrl ?? '').trim().replace(/\/+$/, '');
  if (!custom || isOfficialXydcMcpUrl(custom)) {
    return XYDC_MCP_PROXY_PATH;
  }
  return custom;
}

export function isOfficialSorftimeMcpUrl(url: string): boolean {
  const u = url.trim().toLowerCase().replace(/\/+$/, '');
  if (!u) return true;
  return /mcp\.sorftime\.com/i.test(u);
}

/**
 * Sorftime 实际请求 endpoint：官方地址一律走同源反代。
 *
 * 安全红线：**Key 不得进入 URL query**（query 会进浏览器历史、代理日志、Referer 与审计记录），
 * 所以这个函数不拼 `?key=`。第二个参数保留是为了不改调用点签名，但**刻意忽略**它。
 */
export function getSorftimeEndpoint(mcpUrl?: string, _secretKey?: string): string {
  const custom = (mcpUrl ?? '').trim().replace(/\/+$/, '');
  if (!custom || isOfficialSorftimeMcpUrl(custom.split('?')[0] || custom)) {
    return SORFTIME_MCP_PROXY_PATH;
  }
  return custom;
}

/* ───────────── 密钥：按账号存在服务端（页面只拿状态与指纹） ───────────── */

export interface UserKeyStatus {
  configured: boolean;
  /** 服务端 maskKey 产出的指纹（如 `sk-1…ab12`）；空串 = 还没读到或未配置 */
  fingerprint: string;
}

export type UserKeyStatuses = Partial<Record<McpProviderKind, UserKeyStatus>>;

/** 进程内状态缓存（**不是密钥**：只有 configured + 指纹，刷新页面重新拉） */
let keyStatusCache: UserKeyStatuses = {};

const UNKNOWN_STATUS: UserKeyStatus = { configured: false, fingerprint: '' };

/**
 * 只接受服务端给的**掩码**：maskKey 的产物一定带省略号。
 * 万一服务端将来"手滑"把明文当指纹回传，这里也不会把它存进缓存、更不会显示出来。
 */
function safeStatus(raw: unknown): UserKeyStatus {
  const r = (raw ?? {}) as Partial<UserKeyStatus>;
  const configured = Boolean(r.configured);
  const fingerprint = String(r.fingerprint ?? '').trim();
  return { configured, fingerprint: configured && fingerprint.includes('…') ? fingerprint : '' };
}

/** 同步读缓存（给首屏渲染用；真状态要等 loadUserKeyStatuses 拉回来） */
export function getUserKeyStatus(kind: McpProviderKind): UserKeyStatus {
  return keyStatusCache[kind] ?? UNKNOWN_STATUS;
}

export function cachedUserKeyStatuses(): UserKeyStatuses {
  return { ...keyStatusCache };
}

/** 清掉进程内状态（退出登录 / 换账号时用）：状态缓存 + 一次性迁移的"已跑过"闸门都要放开 */
export function resetUserKeyState(): void {
  keyStatusCache = {};
  migrationSettled = false;
  migrationInFlight = null;
}

interface KeyActionResult {
  ok: boolean;
  error?: string;
  needsMigration?: boolean;
  body: Record<string, unknown>;
}

/** 三个密钥动作的唯一通道：同源 POST /api/data/<action>，token 走请求体（**Key 绝不进 URL query**） */
async function postKeyAction(action: 'keyList' | 'keySet' | 'keyClear', payload: Record<string, unknown>): Promise<KeyActionResult> {
  const token = getAuthToken();
  if (!token) return { ok: false, error: '未登录：密钥按账号保存，登录后才能使用', body: {} };
  try {
    const res = await fetch(`/api/data/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...payload }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const ok = res.ok && body.ok !== false;
    return {
      ok,
      error: ok ? undefined : String(body.error || `HTTP ${res.status}`),
      needsMigration: body.needsMigration === true,
      body,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '网络错误', body: {} };
  }
}

/**
 * 登录后读各数据源在本账号上的密钥状态（**只回 configured + 指纹，服务器不回明文**）。
 * 顺手做一次旧本机密钥迁移 —— 这是"换设备也能用"里那台**老设备**的收口动作。
 */
export async function loadUserKeyStatuses(): Promise<{ ok: boolean; keys: UserKeyStatuses; error?: string; needsMigration?: boolean }> {
  await migrateLegacyLocalKeys();
  const res = await postKeyAction('keyList', {});
  if (!res.ok && Object.keys(res.body).length === 0) {
    return { ok: false, keys: cachedUserKeyStatuses(), error: res.error };
  }
  const raw = (res.body.keys ?? {}) as Record<string, unknown>;
  const keys: UserKeyStatuses = {};
  for (const kind of MCP_KEY_PROVIDERS) keys[kind] = safeStatus(raw[kind]);
  keyStatusCache = keys;
  return { ok: res.ok, keys, error: res.error, needsMigration: res.needsMigration };
}

/**
 * 保存/替换某个数据源的 Key（服务端按 JWT 的 userId 写自己那一行；成功后本地只留指纹）。
 * 校验用**与服务端同一份** `sanitizeUserKey`：空 / 超长（>512）/ 含控制字符一律不合法。
 */
export async function saveUserKey(
  kind: McpProviderKind,
  value: string
): Promise<{ ok: boolean; error?: string; needsMigration?: boolean; fingerprint?: string }> {
  const plain = sanitizeUserKey(value);
  if (!plain) {
    return { ok: false, error: '密钥不合法：不能为空、长度不超过 512、且不能包含控制字符' };
  }
  const res = await postKeyAction('keySet', { provider: kind, value: plain });
  if (!res.ok) return { ok: false, error: res.error, needsMigration: res.needsMigration };
  const fingerprint = safeStatus({ configured: true, fingerprint: res.body.fingerprint }).fingerprint || maskKey(plain);
  keyStatusCache = { ...keyStatusCache, [kind]: { configured: true, fingerprint } };
  return { ok: true, fingerprint };
}

/** 清除某个数据源的 Key（只删自己那一行） */
export async function clearUserKey(kind: McpProviderKind): Promise<{ ok: boolean; error?: string; needsMigration?: boolean }> {
  const res = await postKeyAction('keyClear', { provider: kind });
  if (!res.ok) return { ok: false, error: res.error, needsMigration: res.needsMigration };
  keyStatusCache = { ...keyStatusCache, [kind]: { configured: false, fingerprint: '' } };
  return { ok: true };
}

/* ───────────── 旧本机密钥：一次性迁移到账号里（写完即删） ───────────── */

export interface McpKeyMigrationResult {
  migrated: McpProviderKind[];
  failed: McpProviderKind[];
  message: string;
}

/** 能出现旧明文密钥的本机存储键（分账号之后是 __<userId>，之前是共享的一份） */
function legacyStorageKeys(): string[] {
  const perUser = getMcpSettingsKey();
  // 分账号之前的共享那份只有管理员会话才认：否则同一台电脑上换个账号登录，
  // 就会把上一个用户的 Key 写进新账号里（那等于把别人的额度送人）。
  if (canUseAdminMcpDefaults() && perUser !== MCP_KEY) return [perUser, MCP_KEY];
  return [perUser];
}

/** 读出本机残留的明文密钥（**只给迁移用**，不参与任何"取数用哪个 Key"的判断） */
export function readLegacyLocalKeys(): Partial<Record<McpProviderKind, string>> {
  const out: Partial<Record<McpProviderKind, string>> = {};
  for (const storageKey of legacyStorageKeys()) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { secretKey?: string; providers?: { kind?: unknown; secretKey?: unknown }[] };
      for (const p of Array.isArray(parsed.providers) ? parsed.providers : []) {
        const kind = parseProviderKind(p.kind);
        const value = String(p.secretKey ?? '').trim();
        if (value && !out[kind]) out[kind] = value;
      }
      const top = String(parsed.secretKey ?? '').trim();
      if (top && !out.sellersprite) out.sellersprite = top;
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** 迁移成功后，从本机配置里**删掉**这些明文（不保留两处真相） */
function dropLegacyLocalKeys(kinds: McpProviderKind[]): void {
  for (const storageKey of legacyStorageKeys()) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { secretKey?: string; mcpUrl?: string; providers?: Record<string, unknown>[] };
      const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
      let changed = false;
      const next = providers.map((p) => {
        const kind = parseProviderKind(p.kind);
        if (!kinds.includes(kind) || !String(p.secretKey ?? '').trim()) return p;
        changed = true;
        const { secretKey: _dropped, ...rest } = p;
        return rest;
      });
      if (parsed.secretKey && kinds.includes('sellersprite')) {
        delete parsed.secretKey;
        changed = true;
      }
      if (!changed) continue;
      localStorage.setItem(storageKey, JSON.stringify({ mcpUrl: parsed.mcpUrl ?? '', providers: next }));
    } catch {
      /* ignore */
    }
  }
}

let migrationInFlight: Promise<McpKeyMigrationResult> | null = null;
let migrationSettled = false;

/**
 * 旧本机密钥一次性迁移：本机有旧 `secretKey` → 逐条写进账号（keySet）→ 成功后删掉本机副本。
 *
 * 触发时机（两处，都是"登录之后"）：
 *   · 打开「设置 → MCP 数据」时（loadUserKeyStatuses 里先迁再拉状态）；
 *   · 任何一次数据池调用之前（dataPoolClient 会先 ensure 一次），保证老设备不打开设置也能用。
 * 幂等：同一页面只跑一遍；失败的那几条约会保留本机副本，下次再试（不静默丢密钥）。
 */
export async function migrateLegacyLocalKeys(): Promise<McpKeyMigrationResult> {
  if (migrationSettled) return { migrated: [], failed: [], message: '' };
  if (migrationInFlight) return migrationInFlight;
  migrationInFlight = (async (): Promise<McpKeyMigrationResult> => {
    const legacy = readLegacyLocalKeys();
    const kinds = Object.keys(legacy) as McpProviderKind[];
    if (kinds.length === 0) {
      migrationSettled = true;
      return { migrated: [], failed: [], message: '本机没有待迁移的旧密钥' };
    }
    if (!getAuthToken()) {
      return { migrated: [], failed: kinds, message: `本机还有 ${kinds.length} 个旧密钥，登录后会自动迁到你的账号` };
    }
    const migrated: McpProviderKind[] = [];
    const failed: McpProviderKind[] = [];
    for (const kind of kinds) {
      const res = await postKeyAction('keySet', { provider: kind, value: legacy[kind] });
      if (res.ok) migrated.push(kind);
      else failed.push(kind);
    }
    // 写完即删：本机不再保留明文副本（否则又是两处真相）
    if (migrated.length > 0) dropLegacyLocalKeys(migrated);
    if (failed.length > 0) {
      return {
        migrated,
        failed,
        message: `已迁移 ${migrated.length} 个密钥，还有 ${failed.length} 个没成功：本机副本已保留，请检查登录状态后重试`,
      };
    }
    migrationSettled = true;
    return { migrated, failed, message: `已把 ${migrated.length} 个旧密钥迁到你的账号（本机副本已删除）` };
  })();
  try {
    return await migrationInFlight;
  } finally {
    migrationInFlight = null;
  }
}

/** 迁移期保护：保存设置时把**还没迁移**的旧明文原样留着（否则一次"保存"就把待迁移的 Key 弄丢了） */
function pendingLegacySecretsById(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const storageKey of legacyStorageKeys()) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { providers?: { id?: unknown; secretKey?: unknown }[] };
      for (const p of Array.isArray(parsed.providers) ? parsed.providers : []) {
        const id = String(p.id ?? '');
        const value = String(p.secretKey ?? '').trim();
        if (id && value) out[id] = value;
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** 保存非密钥配置（id / 名称 / 地址 / 启用）。**不涉及密钥**：密钥只走 saveUserKey / clearUserKey */
export function saveMcpSettings(settings: McpSettings): void {
  const providers = ensureBuiltinProviders(
    settings.providers?.length ? settings.providers : [createSellerSpriteProvider({ mcpUrl: settings.mcpUrl })]
  ).map((p) => {
    const mcpUrl =
      p.kind === 'sellersprite' && isOfficialSellerSpriteMcpUrl(p.mcpUrl)
        ? ''
        : p.kind === 'lingxing' && isOfficialLingXingMcpUrl(p.mcpUrl)
        ? ''
        : p.kind === 'xydc' && isOfficialXydcMcpUrl(p.mcpUrl)
        ? ''
        : p.kind === 'sorftime' && isOfficialSorftimeMcpUrl((p.mcpUrl || '').split('?')[0] || p.mcpUrl)
        ? ''
        : p.mcpUrl.trim();
    return { ...p, name: p.name.trim() || providerKindLabel(p.kind), mcpUrl };
  });

  const ss = providers.find((p) => p.kind === 'sellersprite' && p.enabled)
    || providers.find((p) => p.kind === 'sellersprite')
    || providers[0];

  // 唯一的例外：**还没迁移**的旧明文按 id 原样带上（迁移成功后它自己就消失了）。
  // 没有这一段，用户在迁移跑完之前点一次"保存"就会把待迁移的 Key 静默丢掉。
  const pending = pendingLegacySecretsById();
  const withPending = providers.map((p) => {
    const value = String(pending[p.id] ?? '').trim();
    return value ? { ...p, secretKey: value } : p;
  });

  localStorage.setItem(
    getMcpSettingsKey(),
    JSON.stringify({ mcpUrl: ss?.mcpUrl || '', providers: withPending })
  );
  // 安全红线：**到此为止**。新的密钥绝不写 localStorage：一律走 saveUserKey → 服务端按账号保存。
}

export function loadFeatureFlags(): AppFeatureFlags {
  try {
    const raw = localStorage.getItem(FEATURES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppFeatureFlags>;
      return {
        showMarketScorecard: Boolean(parsed.showMarketScorecard),
      };
    }
  } catch {
    /* ignore */
  }
  return { showMarketScorecard: false };
}

export function saveFeatureFlags(flags: AppFeatureFlags): void {
  localStorage.setItem(FEATURES_KEY, JSON.stringify(flags));
}
