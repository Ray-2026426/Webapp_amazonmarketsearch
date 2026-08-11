import type { Keyword, Review } from './parser';
import {
  getEffectiveMcpEndpoint,
  loadMcpSettings,
  type McpSettings,
} from './mcpConfig';

export const SELLERSPRITE_MARKETPLACES = [
  'US', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'CA', 'AU', 'MX', 'IN', 'BR', 'AE',
] as const;

export type SellerSpriteMarketplace = (typeof SELLERSPRITE_MARKETPLACES)[number];

export function normalizeMarketplaceCode(code: string): SellerSpriteMarketplace {
  const c = (code || 'US').toUpperCase();
  if ((SELLERSPRITE_MARKETPLACES as readonly string[]).includes(c)) {
    return c as SellerSpriteMarketplace;
  }
  if (c === 'EU' || c === 'NL' || c === 'BE' || c === 'SE' || c === 'PL') return 'DE';
  return 'US';
}

function stripHtml(s: string): string {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function uid(): string {
  return Math.random().toString(36).slice(2, 11);
}

function asArray<T>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  return [];
}

function pickItems(payload: unknown): unknown[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object') return [];
  const o = payload as Record<string, unknown>;
  if (o.data && typeof o.data === 'object') {
    const d = o.data as Record<string, unknown>;
    if (Array.isArray(d.items)) return d.items;
    if (Array.isArray(d.list)) return d.list;
  }
  if (Array.isArray(o.items)) return o.items;
  if (Array.isArray(o.list)) return o.list;
  return [];
}

function pickMeta(payload: unknown): { total?: number; pages?: number; page?: number; hasNext?: boolean } {
  if (!payload || typeof payload !== 'object') return {};
  const o = payload as Record<string, unknown>;
  const d = (o.data && typeof o.data === 'object' ? o.data : o) as Record<string, unknown>;
  return {
    total: Number(d.total) || undefined,
    pages: Number(d.pages) || undefined,
    page: Number(d.page) || undefined,
    hasNext: Boolean(d.hasNextPage),
  };
}

type JsonRpc = {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { message?: string };
};

function parseMcpHttpBody(text: string): JsonRpc | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as JsonRpc;
    } catch {
      /* fall through */
    }
  }
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter((l) => l && l !== '[DONE]');
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(dataLines[i]) as JsonRpc;
      if (obj && (obj.result !== undefined || obj.error !== undefined)) return obj;
    } catch {
      /* continue */
    }
  }
  return null;
}

function extractToolPayload(result: unknown): unknown {
  if (result == null) return null;
  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }
  if (typeof result !== 'object') return result;
  const r = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
  if (r.structuredContent !== undefined) return r.structuredContent;
  if (Array.isArray(r.content)) {
    const joined = r.content.map((c) => String(c.text ?? '')).join('\n').trim();
    if (!joined) return result;
    try {
      return JSON.parse(joined);
    } catch {
      return joined;
    }
  }
  return result;
}

async function mcpHttp(
  endpoint: string,
  secretKey: string,
  init: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<{ ok: boolean; status: number; text: string; sessionId?: string }> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: init.method ?? 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'secret-key': secretKey,
        ...(init.headers ?? {}),
      },
      body: init.body,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      /Failed to fetch|NetworkError|Load failed/i.test(msg)
        ? '网络请求失败（Failed to fetch）。请确认：① 已用 npm run dev 启动本应用；② MCP 地址栏留空（不要填官方网址，官方地址请走应用内代理）；③ Secret Key 正确。'
        : msg
    );
  }
  return {
    ok: res.ok,
    status: res.status,
    text: await res.text(),
    sessionId: res.headers.get('mcp-session-id') || undefined,
  };
}

