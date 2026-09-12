// 看竞对 · 自动挑选对标竞品（纯逻辑，可测试）—— M3 升级版（PRD §6.3）。
//
// 规则（确定性，用户可换人）：
//  - 头部：目标细分内月收入最高（代表当前标杆与壁垒）
//  - 跟随者：接近头部、有增长、形成对照（同品牌优先，再看价格贴近度与增长）
//  - 新人：上架 ≤180 天里**表现最好的代表性新人**（不是"上架最新"的那一个）。
//    表现分 = 收入相对位置 0.5 + 评论增长 0.3 + 评分 0.2（全部是确定性排序，平局按 ASIN）。
//    若细分里没有 ≤180 天的新人 → 退回到"次新窗口"（≤540 天）里表现最好的，
//    并在 reason/note 里**明确写出这是回退**（用户确认口径，§15.1-17）。
//
// 每个选中项都带"为什么选它"（含具体数字），用户可以从目标细分 ASIN 列表里换人。

import type { Product } from './parser';

export type CompetitorRole = 'head' | 'follower' | 'newcomer';

export const ROLE_LABELS: Record<CompetitorRole, string> = {
  head: '头部',
  follower: '跟随者',
  newcomer: '新人',
};

/** 新人的标准窗口（天） */
export const NEWCOMER_MAX_DAYS = 180;
/** 没有新人时的回退窗口（天）：仍是"次新 + 表现好"，不是"上架最新" */
export const NEWCOMER_FALLBACK_DAYS = 540;

export interface PickedMetrics {
  monthlyRevenue: number;
  monthlySales: number;
  price: number;
  rating: number;
  reviewCount: number;
  reviewGrowth: number;
  daysSinceLaunch: number;
  /** 收入在候选池里的相对位置 0-1（1 = 最高） */
  revenueRank: number;
}

export interface PickedCompetitor {
  asin: string;
  brand: string;
  title: string;
  price: number;
  monthlyRevenue: number;
  monthlySales: number;
  rating: number;
  reviewCount: number;
  reviewGrowth: number;
  daysSinceLaunch: number;
  role: CompetitorRole;
  /** 为什么选它（含数字，确定性生成） */
  reason: string;
  /** 新人回退等需要用户知情的情况 */
  note?: string;
  metrics: PickedMetrics;
}

export interface PickResult {
  picked: PickedCompetitor[];
  /** 缺位与回退说明（例如"该细分没有 ≤180 天新人，已回退到次新窗口"） */
  notes: string[];
}

function rank(values: number[], v: number): number {
  const positive = values.filter((x) => Number.isFinite(x));
  if (positive.length <= 1) return 1;
  const sorted = [...positive].sort((a, b) => a - b);
  const below = sorted.filter((x) => x < v).length;
  return Math.round((below / (sorted.length - 1)) * 1000) / 1000;
}

function toPicked(p: Product, all: Product[]): Omit<PickedCompetitor, 'role' | 'reason' | 'note'> {
  return {
    asin: p.asin,
    brand: p.brand || '未知',
    title: p.title || '',
    price: p.price || 0,
    monthlyRevenue: p.monthlyRevenue || 0,
    monthlySales: p.monthlySales || 0,
    rating: p.rating || 0,
    reviewCount: p.reviewCount || 0,
    reviewGrowth: p.reviewGrowth || 0,
    daysSinceLaunch: p.daysSinceLaunch || 0,
    metrics: {
      monthlyRevenue: p.monthlyRevenue || 0,
      monthlySales: p.monthlySales || 0,
      price: p.price || 0,
      rating: p.rating || 0,
      reviewCount: p.reviewCount || 0,
      reviewGrowth: p.reviewGrowth || 0,
      daysSinceLaunch: p.daysSinceLaunch || 0,
      revenueRank: rank(all.map((x) => x.monthlyRevenue || 0), p.monthlyRevenue || 0),
    },
  };
}

/** 新人的表现分（0-1，确定性）：收入位置 0.5 + 评论增长 0.3 + 评分 0.2 */
export function newcomerPerformanceScore(p: Product, all: Product[]): number {
  const revenueRank = rank(all.map((x) => x.monthlyRevenue || 0), p.monthlyRevenue || 0);
  const growthRank = rank(all.map((x) => x.reviewGrowth || 0), p.reviewGrowth || 0);
  const ratingNorm = Math.max(0, Math.min(1, (Number(p.rating) || 0) / 5));
  return Math.round((revenueRank * 0.5 + growthRank * 0.3 + ratingNorm * 0.2) * 1000) / 1000;
}

