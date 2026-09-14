import type { Keyword, Review } from './parser';
import { callDataPool, canUseDataPool, fetchDataPoolStatus } from './dataPoolClient';
import { decideOutboundRoute, poolTypeForTool, usageToolForTool } from './dataPoolRouting';
import {
  getActiveSellerSpriteProvider,
  getSellerSpriteEndpoint,
  getActiveLingXingProvider,
  getLingXingEndpoint,
  getXydcEndpoint,
  getSorftimeEndpoint,
  loadMcpSettings,
  type McpSettings,
  type McpProviderEntry,
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

function pickMeta(payload: unknown): {
  total?: number;
  pages?: number;
  page?: number;
  /** 仅当接口明确给出 true/false 时有值；null/缺失则为 undefined，切勿当成 false */
  hasNext?: boolean;
} {
  if (!payload || typeof payload !== 'object') return {};
  const o = payload as Record<string, unknown>;
  const d = (o.data && typeof o.data === 'object' ? o.data : o) as Record<string, unknown>;
  const rawNext = d.hasNextPage;
  let hasNext: boolean | undefined;
  if (rawNext === true || rawNext === 'true' || rawNext === 1) hasNext = true;
  else if (rawNext === false || rawNext === 'false' || rawNext === 0) hasNext = false;
  else hasNext = undefined;
  return {
    total: Number(d.total) || undefined,
    pages: Number(d.pages) || undefined,
    page: Number(d.page) || undefined,
    hasNext,
  };
}

type JsonRpc = {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { message?: string };
};

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

/**
 * 调用卖家精灵 MCP 工具。
 * 用户决策 A（数据池只对登录用户开放）：**只走服务端数据池**，浏览器里没有也不应该有密钥。
 * 未登录时明确拒绝（让用户去用示例数据或登录），绝不回退到"本地填密钥"的旧模式。
 */
async function callSellerSpriteToolBrowser(
  toolName: string,
  args: Record<string, unknown>,
  _settings?: McpSettings | null
): Promise<unknown> {
  const route = decideOutboundRoute({ hasToken: canUseDataPool() });
  if (route.route === 'blocked') {
    throw new Error(route.reason);
  }
  const gateway = await callDataPool({
    provider: 'sellersprite',
    tool: toolName,
    args,
    type: poolTypeForTool(toolName),
    usageTool: usageToolForTool(toolName),
  });
  if (!gateway.ok) {
    // 服务端失败就如实抛出（配额/未配置/外部错误），不回退、不编造数据
    throw new Error(gateway.error || '数据池调用失败');
  }
  return extractToolPayload(gateway.data);
}


/**
 * 数据池可用性自检（决策 A：密钥只在服务端，浏览器不再自检密钥）。
 * 它检查的是"服务端是否已配置 + 当前是否登录"，而不是在浏览器里拿密钥去握手。
 */
async function checkDataPoolReady(providerLabel: string): Promise<void> {
  const route = decideOutboundRoute({ hasToken: canUseDataPool() });
  if (route.route === 'blocked') throw new Error(route.reason);
  const status = await fetchDataPoolStatus();
  if (!status.ok) throw new Error(status.error || '无法读取数据池状态');
  const seller = status.providers?.sellersprite;
  if (!seller?.configured) {
    throw new Error('服务端还没有配置卖家精灵密钥：请让管理员在「设置 → 管理员后台 → 配置中心」配置（浏览器不保存密钥）');
  }
  void providerLabel;
}

export async function getSellerSpriteStatus(): Promise<{ configured: boolean; message: string }> {
  const cfg = loadMcpSettings();
  const ss = getActiveSellerSpriteProvider(cfg);
  const key = (ss?.secretKey || cfg.secretKey || '').trim();
  if (key) {
    const viaProxy = getSellerSpriteEndpoint(ss?.mcpUrl ?? cfg.mcpUrl) === '/api-proxy/sellersprite-mcp'
      || getSellerSpriteEndpoint(ss?.mcpUrl ?? cfg.mcpUrl).startsWith('/api-proxy/');
    return {
      configured: true,
      message: viaProxy
        ? `已配置「${ss?.name || '卖家精灵'}」，将通过应用安全代理连接。`
        : `已配置「${ss?.name || '卖家精灵'}」（自定义地址）。可直接抓取。`,
    };
  }
  return {
    configured: false,
    message: '尚未配置卖家精灵。请打开「设置 → MCP 数据」，添加或填写卖家精灵密钥（地址栏请留空）。',
  };
}

async function callTool(
  tool: 'review' | 'traffic_keyword' | 'keyword_miner' | 'keyword_research' | 'aba_research_weekly',
  args: Record<string, unknown>
): Promise<unknown> {
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
  // 卖家精灵 review API 每页固定约 20 条
  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 20);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 10, 1), 50);
  const out: Review[] = [];

  for (let page = 1; page <= maxPages; page++) {
    opts.onProgress?.(`正在抓取 ${asin} 评论 第 ${page}/${maxPages} 页（已获 ${out.length} 条）…`);
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
    // 本页空 → 结束
    if (items.length === 0) break;
    // 已达接口声明的总数 → 结束
    if (meta.total != null && out.length >= meta.total) break;
    // 明确没有下一页 → 结束（注意：hasNextPage 常为 null，不能当成 false）
    if (meta.hasNext === false) break;
    // 有明确总页数且已到最后一页 → 结束
    if (meta.pages != null && page >= meta.pages) break;
  }
  return out;
}