/** 浏览器端直接调用卖家精灵 MCP（经同源反代或用户自定义 URL） */
async function callSellerSpriteToolBrowser(
  toolName: string,
  args: Record<string, unknown>,
  settings?: McpSettings | null
): Promise<unknown> {
  const cfg = settings ?? loadMcpSettings();
  const secretKey = cfg.secretKey.trim();
  if (!secretKey) {
    throw new Error('请先在「设置 → MCP 数据」中填写卖家精灵 Secret Key');
  }
  const endpoint = getEffectiveMcpEndpoint(cfg);
  const rpcBody = {
    jsonrpc: '2.0' as const,
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  const direct = await mcpHttp(endpoint, secretKey, {
    headers: {
      'MCP-Protocol-Version': '2025-03-26',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': toolName,
    },
    body: JSON.stringify(rpcBody),
  });
  let parsed = parseMcpHttpBody(direct.text);
  if (direct.ok && parsed?.result !== undefined && !parsed.error) {
    return extractToolPayload(parsed.result);
  }

  const initRes = await mcpHttp(endpoint, secretKey, {
    headers: { 'MCP-Protocol-Version': '2025-03-26' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'amz-market-research-app', version: '1.0.0' },
      },
    }),
  });
  const sessionId = initRes.sessionId;
  if (!initRes.ok && !sessionId) {
    const hint =
      parsed?.error?.message ||
      direct.text.slice(0, 200) ||
      initRes.text.slice(0, 200);
    if (/Failed to fetch|NetworkError|CORS/i.test(String(hint)) || direct.status === 0) {
      throw new Error('无法连接 MCP。请确认已用 npm run dev 启动，或检查自定义 MCP 地址是否允许跨域。');
    }
    throw new Error(hint || `MCP 初始化失败 (${initRes.status || direct.status})`);
  }

  if (sessionId) {
    await mcpHttp(endpoint, secretKey, {
      headers: {
        'MCP-Protocol-Version': '2025-03-26',
        'Mcp-Session-Id': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
  }

  const callRes = await mcpHttp(endpoint, secretKey, {
    headers: {
      'MCP-Protocol-Version': '2025-03-26',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': toolName,
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(rpcBody),
  });
  parsed = parseMcpHttpBody(callRes.text);
  if (!callRes.ok || parsed?.error) {
    throw new Error(
      parsed?.error?.message || callRes.text.slice(0, 300) || `MCP 调用失败 (${callRes.status})`
    );
  }
  if (parsed?.result === undefined) {
    throw new Error('MCP 返回为空，请检查密钥或 ASIN/站点是否正确');
  }
  return extractToolPayload(parsed.result);
}

export async function getSellerSpriteStatus(): Promise<{ configured: boolean; message: string }> {
  const cfg = loadMcpSettings();
  if (cfg.secretKey.trim()) {
    const viaProxy = !cfg.mcpUrl.trim() || /mcp\.sellersprite\.com/i.test(cfg.mcpUrl);
    return {
      configured: true,
      message: viaProxy
        ? '已配置 MCP 密钥，将通过应用安全代理连接卖家精灵。'
        : '已配置 MCP 密钥（自定义中转地址）。可直接抓取。',
    };
  }
  return {
    configured: false,
    message: '尚未配置。请打开「设置 → MCP 数据」，填入卖家精灵 Secret Key（地址栏请留空）。',
  };
}

async function callTool(tool: 'review' | 'traffic_keyword', args: Record<string, unknown>): Promise<unknown> {
  return callSellerSpriteToolBrowser(tool, args);
}

function mapReviewItem(item: Record<string, unknown>, asin: string, marketplace: string): Review {
  const dateRaw = item.date;
  let date = '';
  if (typeof dateRaw === 'number' && Number.isFinite(dateRaw)) {
    date = new Date(dateRaw).toISOString().slice(0, 10);
  } else if (dateRaw != null) {
    date = String(dateRaw).slice(0, 10);
  }
  const images = asArray<string>(item.images);
  const videos = asArray<string>(item.videos);
  return {
    id: uid(),
    asin,
    country: marketplace,
    title: stripHtml(String(item.title || '')),
    content: stripHtml(String(item.content || '')),
    rating: Number(item.star) || 0,
    date,
    helpful: Number(item.likes) || 0,
    hasImage: Boolean(item.image) || images.length > 0,
    hasVideo: Boolean(item.video) || videos.length > 0,
    isVp: Boolean(item.verified),
    imageUrls: images.length ? images : undefined,
    videoUrls: videos.length ? videos : undefined,
  };
}

export interface FetchReviewsOptions {
  asin: string;
  marketplace: string;
  pageSize?: number;
  maxPages?: number;
  onProgress?: (msg: string) => void;
}

export async function fetchReviewsFromMcp(opts: FetchReviewsOptions): Promise<Review[]> {
  const asin = opts.asin.trim().toUpperCase();
  const marketplace = normalizeMarketplaceCode(opts.marketplace);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 100);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 5, 1), 20);
  const out: Review[] = [];

  for (let page = 1; page <= maxPages; page++) {
    opts.onProgress?.(`正在抓取 ${asin} 评论 第 ${page}/${maxPages} 页…`);
    const payload = await callTool('review', {
      marketplace,
      asin,
      page,
      size: pageSize,
    });
    const items = pickItems(payload);
    for (const it of items) {
      if (it && typeof it === 'object') {
        out.push(mapReviewItem(it as Record<string, unknown>, asin, marketplace));
      }
    }
    const meta = pickMeta(payload);
    const noMore =
      items.length === 0 ||
      items.length < pageSize ||
      (meta.pages != null && page >= meta.pages) ||
      meta.hasNext === false;
    if (noMore) break;
  }
  return out;
}

