// M5 · 数据池持久化缓存的行映射（Supabase `pool_cache` 表 <-> 内存里的 PoolCacheEntry）。
//
// 职责边界：这一层是**纯函数**——不 import Supabase 客户端、不做任何 IO，读写都由网关（api/data/[action].ts）负责。
// 这样"库里那一行"和"内存里那一条"之间的转换规则可以被单测穷举，也保证内存缓存与持久缓存不会各算一套。
//
// 口径要点：
// - 字段名差异（camelCase <-> snake_case）只在这一层转换，避免每个调用点各写一遍映射；
// - 从库里读出来的一律当**不可信输入**：缺 key、日期不合法、hits 为负/小数、type 是未来新增的枚举值，
//   都必须被兜住，而不是让 NaN 和非法枚举扩散进命中决策（脏数据比"没缓存"更糟，会串数据）；
// - 过期只认 expires_at（与 isFresh() 同口径）：日期坏掉的行直接判为不可用（返回 null），
//   而不是猜一个 created_at/expires_at，否则"这条缓存到底能不能用来省钱"就说不清了。

import {
  cacheHitRate,
  DEFAULT_TTL_SECONDS,
  isFresh,
  type PoolCacheEntry,
  type PoolDataType,
} from './poolCache';

/**
 * `pool_cache` 表的一行（数据库口径，snake_case）。
 * `value` 用 unknown：jsonb 可以是对象/数组/标量/null，网关写入什么就原样读回什么。
 */
export interface PoolCacheRow {
  key: string;
  type: string;
  value: unknown;
  created_at: string;
  expires_at: string;
  hits: number;
}

/** 合法类型集合：从 DEFAULT_TTL_SECONDS 派生，避免将来新增类型时这里漏改（单一事实来源） */
const POOL_TYPES: readonly PoolDataType[] = Object.keys(DEFAULT_TTL_SECONDS) as PoolDataType[];

/** hits：夹成非负整数（负数→0、2.9→2、NaN/非数字→0）。它是统计口径，宁可少算也不能出现负数或小数 */
function clampHits(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/**
 * 时间归一化成 ISO 字符串；无法解析（缺字段、空串、'not-a-date'、Invalid Date）一律返回 null。
 * 顺带接受 Date 对象：PostgREST 一般返回 ISO 字符串，但不同驱动/未来换 pg 时可能是 Date。
 */
function normalizeIso(value: unknown): string | null {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const t = new Date(value).getTime();
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

/** type 兜底：大小写/空白归一后必须是已知枚举，否则归 'other'（未知类型仍可缓存，但统计时归入"其他"） */
function coercePoolType(value: unknown): PoolDataType {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if ((POOL_TYPES as readonly string[]).includes(v)) return v as PoolDataType;
  }
  return 'other';
}

/**
 * 内存条目 → 数据库行（写库前用）。
 * 规则：字段名转 snake_case；`undefined` 的值显式写成 `null`（jsonb 存不了 undefined，显式化才能保证"写进去的和读回来的一致"）；
 * hits 同样夹成非负整数，避免把内存里的脏计数写进库。
 */
export function entryToCacheRow(entry: PoolCacheEntry): PoolCacheRow {
  return {
    key: entry.key,
    type: entry.type,
    value: entry.value ?? null,
    created_at: entry.createdAt,
    expires_at: entry.expiresAt,
    hits: clampHits(entry.hits),
  };
}

/**
 * 数据库行 → 内存条目（读库后用）。**防御式**：任何无法安全使用的行返回 `null`，调用方按"没缓存"处理。
 *
 * 判为 null 的情形：row 不是普通对象（null / 数组 / 字符串 / 数字）、key 缺失或只有空白、
 * created_at 或 expires_at 缺失或不可解析（日期坏掉就无法判断新鲜度，猜不得）。
 * 被兜住而不是丢弃的情形：`value` 可以是任何 JSON（含 null，即"缓存了一个空结果"）；
 * `hits` 夹成非负整数；`type` 非法/非字符串则回落 'other'。
 */
export function rowToCacheEntry<T = unknown>(row: unknown): PoolCacheEntry<T> | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  const key = typeof r.key === 'string' ? r.key.trim() : '';
  if (!key) return null;

  const createdAt = normalizeIso(r.created_at);
  if (!createdAt) return null;
  const expiresAt = normalizeIso(r.expires_at);
  if (!expiresAt) return null;

  return {
    key,
    type: coercePoolType(r.type),
    value: (r.value ?? null) as T,
    createdAt,
    expiresAt,
    hits: clampHits(r.hits),
  };
}