function parseRankPos(raw: unknown): { page: number | null; position: number | null; index: number | null } {
  if (!raw || typeof raw !== 'object') return { page: null, position: null, index: null };
  const o = raw as Record<string, unknown>;
  return {
    page: Number(o.page) || null,
    position: Number(o.position) || null,
    index: Number(o.index) || null,
  };
}

/** 竞品流量词明细（含 ABA / 自然位 / 广告位 / 流量占比） */
export interface TrafficKeywordDetail {
  keyword: string;
  translation: string;
  monthlySearches: number;
  weeklySearches: number;
  /** ABA 周搜索量排名（searchesRank），越小越热 */
  abaRank: number;
  /** 流量占比 0–1 */
  trafficPercentage: number;
  organicPage: number | null;
  /** 自然总名次（跨页累计位次） */
  organicPosition: number | null;
  adPage: number | null;
  adPosition: number | null;
  /** 广告页内序号 */
  adIndex: number | null;
  naturalRatio: number;
  adRatio: number;
  cpcBid: number;
  badges: string[];
  trafficKeywordType: string;
}

function mapTrafficKeywordDetail(item: Record<string, unknown>): TrafficKeywordDetail | null {
  const keyword = String(item.keyword || '').trim();
  if (!keyword) return null;
  const organic = parseRankPos(item.rankPosition);
  const ad = parseRankPos(item.adPosition);
  const searches = Number(item.searches) || 0;
  const weekly =
    Number(item.calculatedWeeklySearches) ||
    (searches > 0 ? Math.round(searches / 4.3) : 0);
  const badges = Array.isArray(item.badges) ? item.badges.map(String) : [];
  return {
    keyword,
    translation: String(item.keywordCn || ''),
    monthlySearches: searches,
    weeklySearches: Math.round(weekly),
    abaRank: Number(item.searchesRank) || 0,
    trafficPercentage: Number(item.trafficPercentage) || 0,
    organicPage: organic.page,
    organicPosition: organic.position,
    adPage: ad.page,
    adPosition: ad.position,
    adIndex: ad.index,
    naturalRatio: Number(item.naturalRatio) || 0,
    adRatio: Number(item.adRatio) || 0,
    cpcBid: Number(item.bid) || 0,
    badges,
    trafficKeywordType: String(item.trafficKeywordType || ''),
  };
}

export interface FetchTrafficKeywordsOptions {
  asin: string;
  marketplace: string;
  pageSize?: number;
  maxPages?: number;
  onProgress?: (msg: string) => void;
}