function mapKeywordItem(item: Record<string, unknown>, rank: number): Keyword {
  const searches = Number(item.searches) || 0;
  const weekly =
    Number(item.calculatedWeeklySearches) ||
    (searches > 0 ? Math.round(searches / 4.3) : 0);
  const bid = Number(item.bid) || 0;
  const bidMin = Number(item.bidMin);
  const bidMax = Number(item.bidMax);
  const monopoly = Number(item.monopolyClickRate) || 0;
  const top3Click = Number(item.top3ClickingRate) || monopoly;
  const top3Conv = Number(item.top3ConversionRate) || 0;
  const purchaseRate = Number(item.purchaseRate) || 0;
  const difficulty = Math.round(Math.min(100, Math.max(0, monopoly * 100)));

  return {
    id: uid(),
    keyword: String(item.keyword || ''),
    translation: String(item.keywordCn || ''),
    wordTag: '',
    matchType: '',
    relevanceTier: '',
    rank,
    weeklySearchVolume: Math.round(weekly),
    cpcBid: bid,
    cpcBidRange:
      Number.isFinite(bidMin) && Number.isFinite(bidMax)
        ? `${bidMin.toFixed(2)}-${bidMax.toFixed(2)}`
        : '',
    conversionRate: purchaseRate,
    difficulty,
    difficultyTier: difficulty >= 70 ? '高' : difficulty >= 40 ? '中' : '低',
    organicScrollRate: 0,
    top3ClickShare: top3Click,
    top3ConversionShare: top3Conv,
    top3Asins: '',
    aiTags: [],
  };
}

export interface FetchKeywordsOptions {
  asin: string;
  marketplace: string;
  pageSize?: number;
  maxPages?: number;
  onProgress?: (msg: string) => void;
}

export async function fetchKeywordsFromMcp(opts: FetchKeywordsOptions): Promise<Keyword[]> {
  const asin = opts.asin.trim().toUpperCase();
  const marketplace = normalizeMarketplaceCode(opts.marketplace);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 100);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 3, 1), 10);
  const map = new Map<string, Keyword>();

  for (let page = 1; page <= maxPages; page++) {
    opts.onProgress?.(`正在抓取 ${asin} 流量词 第 ${page}/${maxPages} 页…`);
    const payload = await callTool('traffic_keyword', {
      request: {
        asin,
        marketplace,
        page,
        size: pageSize,
        order: { field: 'searches', desc: true },
      },
    });
    const items = pickItems(payload);
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const row = it as Record<string, unknown>;
      const kw = String(row.keyword || '').trim();
      if (!kw) continue;
      if (!map.has(kw.toLowerCase())) {
        map.set(kw.toLowerCase(), mapKeywordItem(row, map.size + 1));
      }
    }
    if (items.length === 0 || items.length < pageSize) break;
    const meta = pickMeta(payload);
    if (meta.pages != null && page >= meta.pages) break;
  }
  return [...map.values()];
}