/**
 * 过期清理计划（网关据此执行 `delete from pool_cache where expires_at <= expiredBefore`）。
 *
 * 规则：**expires_at <= now 视为可清理**（边界相等也算，与 isFresh() 的 `exp > now` 严格互补，
 * 因此"数据库里删掉的"和"内存里认为过期的"永远是同一批行，不会出现一边当命中一边被删）。
 * `nowIso` 不传或不可解析时取当前时间，保证函数对调用方永远可用、不抛错。
 */
export function prunePlan(nowIso?: string): { expiredBefore: string } {
  return { expiredBefore: normalizeIso(nowIso) ?? new Date().toISOString() };
}

/** 按类型聚合的一行（管理后台"缓存降本效果"表） */
export interface CacheTypeSummary {
  type: PoolDataType;
  entries: number;
  hits: number;
}

/** 缓存现状汇总（管理后台展示用） */
export interface CacheRowsSummary {
  /** 可用行数（坏行已被 rowToCacheEntry 过滤，因此 ≤ 传入行数） */
  entries: number;
  /** 其中未过期的行数 */
  fresh: number;
  /** 其中已过期的行数（entries - fresh） */
  expired: number;
  /** 命中次数合计（hits 已夹成非负整数） */
  hits: number;
  /** 命中率 0-1，公式见函数注释；无数据时为 0 */
  hitRate: number;
  /** 按类型分组，排序确定（见函数注释） */
  byType: CacheTypeSummary[];
}

/**
 * 汇总一批缓存行，供管理后台回答"持久缓存到底省了多少次外部调用"。
 *
 * 规则：
 * 1) 先用 rowToCacheEntry 逐行解析，坏行直接跳过（统计只基于可用数据，不会因为一行脏数据整体崩掉）；
 * 2) fresh / expired 按 `isFresh(entry, nowIso)` 判定，与网关命中判定同口径；
 * 3) hitRate = 命中次数 /（命中次数 + 缓存行数），其中"缓存行数"作为**未命中代理**：
 *    每写入一行都代表一次不得不真去调外部接口的未命中（缓存命中不会写行，只会 hits+1）。
 *    直接复用 poolCache.cacheHitRate，保证持久缓存与内存缓存命中率同口径；
 *    分母为 0（无数据或全是坏行）时返回 0，**绝不产生 NaN**，小数位保留 3 位；
 * 4) byType 只列出现过的类型，排序为：命中次数降序 → 条目数降序 → 类型名升序（字符序，不依赖 locale），
 *    保证同一份数据每次输出的顺序完全一致，便于快照对比与表格稳定。
 */
export function summarizeCacheRows(rows: unknown[], nowIso?: string): CacheRowsSummary {
  const list = Array.isArray(rows) ? rows : [];
  const now = normalizeIso(nowIso) ?? new Date().toISOString();

  const entries: PoolCacheEntry[] = [];
  for (const row of list) {
    const entry = rowToCacheEntry(row);
    if (entry) entries.push(entry);
  }

  let fresh = 0;
  let hits = 0;
  const grouped = new Map<PoolDataType, CacheTypeSummary>();
  for (const entry of entries) {
    if (isFresh(entry, now)) fresh += 1;
    hits += entry.hits;
    const bucket = grouped.get(entry.type);
    if (bucket) {
      bucket.entries += 1;
      bucket.hits += entry.hits;
    } else {
      grouped.set(entry.type, { type: entry.type, entries: 1, hits: entry.hits });
    }
  }

  const byType = [...grouped.values()].sort(
    (a, b) =>
      b.hits - a.hits ||
      b.entries - a.entries ||
      (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
  );

  return {
    entries: entries.length,
    fresh,
    expired: entries.length - fresh,
    hits,
    // misses 取缓存行数：见上面第 3 条（每行 = 一次真实外部调用）
    hitRate: cacheHitRate({ hits, misses: entries.length }),
    byType,
  };
}
