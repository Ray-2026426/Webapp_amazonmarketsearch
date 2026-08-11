/** 卖家精灵 MCP + 应用功能开关（仅存本机浏览器） */

const MCP_KEY = 'amzdev_mcp_settings';
const FEATURES_KEY = 'amzdev_feature_flags';

export const DEFAULT_SELLERSPRITE_MCP_URL = 'https://mcp.sellersprite.com/mcp';
/** 经 Vite / Vercel 反代，避免浏览器跨域 */
export const SELLERSPRITE_MCP_PROXY_PATH = '/api-proxy/sellersprite-mcp';

export interface McpSettings {
  /** 卖家精灵 MCP secret-key */
  secretKey: string;
  /**
   * 可选：自定义 MCP 地址。
   * 留空 = 走本应用反代（推荐）；填完整 URL 则尝试直连（可能被跨域拦截）。
   */
  mcpUrl: string;
}

export interface AppFeatureFlags {
  /** 市场大盘「市场准入评估」评分卡，默认关闭 */
  showMarketScorecard: boolean;
}

export function loadMcpSettings(): McpSettings {
  try {
    const raw = localStorage.getItem(MCP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<McpSettings>;
      return {
        secretKey: String(parsed.secretKey ?? '').trim(),
        mcpUrl: String(parsed.mcpUrl ?? '').trim(),
      };
    }
  } catch {
    /* ignore */
  }
  return { secretKey: '', mcpUrl: '' };
}

export function saveMcpSettings(settings: McpSettings): void {
  localStorage.setItem(
    MCP_KEY,
    JSON.stringify({
      secretKey: settings.secretKey.trim(),
      mcpUrl: settings.mcpUrl.trim(),
    })
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

/** 实际请求用的 MCP endpoint：自定义 URL 优先，否则走同源反代 */
export function getEffectiveMcpEndpoint(settings?: McpSettings | null): string {
  const s = settings ?? loadMcpSettings();
  const custom = s.mcpUrl.trim().replace(/\/+$/, '');
  if (custom) return custom;
  return SELLERSPRITE_MCP_PROXY_PATH;
}
