import type { Product, HistoryRecord } from './parser';

export type SegmentScoreDimKey =
  | 'marketSize'
  | 'growth'
  | 'concentration'
  | 'reviews'
  | 'priceDispersion'
  | 'newProduct'
  | 'rating'
  | 'fbaCost';

export interface SegmentScoreDimension {
  key: SegmentScoreDimKey;
  label: string;
  score: number;
  weight: number;
  display: string;
}

export interface SegmentScoreResult {
  segment: string;
  trend: number;
  volume: number;
  competition: number;
  opportunity: number;
  productCount: number;
  totalRevenue: number;
  avgPrice: number;
  avgRating: number;
  topAsins: string[];
  dimensions: SegmentScoreDimension[];
  confidenceNotes: string[];
}

export type SegmentScoreWeights = Record<SegmentScoreDimKey, number>;

export interface SegmentScoreConifg {
  weights?: Partial<SegmentScoreWeights>;
}

export const SEGMENT_SCORE_LABELS: Record<SegmentScoreDimKey, string> = {
  marketSize: '市场体量',
  growth: '增长趋势',
  concentration: '市场集中度',
  reviews: '评论壁垒',
  priceDispersion: '价格离散度',
  newProduct: '新品活力',
  rating: '评分水平',
  fbaCost: 'FBA成本率',
};

export const DEFAULT_SEGMENT_SCORE_WEIGHTS: SegmentScoreWeights = {
  marketSize: 10,
  growth: 9,
  concentration: 7,
  reviews: 6,
  priceDispersion: 4,
  newProduct: 5,
  rating: 4,
  fbaCost: 6,
};

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function avg(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v));
  return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : 0;
}

