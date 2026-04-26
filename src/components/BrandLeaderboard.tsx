import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { Product, HistoryRecord } from '../utils/parser';
import { TrendingUp, TrendingDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { DateRangeSelector } from './DateRangeSelector';
import { ProductModal } from './ProductModal';
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';

interface BrandLeaderboardProps {
  products: Product[];
  history: HistoryRecord[];
  months: string[];
  domain?: string;
  asinToSegment?: Record<string, string>;
}

// Product positioning classification based on price and sales
function getPositionLabel(price: number, monthlySales: number, reviewCount: number): { label: string; color: string } {
  if (price >= 50 && reviewCount >= 1000) return { label: '高端精品', color: 'bg-purple-100 text-purple-700' };
  if (price >= 30 && monthlySales >= 300) return { label: '中高端主流', color: 'bg-indigo-100 text-indigo-700' };
  if (price < 15 && monthlySales >= 500) return { label: '低价走量', color: 'bg-orange-100 text-orange-700' };
  if (price < 15) return { label: '低价引流', color: 'bg-yellow-100 text-yellow-700' };
  if (monthlySales >= 1000) return { label: '爆款热销', color: 'bg-rose-100 text-rose-700' };
  if (reviewCount < 50 && monthlySales < 100) return { label: '新品测试', color: 'bg-sky-100 text-sky-700' };
  if (monthlySales < 100) return { label: '长尾利基', color: 'bg-teal-100 text-teal-700' };
  return { label: '中端均衡', color: 'bg-emerald-100 text-emerald-700' };
}

export const BrandLeaderboard = React.memo(function BrandLeaderboard({ products, history, months, domain = 'amazon.com', asinToSegment = {} }: BrandLeaderboardProps) {
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [previousMonths, setPreviousMonths] = useState<string[]>([]);
  const [lastYearMonths, setLastYearMonths] = useState<string[]>([]);
  const [modalBrand, setModalBrand] = useState<string | null>(null);
  const [brandPage, setBrandPage] = useState(1);
  const brandsPerPage = 20;

  const asinToBrand = useMemo(() => new Map(products.map(p => [p.asin, p.brand])), [products]);

  const calculateBrandStats = (targetMonths: string[]) => {
    const brandMap = new Map<string, { sales: number, revenue: number, count: number }>();
    let totalMarketRevenue = 0;

    if (targetMonths.length === 0) {
      return { brandMap, totalMarketRevenue };
    }

    history.forEach(h => {
      const brand = asinToBrand.get(h.asin) || 'Unknown';
      targetMonths.forEach(m => {
        const monthData = h.history[m];
        if (monthData) {
          const current = brandMap.get(brand) || { sales: 0, revenue: 0, count: 0 };
          brandMap.set(brand, {
            sales: current.sales + monthData.sales,
            revenue: current.revenue + monthData.revenue,
            count: current.count + 1,
          });
          totalMarketRevenue += monthData.revenue;
        }
      });
    });
    return { brandMap, totalMarketRevenue };
  };

  const data = useMemo(() => {
    const currentStats = calculateBrandStats(selectedMonths);
    const prevStats = calculateBrandStats(previousMonths);
    const lastYearStats = calculateBrandStats(lastYearMonths);

    return Array.from(currentStats.brandMap.entries())
      .map(([brand, stats]) => {
        const share = currentStats.totalMarketRevenue > 0 ? (stats.revenue / currentStats.totalMarketRevenue) * 100 : 0;
        
        // Previous period calculations
        const prevBrandStats = prevStats.brandMap.get(brand) || { sales: 0, revenue: 0, count: 0 };
        const prevShare = prevStats.totalMarketRevenue > 0 ? (prevBrandStats.revenue / prevStats.totalMarketRevenue) * 100 : 0;
        
        // Last year calculations
        const lyBrandStats = lastYearStats.brandMap.get(brand) || { sales: 0, revenue: 0, count: 0 };
        const lyShare = lastYearStats.totalMarketRevenue > 0 ? (lyBrandStats.revenue / lastYearStats.totalMarketRevenue) * 100 : 0;

        // YoY and MoM for Sales (Relative %)
        const salesYoY = lyBrandStats.sales > 0 ? ((stats.sales - lyBrandStats.sales) / lyBrandStats.sales) * 100 : undefined;
        const salesMoM = prevBrandStats.sales > 0 ? ((stats.sales - prevBrandStats.sales) / prevBrandStats.sales) * 100 : undefined;

        // YoY and MoM for Market Share (Absolute %)
        const shareYoY = lastYearMonths.length > 0 ? share - lyShare : undefined;
        const shareMoM = previousMonths.length > 0 ? share - prevShare : undefined;

        return {
          brand,
          ...stats,
          share,
          salesYoY,
          salesMoM,
          shareYoY,
          shareMoM,
          marketSize: share > 10 ? '头部品牌' : share > 5 ? '腰部品牌' : share > 1 ? '潜力品牌' : '长尾品牌',
          sparkline: months.slice(-6).map(m => {
            let rev = 0;
            history.forEach(h => {
              if (asinToBrand.get(h.asin) === brand) {
                rev += h.history[m]?.revenue ?? 0;
              }
            });
            return { m, rev };
          }),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [products, history, selectedMonths, previousMonths, lastYearMonths]);

  const brandProducts = useMemo(() => {
    if (!modalBrand) return [];
    return products.filter(p => p.brand === modalBrand).sort((a, b) => b.monthlyRevenue - a.monthlyRevenue);
  }, [products, modalBrand]);

  const renderTrend = (value: number | undefined, isAbsolute = false) => {
    if (value === undefined) return null;
    const isPositive = value > 0;
    const isNegative = value < 0;
    const colorClass = isPositive ? 'text-emerald-600' : isNegative ? 'text-red-600' : 'text-zinc-500';
    const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : null;
    
    return (
      <div className={`flex items-center space-x-0.5 text-[10px] ${colorClass}`}>
        {Icon && <Icon className="w-3 h-3" />}
        <span>{isPositive ? '+' : ''}{value.toFixed(1)}{isAbsolute ? '%' : '%'}</span>
      </div>
    );
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle>品牌排行榜</CardTitle>
            <CardDescription>共 {data.length} 个品牌，按销售额排名。</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {data.length > brandsPerPage && (
              <div className="flex items-center gap-1 text-xs text-[#86868b]">
                <button onClick={() => setBrandPage(p => Math.max(1, p-1))} disabled={brandPage===1} className="p-1 hover:bg-black/5 rounded disabled:opacity-30"><ChevronLeft className="w-3 h-3"/></button>
                <span>第 {brandPage} / {Math.ceil(data.length/brandsPerPage)} 页</span>
                <button onClick={() => setBrandPage(p => Math.min(Math.ceil(data.length/brandsPerPage), p+1))} disabled={brandPage===Math.ceil(data.length/brandsPerPage)} className="p-1 hover:bg-black/5 rounded disabled:opacity-30"><ChevronRight className="w-3 h-3"/></button>
              </div>
            )}
            <DateRangeSelector 
              availableMonths={months} 
              onRangeChange={(selected, previous, lastYear) => {
                setSelectedMonths(selected);
                setPreviousMonths(previous);
                setLastYearMonths(lastYear);
                setBrandPage(1);
              }} 
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-[#86868b]">
              <thead className="text-xs text-[#1d1d1f] uppercase bg-[#f5f5f7] border-b border-black/5">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">排名</th>
                  <th scope="col" className="px-4 py-3 font-medium">品牌</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">ASIN数量</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">销量</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">销售额</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">市场份额</th>
                  <th scope="col" className="px-4 py-3 font-medium text-center">近6月趋势</th>
                  <th scope="col" className="px-4 py-3 font-medium text-right">市场定位</th>
                </tr>
              </thead>
              <tbody>
                {data.slice((brandPage-1)*brandsPerPage, brandPage*brandsPerPage).map((brand, index) => { const globalIndex = (brandPage-1)*brandsPerPage + index; return (
                  <tr 
                    key={brand.brand} 
                    className="border-b border-black/5 hover:bg-[#f5f5f7]/50 transition-colors cursor-pointer"
                    onClick={() => setModalBrand(brand.brand)}
                  >
                    <td className="px-4 py-3 font-medium text-[#1d1d1f]">
                      <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        globalIndex === 0 ? 'bg-amber-100 text-amber-700' : 
                        globalIndex === 1 ? 'bg-zinc-200 text-zinc-700' : 
                        globalIndex === 2 ? 'bg-orange-100 text-orange-800' : 
                        'bg-zinc-100 text-zinc-500'
                      }`}>
                        {globalIndex + 1}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-indigo-600 hover:underline">{brand.brand}</td>
                    <td className="px-4 py-3 text-right">{brand.count}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end">
                        <span>{brand.sales.toLocaleString()}</span>
                        <div className="flex items-center space-x-2 mt-0.5">
                          {brand.salesYoY !== undefined && <span className="text-[10px] text-[#86868b]">同比 {renderTrend(brand.salesYoY)}</span>}
                          {brand.salesMoM !== undefined && <span className="text-[10px] text-[#86868b]">环比 {renderTrend(brand.salesMoM)}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">
                      ${Math.round(brand.revenue).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end">
                        <div className="flex items-center justify-end space-x-2 w-full">
                          <span className="text-xs font-medium">{brand.share.toFixed(1)}%</span>
                          <div className="w-12 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${brand.share}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 mt-1">
                          {brand.shareYoY !== undefined && <span className="text-[10px] text-[#86868b]">同比 {renderTrend(brand.shareYoY, true)}</span>}
                          {brand.shareMoM !== undefined && <span className="text-[10px] text-[#86868b]">环比 {renderTrend(brand.shareMoM, true)}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-24 h-10 mx-auto">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={brand.sparkline}>
                            <Tooltip
                              contentStyle={{fontSize:'10px',padding:'4px 8px',borderRadius:'8px',border:'none',boxShadow:'0 2px 8px rgba(0,0,0,0.12)'}}
                              formatter={(v: number) => [`$${(v/1000).toFixed(1)}k`, '销售额']}
                              labelFormatter={(l: string) => l}
                            />
                            <Line type="monotone" dataKey="rev" stroke="#6366f1" strokeWidth={1.5} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-medium ${
                        brand.marketSize === '头部品牌' ? 'bg-red-100 text-red-700' :
                        brand.marketSize === '腰部品牌' ? 'bg-orange-100 text-orange-700' :
                        brand.marketSize === '潜力品牌' ? 'bg-blue-100 text-blue-700' :
                        'bg-zinc-100 text-zinc-700'
                      }`}>
                        {brand.marketSize}
                      </span>
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Brand Details Modal - using ProductModal for consistency */}
      {modalBrand && (
        <ProductModal
          products={brandProducts}
          onClose={() => setModalBrand(null)}
          domain={domain}
          asinToSegment={asinToSegment}
          history={history}
          months={months}
          title={`品牌详情: ${modalBrand}`}
        />
      )}
    </>
  );
});
