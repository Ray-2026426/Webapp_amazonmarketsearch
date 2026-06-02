import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Product, HistoryRecord, getCurrencySymbol, formatRevenue } from '../utils/parser';
import { buildAsinPeriodStatsMap, getAsinPeriodStats } from '../utils/chartHistory';
import { ProductModal } from './ProductModal';

interface SellerTypeChartProps {
  products: Product[];
  domain?: string;
  history?: HistoryRecord[];
  months?: string[];
  selectedMonths?: string[];
  asinToSegment?: Record<string, string>;
}

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6'];

export const SellerTypeChart = React.memo(function SellerTypeChart({ products, domain = 'amazon.com', history = [], months = [], selectedMonths = [], asinToSegment = {} }: SellerTypeChartProps) {
  const currency = getCurrencySymbol(domain);
  const [metric, setMetric] = useState<'sales' | 'revenue'>('sales');
  const [selectedProducts, setSelectedProducts] = useState<Product[] | null>(null);

  const data = useMemo(() => {
    const typeMap = new Map<string, { products: Product[], sales: number, revenue: number }>();
    const asinStats = buildAsinPeriodStatsMap(products, history, selectedMonths);

    const mapType = (type: string) => {
      if (type.toLowerCase().includes('fba')) return 'FBA';
      if (type.toLowerCase().includes('fbm')) return 'FBM';
      if (type.toLowerCase().includes('amazon')) return 'Amazon自营';
      return '其他';
    };

    products.forEach(p => {
      const period = getAsinPeriodStats(asinStats, p.asin);
      if (period.sales === 0 && period.revenue === 0) return;

      const type = mapType(p.buyBoxType || 'Unknown');
      if (!typeMap.has(type)) {
        typeMap.set(type, { products: [], sales: 0, revenue: 0 });
      }
      const stats = typeMap.get(type)!;
      stats.products.push(p);
      stats.sales += period.sales;
      stats.revenue += period.revenue;
    });

    return Array.from(typeMap.entries()).map(([name, stats]) => ({ name, ...stats }));
  }, [products, history, selectedMonths]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle>卖家类型分布</CardTitle>
            <CardDescription>FBA、FBM与Amazon自营占比。</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <label className="text-xs text-[#86868b] font-medium">指标:</label>
            <select 
              value={metric} 
              onChange={(e) => setMetric(e.target.value as 'sales' | 'revenue')}
              className="text-sm border border-black/5 rounded-lg px-2 py-1 bg-[#f5f5f7] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="sales">销量</option>
              <option value="revenue">销售额</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey={metric}
                  nameKey="name"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  onClick={(data) => setSelectedProducts(data.payload.products)}
                  className="cursor-pointer"
                >
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: number, name: string, props: any) => {
                    const payload = props.payload;
                    const totalCount = payload.products.length;
                    const avg = totalCount > 0 ? value / totalCount : 0;
                    const isRevenue = metric === 'revenue';
                    const formattedValue = isRevenue ? formatRevenue(value, domain) : Math.round(value).toLocaleString();
                    const formattedAvg = isRevenue ? `${currency}${Math.round(avg).toLocaleString()}` : avg.toFixed(1);
                    return [
                      `${formattedValue} (总平均每个ASIN${isRevenue ? '销售额' : '销量'}: ${formattedAvg})`, 
                      isRevenue ? '销售额' : '销量'
                    ];
                  }}
                />
                <Legend verticalAlign="bottom" height={36} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      {selectedProducts && (
        <ProductModal products={selectedProducts} onClose={() => setSelectedProducts(null)} domain={domain} history={history} months={months} asinToSegment={asinToSegment} />
      )}
    </>
  );
});

