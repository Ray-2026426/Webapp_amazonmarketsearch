import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { ComposedChart, Bar, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, Cell } from 'recharts';
import { Product, HistoryRecord, getCurrencySymbol } from '../utils/parser';
import { ProductModal } from './ProductModal';

interface NewVsOldChartProps {
  products: Product[];
  domain?: string;
  history?: HistoryRecord[];
  months?: string[];
  asinToSegment?: Record<string, string>;
}

const THRESHOLD_OPTIONS = [
  { label: '30天', value: 30 },
  { label: '90天', value: 90 },
  { label: '180天', value: 180 },
  { label: '365天', value: 365 },
];

const CustomTooltip = ({ active, payload, label, currency }: any) => {
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
              {p.dataKey === 'revenue' ? `${currency}${p.value.toLocaleString(undefined,{maximumFractionDigits:0})}` :
               p.dataKey === 'avgPrice' ? `${currency}${p.value.toFixed(2)}` :
               p.dataKey === 'avgRating' ? p.value.toFixed(2) :
               p.value.toLocaleString(undefined,{maximumFractionDigits:0})}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const NewVsOldChart = React.memo(function NewVsOldChart({ products, domain = 'amazon.com', history = [], months = [], asinToSegment = {} }: NewVsOldChartProps) {
  const currency = getCurrencySymbol(domain);
  const [thresholdDays, setThresholdDays] = useState<number>(90);
  const [selectedProducts, setSelectedProducts] = useState<Product[] | null>(null);

  const { barData, trendData } = useMemo(() => {
    const newProds = products.filter(p => p.daysSinceLaunch <= thresholdDays);
    const oldProds = products.filter(p => p.daysSinceLaunch > thresholdDays);

    const calc = (prods: Product[], label: string) => ({
      label,
      products: prods,
      count: prods.length,
      sales: prods.reduce((s, p) => s + p.monthlySales, 0),
      revenue: prods.reduce((s, p) => s + p.monthlyRevenue, 0),
      avgPrice: prods.length ? prods.reduce((s, p) => s + p.price, 0) / prods.length : 0,
      avgRating: prods.filter(p => p.rating > 0).length
        ? prods.filter(p => p.rating > 0).reduce((s, p) => s + p.rating, 0) / prods.filter(p => p.rating > 0).length
        : 0,
    });

    const barData = [calc(newProds, '新品'), calc(oldProds, '老品')];

    // 新品占比月度趋势 - 按当月判断：上架时间在该月之前thresholdDays以内才算新品
    const trendData = months.map(m => {
      let newSales = 0, totalSales = 0;
      // 解析月份对应的日期（该月最后一天）
      const [y, mo] = m.split('-').map(Number);
      const monthEndDate = new Date(y, mo, 0); // 该月最后一天
      history.forEach(h => {
        const p = products.find(x => x.asin === h.asin);
        const d = h.history[m];
        if (!d || !p) return;
        totalSales += d.sales;
        // 计算该产品在当月月末时的上架天数
        const launchDate = p.launchDate ? new Date(p.launchDate) : null;
        if (launchDate) {
          const daysAtMonth = Math.floor((monthEndDate.getTime() - launchDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysAtMonth >= 0 && daysAtMonth <= thresholdDays) newSales += d.sales;
        }
      });
      return {
        month: m.substring(2),
        newRatio: totalSales > 0 ? parseFloat(((newSales / totalSales) * 100).toFixed(1)) : 0,
      };
    });

    return { barData, trendData };
  }, [products, history, months, thresholdDays]);

  const COLORS = ['#3b82f6', '#94a3b8'];

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>新老品对比</CardTitle>
              <CardDescription>ASIN数量、销量、销售额、均价、均评分多维对比，及新品月度销量占比趋势</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#86868b] font-medium">新品阈值:</label>
              <select value={thresholdDays} onChange={e => setThresholdDays(Number(e.target.value))}
                className="text-xs border border-black/10 rounded-lg px-2 py-1.5 bg-[#f5f5f7] focus:outline-none">
                {THRESHOLD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* 5维对比卡片 - 一行 */}
          <div className="grid grid-cols-5 gap-3 mb-5">
            {[
              { label: 'ASIN数量', new: barData[0].count, old: barData[1].count, fmt: (v:number) => v.toLocaleString() },
              { label: '月销量', new: barData[0].sales, old: barData[1].sales, fmt: (v:number) => v.toLocaleString() },
              { label: '月销售额', new: barData[0].revenue, old: barData[1].revenue, fmt: (v:number) => `${currency}${Math.round(v).toLocaleString()}` },
              { label: '均价', new: barData[0].avgPrice, old: barData[1].avgPrice, fmt: (v:number) => `${currency}${v.toFixed(2)}` },
              { label: '均评分', new: barData[0].avgRating, old: barData[1].avgRating, fmt: (v:number) => v.toFixed(2) },
            ].map(item => (
              <div key={item.label} className="bg-[#f5f5f7] rounded-2xl p-3 border border-black/5">
                <div className="text-xs text-[#86868b] mb-2 font-medium">{item.label}</div>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-[10px] text-blue-500 font-medium mb-0.5">新品</div>
                    <div className="text-sm font-bold text-[#1d1d1f]">{item.fmt(item.new)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 font-medium mb-0.5">老品</div>
                    <div className="text-sm font-bold text-[#86868b]">{item.fmt(item.old)}</div>
                  </div>
                </div>
                {/* 占比条 */}
                <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 rounded-full transition-all"
                    style={{width: `${item.new + item.old > 0 ? (item.new / (item.new + item.old)) * 100 : 0}%`}}/>
                </div>
                <div className="text-[10px] text-[#86868b] mt-1">新品占 {item.new + item.old > 0 ? ((item.new / (item.new + item.old)) * 100).toFixed(1) : 0}%</div>
              </div>
            ))}
          </div>

          {/* 新品销量占比趋势 - 有真实数据才显示 */}
          {trendData.length > 0 && trendData.some(d => d.newRatio > 0) && (
            <div>
              <div className="text-xs font-semibold text-[#86868b] mb-2">新品月度销量占比趋势</div>
              <div className="h-[160px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trendData} margin={{top:5, right:10, left:-20, bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                    <XAxis dataKey="month" stroke="#86868b" fontSize={10} tickLine={false} axisLine={false}/>
                    <YAxis stroke="#86868b" fontSize={10} tickLine={false} axisLine={false}
                      tickFormatter={(v:number) => `${v}%`} domain={[0, 50]}/>
                    <Tooltip
                      contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.1)',fontSize:'12px'}}
                      formatter={(v:number) => [`${v}%`, '新品销量占比']}/>
                    <Bar dataKey="newRatio" name="新品占比" fill="#3b82f6" fillOpacity={0.15} radius={[3,3,0,0]} barSize={12}/>
                    <Line type="monotone" dataKey="newRatio" name="新品占比" stroke="#3b82f6" strokeWidth={2}
                      dot={{r:3, fill:'#3b82f6', stroke:'white', strokeWidth:1.5}} activeDot={{r:5}}/>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      {selectedProducts && (
        <ProductModal products={selectedProducts} onClose={() => setSelectedProducts(null)}
          domain={domain} history={history} months={months} asinToSegment={asinToSegment}/>
      )}
    </>
  );
});