/** 挑选结果 + 说明；需要只在 UI 里用列表时可直接取 picked */
export function pickCompetitorsDetailed(products: Product[], opts: { maxDaysNewcomer?: number } = {}): PickResult {
  if (!Array.isArray(products) || products.length === 0) return { picked: [], notes: [] };
  const notes: string[] = [];
  const newcomerWindow = opts.maxDaysNewcomer ?? NEWCOMER_MAX_DAYS;
  const sorted = [...products].sort(
    (a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0) || String(a.asin).localeCompare(String(b.asin))
  );
  const head = sorted[0];

  // 跟随者：同品牌优先 → 收入更高（更"接近头部"）→ 有增长 → 价格贴近头部 → ASIN（全部确定性）
  const headBrand = head.brand || '';
  const headPrice = head.price || 0;
  const follower = sorted
    .filter((p) => p.asin !== head.asin)
    .sort((a, b) => {
      const aSame = a.brand === headBrand ? 1 : 0;
      const bSame = b.brand === headBrand ? 1 : 0;
      if (aSame !== bSame) return bSame - aSame;
      const ra = a.monthlyRevenue || 0;
      const rb = b.monthlyRevenue || 0;
      if (ra !== rb) return rb - ra;
      const ga = a.reviewGrowth || 0;
      const gb = b.reviewGrowth || 0;
      if (ga !== gb) return gb - ga;
      const da = Math.abs((a.price || 0) - headPrice);
      const db = Math.abs((b.price || 0) - headPrice);
      if (da !== db) return da - db;
      return String(a.asin).localeCompare(String(b.asin));
    })[0];

  // 新人：≤180 天里表现最好的；没有则回退到"次新窗口"（≤540 天）里表现最好的；
  // 都没有 → 新人位**空缺**（绝不用老品冒充新人，那会让三列对比失去意义）
  const excluded = new Set([head.asin, follower?.asin].filter(Boolean) as string[]);
  const rest = sorted.filter((p) => !excluded.has(p.asin));
  const inWindow = rest.filter((p) => (p.daysSinceLaunch || 0) >= 0 && (p.daysSinceLaunch || 0) <= newcomerWindow);
  let pool = inWindow;
  let fallbackUsed = false;
  if (pool.length === 0) {
    pool = rest.filter((p) => (p.daysSinceLaunch || 0) <= NEWCOMER_FALLBACK_DAYS);
    fallbackUsed = pool.length > 0;
  }
  const newcomer = [...pool].sort(
    (a, b) => newcomerPerformanceScore(b, products) - newcomerPerformanceScore(a, products) || String(a.asin).localeCompare(String(b.asin))
  )[0];
  if (!newcomer) {
    notes.push(
      rest.length === 0
        ? '该细分只有 1-2 个商品：新人位空缺，建议先扩大细分样本或人工补充竞品'
        : `该细分没有 ≤${NEWCOMER_FALLBACK_DAYS} 天的次新样本（其余商品上架均更早）：新人位空缺——不用老品冒充新人，请人工指定或扩大样本`
    );
  } else if (fallbackUsed) {
    notes.push(
      `该细分没有上架 ≤${newcomerWindow} 天的新人：新人位回退为次新窗口（≤${NEWCOMER_FALLBACK_DAYS} 天）里表现最好者（仍按代表性挑选，不按上架时间）`
    );
  }

  const out: PickedCompetitor[] = [];
  if (head) {
    out.push({
      ...toPicked(head, products),
      role: 'head',
      reason: `细分内月收入最高：$${Math.round(head.monthlyRevenue || 0).toLocaleString()}（月销 ${head.monthlySales || 0} 件，评分 ${head.rating || 0}），代表当前标杆与竞争壁垒。`,
    });
  }
  if (follower) {
    const priceGap = Math.abs((follower.price || 0) - headPrice);
    out.push({
      ...toPicked(follower, products),
      role: 'follower',
      reason: `${follower.brand === headBrand ? '与头部同品牌' : '品牌不同但定位贴近'}、价格差 $${priceGap.toFixed(2)}，月收入 $${Math.round(
        follower.monthlyRevenue || 0
      ).toLocaleString()}${follower.reviewGrowth ? `、评论增长 ${follower.reviewGrowth}` : ''} → 紧跟头部、可作为对照。`,
    });
  }
  if (newcomer) {
    const score = newcomerPerformanceScore(newcomer, products);
    out.push({
      ...toPicked(newcomer, products),
      role: 'newcomer',
      reason: `上架 ${newcomer.daysSinceLaunch} 天，月收入 $${Math.round(newcomer.monthlyRevenue || 0).toLocaleString()}（候选池收入位置 ${(
        newcomerPerformanceScore(newcomer, products) * 100
      ).toFixed(0)} 分）、评分 ${newcomer.rating || 0} → 是**表现最好的代表性新人**（不是上架最新的那个）。`,
      note: fallbackUsed ? `回退：该细分无 ≤${newcomerWindow} 天新人，取自次新窗口（表现分 ${score}）` : undefined,
    });
  }
  return { picked: out, notes };
}