/** 按流量占比排序拉取流量词明细 */
export async function fetchTrafficKeywordsDetailedFromMcp(
  opts: FetchTrafficKeywordsOptions
): Promise<TrafficKeywordDetail[]> {
  const asin = opts.asin.trim().toUpperCase();
  const marketplace = normalizeMarketplaceCode(opts.marketplace);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 100);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 2, 1), 5);
  const map = new Map<string, TrafficKeywordDetail>();

  for (let page = 1; page <= maxPages; page++) {
    opts.onProgress?.(`正在抓取 ${asin} 流量词明细 第 ${page}/${maxPages} 页…`);
    const payload = await callTool('traffic_keyword', {
      request: {
        asin,
        marketplace,
        page,
        size: pageSize,
        order: { field: 'trafficPercentage', desc: true },
      },
    });
    const items = pickItems(payload);
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const row = mapTrafficKeywordDetail(it as Record<string, unknown>);
      if (!row) continue;
      if (!map.has(row.keyword.toLowerCase())) {
        map.set(row.keyword.toLowerCase(), row);
      }
    }
    if (items.length === 0) break;
    const meta = pickMeta(payload);
    if (meta.total != null && map.size >= meta.total) break;
    if (meta.hasNext === false) break;
    if (meta.pages != null && page >= meta.pages) break;
  }
  return [...map.values()].sort((a, b) => b.trafficPercentage - a.trafficPercentage);
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
  // 流量词接口单页常见 20～50；过大 size 可能异常，统一用 50
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 50);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 3, 1), 10);
  const map = new Map<string, Keyword>();

  for (let page = 1; page <= maxPages; page++) {
    opts.onProgress?.(`正在抓取 ${asin} 流量词 第 ${page}/${maxPages} 页（已获 ${map.size} 个）…`);
    let payload: unknown;
    try {
      payload = await callTool('traffic_keyword', {
        request: {
          asin,
          marketplace,
          page,
          size: pageSize,
          order: { field: 'searches', desc: true },
        },
      });
    } catch (e) {
      // 兼容部分账号对 order 校验更严：去掉排序再试一次
      if (page === 1) {
        opts.onProgress?.(`${asin} 带排序抓取失败，改用不带排序重试…`);
        payload = await callTool('traffic_keyword', {
          request: { asin, marketplace, page, size: pageSize },
        });
      } else {
        throw e;
      }
    }
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
    if (items.length === 0) break;
    const meta = pickMeta(payload);
    if (meta.total != null && map.size >= meta.total) break;
    if (meta.hasNext === false) break;
    if (meta.pages != null && page >= meta.pages) break;
    // 不要用 items.length < pageSize 提前停：接口经常少返回几条但仍有下一页
  }
  return [...map.values()];
}

/** 按种子关键词拉取 ABA / 关联关键词（keyword_miner） */
export interface FetchKeywordsByKeywordOptions {
  keyword: string;
  marketplace: string;
  pageSize?: number;
  maxPages?: number;
  onProgress?: (msg: string) => void;
}

