// 细分市场评分（看市场）：按「趋势 / 体量 / 竞争」三维度确定性打分，产出机会分。
// 原则：分值由确定性公式计算，AI 只做解读、不改数值（PRD 18）。

import type { Product, HistoryRecord } from './parser';

export interface SegmentScoreResult {
  segment: string;
  /** 维度得分 0-100 */
  trend: number;
  volume: number;
  competition: number;
  /** 综合机会分 0-100（加权） */
  opportunity: number;
  /** 该细分商品样本数 */
  productCount: number;
  /** 该细分总月销售额（美元） */
  totalRevenue: number;
  avgPrice: number;
  avgRating: number;
  /** 头部 / 标杆建议（按月收入排序取前 3） */
  topAsins: string[];
}

export interface SegmentScoreConifg {
  weights?: { trend?: number; volume?: number; competition?: number };
}

const DEFAULT_WEIGHTS = { trend: 0.35, volume: 0.35, competition: 0.3 };

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

/** 由全局数据计算某集合的趋势（基于 history 的月度均值变化）；无历史时退回经验分。 */
function computeTrend(products: Product[], history: HistoryRecord[]): number {
  // 用有历史记录的商品估算月度复合增长率
  const ratios: number[] = [];
  for (const h of history) {
    const p = products.find((pr) => pr.asin === h.asin);
    if (!p) continue;
    const months = Object.keys(h.history || {}).sort();
    if (months.length < 2) continue;
    const first = h.history[months[0]];
    const last = h.history[months[months.length - 1]];
    if (!first || !last || first.revenue <= 0) continue;
    const growth = (last.revenue - first.revenue) / first.revenue;
    // 用简单平均趋势；限制单条影响
    ratios.push(clamp(growth * 100, -60, 120));
  }
  if (ratios.length === 0) {
    // 无历史：用新品占比作为趋势代理（新品多通常代表需求在增长）
    const fresh = products.filter((p) => p.daysSinceLaunch >= 0 && p.daysSinceLaunch <= 180).length;
    const ratio = products.length > 0 ? fresh / products.length : 0;
    return clamp(Math.round(50 + ratio * 40), 0, 100);
  }
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return clamp(Math.round(50 + avg), 0, 100);
}

/** 体量：用总月收入在这一细分集合中的相对水平 + 商品规模估算。 */
function computeVolume(products: Product[]): number {
  if (products.length === 0) return 0;
  const totalRevenue = products.reduce((s, p) => s + (p.monthlyRevenue || 0), 0);
  // 体量分 = 收入 0~某上限映射 + 商品数小权重。上限按经验设 300 万刀封顶（100 分）。
  const revenueScore = clamp((totalRevenue / 3_000_000) * 100, 0, 100);
  const countScore = clamp((products.length / 100) * 100, 0, 100);
  return clamp(Math.round(revenueScore * 0.7 + countScore * 0.3), 0, 100);
}

/** 竞争：集中度越低越不卷 → 分越高。用头部品牌份额（CR）与商品分散度估算。 */
function computeCompetition(products: Product[]): number {
  if (products.length === 0) return 50; // 无数据给中性分
  const totalRev = products.reduce((s, p) => s + (p.monthlyRevenue || 0), 0) || 1;
  const brandRev = new Map<string, number>();
  for (const p of products) {
    const b = p.brand || '未知';
    brandRev.set(b, (brandRev.get(b) || 0) + (p.monthlyRevenue || 0));
  }
  const sorted = [...brandRev.entries()].sort((a, b) => b[1] - a[1]);
  // CR4：前 4 品牌份额
  const cr4 = sorted.slice(0, 4).reduce((s, [, v]) => s + v, 0) / totalRev;
  // CR4 越高→集中度越高→竞争越强（对进入者更难）→ 竞争分越低
  // CR4 0.2(分散) → 高分；0.8(垄断) → 低分
  const concentrationScore = clamp((1 - cr4) * 125, 0, 100);
  // 商品分散度（样本越多越分散 → 越易进入）
  const spreadScore = clamp((products.length / 50) * 100, 0, 100);
  return clamp(Math.round(concentrationScore * 0.6 + spreadScore * 0.4), 0, 100);
}

/** 对一个细分市场打分。 */
export function scoreSegment(
  segment: string,
  products: Product[],
  history: HistoryRecord[],
  cfg: SegmentScoreConifg = {}
): SegmentScoreResult {
  const weights = { ...DEFAULT_WEIGHTS, ...cfg.weights };
  if (products.length === 0) {
    // 无商品：无数据可评估，各维度与机会分均记为 0
    return {
      segment,
      trend: 0,
      volume: 0,
      competition: 0,
      opportunity: 0,
      productCount: 0,
      totalRevenue: 0,
      avgPrice: 0,
      avgRating: 0,
      topAsins: [],
    };
  }
  const trend = computeTrend(products, history);
  const volume = computeVolume(products);
  const competition = computeCompetition(products);
  const opportunity = clamp(
    Math.round(trend * weights.trend + volume * weights.volume + competition * weights.competition),
    0,
    100
  );
  const totalRevenue = products.reduce((s, p) => s + (p.monthlyRevenue || 0), 0);
  const avgPrice = products.length > 0 ? products.reduce((s, p) => s + (p.price || 0), 0) / products.length : 0;
  const avgRating = products.length > 0 ? products.reduce((s, p) => s + (p.rating || 0), 0) / products.length : 0;
  const topAsins = [...products]
    .sort((a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0))
    .slice(0, 3)
    .map((p) => p.asin);

  return {
    segment,
    trend,
    volume,
    competition,
    opportunity,
    productCount: products.length,
    totalRevenue,
    avgPrice: Math.round(avgPrice * 100) / 100,
    avgRating: Math.round(avgRating * 10) / 10,
    topAsins,
  };
}

/** 对所有细分打分并按机会分降序，返回排序结果。 */
export function scoreSegments(
  segments: string[],
  asinToSegment: Record<string, string>,
  products: Product[],
  history: HistoryRecord[],
  cfg: SegmentScoreConifg = {}
): SegmentScoreResult[] {
  const results = segments.map((seg) => {
    const segProducts = products.filter((p) => asinToSegment[p.asin] === seg);
    return scoreSegment(seg, segProducts, history, cfg);
  });
  return results.sort((a, b) => b.opportunity - a.opportunity);
}

/** 返回机会分最高的细分市场（最多 topN 个），用于竞品对标等。 */
export function topOpportunitySegments(
  segments: string[],
  asinToSegment: Record<string, string>,
  products: Product[],
  history: HistoryRecord[],
  topN = 1,
  cfg: SegmentScoreConifg = {}
): SegmentScoreResult[] {
  return scoreSegments(segments, asinToSegment, products, history, cfg).slice(0, topN);
}
