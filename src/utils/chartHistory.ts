import { Product, HistoryRecord } from './parser';

export interface AsinPeriodStats {
  sales: number;
  revenue: number;
}

/** 按 ASIN 汇总所选月份内的销量/销售额（仅含当前商品列表中的 ASIN） */
export function buildAsinPeriodStatsMap(
  products: Product[],
  history: HistoryRecord[],
  selectedMonths: string[]
): Map<string, AsinPeriodStats> {
  const asinSet = new Set(products.map(p => p.asin));
  const map = new Map<string, AsinPeriodStats>();

  if (selectedMonths.length === 0) return map;

  history.forEach(h => {
    if (!asinSet.has(h.asin)) return;
    let sales = 0;
    let revenue = 0;
    selectedMonths.forEach(m => {
      const d = h.history[m];
      if (d) {
        sales += d.sales;
        revenue += d.revenue;
      }
    });
    if (sales > 0 || revenue > 0) {
      map.set(h.asin, { sales, revenue });
    }
  });

  return map;
}

export function getAsinPeriodStats(
  asinStats: Map<string, AsinPeriodStats>,
  asin: string
): AsinPeriodStats {
  return asinStats.get(asin) ?? { sales: 0, revenue: 0 };
}