function mapMinerKeywordItem(item: Record<string, unknown>, rank: number): Keyword {
  // keyword_miner 字段映射：字段名与 traffic_keyword 略有差异
  // searches=月搜索量, purchasesRate=购买率(0-1), monopolyClickRate=点击集中度(0-1)
  const searches = Number(item.searches) || 0;
  const weekly =
    Number(item.calculatedWeeklySearches) ||
    (searches > 0 ? Math.round(searches / 4.3) : 0);
  const bid = Number(item.bid) || 0;
  const bidMin = Number(item.bidMin);
  const bidMax = Number(item.bidMax);
  // 点击集中度 (0-1)：keyword_miner 返回 monopolyClickRate，也可能叫 araClickRate
  const monopoly = Number(item.monopolyClickRate) || Number(item.araClickRate) || 0;
  const top3Click = Number(item.top3ClickingRate) || monopoly;
  const top3Conv = Number(item.top3ConversionRate) || 0;
  // keyword_miner 的"购买率"字段名是 purchasesRate（见其 filter 参数命名 minPurchasesRate/maxPurchasesRate）
  const purchaseRate =
    Number(item.purchasesRate) ||
    Number(item.purchaseRate) ||
    0;
  // 难度用点击集中度 * 100 做近似（SPR 来自另一套体系，不混用）
  const rawDifficulty = Math.round(monopoly * 100);
  const difficulty = Number.isFinite(rawDifficulty) ? Math.min(100, Math.max(0, rawDifficulty)) : 0;

  return {
    id: uid(),
    keyword: String(item.keyword || item.keywords || '').trim(),
    translation: String(item.keywordCn || item.translation || item.keywordZh || ''),
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

/**
 * 输入种子关键词 → 用 keyword_miner 抓取关联 ABA 关键词列表
 * （比 traffic_keyword 更接近「按词反查市场词库」）
 */
export async function fetchKeywordsByKeywordFromMcp(
  opts: FetchKeywordsByKeywordOptions
): Promise<Keyword[]> {
  const seed = opts.keyword.trim();
  if (!seed) throw new Error('请输入种子关键词');
  const marketplace = normalizeMarketplaceCode(opts.marketplace);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 50);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 3, 1), 10);
  const map = new Map<string, Keyword>();

  for (let page = 1; page <= maxPages; page++) {
    opts.onProgress?.(
      `正在抓取「${seed}」ABA 关联词 第 ${page}/${maxPages} 页（已获 ${map.size} 个）…`
    );
    let payload: unknown;
    try {
      payload = await callTool('keyword_miner', {
        request: {
          keyword: seed,
          marketplace,
          page,
          size: pageSize,
          filterRootWord: 1,       // 只保留包含种子词的词（排除毫不相关的）
          order: { field: 'searches', desc: true },
        },
      });
    } catch (e) {
      if (page === 1) {
        opts.onProgress?.(`「${seed}」带排序抓取失败，改用不带排序重试…`);
        payload = await callTool('keyword_miner', {
          request: { keyword: seed, marketplace, page, size: pageSize, filterRootWord: 1 },
        });
      } else {
        throw e;
      }
    }
    const items = pickItems(payload);
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const row = it as Record<string, unknown>;
      const kw = String(row.keyword || row.keywords || '').trim();
      if (!kw) continue;
      if (!map.has(kw.toLowerCase())) {
        map.set(kw.toLowerCase(), mapMinerKeywordItem(row, map.size + 1));
      }
    }
    if (items.length === 0) break;
    const meta = pickMeta(payload);
    if (meta.total != null && map.size >= meta.total) break;
    if (meta.hasNext === false) break;
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
}export async function testMcpProvider(provider: McpProviderEntry): Promise<void> {
  const label = provider?.kind === 'sellersprite' ? '卖家精灵' : provider?.kind || 'MCP';
  await checkDataPoolReady(label);
}export async function testSellerSpriteMcp(_settings?: McpSettings | null): Promise<void> {
  await checkDataPoolReady('卖家精灵');
}

function unwrapData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const o = payload as Record<string, unknown>;
  if (o.data && typeof o.data === 'object') return o.data as Record<string, unknown>;
  return o;
}

export interface VariationChild {
  asin: string;
  attribute: string;
}

export interface AsinDetailSnapshot {
  asin: string;
  title: string;
  brand: string;
  price: number;
  rating: number;
  ratings: number;
  imageUrl: string;
  zoomImageUrl: string;
  features: string[];
  lqs: number;
  fulfillment: string;
  sellers: number;
  sellerName: string;
  categoryPath: string;
  badge: Record<string, string>;
  /** 父体 ASIN */
  parentAsin: string;
  /** 子体数量（卖家精灵 variations 字段） */
  variationCount: number;
  /** 父体下全部子体 */
  variationList: VariationChild[];
  /** 当前子体规格，如 Size: 2.75 Inchs */
  skuList: string[];
  dimensions: string;
  weight: string;
  bsrRank: number;
  bsrLabel: string;
  asinUrl: string;
  raw: Record<string, unknown>;
}

function parseVariationList(raw: unknown): VariationChild[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const asin = String(o.asin || '').toUpperCase();
      if (!asin) return null;
      return { asin, attribute: String(o.attribute || '') };
    })
    .filter(Boolean) as VariationChild[];
}

