import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { ComposedChart, Bar, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Cell } from 'recharts';
import { Product, getCurrencySymbol, HistoryRecord } from '../utils/parser';
import { ProductModal } from './ProductModal';
import { Trophy } from 'lucide-react';

interface Props {
  products: Product[];
  domain?: string;
  history?: HistoryRecord[];
  months?: string[];
  asinToSegment?: Record<string, string>;
}

const BSR_BUCKETS = [
  { label: 'Top 1-100',    min: 1,    max: 100 },
  { label: 'Top 101-300',  min: 101,  max: 300 },
  { label: 'Top 301-500',  min: 301,  max: 500 },
  { label: 'Top 501-1000', min: 501,  max: 1000 },
  { label: '1001-3000',    min: 1001, max: 3000 },
  { label: '3001-5000',    min: 3001, max: 5000 },
  { label: '5000+',        min: 5001, max: Infinity },
];

const BUCKET_COLORS = ['#f59e0b','#10b981','#6366f1','#3b82f6','#8b5cf6','#ec4899','#94a3b8'];

const CustomTooltip = ({ active, payload, label, currency }: any) => {
  if (!active || !payload?.length) return null;
  const count = payload.find((p: any) => p.dataKey === 'count');
  const avgSales = payload.find((p: any) => p.dataKey === 'avgSales');
  const avgPrice = payload.find((p: any) => p.dataKey === 'avgPrice');
  return (
    <div className="bg-white border border-black/10 rounded-2xl shadow-xl p-3 min-w-[180px]">
      <div className="font-bold text-[#1d1d1f] text-sm mb-2">{label}</div>
      <div className="space-y-1 text-xs">
        {count && <div className="flex justify-between gap-4"><span className="text-[#86868b]">ASIN数量</span><span className="font-semibold text-[#1d1d1f]">{count.value}</span></div>}
        {avgSales && <div className="flex justify-between gap-4"><span className="text-[#86868b]">平均月销量</span><span className="font-semibold text-[#1d1d1f]">{avgSales.value.toLocaleString(undefined,{maximumFractionDigits:0})}</span></div>}
        {avgPrice && <div className="flex justify-between gap-4"><span className="text-[#86868b]">平均价格</span><span className="font-semibold text-[#1d1d1f]">{currency}{avgPrice.value.toFixed(2)}</span></div>}
      </div>
    </div>
  );
};

export const BsrDistributionChart = React.memo(function BsrDistributionChart({ products, domain = 'amazon.com', history = [], months = [], asinToSegment = {} }: Props) {
  const currency = getCurrencySymbol(domain);
  const [selectedProducts, setSelectedProducts] = useState<Product[] | null>(null);

  const data = useMemo(() => {
    return BSR_BUCKETS.map((b, i) => {
      const ps = products.filter(p => p.subBsr >= b.min && p.subBsr <= b.max);
      const count = ps.length;
      const avgSales = count > 0 ? ps.reduce((s, p) => s + p.monthlySales, 0) / count : 0;
      const avgPrice = count > 0 ? ps.reduce((s, p) => s + p.price, 0) / count : 0;
      const minSales = count > 0 ? ps.filter(p => p.monthlySales > 0).reduce((s, p, _, arr) => s + p.monthlySales / arr.length, 0) : 0;
      const sortedSales = ps.map(p => p.monthlySales).filter(v => v > 0).sort((a,b)=>a-b);
      const medianSales = sortedSales.length > 0 ? sortedSales[Math.floor(sortedSales.length / 2)] : 0;
      return { label: b.label, count, avgSales, avgPrice, minSales, medianSales, color: BUCKET_COLORS[i] };
    }).filter(d => d.count > 0);
  }, [products]);

  const noData = products.filter(p => p.subBsr > 0).length === 0;

  return (
    <>
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500"/>
              小类BSR排名分布
            </CardTitle>
            <CardDescription>各BSR排名段的ASIN数量、平均月销量和平均价格，了解进入各排名区间的销量门槛</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {noData ? (
          <div className="h-40 flex items-center justify-center text-[#86868b] text-sm">暂无小类BSR数据</div>
        ) : (
          <>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{top:10,right:60,left:-10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                  <XAxis dataKey="label" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}/>
                  <YAxis yAxisId="left" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                    tickFormatter={(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)}/>
                  <YAxis yAxisId="right" orientation="right" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                    tickFormatter={(v:number)=>`${currency}${v.toFixed(0)}`}/>
                  <Tooltip content={<CustomTooltip currency={currency}/>}/>
                  <Legend verticalAlign="bottom" height={28} iconType="circle" wrapperStyle={{fontSize:'12px'}}/>
                  <Bar yAxisId="left" dataKey="count" name="ASIN数量" radius={[4,4,0,0]} barSize={28}
                    onClick={(d:any)=>setSelectedProducts(d.products)}
                    className="cursor-pointer">
                    {data.map((d,i)=><Cell key={i} fill={d.color} fillOpacity={0.85}/>)}
                  </Bar>
                  <Line yAxisId="left" type="monotone" dataKey="avgSales" name="平均月销量" stroke="#10b981" strokeWidth={2.5} dot={{r:4,fill:'#10b981',stroke:'white',strokeWidth:2}} activeDot={{r:6}}/>
                  <Line yAxisId="right" type="monotone" dataKey="avgPrice" name="平均价格" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" dot={{r:3,fill:'#f59e0b',stroke:'white',strokeWidth:2}} activeDot={{r:5}}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* 门槛汇总卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {data.slice(0,4).map((d,i)=>(
                <div key={i} className="bg-[#f5f5f7] rounded-2xl p-3 border border-black/5 cursor-pointer hover:bg-indigo-50 hover:border-indigo-100 transition-colors"
                  onClick={()=>setSelectedProducts(d.products)}>
                  <div className="text-xs text-[#86868b] mb-1">{d.label}</div>
                  <div className="font-bold text-[#1d1d1f]">月销中位数 {d.medianSales.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                  <div className="text-xs text-[#86868b] mt-0.5">均价 {currency}{d.avgPrice.toFixed(0)} · {d.count} 个ASIN</div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
    {selectedProducts && (
      <ProductModal products={selectedProducts} onClose={()=>setSelectedProducts(null)}
        domain={domain} history={history} months={months} asinToSegment={asinToSegment}/>
    )}
  </>
  );
});
