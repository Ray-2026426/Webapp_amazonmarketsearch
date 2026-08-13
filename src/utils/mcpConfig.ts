/** MCP 数据源配置（可多家）+ 应用功能开关（仅存本机浏览器） */

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

/**
 * 管理员默认 MCP（与本机 Cursor mcp.json 对齐）。
 * 换版本 / 清缓存后，ensureAdminMcpDefaults 会自动补回。
 */
export const ADMIN_DEFAULT_MCP_KEYS = {
  lingxing: 'b3791d5d4089bfd5a2025b8cdfd1d5ff',
  sellersprite: '51ebe95758734929acf80c61704e2dda',
  xydc: 'mcp_407eba6698f9e99d23ecaad5364e4be6',
  sorftime: 'mddheg1wejzyqlzim2p4d216vmhldz09',
} as const;

/** 单条 MCP 数据源 */
export interface McpProviderEntry {
  id: string;
  /** 展示名称，如「卖家精灵」「自建中转」 */
  name: string;
  kind: McpProviderKind;
  secretKey: string;
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

function envDefaultXydcSecret(): string {
  try {
    return String(import.meta.env?.VITE_DEFAULT_XYDC_SECRET_KEY ?? '').trim();
  } catch {
    return '';
  }
}

function envDefaultSellerSpriteSecret(): string {
  try {
    return String(import.meta.env?.VITE_DEFAULT_SELLERSPRITE_SECRET_KEY ?? '').trim();
  } catch {
    return '';
  }
}

export interface McpSettings {
  /** @deprecated 兼容旧版，写入时会同步到 providers 里的卖家精灵条目 */
  secretKey: string;
  /** @deprecated 兼容旧版 */
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
    secretKey: (partial?.secretKey || envDefaultSellerSpriteSecret() || ADMIN_DEFAULT_MCP_KEYS.sellersprite || '').trim(),
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function createLingXingProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `lx_${uid()}`,
    name: partial?.name || '领星',
    kind: 'lingxing',
    secretKey: (partial?.secretKey || ADMIN_DEFAULT_MCP_KEYS.lingxing || '').trim(),
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function createCustomProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `custom_${uid()}`,
    name: partial?.name || '自定义 MCP',
    kind: 'custom',
    secretKey: (partial?.secretKey || '').trim(),
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function createXydcProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `xydc_${uid()}`,
    name: partial?.name || '西柚洞察',
    kind: 'xydc',
    secretKey: (partial?.secretKey || envDefaultXydcSecret() || ADMIN_DEFAULT_MCP_KEYS.xydc || '').trim(),
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function createSorftimeProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `sorf_${uid()}`,
    name: partial?.name || 'Sorftime',
    kind: 'sorftime',
    secretKey: (partial?.secretKey || ADMIN_DEFAULT_MCP_KEYS.sorftime || '').trim(),
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

function parseProviderKind(raw: unknown): McpProviderKind {
  if (raw === 'lingxing') return 'lingxing';
  if (raw === 'xydc') return 'xydc';
  if (raw === 'sorftime') return 'sorftime';
  if (raw === 'custom') return 'custom';
  return 'sellersprite';
}

/** 保证四家内置数据源默认存在，并在 Key 为空时用管理员默认值补齐 */
function ensureBuiltinProviders(providers: McpProviderEntry[]): McpProviderEntry[] {
  const envXydc = envDefaultXydcSecret() || ADMIN_DEFAULT_MCP_KEYS.xydc;
  const envSs = envDefaultSellerSpriteSecret() || ADMIN_DEFAULT_MCP_KEYS.sellersprite;
  const list = providers.map((p) => {
    if (p.kind === 'xydc' && !p.secretKey.trim() && envXydc) {
      return { ...p, secretKey: envXydc };
    }
    if (p.kind === 'sellersprite' && !p.secretKey.trim() && envSs) {
      return { ...p, secretKey: envSs };
    }
    if (p.kind === 'lingxing' && !p.secretKey.trim()) {
      return { ...p, secretKey: ADMIN_DEFAULT_MCP_KEYS.lingxing };
    }
    if (p.kind === 'sorftime' && !p.secretKey.trim()) {
      return { ...p, secretKey: ADMIN_DEFAULT_MCP_KEYS.sorftime };
    }
    return p;
  });
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

function normalizeProviders(raw: Partial<McpSettings>): McpProviderEntry[] {
  if (Array.isArray(raw.providers) && raw.providers.length > 0) {
    const mapped = raw.providers.map((p) => {
      const kind = parseProviderKind(p.kind);
      return {
        id: p.id || uid(),
        name: String(p.name || providerKindLabel(kind)).trim(),
        kind,
        secretKey: String(p.secretKey ?? '').trim(),
        mcpUrl: String(p.mcpUrl ?? '').trim(),
        enabled: p.enabled !== false,
      };
    });
    return ensureBuiltinProviders(mapped);
  }
  // 旧版：只有 secretKey / mcpUrl → 迁成完整四家
  return ensureBuiltinProviders([
    createSellerSpriteProvider({
      secretKey: String(raw.secretKey ?? '').trim(),
      mcpUrl: String(raw.mcpUrl ?? '').trim(),
    }),
  ]);
}

function loadMcpSettingsRaw(): McpSettings {
  try {
    const raw = localStorage.getItem(MCP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<McpSettings>;
      const providers = normalizeProviders(parsed);
      const ss = providers.find((p) => p.kind === 'sellersprite' && p.enabled)
        || providers.find((p) => p.kind === 'sellersprite')
        || providers[0];
      return {
        secretKey: ss?.secretKey || '',
        mcpUrl: ss?.mcpUrl || '',
        providers,
      };
    }
  } catch {
    /* ignore */
  }
  return {
    secretKey: ADMIN_DEFAULT_MCP_KEYS.sellersprite,
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
 * 管理员默认 MCP：四家齐全 + Key 强制对齐（换版本后仍可用）。
 * 会写回 localStorage。
 */
export function ensureAdminMcpDefaults(): McpSettings {
  const current = loadMcpSettingsRaw();
  const providers = ensureBuiltinProviders(current.providers || []).map((p) => {
    if (p.kind === 'lingxing') {
      return { ...p, secretKey: ADMIN_DEFAULT_MCP_KEYS.lingxing, enabled: true, mcpUrl: '' };
    }
    if (p.kind === 'sellersprite') {
      return { ...p, secretKey: ADMIN_DEFAULT_MCP_KEYS.sellersprite, enabled: true, mcpUrl: '' };
    }
    if (p.kind === 'xydc') {
      return { ...p, secretKey: ADMIN_DEFAULT_MCP_KEYS.xydc, enabled: true, mcpUrl: '' };
    }
    if (p.kind === 'sorftime') {
      return { ...p, secretKey: ADMIN_DEFAULT_MCP_KEYS.sorftime, enabled: true, mcpUrl: '' };
    }
    return p;
  });
  const next: McpSettings = {
    secretKey: ADMIN_DEFAULT_MCP_KEYS.sellersprite,
    mcpUrl: '',
    providers,
  };
  saveMcpSettings(next);
  return next;
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
  return (
    list.find((p) => p.kind === 'sellersprite' && p.enabled && p.secretKey.trim()) ||
    list.find((p) => p.kind === 'sellersprite' && p.enabled) ||
    list.find((p) => p.kind === 'sellersprite') ||
    null
  );
}

/** 当前用于抓数的领星配置（优先启用中的第一条） */
export function getActiveLingXingProvider(settings?: McpSettings | null): McpProviderEntry | null {
  const s = settings ?? loadMcpSettings();
  const list = s.providers?.length ? s.providers : normalizeProviders(s);
  return (
    list.find((p) => p.kind === 'lingxing' && p.enabled && p.secretKey.trim()) ||
    list.find((p) => p.kind === 'lingxing' && p.enabled) ||
    list.find((p) => p.kind === 'lingxing') ||
    null
  );
}

/** 当前用于抓数的西柚洞察配置（优先启用中的第一条） */
export function getActiveXydcProvider(settings?: McpSettings | null): McpProviderEntry | null {
  const s = settings ?? loadMcpSettings();
  const list = s.providers?.length ? s.providers : normalizeProviders(s);
  return (
    list.find((p) => p.kind === 'xydc' && p.enabled && p.secretKey.trim()) ||
    list.find((p) => p.kind === 'xydc' && p.enabled) ||
    list.find((p) => p.kind === 'xydc') ||
    null
  );
}

export function getActiveSorftimeProvider(settings?: McpSettings | null): McpProviderEntry | null {
  const s = settings ?? loadMcpSettings();
  const list = s.providers?.length ? s.providers : normalizeProviders(s);
  return (
    list.find((p) => p.kind === 'sorftime' && p.enabled && p.secretKey.trim()) ||
    list.find((p) => p.kind === 'sorftime' && p.enabled) ||
    list.find((p) => p.kind === 'sorftime') ||
    null
  );
}

export function isOfficialLingXingMcpUrl(url: string): boolean {
  const u = url.trim().toLowerCase().replace(/\/+$/, '');
  if (!u) return true;
  return /openmcp\.lingxing\.com/i.test(u);
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

/** Sorftime：官方地址走同源反代，Key 拼到 query */
export function getSorftimeEndpoint(mcpUrl?: string, secretKey?: string): string {
  const key = (secretKey ?? '').trim();
  const custom = (mcpUrl ?? '').trim().replace(/\/+$/, '');
  if (!custom || isOfficialSorftimeMcpUrl(custom.split('?')[0] || custom)) {
    return key ? `${SORFTIME_MCP_PROXY_PATH}?key=${encodeURIComponent(key)}` : SORFTIME_MCP_PROXY_PATH;
  }
  if (key && !/[?&]key=/.test(custom)) {
    return `${custom}${custom.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
  }
  return custom;
}

export function saveMcpSettings(settings: McpSettings): void {
  const providers = ensureBuiltinProviders(
    settings.providers?.length
      ? settings.providers
      : [createSellerSpriteProvider({ secretKey: settings.secretKey, mcpUrl: settings.mcpUrl })]
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
    return {
      ...p,
      name: p.name.trim() || providerKindLabel(p.kind),
      secretKey: p.secretKey.trim(),
      mcpUrl,
    };
  });

  const ss = providers.find((p) => p.kind === 'sellersprite' && p.enabled)
    || providers.find((p) => p.kind === 'sellersprite')
    || providers[0];

  localStorage.setItem(
    MCP_KEY,
    JSON.stringify({
      secretKey: ss?.secretKey || '',
      mcpUrl: ss?.mcpUrl || '',
      providers,
    } satisfies McpSettings)
  );
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
