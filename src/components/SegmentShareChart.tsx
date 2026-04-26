import React, { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { Product, HistoryRecord } from '../utils/parser';

interface SegmentShareChartProps {
  products: Product[];
  history: HistoryRecord[];
  months: string[];
  segments: string[];
  asinToSegment: Record<string, string>;
}

const COLORS = [
  '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', 
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'
];

export const SegmentShareChart: React.FC<SegmentShareChartProps> = React.memo(({ 
  products, 
  history, 
  months, 
  segments, 
  asinToSegment 
}) => {
  const [metric, setMetric] = useState<'sales' | 'revenue'>('sales');

  const data = useMemo(() => {
    if (segments.length === 0) return [];

    const segmentTotals: Record<string, { sales: number; revenue: number }> = {};
    segments.forEach(s => {
      segmentTotals[s] = { sales: 0, revenue: 0 };
    });
    segmentTotals['未分类'] = { sales: 0, revenue: 0 };

    history.forEach(h => {
      const segment = asinToSegment[h.asin] || '未分类';
      if (!segmentTotals[segment]) {
        segmentTotals[segment] = { sales: 0, revenue: 0 };
      }
      
      months.forEach(m => {
        if (h.history[m]) {
          segmentTotals[segment].sales += h.history[m].sales;
          segmentTotals[segment].revenue += h.history[m].revenue;
        }
      });
    });

    const result = Object.entries(segmentTotals)
      .filter(([_, totals]) => totals.sales > 0 || totals.revenue > 0)
      .map(([name, totals]) => ({
        name,
        value: metric === 'sales' ? totals.sales : totals.revenue,
        sales: totals.sales,
        revenue: totals.revenue
      }))
      .sort((a, b) => b.value - a.value);

    // If only "未分类" exists, or no data, return empty array
    if (result.length === 0 || (result.length === 1 && result[0].name === '未分类')) {
      return [];
    }

    return result;
  }, [history, months, segments, asinToSegment, metric]);

  if (segments.length === 0 || data.length === 0) return null;

  const formatValue = (value: number) => {
    if (metric === 'revenue') {
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>细分市场占比</CardTitle>
          <CardDescription>各细分市场的{metric === 'sales' ? '销量' : '销售额'}分布</CardDescription>
        </div>
        <div className="flex bg-[#f5f5f7] p-1 rounded-lg">
          <button
            onClick={() => setMetric('sales')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              metric === 'sales' 
                ? 'bg-white text-[#1d1d1f] shadow-sm' 
                : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
          >
            销量
          </button>
          <button
            onClick={() => setMetric('revenue')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              metric === 'revenue' 
                ? 'bg-white text-[#1d1d1f] shadow-sm' 
                : 'text-[#86868b] hover:text-[#1d1d1f]'
            }`}
          >
            销售额
          </button>
        </div>
      </CardHeader>
      <CardContent>
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
                formatter={(value: number, name: string, props: any) => {
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
                formatter={(value, entry: any) => {
                  const item = data.find(d => d.name === value);
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
      </CardContent>
    </Card>
  );
});
