import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { HistoryRecord, getCurrencySymbol } from '../utils/parser';
import { Flame } from 'lucide-react';

interface Props {
  history: HistoryRecord[];
  months: string[];
  domain?: string;
}

const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

type MetricType = 'sales' | 'revenue' | 'avgPrice';
const METRIC_LABELS: Record<MetricType, string> = { sales: '销量', revenue: '销售额', avgPrice: '平均价格' };

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function getColor(norm: number, metric: MetricType): string {
  // norm: 0(min) ~ 1(max)
  if (metric === 'avgPrice') {
    // 蓝色系：低价=浅蓝，高价=深蓝
    const r = Math.round(lerp(239, 37, norm));
    const g = Math.round(lerp(246, 99, norm));
    const b = Math.round(lerp(255, 235, norm));
    return `rgb(${r},${g},${b})`;
  }
  // 火色/橙色系：低=浅黄，高=深橙红
  if (norm < 0.5) {
    const t = norm * 2;
    const r = Math.round(lerp(255, 251, t));
    const g = Math.round(lerp(251, 146, t));
    const b = Math.round(lerp(235, 60, t));
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (norm - 0.5) * 2;
    const r = Math.round(lerp(251, 194, t));
    const g = Math.round(lerp(146, 65, t));
    const b = Math.round(lerp(60, 12, t));
    return `rgb(${r},${g},${b})`;
  }
}

function getTextColor(norm: number): string {
  return norm > 0.55 ? 'text-white' : 'text-[#1d1d1f]';
}

