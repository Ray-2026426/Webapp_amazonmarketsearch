import type { Keyword, Review } from './parser';

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

/** 从卖家精灵包装结构里取出 items 列表 */
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

export async function getSellerSpriteStatus(): Promise<{ configured: boolean; message: string }> {
  try {
    const res = await fetch('/api/sellersprite/status');
    const json = await res.json();
    return {
      configured: Boolean(json.configured),
      message: String(json.message || ''),
    };
  } catch {
    return {
      configured: false,
      message: '无法连接本地代理，请确认已用 npm run dev 启动本应用',
    };
  }
}

async function callTool(tool: 'review' | 'traffic_keyword', args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch('/api/sellersprite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(json.error || `请求失败 (${res.status})`));
  }
  return json.data;
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
  /** 每页条数，默认 50 */
  pageSize?: number;
  /** 最多抓取页数，默认 5（约 250 条） */
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
  // 用点击集中度映射为 0–100 难度，便于沿用现有象限逻辑
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

/** 解析用户输入的多个 ASIN（逗号/空格/换行） */
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
