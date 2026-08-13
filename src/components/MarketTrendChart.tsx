import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { ComposedChart, Bar, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { HistoryRecord, Product, getCurrencySymbol, formatRevenue } from '../utils/parser';
import { ProductModal } from './ProductModal';
import { Select } from './ui/Select';

interface MarketTrendChartProps {
  history: HistoryRecord[];
  months: string[];
  products?: Product[];
  asinToSegment?: Record<string, string>;
  domain?: string;
}

type AggregationType = 'month' | 'quarter' | 'year';

export const MarketTrendChart = React.memo(function MarketTrendChart({ history, months, products = [], asinToSegment = {}, domain = 'amazon.com' }: MarketTrendChartProps) {
  const currency = getCurrencySymbol(domain);
  const [aggregation, setAggregation] = useState<AggregationType>('month');
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const data = useMemo(() => {
    const rawData = months.map(month => {
      let totalSales = 0;
      let totalRevenue = 0;
      let totalPrice = 0;
      let priceCount = 0;
      
      history.forEach(product => {
        const monthData = product.history[month];
        if (monthData) {
          totalSales += monthData.sales;
          totalRevenue += monthData.revenue;
          if (monthData.price > 0) {
            totalPrice += monthData.price;
            priceCount++;
          }
        }
      });
      
      return {
        month,
        sales: totalSales,
        revenue: totalRevenue,
        price: priceCount > 0 ? totalPrice / priceCount : 0,
      };
    });

    if (aggregation === 'month') return rawData;

    const aggregatedMap = new Map<string, { sales: number, revenue: number, price: number, priceCount: number }>();

    rawData.forEach(item => {
      // Assume month format is "YYYY-MM" or "YY-MM"
      const parts = item.month.split('-');
      if (parts.length !== 2) return;
      
      let yearStr = parts[0];
      if (yearStr.length === 2) yearStr = '20' + yearStr; // Simple heuristic for YY to YYYY
      
      const monthNum = parseInt(parts[1], 10);
      let key = '';

      if (aggregation === 'year') {
        key = yearStr;
      } else if (aggregation === 'quarter') {
        const quarter = Math.ceil(monthNum / 3);
        key = `${yearStr}-Q${quarter}`;
      }

      if (!aggregatedMap.has(key)) {
        aggregatedMap.set(key, { sales: 0, revenue: 0, price: 0, priceCount: 0 });
      }
      const current = aggregatedMap.get(key)!;
      current.sales += item.sales;
      current.revenue += item.revenue;
      if (item.price > 0) {
        current.price += item.price;
        current.priceCount++;
      }
    });

    return Array.from(aggregatedMap.entries()).map(([key, stats]) => ({
      month: key,
      sales: stats.sales,
      revenue: stats.revenue,
      price: stats.priceCount > 0 ? stats.price / stats.priceCount : 0,
    }));

  }, [history, months, aggregation]);

  // Products active in selected month/period
  const modalProducts = useMemo(() => {
    if (!selectedMonthKey || products.length === 0) return [];
    // Find which original months map to this key
    const activeAsins = new Set<string>();
    history.forEach(h => {
      months.forEach(m => {
        // Build the aggregation key for this month
        const parts = m.split('-');
        if (parts.length !== 2) return;
        const yr = parts[0].length === 2 ? '20' + parts[0] : parts[0];
        const mn = parseInt(parts[1], 10);
        let key = m;
        if (aggregation === 'quarter') key = `${yr}-Q${Math.ceil(mn / 3)}`;
        else if (aggregation === 'year') key = yr;
        if (key === selectedMonthKey && h.history[m] && (h.history[m].sales > 0 || h.history[m].revenue > 0)) {
          activeAsins.add(h.asin);
        }
      });
    });
    return products.filter(p => activeAsins.has(p.asin)).sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);
  }, [selectedMonthKey, products, history, months, aggregation]);

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>市场趋势 (历史)</CardTitle>
          <CardDescription>历史销售额和销量趋势。</CardDescription>
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-xs text-[#86868b] font-medium">聚合方式:</label>
          <Select
            value={aggregation}
            onChange={(v) => setAggregation(v as AggregationType)}
            options={[
              { value: 'month', label: '月' },
              { value: 'quarter', label: '季度' },
              { value: 'year', label: '年' },
            ]}
            size="sm"
            aria-label="聚合方式"
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <XAxis 
                dataKey="month" 
                stroke="#86868b" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false}
                tickFormatter={(value) => aggregation === 'month' && value.includes('-') ? value.substring(2) : value}
              />
              <YAxis 
                yAxisId="left"
                stroke="#86868b" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false} 
                tickFormatter={(value) => `${currency}${(value / 1000000).toFixed(1)}M`}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                stroke="#86868b" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false} 
                tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
              />
              <YAxis 
                yAxisId="price"
                orientation="right"
                stroke="#f59e0b" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false} 
                tickFormatter={(value) => `${currency}${value.toFixed(0)}`}
                dx={10}
              />
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                formatter={(value: number, name: string, props: any) => {
                  if (props.dataKey === 'revenue') return [formatRevenue(value, domain), '销售额'];
                  if (props.dataKey === 'sales') return [Math.round(value).toLocaleString(), '销量'];
                  if (props.dataKey === 'price') return [`${currency}${value.toFixed(2)}`, '平均价格'];
                  return [value, name];
                }}
              />
              <Legend verticalAlign="bottom" height={36} iconType="circle" />
              <Bar 
                yAxisId="right"
                dataKey="sales" 
                name="销量"
                fill="#10b981" 
                radius={[4, 4, 0, 0]}
                barSize={aggregation === 'month' ? 20 : 40}
                style={{ cursor: products.length > 0 ? 'pointer' : 'default' }}
                onClick={(data: any) => { if (products.length > 0) setSelectedMonthKey(data.month); }}
              />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="revenue" 
                name="销售额"
                stroke="#4f46e5" 
                strokeWidth={3}
                dot={{ r: 4, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6 }}
              />
              <Line 
                yAxisId="price"
                type="monotone" 
                dataKey="price" 
                name="平均价格"
                stroke="#f59e0b" 
                strokeWidth={3}
                dot={{ r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 6 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>

    {selectedMonthKey && modalProducts.length > 0 && (
      <ProductModal
        products={modalProducts}
        onClose={() => setSelectedMonthKey(null)}
        domain={domain}
        asinToSegment={asinToSegment}
        history={history}
        months={months}
        title={`${selectedMonthKey} 活跃 ASIN 列表`}
      />
    )}
    </>
  );
});
