import React, { useState, useMemo, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { MultiSelectChips } from './ui/Select';
import { Product, HistoryRecord, formatRevenue } from '../utils/parser';
import { ChevronDown, Layers } from 'lucide-react';

interface SegmentShareChartProps {
  products: Product[];
  history: HistoryRecord[];
  months: string[];
  segments: string[];
  asinToSegment: Record<string, string>;
  domain?: string;
}

const COLORS = [
  '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

const UNCATEGORIZED = '未分类';

export const SegmentShareChart: React.FC<SegmentShareChartProps> = React.memo(({
  products: _products,
  history,
  months,
  segments,
  asinToSegment,
  domain = 'amazon.com',
}) => {
  const [metric, setMetric] = useState<'sales' | 'revenue'>('sales');
  const [pickerOpen, setPickerOpen] = useState(false);

  /** 有销量/销售额的细分（含未分类） */
  const availableSegments = useMemo(() => {
    const totals: Record<string, { sales: number; revenue: number }> = {};
    segments.forEach((s) => {
      totals[s] = { sales: 0, revenue: 0 };
    });
    totals[UNCATEGORIZED] = { sales: 0, revenue: 0 };

    history.forEach((h) => {
      const segment = asinToSegment[h.asin] || UNCATEGORIZED;
      if (!totals[segment]) totals[segment] = { sales: 0, revenue: 0 };
      months.forEach((m) => {
        if (h.history[m]) {
          totals[segment].sales += h.history[m].sales;
          totals[segment].revenue += h.history[m].revenue;
        }
      });
    });

    return Object.entries(totals)
      .filter(([, t]) => t.sales > 0 || t.revenue > 0)
      .sort((a, b) => (b[1].sales + b[1].revenue) - (a[1].sales + a[1].revenue))
      .map(([name]) => name);
  }, [history, months, segments, asinToSegment]);

  /** 默认：全部已命名细分，不展示「未分类」 */
  const defaultVisible = useMemo(
    () => availableSegments.filter((s) => s !== UNCATEGORIZED),
    [availableSegments]
  );

  const [visibleSegments, setVisibleSegments] = useState<string[]>(defaultVisible);

  // 细分列表变化时：保留用户已选中的交集；若交集为空则回到默认（不含未分类）
  useEffect(() => {
    setVisibleSegments((prev) => {
      const keep = prev.filter((s) => availableSegments.includes(s));
      if (keep.length > 0) return keep;
      return availableSegments.filter((s) => s !== UNCATEGORIZED);
    });
  }, [availableSegments]);

  const data = useMemo(() => {
    if (!visibleSegments.length) return [];

    const segmentTotals: Record<string, { sales: number; revenue: number }> = {};
    visibleSegments.forEach((s) => {
      segmentTotals[s] = { sales: 0, revenue: 0 };
    });

    history.forEach((h) => {
      const segment = asinToSegment[h.asin] || UNCATEGORIZED;
      if (!segmentTotals[segment]) return;
      months.forEach((m) => {
        if (h.history[m]) {
          segmentTotals[segment].sales += h.history[m].sales;
          segmentTotals[segment].revenue += h.history[m].revenue;
        }
      });
    });

    return Object.entries(segmentTotals)
      .filter(([, totals]) => totals.sales > 0 || totals.revenue > 0)
      .map(([name, totals]) => ({
        name,
        value: metric === 'sales' ? totals.sales : totals.revenue,
        sales: totals.sales,
        revenue: totals.revenue,
      }))
      .sort((a, b) => b.value - a.value);
  }, [history, months, asinToSegment, metric, visibleSegments]);

  if (segments.length === 0 || availableSegments.length === 0) return null;

  const formatValue = (value: number) => {
    if (metric === 'revenue') return formatRevenue(value, domain);
    return Math.round(value).toLocaleString();
  };

  const namedCount = availableSegments.filter((s) => s !== UNCATEGORIZED).length;
  const hasUncategorized = availableSegments.includes(UNCATEGORIZED);
  const showingUncategorized = visibleSegments.includes(UNCATEGORIZED);

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>细分市场占比</CardTitle>
          <CardDescription>
            各细分市场的{metric === 'sales' ? '销量' : '销售额'}分布
            {!showingUncategorized && hasUncategorized ? ' · 默认已隐藏「未分类」' : ''}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-black/[0.07] bg-gradient-to-b from-white to-[#f8f9fb] text-[#1d1d1f] hover:border-indigo-200 shadow-sm transition-all"
          >
            <Layers className="w-3.5 h-3.5 text-indigo-500" />
            选择细分
            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full">
              {visibleSegments.length}/{availableSegments.length}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-[#86868b] transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex bg-[#f5f5f7] p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setMetric('sales')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                metric === 'sales'
                  ? 'bg-white text-[#1d1d1f] shadow-sm'
                  : 'text-[#86868b] hover:text-[#1d1d1f]'
              }`}
            >
              销量
            </button>
            <button
              type="button"
              onClick={() => setMetric('revenue')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                metric === 'revenue'
                  ? 'bg-white text-[#1d1d1f] shadow-sm'
                  : 'text-[#86868b] hover:text-[#1d1d1f]'
              }`}
            >
              销售额
            </button>
          </div>
        </div>
      </CardHeader>

      {pickerOpen && (
        <div className="mx-6 mb-2 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-violet-50/40 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <button
              type="button"
              className="px-2.5 py-1 rounded-lg bg-white border border-black/8 font-semibold text-[#424245] hover:border-indigo-200"
              onClick={() => setVisibleSegments(availableSegments.filter((s) => s !== UNCATEGORIZED))}
            >
              仅已命名（默认）
            </button>
            <button
              type="button"
              className="px-2.5 py-1 rounded-lg bg-white border border-black/8 font-semibold text-[#424245] hover:border-indigo-200"
              onClick={() => setVisibleSegments([...availableSegments])}
            >
              全部含未分类
            </button>
            <button
              type="button"
              className="px-2.5 py-1 rounded-lg bg-white border border-black/8 font-semibold text-[#424245] hover:border-indigo-200"
              onClick={() => setVisibleSegments([])}
            >
              清空
            </button>
            <span className="text-[#86868b] ml-auto">
              已命名 {namedCount} 个{hasUncategorized ? ' · 另有未分类' : ''}
            </span>
          </div>
          <MultiSelectChips
            options={availableSegments.map((s) => ({
              value: s,
              label: s === UNCATEGORIZED ? '未分类' : s,
            }))}
            value={visibleSegments}
            onChange={setVisibleSegments}
          />
        </div>
      )}

      <CardContent>
        {data.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-[#86868b]">
            请至少选择一个有数据的细分
          </div>
        ) : (
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={130}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => {
                    const total = data.reduce((sum, item) => sum + item.value, 0);
                    const percentage = ((value / total) * 100).toFixed(1);
                    return [`${formatValue(value)} (${percentage}%)`, name];
                  }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  formatter={(value) => {
                    const item = data.find((d) => d.name === value);
                    const total = data.reduce((sum, d) => sum + d.value, 0);
                    const percentage = item ? ((item.value / total) * 100).toFixed(1) : 0;
                    return (
                      <span className="text-sm text-[#1d1d1f] font-medium">
                        {value} <span className="text-[#86868b] font-normal ml-1">({percentage}%)</span>
                      </span>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
