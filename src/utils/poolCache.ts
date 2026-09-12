// M5 · 数据池请求缓存（PRD §11.2「请求缓存（词/ASIN/评论按 TTL 缓存，降本）」）。
//
// 纯函数：缓存键（含参数归一化）、TTL 判断、命中决策、淘汰。服务端网关与本地 dev 插件共用同一套规则，
// 保证"本地认为会命中"和"线上认为会命中"不会不一致。
//
// 口径要点：
// - 缓存键必须把**会影响结果的所有参数**都纳进来（站点、ASIN、月份区间、取样条数…），
//   否则会串数据（比"没缓存"更糟）；
// - 参数归一化：键的构造与顺序无关（对象键排序、字符串 trim + 小写、数组排序），避免同一次请求算出两个键；
// - TTL 按数据类型分档（§15.1-13：评论 14-30 天；词/ASIN 更短），并允许调用方覆盖；
// - 不缓存失败结果（失败重试不应被缓存挡住）。

export type PoolDataType =
  | 'keywords'
  | 'asin_detail'
  | 'reviews'
  | 'listing'
  | 'traffic'
  | 'market'
  | 'other';

/** TTL（秒）：按数据类型分档（§15.1-13 评论 14-30 天；词与 ASIN 更短，价格/排名类最短） */
export const DEFAULT_TTL_SECONDS: Record<PoolDataType, number> = {
  keywords: 7 * 24 * 3600,
  asin_detail: 3 * 24 * 3600,
  reviews: 14 * 24 * 3600,
  listing: 7 * 24 * 3600,
  traffic: 3 * 24 * 3600,
  market: 30 * 24 * 3600,
  other: 24 * 3600,
};

export const POOL_TYPE_LABELS: Record<PoolDataType, string> = {
  keywords: '关键词',
  asin_detail: 'ASIN 详情',
  reviews: '评论',
  listing: 'Listing',
  traffic: '流量词',
  market: '大盘',
  other: '其他',
};

export interface PoolCacheEntry<T = unknown> {
  key: string;
  type: PoolDataType;
  /** 缓存值 */
  value: T;
  createdAt: string;
  expiresAt: string;
  /** 命中次数（用于统计"省了多少次调用"） */
  hits: number;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) {
    // 数组：元素相同但顺序不同视为同一个键（如 ASIN 列表）
    return `[${value.map(stableStringify).sort().join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/**
 * 缓存键：`v1:<type>:<归一化参数>`。
 * v1 前缀是为了将来参数口径变化时可以整体失效，而不是让新旧键互相污染。
 */
export function buildCacheKey(type: PoolDataType, params: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === '') continue; // 空参数不进键（等价于没传）
    if (typeof v === 'string') normalized[k] = v.trim().toLowerCase();
    else normalized[k] = v;
  }
  return `v1:${type}:${stableStringify(normalized)}`;
}

/** 该条目是否仍有效（未过期） */
export function isFresh(entry: PoolCacheEntry | null | undefined, nowIso?: string): boolean {
  if (!entry) return false;
  const now = new Date(nowIso ?? new Date().toISOString()).getTime();
  const exp = new Date(entry.expiresAt).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(exp)) return false;
  return exp > now;
}

export interface CacheDecision {
  hit: boolean;
  entry?: PoolCacheEntry;
  /** 人话说明（写进用量事件与日志，方便回答"为什么这次没走缓存"） */
  reason: string;
}

/** 命中决策：只有"存在 + 未过期"才算命中；失败结果不入缓存，所以这里不需要再判 ok */
export function decideCache<T>(
  entries: PoolCacheEntry<T>[] | undefined,
  key: string,
  nowIso?: string
): CacheDecision {
  const list = Array.isArray(entries) ? entries : [];
  const found = list.find((e) => e.key === key);
  if (!found) return { hit: false, reason: '缓存里没有这条键' };
  if (!isFresh(found, nowIso)) {
    return { hit: false, entry: found, reason: `缓存已过期（${found.expiresAt}）` };
  }
  return { hit: true, entry: found, reason: `缓存命中（创建于 ${found.createdAt}，命中 ${found.hits} 次）` };
}

/** 写入缓存条目（失败结果不入缓存） */
export function makeCacheEntry<T>(input: {
  key: string;
  type: PoolDataType;
  value: T;
  ok: boolean;
  ttlSeconds?: number;
  nowIso?: string;
}): PoolCacheEntry<T> | null {
  if (!input.ok) return null; // 失败不缓存
  const now = new Date(input.nowIso ?? new Date().toISOString());
  const ttl = Math.max(0, input.ttlSeconds ?? DEFAULT_TTL_SECONDS[input.type]);
  return {
    key: input.key,
    type: input.type,
    value: input.value,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    hits: 0,
  };
}

/** 记一次命中（返回新条目，不改原对象） */
export function bumpHit<T>(entry: PoolCacheEntry<T>): PoolCacheEntry<T> {
  return { ...entry, hits: (entry.hits || 0) + 1 };
}

/**
 * 淘汰策略：先清过期，再按"最久未被创建"（近似 LRU：创建时间早的优先丢）截到 maxEntries。
 * 返回保留下来的条目与被淘汰数量。
 */
export function pruneCache<T>(
  entries: PoolCacheEntry<T>[],
  opts: { maxEntries?: number; nowIso?: string } = {}
): { kept: PoolCacheEntry<T>[]; expired: number; evicted: number } {
  const maxEntries = Math.max(1, opts.maxEntries ?? 500);
  const list = Array.isArray(entries) ? entries : [];
  const fresh = list.filter((e) => isFresh(e, opts.nowIso));
  const expired = list.length - fresh.length;
  if (fresh.length <= maxEntries) return { kept: fresh, expired, evicted: 0 };
  const sorted = [...fresh].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const drop = sorted.length - maxEntries;
  return { kept: sorted.slice(drop), expired, evicted: drop };
}

/** 缓存命中率（0-1）：用于管理员面板"缓存降本效果" */
export function cacheHitRate(input: { hits: number; misses: number }): number {
  const total = Math.max(0, input.hits) + Math.max(0, input.misses);
  if (total === 0) return 0;
  return Math.round((Math.max(0, input.hits) / total) * 1000) / 1000;
}