/** 兼容旧签名：只要列表时用这个 */
export function pickCompetitors(products: Product[], opts: { sameBandTolerance?: number } = {}): PickedCompetitor[] {
  void opts;
  return pickCompetitorsDetailed(products).picked;
}

/** 竞品明细工具的对比池上限（与 CompetitorHub 的 MAX_ASINS 保持一致：≤5） */
export const MAX_COMPARISON_ASINS = 5;

/**
 * M3⑥ 断链 #4：把看竞对挑出的 ASIN 归一化成可入对比池的列表。
 * 规则：去空、转大写、去重（保序）、截断到 ≤5。**不做猜测**：没有合法 ASIN 就返回空数组，
 * 由调用方决定提示什么（绝不用"随便挑几个"填充）。
 */
export function normalizeComparisonAsins(asins: string[], max = MAX_COMPARISON_ASINS): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(asins) ? asins : []) {
    const a = String(raw ?? '').trim().toUpperCase();
    if (!a) continue;
    if (out.includes(a)) continue;
    out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

export interface ReplacementCandidate {
  asin: string;
  brand: string;
  title: string;
  price: number;
  monthlyRevenue: number;
  daysSinceLaunch: number;
  rating: number;
  /** 为什么它可以替换当前这个角色（人话） */
  why: string;
}

/**
 * 用户换人（PRD §6.3："用户可换人（从目标细分 ASIN 列表选）"）。
 * 列出该角色下**除已选之外**的候选，按该角色的规则排序，并给"为什么它也行"的一句话。
 */
export function listReplacementCandidates(
  products: Product[],
  role: CompetitorRole,
  pickedAsins: string[]
): ReplacementCandidate[] {
  const pool = (Array.isArray(products) ? products : []).filter((p) => !pickedAsins.includes(p.asin));
  const head = [...products].sort((a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0))[0];
  const revenueOrder = [...products].sort(
    (a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0) || String(a.asin).localeCompare(String(b.asin))
  );
  const revenueRankOf = (asin: string) => revenueOrder.findIndex((p) => p.asin === asin) + 1;
  const sorted = [...pool].sort((a, b) => {
    if (role === 'newcomer') {
      return newcomerPerformanceScore(b, products) - newcomerPerformanceScore(a, products) || String(a.asin).localeCompare(String(b.asin));
    }
    return (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0) || String(a.asin).localeCompare(String(b.asin));
  });
  return sorted.slice(0, 8).map((p) => ({
    asin: p.asin,
    brand: p.brand || '未知',
    title: p.title || '',
    price: p.price || 0,
    monthlyRevenue: p.monthlyRevenue || 0,
    daysSinceLaunch: p.daysSinceLaunch || 0,
    rating: p.rating || 0,
    why:
      role === 'newcomer'
        ? `上架 ${p.daysSinceLaunch} 天，表现分 ${newcomerPerformanceScore(p, products)}（收入位置 ${(
            rank(products.map((x) => x.monthlyRevenue || 0), p.monthlyRevenue || 0) * 100
          ).toFixed(0)} 分）`
        : role === 'head'
          ? `月收入 $${Math.round(p.monthlyRevenue || 0).toLocaleString()}（全池第 ${revenueRankOf(p.asin)} 名）`
          : `价格 $${p.price || 0}（与头部 $${head?.price || 0} 相差 $${Math.abs((p.price || 0) - (head?.price || 0)).toFixed(2)}），月收入 $${Math.round(p.monthlyRevenue || 0).toLocaleString()}`,
  }));
}
