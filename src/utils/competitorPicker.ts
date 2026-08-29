import type { Product } from './parser';

export interface PickedCompetitor {
  asin: string;
  brand: string;
  title: string;
  price: number;
  monthlyRevenue: number;
  monthlySales: number;
  rating: number;
  reviewCount: number;
  daysSinceLaunch: number;
  role: 'head' | 'follower' | 'newcomer';
  reason: string;
}

export function pickCompetitors(
  products: Product[],
  opts: { sameBandTolerance?: number } = {}
): PickedCompetitor[] {
  if (products.length === 0) return [];
  const sorted = [...products].sort((a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0));
  const head = sorted[0];
  const headBrand = head.brand || '';
  const headPrice = head.price || 0;
  const tolerance = opts.sameBandTolerance ?? 0.2;

  const follower =
    sorted
      .filter((p) => p.asin !== head.asin && (p.brand || '') === headBrand)
      .sort((a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0))[0]
    ?? sorted
      .filter((p) => {
        if (p.asin === head.asin) return false;
        if (!headPrice || !p.price) return true;
        return Math.abs(p.price - headPrice) / headPrice <= tolerance;
      })
      .sort((a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0))[0]
    ?? sorted.find((p) => p.asin !== head.asin);

  const newcomer = pickNewcomer(sorted.filter((p) => p.asin !== head.asin && p.asin !== follower?.asin));
  const out: PickedCompetitor[] = [];

  if (head) {
    out.push({
      ...toPick(head),
      role: 'head',
      reason: '该细分市场月销售额最高的头部商品，代表当前标杆和竞争壁垒。',
    });
  }
  if (follower) {
    out.push({
      ...toPick(follower),
      role: 'follower',
      reason: follower.brand === headBrand
        ? '与头部同品牌，收入靠前，适合观察头部品牌的产品组合打法。'
        : '收入和价格带接近头部，适合观察主要跟随者的追赶方式。',
    });
  }
  if (newcomer) {
    out.push({
      ...toPick(newcomer),
      role: 'newcomer',
      reason: `上架约 ${newcomer.daysSinceLaunch || 0} 天，是优先年龄区间内销量最高的新品样本。`,
    });
  }
  return out;
}

function pickNewcomer(products: Product[]): Product | undefined {
  const buckets = [
    [0, 180],
    [181, 365],
    [366, 730],
    [731, Number.POSITIVE_INFINITY],
  ] as const;
  for (const [min, max] of buckets) {
    const best = products
      .filter((p) => {
        const days = p.daysSinceLaunch || 0;
        return days >= min && days <= max;
      })
      .sort((a, b) => (b.monthlySales || 0) - (a.monthlySales || 0))[0];
    if (best) return best;
  }
  return products.slice().sort((a, b) => (b.monthlySales || 0) - (a.monthlySales || 0))[0];
}

function toPick(p: Product): Omit<PickedCompetitor, 'role' | 'reason'> {
  return {
    asin: p.asin,
    brand: p.brand || '未知',
    title: p.title || '',
    price: p.price || 0,
    monthlyRevenue: p.monthlyRevenue || 0,
    monthlySales: p.monthlySales || 0,
    rating: p.rating || 0,
    reviewCount: p.reviewCount || 0,
    daysSinceLaunch: p.daysSinceLaunch || 0,
  };
}