function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v).toLocaleString()}`;
}

function scoreHigher(raw: number, mid: number, high: number): number {
  if (raw >= high) return 85;
  if (raw >= mid) return 55;
  return 25;
}

function scoreLower(raw: number, low: number, mid: number): number {
  if (raw <= low) return 85;
  if (raw <= mid) return 55;
  return 25;
}

function segmentHistory(products: Product[], history: HistoryRecord[]): HistoryRecord[] {
  const asins = new Set(products.map((p) => p.asin.toUpperCase()));
  return history.filter((h) => asins.has(h.asin.toUpperCase()));
}

function recentMonthlyRevenue(products: Product[], history: HistoryRecord[]): { value: number; months: string[] } {
  const hist = segmentHistory(products, history);
  const months = [...new Set(hist.flatMap((h) => Object.keys(h.history || {})))].sort();
  const recent = months.slice(-3);
  if (recent.length) {
    const value = avg(
      recent.map((month) =>
        hist.reduce((sum, h) => sum + (h.history[month]?.revenue || 0), 0)
      )
    );
    return { value, months };
  }
  return { value: products.reduce((s, p) => s + (p.monthlyRevenue || 0), 0), months };
}

function growthRate(products: Product[], history: HistoryRecord[]): { value: number; months: string[] } {
  const hist = segmentHistory(products, history);
  const months = [...new Set(hist.flatMap((h) => Object.keys(h.history || {})))].sort();
  const sumRev = (items: string[]) =>
    items.reduce((sum, month) => sum + hist.reduce((s, h) => s + (h.history[month]?.revenue || 0), 0), 0);
  if (months.length >= 12) {
    const recent = sumRev(months.slice(-6));
    const prior = sumRev(months.slice(-12, -6));
    return { value: prior > 0 ? ((recent / prior) - 1) * 100 : 0, months };
  }
  if (months.length >= 2) {
    const first = sumRev(months.slice(0, 1));
    const last = sumRev(months.slice(-1));
    return { value: first > 0 ? ((last / first) - 1) * 100 : 0, months };
  }
  return { value: 0, months };
}

export function scoreSegment(
  segment: string,
  products: Product[],
  history: HistoryRecord[],
  cfg: SegmentScoreConifg = {}
): SegmentScoreResult {
  const weights: SegmentScoreWeights = { ...DEFAULT_SEGMENT_SCORE_WEIGHTS, ...cfg.weights };
  if (products.length === 0) {
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
      dimensions: Object.keys(weights).map((key) => ({
        key: key as SegmentScoreDimKey,
        label: SEGMENT_SCORE_LABELS[key as SegmentScoreDimKey],
        score: 0,
        weight: weights[key as SegmentScoreDimKey],
        display: '-',
      })),
      confidenceNotes: ['该细分没有可评分商品样本'],
    };
  }

  const totalRevenue = products.reduce((s, p) => s + (p.monthlyRevenue || 0), 0);
  const totalSales = products.reduce((s, p) => s + (p.monthlySales || 0), 0);
  const top10Sales = [...products].sort((a, b) => (b.monthlySales || 0) - (a.monthlySales || 0)).slice(0, 10).reduce((s, p) => s + (p.monthlySales || 0), 0);
  const concentration = totalSales > 0 ? (top10Sales / totalSales) * 100 : 0;
  const avgReviews = avg(products.map((p) => p.reviewCount || 0));
  const prices = products.map((p) => p.price || 0).filter((p) => p > 0);
  const avgPrice = avg(prices);
  const priceCv = avgPrice > 0 ? Math.sqrt(avg(prices.map((p) => (p - avgPrice) ** 2))) / avgPrice : 0;
  const newProductRatio = products.length ? (products.filter((p) => (p.daysSinceLaunch || 0) > 0 && (p.daysSinceLaunch || 0) <= 90).length / products.length) * 100 : 0;
  const avgRating = avg(products.map((p) => p.rating || 0));
  const fbaProducts = products.filter((p) => (p.fbaFee || 0) > 0 && (p.price || 0) > 0);
  const avgFbaRatio = fbaProducts.length ? avg(fbaProducts.map((p) => ((p.fbaFee || 0) / (p.price || 1)) * 100)) : 0;
  const market = recentMonthlyRevenue(products, history);
  const growth = growthRate(products, history);
  const historyCoverage = products.length ? (segmentHistory(products, history).length / products.length) * 100 : 0;
  const launchCoverage = products.length ? (products.filter((p) => (p.daysSinceLaunch || 0) > 0 || p.launchDate).length / products.length) * 100 : 0;
  const fbaCoverage = products.length ? (fbaProducts.length / products.length) * 100 : 0;

  const scoreMap: Record<SegmentScoreDimKey, number> = {
    marketSize: scoreHigher(market.value, 70_000, 300_000),
    growth: scoreHigher(growth.value, 0, 15),
    concentration: scoreLower(concentration, 30, 50),
    reviews: scoreLower(avgReviews, 100, 500),
    priceDispersion: scoreLower(priceCv, 0.3, 0.6),
    newProduct: scoreHigher(newProductRatio, 8, 15),
    rating: scoreHigher(avgRating, 4.0, 4.3),
    fbaCost: fbaProducts.length ? scoreLower(avgFbaRatio, 15, 25) : 55,
  };

  const displayMap: Record<SegmentScoreDimKey, string> = {
    marketSize: fmtMoney(market.value),
    growth: `${growth.value >= 0 ? '+' : ''}${growth.value.toFixed(1)}%`,
    concentration: `${concentration.toFixed(0)}%`,
    reviews: avgReviews >= 1000 ? `${(avgReviews / 1000).toFixed(1)}k` : `${avgReviews.toFixed(0)}`,
    priceDispersion: `${(priceCv * 100).toFixed(0)}%`,
    newProduct: `${newProductRatio.toFixed(1)}%`,
    rating: avgRating.toFixed(1),
    fbaCost: fbaProducts.length ? `${avgFbaRatio.toFixed(1)}%` : '-',
  };

  const dimensions = (Object.keys(weights) as SegmentScoreDimKey[]).map((key) => ({
    key,
    label: SEGMENT_SCORE_LABELS[key],
    score: scoreMap[key],
    weight: weights[key],
    display: displayMap[key],
  }));
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const opportunity = totalWeight > 0
    ? Math.round(dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight)
    : Math.round(avg(dimensions.map((d) => d.score)));
  const topAsins = [...products]
    .sort((a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0))
    .slice(0, 3)
    .map((p) => p.asin);

  const confidenceNotes = [
    growth.months.length < 12 ? `历史月份 ${growth.months.length}/12，增长分偏保守` : '',
    historyCoverage < 70 ? `历史覆盖 ${historyCoverage.toFixed(0)}%` : '',
    launchCoverage < 50 ? `上架时间覆盖 ${launchCoverage.toFixed(0)}%` : '',
    fbaCoverage < 50 ? `FBA覆盖 ${fbaCoverage.toFixed(0)}%` : '',
  ].filter(Boolean);

  return {
    segment,
    trend: scoreMap.growth,
    volume: scoreMap.marketSize,
    competition: scoreMap.concentration,
    opportunity: clamp(opportunity),
    productCount: products.length,
    totalRevenue,
    avgPrice: Math.round(avgPrice * 100) / 100,
    avgRating: Math.round(avgRating * 10) / 10,
    topAsins,
    dimensions,
    confidenceNotes,
  };
}

export function scoreSegments(
  segments: string[],
  asinToSegment: Record<string, string>,
  products: Product[],
  history: HistoryRecord[],
  cfg: SegmentScoreConifg = {}
): SegmentScoreResult[] {
  const map = new Map(Object.entries(asinToSegment).map(([asin, seg]) => [asin.toUpperCase(), seg]));
  return segments
    .map((seg) => scoreSegment(seg, products.filter((p) => map.get(p.asin.toUpperCase()) === seg), history, cfg))
    .sort((a, b) => b.opportunity - a.opportunity);
}

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
