import type { HistoryRecord, Product } from './parser';

export interface DataQualityMetric {
  label: string;
  value: string;
  level: 'good' | 'warn' | 'bad';
  note: string;
}

export interface DataQualityIssue {
  level: 'warn' | 'bad';
  message: string;
}

export interface MarketDataQuality {
  score: number;
  summary: string;
  metrics: DataQualityMetric[];
  issues: DataQualityIssue[];
}

const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);
const fmtPct = (v: number) => `${v.toFixed(0)}%`;

function levelByCoverage(v: number, warn = 70, bad = 35): DataQualityMetric['level'] {
  if (v < bad) return 'bad';
  if (v < warn) return 'warn';
  return 'good';
}

export function buildMarketDataQuality(
  products: Product[],
  history: HistoryRecord[],
  months: string[]
): MarketDataQuality {
  const total = products.length;
  const historyAsins = new Set(history.map((h) => h.asin));
  const withHistory = products.filter((p) => historyAsins.has(p.asin)).length;
  const priceCoverage = pct(products.filter((p) => p.price > 0).length, total);
  const fbaCoverage = pct(products.filter((p) => p.fbaFee > 0 && p.price > 0).length, total);
  const launchCoverage = pct(products.filter((p) => p.daysSinceLaunch > 0 || p.launchDate).length, total);
  const ratingCoverage = pct(products.filter((p) => p.rating > 0).length, total);
  const reviewCoverage = pct(products.filter((p) => p.reviewCount > 0).length, total);
  const imageCoverage = pct(products.filter((p) => Boolean(p.image)).length, total);
  const historyCoverage = pct(withHistory, total);

  const historyCells = history.reduce((sum, h) => sum + months.filter((m) => Boolean(h.history[m])).length, 0);
  const revenueCells = history.reduce(
    (sum, h) => sum + months.filter((m) => (h.history[m]?.revenue || 0) > 0).length,
    0
  );
  const salesCells = history.reduce(
    (sum, h) => sum + months.filter((m) => (h.history[m]?.sales || 0) > 0).length,
    0
  );
  const revenueCoverage = pct(revenueCells, historyCells || history.length * months.length);
  const salesCoverage = pct(salesCells, historyCells || history.length * months.length);

  const issues: DataQualityIssue[] = [];
  if (total === 0) issues.push({ level: 'bad', message: '没有有效 ASIN，所有市场判断不可用。' });
  if (months.length < 3) issues.push({ level: 'bad', message: '历史月份少于 3 个月，趋势、季节性和增长判断不可用。' });
  else if (months.length < 12) issues.push({ level: 'warn', message: '历史月份少于 12 个月，增长率和季节性只能作为弱信号。' });
  if (historyCoverage < 70) issues.push({ level: 'warn', message: `只有 ${fmtPct(historyCoverage)} 商品匹配到历史数据，趋势图与大盘 KPI 可能低估。` });
  if (revenueCoverage < 70) issues.push({ level: 'warn', message: `销售额覆盖率 ${fmtPct(revenueCoverage)}，市场规模和均价判断置信度下降。` });
  if (fbaCoverage < 50) issues.push({ level: 'warn', message: `FBA 费用覆盖率 ${fmtPct(fbaCoverage)}，成本/利润相关结论只能作参考。` });
  if (launchCoverage < 50) issues.push({ level: 'warn', message: `上架时间覆盖率 ${fmtPct(launchCoverage)}，新品窗口判断可能失真。` });
  if (ratingCoverage < 70 || reviewCoverage < 70) issues.push({ level: 'warn', message: '评分或评论数字段覆盖不足，竞争壁垒和口碑空间判断需谨慎。' });

  const weighted =
    0.2 * Math.min(100, months.length >= 12 ? 100 : months.length * 8) +
    0.2 * historyCoverage +
    0.2 * revenueCoverage +
    0.15 * priceCoverage +
    0.1 * fbaCoverage +
    0.1 * launchCoverage +
    0.05 * Math.min(ratingCoverage, reviewCoverage);
  const score = Math.round(Math.max(0, Math.min(100, weighted)));

  const summary =
    score >= 80
      ? '数据覆盖较完整，可支撑市场判断。'
      : score >= 60
        ? '数据基本可用，但部分结论需要看置信度。'
        : '数据缺口较多，应先补字段或只做方向性判断。';

  return {
    score,
    summary,
    metrics: [
      { label: '商品明细', value: `${total.toLocaleString()} 个 ASIN`, level: total > 0 ? 'good' : 'bad', note: '市场样本规模' },
      { label: '历史月份', value: `${months.length} 个月`, level: months.length >= 12 ? 'good' : months.length >= 3 ? 'warn' : 'bad', note: '影响趋势/季节判断' },
      { label: '历史匹配', value: fmtPct(historyCoverage), level: levelByCoverage(historyCoverage), note: '商品 ASIN 与历史表匹配率' },
      { label: '销售额覆盖', value: fmtPct(revenueCoverage), level: levelByCoverage(revenueCoverage), note: '影响市场规模/均价' },
      { label: '价格覆盖', value: fmtPct(priceCoverage), level: levelByCoverage(priceCoverage), note: '影响价格带与利润测算' },
      { label: 'FBA覆盖', value: fmtPct(fbaCoverage), level: levelByCoverage(fbaCoverage, 60, 25), note: '影响成本判断' },
      { label: '上架时间', value: fmtPct(launchCoverage), level: levelByCoverage(launchCoverage, 60, 25), note: '影响新品窗口' },
      { label: '图片覆盖', value: fmtPct(imageCoverage), level: levelByCoverage(imageCoverage, 60, 25), note: '影响竞品浏览体验' },
    ],
    issues,
  };
}
