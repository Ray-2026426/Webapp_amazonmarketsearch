/** MCP 数据源配置（可多家）+ 应用功能开关（仅存本机浏览器） */

const MCP_KEY = 'amzdev_mcp_settings';
const FEATURES_KEY = 'amzdev_feature_flags';

export const DEFAULT_SELLERSPRITE_MCP_URL = 'https://mcp.sellersprite.com/mcp';
/** 经 Vite / Vercel 反代，避免浏览器跨域 */
export const SELLERSPRITE_MCP_PROXY_PATH = '/api-proxy/sellersprite-mcp';

export const DEFAULT_LINGXING_MCP_URL = 'https://openmcp.lingxing.com/mcp-servers/lingxing-mcp';
export const LINGXING_MCP_PROXY_PATH = '/api-proxy/lingxing-mcp';

export type McpProviderKind = 'sellersprite' | 'lingxing' | 'custom';

/** 单条 MCP 数据源 */
export interface McpProviderEntry {
  id: string;
  /** 展示名称，如「卖家精灵」「自建中转」 */
  name: string;
  kind: McpProviderKind;
  secretKey: string;
  /**
   * MCP 地址。
   * 卖家精灵：留空 = 走本应用反代（推荐）。
   * 其他：填完整 URL（需可跨域，或填你自己的同源代理路径）。
   */
  mcpUrl: string;
  enabled: boolean;
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
    secretKey: (partial?.secretKey || '').trim(),
    mcpUrl: (partial?.mcpUrl || '').trim(),
    enabled: partial?.enabled !== false,
  };
}

export function createLingXingProvider(partial?: Partial<McpProviderEntry>): McpProviderEntry {
  return {
    id: partial?.id || `lx_${uid()}`,
    name: partial?.name || '领星',
    kind: 'lingxing',
    secretKey: (partial?.secretKey || '').trim(),
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

function normalizeProviders(raw: Partial<McpSettings>): McpProviderEntry[] {
  if (Array.isArray(raw.providers) && raw.providers.length > 0) {
    return raw.providers.map((p) => {
      const kind: McpProviderKind =
        p.kind === 'lingxing' ? 'lingxing' : p.kind === 'custom' ? 'custom' : 'sellersprite';
      return {
        id: p.id || uid(),
        name: String(p.name || (kind === 'sellersprite' ? '卖家精灵' : kind === 'lingxing' ? '领星' : '自定义 MCP')).trim(),
        kind,
        secretKey: String(p.secretKey ?? '').trim(),
        mcpUrl: String(p.mcpUrl ?? '').trim(),
        enabled: p.enabled !== false,
      };
    });
  }
  // 旧版：只有 secretKey / mcpUrl → 迁成一条卖家精灵
  return [
    createSellerSpriteProvider({
      secretKey: String(raw.secretKey ?? '').trim(),
      mcpUrl: String(raw.mcpUrl ?? '').trim(),
    }),
  ];
}

export function loadMcpSettings(): McpSettings {
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
    secretKey: '',
    mcpUrl: '',
    providers: [
      createLingXingProvider({ secretKey: '' }),
      createSellerSpriteProvider(),
    ],
  };
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

export function saveMcpSettings(settings: McpSettings): void {
  const providers = (settings.providers?.length
    ? settings.providers
    : [createSellerSpriteProvider({ secretKey: settings.secretKey, mcpUrl: settings.mcpUrl })]
  ).map((p) => {
    const mcpUrl =
      p.kind === 'sellersprite' && isOfficialSellerSpriteMcpUrl(p.mcpUrl)
        ? ''
        : p.kind === 'lingxing' && isOfficialLingXingMcpUrl(p.mcpUrl)
        ? ''
        : p.mcpUrl.trim();
    return {
      ...p,
      name: p.name.trim() || (p.kind === 'sellersprite' ? '卖家精灵' : p.kind === 'lingxing' ? '领星' : '自定义 MCP'),
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
