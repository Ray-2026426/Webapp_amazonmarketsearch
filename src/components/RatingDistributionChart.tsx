import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { ComposedChart, Bar, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Product, HistoryRecord } from '../utils/parser';
import { ProductModal } from './ProductModal';

interface RatingDistributionChartProps {
  products: Product[];
  domain?: string;
  history?: HistoryRecord[];
  months?: string[];
  asinToSegment?: Record<string, string>;
}

export const RatingDistributionChart = React.memo(function RatingDistributionChart({ products, domain = 'amazon.com', history = [], months = [], asinToSegment = {} }: RatingDistributionChartProps) {
  const [metric, setMetric] = useState<'sales' | 'revenue'>('sales');
  const [step, setStep] = useState<number>(0.2);
  const [selectedProducts, setSelectedProducts] = useState<Product[] | null>(null);

  const data = useMemo(() => {
    const bucketsMap = new Map<string, { count: number, sales: number, revenue: number, products: Product[] }>();
    
    // Create buckets from 1.0 to 5.0 based on step
    for (let i = 1.0; i <= 5.0; i += step) {
      // Handle floating point precision issues
      const val = (Math.round(i * 10) / 10).toFixed(1);
      bucketsMap.set(val, { count: 0, sales: 0, revenue: 0, products: [] });
    }

    products.forEach(p => {
      if (p.rating === 0) return; // Skip unrated products
      
      let rating = p.rating;
      if (rating < 1.0) rating = 1.0;
      if (rating > 5.0) rating = 5.0;
      
      // Find the correct bucket based on step
      // e.g., if step is 0.2, 4.3 goes to 4.2 (or 4.4 depending on rounding, let's floor to bucket)
      const bucketIndex = Math.floor((rating - 1.0) / step);
      let bucketVal = 1.0 + (bucketIndex * step);
      if (bucketVal > 5.0) bucketVal = 5.0;
      
      const bucketKey = (Math.round(bucketVal * 10) / 10).toFixed(1);
      const bucket = bucketsMap.get(bucketKey);
      
      if (bucket) {
        bucket.count++;
        bucket.sales += p.monthlySales;
        bucket.revenue += p.monthlyRevenue;
        bucket.products.push(p);
      }
    });

    const result = [];
    let started = false;
    const allEntries: {val: string, bucket: any}[] = [];
    for (let i = 1.0; i <= 5.0; i += step) {
      const val = (Math.round(i * 10) / 10).toFixed(1);
      const bucket = bucketsMap.get(val);
      let endVal = i + step;
      if (endVal > 5.0) endVal = 5.0;
      const endStr = (Math.round(endVal * 10) / 10).toFixed(1);
      allEntries.push({
        val,
        bucket: {
          label: step === 1.0 || step === 0.5 ? `${val}-${endStr}` : val,
          productCount: bucket?.count ?? 0,
          totalSales: bucket?.sales ?? 0,
          totalRevenue: bucket?.revenue ?? 0,
          products: bucket?.products ?? [],
        }
      });
    }
    // 只保留有数据的分段
    for (const entry of allEntries) {
      if (entry.bucket.productCount > 0) {
        result.push({ bucket: entry.bucket.label, ...entry.bucket });
      }
    }

    return result;
  }, [products, step]);

  return (
    <>
      <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>评分分布</CardTitle>
          <CardDescription>各评分区间的ASIN数量和{metric === 'sales' ? '销量' : '销售额'}。</CardDescription>
        </div>
        <div className="flex items-center space-x-4">
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
          <div className="flex items-center space-x-2">
            <label className="text-xs text-[#86868b] font-medium">梯度:</label>
            <select 
              value={step} 
              onChange={(e) => setStep(Number(e.target.value))}
              className="text-sm border border-black/5 rounded-lg px-2 py-1 bg-[#f5f5f7] text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value={0.1}>0.1</option>
              <option value={0.2}>0.2</option>
              <option value={0.5}>0.5</option>
              <option value={1.0}>1.0</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
              <XAxis 
                dataKey="bucket" 
                stroke="#86868b" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false}
              />
              <YAxis 
                yAxisId="left"
                stroke="#86868b" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false} 
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                stroke="#86868b" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false} 
                tickFormatter={(value) => metric === 'sales' ? `${(value / 1000).toFixed(0)}k` : `$${(value / 1000).toFixed(0)}k`}
              />
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <Tooltip 
                cursor={{ fill: '#f5f5f7' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                formatter={(value: number, name: string, props: any) => {
                  if (name === 'ASIN数量') {
                    return [value.toLocaleString(), 'ASIN数量'];
                  }
                  const isRevenue = name === '销售额';
                  const formattedValue = isRevenue ? `$${value.toLocaleString()}` : value.toLocaleString();
                  return [formattedValue, name];
                }}
              />
              <Legend verticalAlign="bottom" height={36} iconType="circle" />
              <Bar 
                yAxisId="left" 
                dataKey="productCount" 
                name="ASIN数量" 
                fill="#f43f5e" 
                radius={[4, 4, 0, 0]} 
                onClick={(data: any) => setSelectedProducts(data.products || data.payload?.products)}
                className="cursor-pointer"
              />
              <Line 
                yAxisId="right" 
                type="monotone" 
                dataKey={metric === 'sales' ? 'totalSales' : 'totalRevenue'} 
                name={metric === 'sales' ? '销量' : '销售额'} 
                stroke="#f59e0b" 
                strokeWidth={3} 
                dot={{ r: 3 }} 
                activeDot={{ r: 5 }} 
                onClick={(data: any) => setSelectedProducts(data.products || data.payload?.products)}
                className="cursor-pointer"
              />
            </ComposedChart>
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