function mapAsinDetail(d: Record<string, unknown>, fallbackAsin: string): AsinDetailSnapshot {
  const features = Array.isArray(d.features) ? d.features.map(String) : [];
  const asin = String(d.asin || fallbackAsin).toUpperCase();
  return {
    asin,
    title: String(d.title || ''),
    brand: String(d.brand || ''),
    price: Number(d.price) || 0,
    rating: Number(d.rating) || 0,
    ratings: Number(d.ratings) || 0,
    imageUrl: String(d.imageUrl || d.zoomImageUrl || ''),
    zoomImageUrl: String(d.zoomImageUrl || d.imageUrl || ''),
    features,
    lqs: Number(d.lqs) || 0,
    fulfillment: String(d.fulfillment || ''),
    sellers: Number(d.sellers) || 0,
    sellerName: String(d.sellerName || ''),
    categoryPath: String(d.nodeLabelPath || ''),
    badge: (d.badge && typeof d.badge === 'object' ? d.badge : {}) as Record<string, string>,
    parentAsin: String(d.parent || '').toUpperCase(),
    variationCount: Number(d.variations) || 0,
    variationList: parseVariationList(d.variationList),
    skuList: Array.isArray(d.skuList) ? d.skuList.map(String) : [],
    dimensions: String(d.dimensions || ''),
    weight: String(d.weight || ''),
    bsrRank: Number(d.bsrRank) || 0,
    bsrLabel: String(d.bsrLabel || ''),
    asinUrl: String(d.asinUrl || ''),
    raw: d,
  };
}

export async function fetchAsinDetailFromMcp(
  asin: string,
  marketplace: string
): Promise<AsinDetailSnapshot> {
  const payload = await callSellerSpriteToolBrowser('asin_detail', {
    asin: asin.trim().toUpperCase(),
    marketplace: normalizeMarketplaceCode(marketplace),
  });
  return mapAsinDetail(unwrapData(payload), asin);
}

export interface AsinSalesTrendPoint {
  month: string;
  price: number;
  averagePrice: number;
  parentUnitSales: number;
  childUnitSales: number | null;
  parentSalesRevenue: number;
  childSalesRevenue: number | null;
}

export interface AsinSalesTrendSnapshot {
  asin: AsinDetailSnapshot | null;
  points: AsinSalesTrendPoint[];
  raw: Record<string, unknown>;
}

function mapSalesTrendPoint(item: unknown): AsinSalesTrendPoint | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
  const month = String(row.month || row.date || '');
  if (!month) return null;
  const nullableNum = (x: unknown): number | null => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  return {
    month,
    price: Number(row.price) || 0,
    averagePrice: Number(row.averagePrice) || Number(row.price) || 0,
    parentUnitSales: Number(row.parentUnitSales) || 0,
    childUnitSales: nullableNum(row.childUnitSales),
    parentSalesRevenue: Number(row.parentSalesRevenue) || 0,
    childSalesRevenue: nullableNum(row.childSalesRevenue),
  };
}

/** ASIN 月度销量/销售额/价格趋势。优先用于单 ASIN 深度分析，避免只凭 Listing 快照下结论。 */
export async function fetchAsinSalesTrendFromMcp(
  asin: string,
  marketplace: string
): Promise<AsinSalesTrendSnapshot> {
  const payload = await callSellerSpriteToolBrowser('asin_sales_trend', {
    asin: asin.trim().toUpperCase(),
    marketplace: normalizeMarketplaceCode(marketplace),
  });
  const data = unwrapData(payload);
  const asinRaw = data.asin && typeof data.asin === 'object' ? data.asin as Record<string, unknown> : null;
  const points = asArray<unknown>(data.salesTrendPoints)
    .map(mapSalesTrendPoint)
    .filter(Boolean) as AsinSalesTrendPoint[];
  return {
    asin: asinRaw ? mapAsinDetail(asinRaw, asin) : null,
    points,
    raw: data,
  };
}

/** 父体结构：锚点子体 + 父体下全部变体明细 */
export interface ParentMatrixSnapshot {
  /** 用户选中的对比 ASIN（通常是子体） */
  anchorAsin: string;
  brand: string;
  parentAsin: string;
  variationCount: number;
  /** 锚点规格 */
  anchorSku: string;
  children: Array<{
    asin: string;
    attribute: string;
    isAnchor: boolean;
    price: number;
    rating: number;
    ratings: number;
    imageUrl: string;
  }>;
}

/**
 * 拉取某 ASIN 对应父体下的子体矩阵。
 * 先取锚点详情拿到 parent + variationList，再对其他子体补价格/评分（最多 12 个，避免过慢）。
 */
