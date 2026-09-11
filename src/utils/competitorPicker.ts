// 看竞品 → 自动挑选对标竞品（纯逻辑，可测试）。
// 从指定细分市场的商品里，按规则选 3 个对标：
//  - 头部：月收入最高
//  - 头部跟随者：月收入次高（与头部同品牌/同价格带优先，作为「紧跟头部」的竞品）
//  - 新品：上架时间最晚（daysSinceLaunch 最小 > 0，即最新上架）

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
  /** seed 类型：head | follower | newcomer */
  role: 'head' | 'follower' | 'newcomer';
  /** 简要说明为何选它 */
  reason: string;
}

export function pickCompetitors(
  products: Product[],
  opts: { sameBandTolerance?: number } = {}
): PickedCompetitor[] {
  if (products.length === 0) return [];
  const sorted = [...products].sort((a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0));
  const head = sorted[0];

  // 跟随者：优先「与头部同品牌」且收入次高；否则取月收入第二（价格与头部相近）
  const headBrand = head.brand || '';
  const headPrice = head.price || 0;
  const sameBand = sorted
    .filter((p) => p.asin !== head.asin)
    .sort((a, b) => {
      // 同品牌优先，再按价格接近度
      const aSame = a.brand === headBrand ? 1 : 0;
      const bSame = b.brand === headBrand ? 1 : 0;
      if (aSame !== bSame) return bSame - aSame;
      const da = Math.abs((a.price || 0) - headPrice);
      const db = Math.abs((b.price || 0) - headPrice);
      return da - db;
    });
  const follower = sameBand[0];

  // 新品：daysSinceLaunch 最小（最新上架），排除头部自身与跟随者
  const newcomers = sorted
    .filter((p) => p.asin !== head.asin && p.asin !== follower?.asin)
    .sort((a, b) => (a.daysSinceLaunch || 0) - (b.daysSinceLaunch || 0));
  const newcomer = newcomers.find((p) => (p.daysSinceLaunch || 0) >= 0 && (p.daysSinceLaunch || 0) <= 365) || newcomers[0];

  const out: PickedCompetitor[] = [];
  if (head) {
    out.push({
      ...toPick(head),
      role: 'head',
      reason: '该细分月收入最高的头部商品，代表当前标杆与竞争壁垒。',
    });
  }
  if (follower) {
    out.push({
      ...toPick(follower),
      role: 'follower',
      reason: follower.brand === headBrand
        ? '与头部同品牌、收入/价格贴近，是紧跟头部的跟随者。'
        : '收入/价格与头部相近，属于头部的主要跟随者。',
    });
  }
  if (newcomer) {
    out.push({
      ...toPick(newcomer),
      role: 'newcomer',
      reason: `上架约 ${newcomer.daysSinceLaunch} 天，是新进入该细分、值得关注的新品。`,
    });
  }
  return out;
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