export function parseAsinList(raw: string): string[] {
  const parts = raw
    .toUpperCase()
    .split(/[\s,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/B0[A-Z0-9]{8}/i) || p.match(/[A-Z0-9]{10}/);
    const asin = (m ? m[0] : p).toUpperCase();
    if (asin.length < 8 || seen.has(asin)) continue;
    seen.add(asin);
    out.push(asin);
  }
  return out;
}

/** 用一条轻量请求验证 MCP 密钥是否可用 */
export async function testSellerSpriteMcp(settings?: McpSettings | null): Promise<void> {
  const cfg = settings ?? loadMcpSettings();
  if (!cfg.secretKey.trim()) throw new Error('请先填写 Secret Key');
  // initialize 握手即可验证密钥，不必真拉业务数据
  const endpoint = getEffectiveMcpEndpoint(cfg);
  const res = await mcpHttp(endpoint, cfg.secretKey.trim(), {
    headers: { 'MCP-Protocol-Version': '2025-03-26' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'amz-market-research-app-test', version: '1.0.0' },
      },
    }),
  });
  if (!res.ok && !res.sessionId) {
    const parsed = parseMcpHttpBody(res.text);
    throw new Error(parsed?.error?.message || res.text.slice(0, 200) || `验证失败 (${res.status})`);
  }
}

function unwrapData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const o = payload as Record<string, unknown>;
  if (o.data && typeof o.data === 'object') return o.data as Record<string, unknown>;
  return o;
}

export interface AsinDetailSnapshot {
  asin: string;
  title: string;
  brand: string;
  price: number;
  rating: number;
  ratings: number;
  imageUrl: string;
  features: string[];
  lqs: number;
  fulfillment: string;
  sellers: number;
  categoryPath: string;
  badge: Record<string, string>;
  raw: Record<string, unknown>;
}

export async function fetchAsinDetailFromMcp(
  asin: string,
  marketplace: string
): Promise<AsinDetailSnapshot> {
  const payload = await callSellerSpriteToolBrowser('asin_detail', {
    asin: asin.trim().toUpperCase(),
    marketplace: normalizeMarketplaceCode(marketplace),
  });
  const d = unwrapData(payload);
  const features = Array.isArray(d.features) ? d.features.map(String) : [];
  return {
    asin: String(d.asin || asin).toUpperCase(),
    title: String(d.title || ''),
    brand: String(d.brand || ''),
    price: Number(d.price) || 0,
    rating: Number(d.rating) || 0,
    ratings: Number(d.ratings) || 0,
    imageUrl: String(d.imageUrl || d.zoomImageUrl || ''),
    features,
    lqs: Number(d.lqs) || 0,
    fulfillment: String(d.fulfillment || ''),
    sellers: Number(d.sellers) || 0,
    categoryPath: String(d.nodeLabelPath || ''),
    badge: (d.badge && typeof d.badge === 'object' ? d.badge : {}) as Record<string, string>,
    raw: d,
  };
}

export interface TrafficStatSnapshot {
  asin: string;
  keywords: number;
  ranks: number;
  ads: number;
  badgeCount: Record<string, number | null>;
}

export async function fetchTrafficStatFromMcp(
  asin: string,
  marketplace: string
): Promise<TrafficStatSnapshot> {
  const payload = await callSellerSpriteToolBrowser('traffic_keyword_stat', {
    asin: asin.trim().toUpperCase(),
    marketplace: normalizeMarketplaceCode(marketplace),
  });
  const d = unwrapData(payload);
  const badge = (d.badgeCount && typeof d.badgeCount === 'object' ? d.badgeCount : {}) as Record<
    string,
    number | null
  >;
  return {
    asin: String(d.asin || asin).toUpperCase(),
    keywords: Number(d.keywords) || 0,
    ranks: Number(d.ranks) || 0,
    ads: Number(d.ads) || 0,
    badgeCount: badge,
  };
}