export async function fetchParentMatrixFromMcp(
  asin: string,
  marketplace: string,
  onProgress?: (msg: string) => void
): Promise<ParentMatrixSnapshot> {
  const detail = await fetchAsinDetailFromMcp(asin, marketplace);
  const parentAsin = detail.parentAsin || detail.asin;
  const list =
    detail.variationList.length > 0
      ? detail.variationList
      : [{ asin: detail.asin, attribute: detail.skuList[0] || '' }];

  const children: ParentMatrixSnapshot['children'] = [];
  const MAX_EXTRA = 12;
  let fetched = 0;

  for (const v of list) {
    const isAnchor = v.asin === detail.asin;
    if (isAnchor) {
      children.push({
        asin: v.asin,
        attribute: v.attribute || detail.skuList[0] || '',
        isAnchor: true,
        price: detail.price,
        rating: detail.rating,
        ratings: detail.ratings,
        imageUrl: detail.imageUrl,
      });
      continue;
    }
    if (fetched >= MAX_EXTRA) {
      children.push({
        asin: v.asin,
        attribute: v.attribute,
        isAnchor: false,
        price: 0,
        rating: 0,
        ratings: 0,
        imageUrl: '',
      });
      continue;
    }
    onProgress?.(`补全子体 ${v.asin}…`);
    try {
      const child = await fetchAsinDetailFromMcp(v.asin, marketplace);
      fetched += 1;
      children.push({
        asin: v.asin,
        attribute: v.attribute || child.skuList[0] || '',
        isAnchor: false,
        price: child.price,
        rating: child.rating,
        ratings: child.ratings,
        imageUrl: child.imageUrl,
      });
    } catch {
      children.push({
        asin: v.asin,
        attribute: v.attribute,
        isAnchor: false,
        price: 0,
        rating: 0,
        ratings: 0,
        imageUrl: '',
      });
    }
  }

  return {
    anchorAsin: detail.asin,
    brand: detail.brand,
    parentAsin,
    variationCount: detail.variationCount || list.length,
    anchorSku: detail.skuList[0] || list.find((x) => x.asin === detail.asin)?.attribute || '',
    children,
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

/** 品牌下其他父体（非锚点父体的 ASIN） */
export interface BrandParentItem {
  asin: string;
  title: string;
  price: number;
  rating: number;
  ratings: number;
  imageUrl: string;
  monthlySales: number;
  bsrRank: number;
}

/**
 * 用 product_research 搜索同品牌其他产品，
 * 聚合为「品牌下其他父体」列表（去重、排除当前锚点父体）
 */
export async function fetchBrandParentsFromMcp(
  brand: string,
  marketplace: string,
  excludeParents: string[],
  onProgress?: (msg: string) => void
): Promise<BrandParentItem[]> {
  if (!brand.trim()) return [];
  const mkt = normalizeMarketplaceCode(marketplace);
  const excludeSet = new Set(excludeParents.map((a) => a.toUpperCase()));
  onProgress?.(`搜索品牌「${brand}」下的产品…`);

  try {
    const payload = await callSellerSpriteToolBrowser('product_research', {
      request: {
        brands: brand.trim(),
        marketplace: mkt,
        page: 1,
        size: 50,
      },
    });
    const items = pickItems(payload);
    const list: BrandParentItem[] = [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const row = it as Record<string, unknown>;
      const asin = String(row.asin || '').toUpperCase();
      if (!asin || excludeSet.has(asin)) continue;
      // 只看父体（没有 parent 字段或 parent 等于自己的就是父体）
      const parent = String(row.parent || '').toUpperCase();
      if (parent && parent !== asin) continue; // 是子体，跳过
      list.push({
        asin,
        title: String(row.title || '').slice(0, 200),
        price: Number(row.price) || 0,
        rating: Number(row.rating) || 0,
        ratings: Number(row.ratings) || 0,
        imageUrl: String(row.imageUrl || ''),
        monthlySales: Number(row.totalUnits) || 0,
        bsrRank: Number(row.bsrRank) || 0,
      });
    }
    return list.filter((x) => x.title);
  } catch {
    return [];
  }
}