export const SeasonalHeatmap = React.memo(function SeasonalHeatmap({ history, months, domain = 'amazon.com' }: Props) {
  const currency = getCurrencySymbol(domain);
  const [metric, setMetric] = useState<MetricType>('sales');

  // 提取所有年份
  const years = useMemo(() => {
    const ys = new Set<string>();
    months.forEach(m => {
      const y = m.split('-')[0];
      if (y) ys.add(y);
    });
    return Array.from(ys).sort();
  }, [months]);

  // 构建 year x month 矩阵
  const matrix = useMemo(() => {
    // { year: { month(1-12): { sales, revenue, count, priceSum } } }
    const data: Record<string, Record<number, { sales: number; revenue: number; count: number; priceSum: number }>> = {};
    years.forEach(y => {
      data[y] = {};
      for (let m = 1; m <= 12; m++) data[y][m] = { sales: 0, revenue: 0, count: 0, priceSum: 0 };
    });

    history.forEach(h => {
      Object.entries(h.history).forEach(([monthStr, d]) => {
        const [y, mStr] = monthStr.split('-');
        const mo = parseInt(mStr, 10);
        if (!y || !mo || !data[y] || !data[y][mo]) return;
        data[y][mo].sales += d.sales;
        data[y][mo].revenue += d.revenue;
        data[y][mo].count += 1;
        data[y][mo].priceSum += d.price ?? 0;
      });
    });
    return data;
  }, [history, years]);

  // 计算当前 metric 的所有值，用于归一化
  const allVals = useMemo(() => {
    const vals: number[] = [];
    years.forEach(y => {
      for (let mo = 1; mo <= 12; mo++) {
        const cell = matrix[y]?.[mo];
        if (!cell) continue;
        if (metric === 'sales') vals.push(cell.sales);
        else if (metric === 'revenue') vals.push(cell.revenue);
        else vals.push(cell.count > 0 ? cell.priceSum / cell.count : 0);
      }
    });
    return vals.filter(v => v > 0);
  }, [matrix, years, metric]);

  const minVal = useMemo(() => Math.min(...allVals), [allVals]);
  const maxVal = useMemo(() => Math.max(...allVals), [allVals]);

  const getCellVal = (y: string, mo: number) => {
    const cell = matrix[y]?.[mo];
    if (!cell) return 0;
    if (metric === 'sales') return cell.sales;
    if (metric === 'revenue') return cell.revenue;
    return cell.count > 0 ? cell.priceSum / cell.count : 0;
  };

  const normalize = (v: number) => maxVal === minVal ? 0.5 : (v - minVal) / (maxVal - minVal);

  const formatVal = (v: number) => {
    if (metric === 'revenue') return v >= 1000000 ? `${currency}${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${currency}${(v/1000).toFixed(0)}k` : `${currency}${v.toFixed(0)}`;
    if (metric === 'avgPrice') return `${currency}${v.toFixed(1)}`;
    return v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(Math.round(v));
  };

  // 找出每列（月份）的最高年份
  const peakYear = useMemo(() => {
    const result: Record<number, string> = {};
    for (let mo = 1; mo <= 12; mo++) {
      let best = '';
      let bestVal = -1;
      years.forEach(y => {
        const v = getCellVal(y, mo);
        if (v > bestVal) { bestVal = v; best = y; }
      });
      result[mo] = best;
    }
    return result;
  }, [matrix, years, metric]);

  // 月度均值（所有年平均）
  const monthAvg = useMemo(() => {
    const result: Record<number, number> = {};
    for (let mo = 1; mo <= 12; mo++) {
      const vals = years.map(y => getCellVal(y, mo)).filter(v => v > 0);
      result[mo] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    return result;
  }, [matrix, years, metric]);

  const overallAvg = useMemo(() => {
    const vals = Object.values(monthAvg).filter(v => v > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [monthAvg]);

  if (years.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-500"/>
              季节性热力图
            </CardTitle>
            <CardDescription>跨年度月份{METRIC_LABELS[metric]}对比，颜色越深代表数值越高，识别旺季/淡季规律</CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-[#86868b] font-medium">指标:</label>
            <select value={metric} onChange={e => setMetric(e.target.value as MetricType)} className="text-xs border border-black/10 rounded-lg px-2 py-1.5 bg-[#f5f5f7] focus:outline-none">
              <option value="sales">销量</option>
              <option value="revenue">销售额</option>
              <option value="avgPrice">平均价格</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="w-16 py-2 pr-3 text-right text-[#86868b] font-medium">年份</th>
                {MONTH_NAMES.map((mn, i) => (
                  <th key={i} className="py-2 px-1 text-center text-[#86868b] font-medium min-w-[60px]">
                    {mn}
                    {peakYear[i+1] && <span className="block text-[9px] text-orange-400 font-normal">{peakYear[i+1]}峰</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map(y => (
                <tr key={y}>
                  <td className="py-1 pr-3 text-right font-bold text-[#1d1d1f]">{y}</td>
                  {Array.from({length: 12}, (_, i) => i + 1).map(mo => {
                    const v = getCellVal(y, mo);
                    const norm = normalize(v);
                    const hasData = v > 0;
                    const monthKey = `${y}-${String(mo).padStart(2,'0')}`;
                    const inRange = months.includes(monthKey);
                    return (
                      <td key={mo} className="py-1 px-1">
                        <div
                          className={`rounded-lg py-2 px-1 text-center transition-all ${
                            hasData ? getTextColor(norm) : 'text-[#d1d5db]'
                          } ${inRange ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}`}
                          style={{ background: hasData ? getColor(norm, metric) : '#f9fafb' }}
                          title={hasData ? `${y}年${mo}月: ${formatVal(v)}` : '无数据'}
                        >
                          {hasData ? formatVal(v) : '—'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* 月均行 */}
              <tr className="border-t border-black/10">
                <td className="py-2 pr-3 text-right text-[#86868b] font-medium">月均</td>
                {Array.from({length: 12}, (_, i) => i + 1).map(mo => {
                  const v = monthAvg[mo] ?? 0;
                  const pct = overallAvg > 0 ? ((v - overallAvg) / overallAvg) * 100 : 0;
                  const isHigh = pct >= 10;
                  const isLow = pct <= -10;
                  return (
                    <td key={mo} className="py-2 px-1 text-center">
                      <div className="text-[#1d1d1f] font-semibold">{formatVal(v)}</div>
                      <div className={`text-[10px] font-medium mt-0.5 ${ isHigh ? 'text-emerald-600' : isLow ? 'text-rose-500' : 'text-[#86868b]'}`}>
                        {pct >= 0 ? '+' : ''}{pct.toFixed(0)}%
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        {/* 色阶图例 */}
        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-black/5">
          <span className="text-xs text-[#86868b]">低</span>
          <div className="flex-1 h-3 rounded-full" style={{background: metric === 'avgPrice'
            ? 'linear-gradient(to right, rgb(239,246,255), rgb(37,99,235))'
            : 'linear-gradient(to right, rgb(255,251,235), rgb(251,146,60), rgb(194,65,12))'
          }}/>
          <span className="text-xs text-[#86868b]">高</span>
          <span className="text-xs text-[#86868b] ml-4"><span className="inline-block w-3 h-3 rounded ring-2 ring-indigo-400 ring-offset-1 bg-white mr-1 align-middle"/>当前选中月份</span>
          <span className="text-xs text-[#86868b]"><span className="text-orange-400 font-bold">峰</span> = 该月历史最高年份</span>
        </div>
      </CardContent>
    </Card>
  );
});
