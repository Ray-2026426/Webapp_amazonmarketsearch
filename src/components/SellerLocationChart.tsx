import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ComposedChart, Line, Legend } from 'recharts';
import { Product, HistoryRecord, getCurrencySymbol } from '../utils/parser';
import { ProductModal } from './ProductModal';

interface SellerLocationChartProps {
  products: Product[];
  domain?: string;
  history?: HistoryRecord[];
  months?: string[];
  asinToSegment?: Record<string, string>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b'];

const CustomTooltip = ({ active, payload, label, currency, metric }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white border border-black/10 rounded-2xl shadow-xl p-3 min-w-[180px]">
      <div className="font-bold text-sm text-[#1d1d1f] mb-2">{label}</div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between gap-4"><span className="text-[#86868b]">ASIN数量</span><span className="font-semibold">{d?.count}</span></div>
        <div className="flex justify-between gap-4"><span className="text-[#86868b]">{metric === 'revenue' ? '销售额' : '销量'}</span><span className="font-semibold">{metric === 'revenue' ? `${currency}${d?.revenue?.toLocaleString(undefined,{maximumFractionDigits:0})}` : d?.sales?.toLocaleString()}</span></div>
        <div className="flex justify-between gap-4"><span className="text-[#86868b]">市场份额</span><span className="font-semibold">{d?.share?.toFixed(1)}%</span></div>
      </div>
    </div>
  );
};

export const SellerLocationChart = React.memo(function SellerLocationChart({ products, domain = 'amazon.com', history = [], months = [], asinToSegment = {} }: SellerLocationChartProps) {
  const currency = getCurrencySymbol(domain);
  const [metric, setMetric] = useState<'sales' | 'revenue'>('revenue');
  const [selectedProducts, setSelectedProducts] = useState<Product[] | null>(null);

  const data = useMemo(() => {
    const locationMap = new Map<string, { count: number; sales: number; revenue: number; products: Product[] }>();
    products.forEach(p => {
      const loc = p.sellerLocation || '未知';
      if (!locationMap.has(loc)) locationMap.set(loc, { count: 0, sales: 0, revenue: 0, products: [] });
      const s = locationMap.get(loc)!;
      s.count++; s.sales += p.monthlySales; s.revenue += p.monthlyRevenue; s.products.push(p);
    });

    const total = products.reduce((s, p) => s + (metric === 'revenue' ? p.monthlyRevenue : p.monthlySales), 0);
    const sorted = Array.from(locationMap.entries()).sort((a, b) => b[1][metric] - a[1][metric]);
    const top6 = sorted.slice(0, 6);
    const other = sorted.slice(6);
    const result = top6.map(([name, s]) => ({ name, ...s, share: total > 0 ? (s[metric] / total) * 100 : 0 }));
    if (other.length > 0) {
      const o = other.reduce((acc, [, s]) => { acc.count += s.count; acc.sales += s.sales; acc.revenue += s.revenue; acc.products.push(...s.products); return acc; }, { count: 0, sales: 0, revenue: 0, products: [] as Product[] });
      result.push({ name: '其他', ...o, share: total > 0 ? (o[metric] / total) * 100 : 0 });
    }
    return result;
  }, [products, metric]);

  // 中国 vs 本地趋势（月度）—— 本地=与市场domain同国
  const localCountryCode = useMemo(() => {
    // 从 domain 推断本地国家代码
    const domainMap: Record<string, string[]> = {
      'amazon.co.uk': ['gb','uk','britain','england','united kingdom','英国'],
      'amazon.de': ['de','germany','deutschland','德国'],
      'amazon.fr': ['fr','france','法国'],
      'amazon.it': ['it','italy','italia','意大利'],
      'amazon.es': ['es','spain','espana','españa','西班牙'],
      'amazon.ca': ['ca','canada','加拿大'],
      'amazon.co.jp': ['jp','japan','日本'],
      'amazon.com.au': ['au','australia','澳大利亚'],
      'amazon.com': ['us','usa','united states','america','美国'],
    };
    return domainMap[domain] ?? ['us','usa','united states'];
  }, [domain]);

  const trendData = useMemo(() => {
    return months.map(m => {
      let cnSales = 0, localSales = 0, total = 0;
      history.forEach(h => {
        const p = products.find(x => x.asin === h.asin);
        const d = h.history[m];
        if (!d || !p) return;
        const val = metric === 'revenue' ? d.revenue : d.sales;
        total += val;
        const loc = (p.sellerLocation || '').toLowerCase();
        if (loc.includes('cn') || loc.includes('china') || loc.includes('中国')) cnSales += val;
        else if (localCountryCode.some(code => loc.includes(code))) localSales += val;
      });
      return {
        month: m.substring(2),
        cn: total > 0 ? parseFloat(((cnSales / total) * 100).toFixed(1)) : 0,
        local: total > 0 ? parseFloat(((localSales / total) * 100).toFixed(1)) : 0,
      };
    });
  }, [history, months, products, metric, localCountryCode]);

  const hasTrend = trendData.some(d => d.cn > 0 || d.local > 0);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle>卖家所属地分布</CardTitle>
            <CardDescription>各地区{metric === 'revenue' ? '销售额' : '销量'}排名及市场份额，含中国 vs 本地趋势</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#86868b] font-medium">指标:</label>
            <select value={metric} onChange={e => setMetric(e.target.value as 'sales' | 'revenue')}
              className="text-sm border border-black/5 rounded-lg px-2 py-1 bg-[#f5f5f7] text-[#1d1d1f] focus:outline-none">
              <option value="sales">销量</option>
              <option value="revenue">销售额</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{top:0, right:80, left:0, bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb"/>
                <XAxis type="number" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                  tickFormatter={(v:number) => metric === 'revenue' ? `${currency}${v>=1000?(v/1000).toFixed(0)+'k':v}` : v>=1000?(v/1000).toFixed(0)+'k':String(v)}/>
                <YAxis type="category" dataKey="name" stroke="#86868b" fontSize={12} tickLine={false} axisLine={false} width={60}/>
                <Tooltip content={<CustomTooltip currency={currency} metric={metric}/>}/>
                <Bar dataKey={metric} radius={[0,4,4,0]} barSize={20}
                  onClick={(d:any) => setSelectedProducts(d.products)} className="cursor-pointer">
                  {data.map((d, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 份额标签 */}
          <div className="flex flex-wrap gap-2 mt-2 mb-4">
            {data.map((d, i) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs">
                <span className="w-2 h-2 rounded-full" style={{background: COLORS[i % COLORS.length]}}/>
                <span className="text-[#86868b]">{d.name}</span>
                <span className="font-semibold text-[#1d1d1f]">{d.share.toFixed(1)}%</span>
              </div>
            ))}
          </div>

          {/* 中国 vs 本地趋势 */}
          {hasTrend && (
            <div>
              <div className="text-xs font-semibold text-[#86868b] mb-2">中国卖家 vs 本地卖家月度占比趋势</div>
              <div className="h-[140px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trendData} margin={{top:5,right:10,left:-25,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                    <XAxis dataKey="month" stroke="#86868b" fontSize={10} tickLine={false} axisLine={false}/>
                    <YAxis stroke="#86868b" fontSize={10} tickLine={false} axisLine={false}
                      tickFormatter={(v:number)=>`${v}%`} domain={[0,100]}/>
                    <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.1)',fontSize:'12px'}}
                      formatter={(v:number, name:string) => [`${v}%`, name]}/>
                    <Legend verticalAlign="bottom" height={24} iconType="circle" wrapperStyle={{fontSize:'11px'}}/>
                    <Line type="monotone" dataKey="cn" name="中国卖家" stroke="#ef4444" strokeWidth={2}
                      dot={{r:3,fill:'#ef4444',stroke:'white',strokeWidth:1.5}} activeDot={{r:5}}/>
                    <Line type="monotone" dataKey="local" name="本地卖家（市场同国）" stroke="#3b82f6" strokeWidth={2}
                      dot={{r:3,fill:'#3b82f6',stroke:'white',strokeWidth:1.5}} activeDot={{r:5}}/>
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
