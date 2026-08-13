import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { ComposedChart, Bar, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { Product, HistoryRecord } from '../utils/parser';
import { ProductModal } from './ProductModal';
import { Select } from './ui/Select';

interface LaunchDateChartProps {
  products: Product[];
  domain?: string;
  history?: HistoryRecord[];
  months?: string[];
  asinToSegment?: Record<string, string>;
}

const CustomTooltip = ({ active, payload, label, metric }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-black/10 rounded-2xl shadow-xl p-3 min-w-[180px]">
      <div className="font-bold text-sm text-[#1d1d1f] mb-2">{label}</div>
      <div className="space-y-1">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{background: p.color}}/>
              <span className="text-[#86868b]">{p.name}</span>
            </span>
            <span className="font-semibold text-[#1d1d1f]">
              {p.dataKey === 'avgRating' ? p.value.toFixed(2) :
               p.dataKey === 'avgReviews' ? Math.round(p.value).toLocaleString() :
               p.dataKey === 'totalRevenue' ? `$${p.value.toLocaleString(undefined,{maximumFractionDigits:0})}` :
               p.value.toLocaleString(undefined,{maximumFractionDigits:0})}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const LaunchDateChart = React.memo(function LaunchDateChart({ products, domain = 'amazon.com', history = [], months = [], asinToSegment = {} }: LaunchDateChartProps) {
  const [selectedProducts, setSelectedProducts] = useState<Product[] | null>(null);
  const [metric, setMetric] = useState<'sales' | 'revenue'>('sales');

  const data = useMemo(() => {
    const buckets = [
      { bucket: '0-半年', min: 0, max: 180, products: [] as Product[], sales: 0, revenue: 0 },
      { bucket: '半年-1年', min: 181, max: 365, products: [] as Product[], sales: 0, revenue: 0 },
      { bucket: '1-2年', min: 366, max: 730, products: [] as Product[], sales: 0, revenue: 0 },
      { bucket: '2-3年', min: 731, max: 1095, products: [] as Product[], sales: 0, revenue: 0 },
      { bucket: '3年以上', min: 1096, max: 999999, products: [] as Product[], sales: 0, revenue: 0 },
    ];
    products.forEach(p => {
      const days = p.daysSinceLaunch || 0;
      const bucket = buckets.find(b => days >= b.min && days <= b.max);
      if (bucket) {
        bucket.products.push(p);
        bucket.sales += p.monthlySales;
        bucket.revenue += p.monthlyRevenue;
      }
    });
    return buckets.map(b => {
      const ratedProds = b.products.filter(p => p.rating > 0);
      const avgRating = ratedProds.length ? ratedProds.reduce((s, p) => s + p.rating, 0) / ratedProds.length : 0;
      const avgReviews = b.products.length ? b.products.reduce((s, p) => s + p.reviewCount, 0) / b.products.length : 0;
      return {
        bucket: b.bucket,
        products: b.products,
        productCount: b.products.length,
        totalSales: b.sales,
        totalRevenue: b.revenue,
        avgRating: parseFloat(avgRating.toFixed(2)),
        avgReviews: parseFloat(avgReviews.toFixed(0)),
      };
    });
  }, [products]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle>上架时间分布</CardTitle>
            <CardDescription>按上架时间统计ASIN数量、{metric === 'sales' ? '销量' : '销售额'}、均评分及平均评论数</CardDescription>
          </div>
          <div className="flex items-center space-x-2">
            <label className="text-xs text-[#86868b] font-medium">指标:</label>
            <Select
              value={metric}
              onChange={(v) => setMetric(v as 'sales' | 'revenue')}
              options={[
                { value: 'sales', label: '销量' },
                { value: 'revenue', label: '销售额' },
              ]}
              size="sm"
              aria-label="指标"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 10, right: 60, left: -20, bottom: 0 }}>
                <XAxis dataKey="bucket" stroke="#86868b" fontSize={12} tickLine={false} axisLine={false}/>
                <YAxis yAxisId="left" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                  tickFormatter={(v:number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}/>
                <YAxis yAxisId="count" orientation="right" stroke="#4f46e5" fontSize={11} tickLine={false} axisLine={false} width={30}/>
                <YAxis yAxisId="rating" orientation="right" stroke="#f59e0b" fontSize={11} tickLine={false} axisLine={false}
                  domain={[3.5, 5]} tickFormatter={(v:number) => v.toFixed(1)} width={36}/>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                <Tooltip cursor={{fill:'#f5f5f7'}} content={<CustomTooltip metric={metric}/>}/>
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{fontSize:'12px'}}/>
                <Bar yAxisId="left" dataKey={metric === 'sales' ? 'totalSales' : 'totalRevenue'}
                  name={metric === 'sales' ? '销量' : '销售额'}
                  fill="#4f46e5" radius={[4,4,0,0]} barSize={36}
                  onClick={(d:any) => setSelectedProducts(d.products)} className="cursor-pointer"/>
                <Line yAxisId="count" type="monotone" dataKey="productCount" name="ASIN数量"
                  stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 3"
                  dot={{r:3, fill:'#94a3b8', stroke:'white', strokeWidth:1.5}} activeDot={{r:5}}/>
                <Line yAxisId="rating" type="monotone" dataKey="avgRating" name="均评分"
                  stroke="#f59e0b" strokeWidth={2.5}
                  dot={{r:4, fill:'#f59e0b', stroke:'white', strokeWidth:2}} activeDot={{r:6}}/>
                <Line yAxisId="count" type="monotone" dataKey="avgReviews" name="均评论数"
                  stroke="#10b981" strokeWidth={2}
                  dot={{r:3, fill:'#10b981', stroke:'white', strokeWidth:1.5}} activeDot={{r:5}}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      {selectedProducts && (
        <ProductModal products={selectedProducts} onClose={() => setSelectedProducts(null)}
          domain={domain} history={history} months={months} asinToSegment={asinToSegment}/>
      )}
    </>
  );
});
