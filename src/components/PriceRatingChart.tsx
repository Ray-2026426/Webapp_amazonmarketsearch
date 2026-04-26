import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { Product, getCurrencySymbol } from '../utils/parser';
import { ProductModal } from './ProductModal';
import { HistoryRecord } from '../utils/parser';
import { Gem, ChevronDown, ChevronUp, ExternalLink, Star, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  products: Product[];
  history?: HistoryRecord[];
  months?: string[];
  domain?: string;
  asinToSegment?: Record<string, string>;
}

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  // 缩小气泡上限，减轻重叠；详细数据在下方可折叠表格中查看
  const r = Math.max(3, Math.min(10, Math.sqrt(Math.max(0, payload.monthlySales) / 45) * 1.05));
  return (
    <circle cx={cx} cy={cy} r={r}
      fill={payload.color} fillOpacity={0.75}
      stroke="white" strokeWidth={1.5}
      style={{cursor:'pointer'}}
    />
  );
};

// 四象限定义（基于均价/均分动态切割）
// 右下：高价+低评分 → 🌟 核心黄金机会（痛点明显，愿意出高价）
// 右上：高价+高评分 → 💡 价格带断层（微升维空白，稀少气泡=机会）
// 左上：低价+高评分 → ⚠️ 红海区（死海，标品内卷）
// 左下：低价+低评分 → 🚫 垃圾场（劣质内卷）
const ZONES = [
  {
    key: 'gold',
    label: '🌟 核心黄金机会',
    sublabel: '高价+低评分',
    desc: '痛点明显，消费者愿意出高价但现有产品无法满足',
    color: '#f59e0b',
    check: (p: Product, avgP: number, avgR: number) => p.price >= avgP && p.rating < avgR,
  },
  {
    key: 'gap',
    label: '💡 价格带断层',
    sublabel: '高价+高评分',
    desc: '微升维空白区，气泡稀少说明无品牌做高端款',
    color: '#6366f1',
    check: (p: Product, avgP: number, avgR: number) => p.price >= avgP && p.rating >= avgR,
  },
  {
    key: 'red',
    label: '⚠️ 红海区',
    sublabel: '低价+高评分',
    desc: '死海，头部大卖供应链极致，避开',
    color: '#ef4444',
    check: (p: Product, avgP: number, avgR: number) => p.price < avgP && p.rating >= avgR,
  },
  {
    key: 'trash',
    label: '🚫 垃圾场',
    sublabel: '低价+低评分',
    desc: '劣质内卷，退货率高，不碰',
    color: '#94a3b8',
    check: (p: Product, avgP: number, avgR: number) => p.price < avgP && p.rating < avgR,
  },
];

function getZone(p: Product, avgP: number, avgR: number) {
  return ZONES.find(z => z.check(p, avgP, avgR)) ?? ZONES[3];
}

type PrSortKey = 'monthlySales' | 'monthlyRevenue' | 'price' | 'rating' | 'reviewCount' | 'fbaFee' | 'subBsr' | 'daysSinceLaunch';
type PrSortDir = 'asc' | 'desc';

function PrSortBtn({ col, current, dir, onClick }: { col: PrSortKey; current: PrSortKey; dir: PrSortDir; onClick: (k: PrSortKey) => void }) {
  const active = current === col;
  return (
    <button type="button" onClick={() => onClick(col)} className={`ml-1 inline-flex ${active ? 'text-indigo-600' : 'text-gray-300 hover:text-gray-500'}`}>
      {active ? (dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
    </button>
  );
}

const PR_PAGE_SIZE = 10;

const PriceRatingTooltip = ({ active, payload, currency, avgPrice, avgRating }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const zone = getZone(d, avgPrice, avgRating);
  return (
    <div className="bg-white border border-black/10 rounded-2xl shadow-xl p-3 max-w-[230px]">
      <div className="font-bold text-[#1d1d1f] text-xs truncate mb-1">{d.title || d.asin}</div>
      <div className="text-[10px] text-[#86868b] mb-2">{d.brand}</div>
      <div className="space-y-1 text-xs">
        {[
          ['价格', `${currency}${d.price.toFixed(2)}`],
          ['评分', `${d.rating.toFixed(1)} ⭐`],
          ['评论数', d.reviewCount.toLocaleString()],
          ['月销量', d.monthlySales.toLocaleString()],
        ].map(([l, v]) => (
          <div key={String(l)} className="flex justify-between gap-4">
            <span className="text-[#86868b]">{l}</span>
            <span className="font-semibold text-[#1d1d1f]">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-black/5">
        <div className="text-[10px] font-bold mb-0.5" style={{color: zone.color}}>{zone.label}</div>
        <div className="text-[10px] text-[#86868b]">{zone.desc}</div>
      </div>
      <div className="text-[10px] text-[#86868b] mt-1">气泡大小 = 月销量</div>
    </div>
  );
};

export const PriceRatingChart = React.memo(function PriceRatingChart({
  products, history = [], months = [], domain = 'amazon.com', asinToSegment = {}
}: Props) {
  const currency = getCurrencySymbol(domain);
  const [selectedProducts, setSelectedProducts] = useState<Product[] | null>(null);
  const [maxPrice, setMaxPrice] = useState(100);
  const [minSales, setMinSales] = useState(100);
  const [listOpen, setListOpen] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [sortKey, setSortKey] = useState<PrSortKey>('monthlySales');
  const [sortDir, setSortDir] = useState<PrSortDir>('desc');

  const avgRating = useMemo(() => {
    const v = products.filter(p => p.rating > 0);
    return v.length ? v.reduce((s, p) => s + p.rating, 0) / v.length : 4.0;
  }, [products]);

  const avgPrice = useMemo(() => {
    const v = products.filter(p => p.price > 0 && p.price <= maxPrice);
    return v.length ? v.reduce((s, p) => s + p.price, 0) / v.length : 30;
  }, [products, maxPrice]);

  const scatterData = useMemo(() =>
    products
      .filter(p => p.price > 0 && p.price <= maxPrice && p.rating > 0 && p.monthlySales >= minSales)
      .map(p => {
        const z = getZone(p, avgPrice, avgRating);
        return { ...p, color: z.color, zoneLabel: z.label, zoneKey: z.key };
      }),
  [products, maxPrice, minSales, avgPrice, avgRating]);

  const goldOpportunityList = useMemo(
    () => scatterData.filter(p => p.zoneKey === 'gold'),
    [scatterData],
  );

  const handleListSort = (k: PrSortKey) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
    setListPage(1);
  };

  const sortedList = useMemo(() => {
    return [...goldOpportunityList].sort((a, b) => {
      const av = (a[sortKey] as number) ?? 0;
      const bv = (b[sortKey] as number) ?? 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [goldOpportunityList, sortKey, sortDir]);

  const listTotalPages = Math.max(1, Math.ceil(sortedList.length / PR_PAGE_SIZE));
  const pagedList = useMemo(
    () => sortedList.slice((listPage - 1) * PR_PAGE_SIZE, listPage * PR_PAGE_SIZE),
    [sortedList, listPage],
  );

  const zoneCounts = useMemo(() =>
    ZONES.map(z => ({ ...z, count: scatterData.filter(p => z.check(p, avgPrice, avgRating)).length })),
  [scatterData, avgPrice, avgRating]);

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Gem className="w-5 h-5 text-amber-500"/>
                价格 × 评分 机会象限图
              </CardTitle>
              <CardDescription>X轴=价格 · Y轴=评分 · 气泡大小=月销量 · 虚线=市场均值 · 右下角为核心黄金机会区</CardDescription>
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[#86868b] font-medium">价格上限:</label>
                <select value={maxPrice} onChange={e => setMaxPrice(Number(e.target.value))} className="text-xs border border-black/10 rounded-lg px-2 py-1.5 bg-[#f5f5f7] focus:outline-none">
                  <option value={30}>{currency}30</option>
                  <option value={50}>{currency}50</option>
                  <option value={100}>{currency}100</option>
                  <option value={200}>{currency}200</option>
                  <option value={99999}>不限</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[#86868b] font-medium">销量下限:</label>
                <select value={minSales} onChange={e => setMinSales(Number(e.target.value))} className="text-xs border border-black/10 rounded-lg px-2 py-1.5 bg-[#f5f5f7] focus:outline-none">
                  <option value={0}>不限</option>
                  <option value={50}>≥50</option>
                  <option value={100}>≥100</option>
                  <option value={300}>≥300</option>
                </select>
              </div>
            </div>
          </div>

          {/* 四象限图例+说明 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            {zoneCounts.map(z => (
              <div key={z.key} className="flex items-start gap-2 bg-[#f5f5f7] rounded-xl p-2.5 border border-black/5">
                <span className="w-2.5 h-2.5 rounded-full mt-0.5 shrink-0" style={{background: z.color}}/>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#1d1d1f] truncate">{z.label}</div>
                  <div className="text-[10px] text-[#86868b] truncate">{z.sublabel} · {z.count}个</div>
                </div>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[420px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{top:10,right:30,bottom:24,left:-10}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                <XAxis type="number" dataKey="price" name="价格" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                  label={{value:`价格（${currency}）`, position:'insideBottom', offset:-14, fontSize:11, fill:'#86868b'}}
                  tickFormatter={(v:number) => `${currency}${v}`}/>
                <YAxis type="number" dataKey="rating" name="评分" domain={[3, 5]} stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                  label={{value:'评分', angle:-90, position:'insideLeft', offset:16, fontSize:11, fill:'#86868b'}}/>

                {/* 均价参考线 */}
                <ReferenceLine x={avgPrice} stroke="#6366f1" strokeDasharray="5 4" strokeOpacity={0.65} strokeWidth={1.5}
                  label={{value:`均价 ${currency}${avgPrice.toFixed(0)}`, position:'insideTopRight', fontSize:10, fill:'#6366f1'}}/>
                {/* 均分参考线 */}
                <ReferenceLine y={avgRating} stroke="#94a3b8" strokeDasharray="5 4" strokeOpacity={0.65} strokeWidth={1.5}
                  label={{value:`均分 ${avgRating.toFixed(2)}`, position:'insideBottomRight', fontSize:10, fill:'#94a3b8'}}/>

                {/* 象限标注 */}
                <ReferenceLine x={avgPrice} stroke="transparent"
                  label={{value:'← 红海/垃圾场   黄金机会/断层 →', position:'insideTopLeft', fontSize:9, fill:'#94a3b8', offset:4}}/>

                <Tooltip content={<PriceRatingTooltip currency={currency} avgPrice={avgPrice} avgRating={avgRating}/>}/>
                <Scatter data={scatterData} shape={<CustomDot/>} onClick={(d:any) => setSelectedProducts([d])} cursor="pointer">
                  {scatterData.map((d, i) => <Cell key={i} fill={d.color}/>)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          {/* 象限解读 */}
          <div className="mt-3 pt-3 border-t border-black/5 grid grid-cols-2 md:grid-cols-4 gap-2">
            {ZONES.map(z => (
              <div key={z.key} className="text-[10px] leading-relaxed">
                <span className="font-semibold" style={{color:z.color}}>{z.label}</span>
                <p className="text-[#86868b] mt-0.5">{z.desc}</p>
              </div>
            ))}
          </div>

          {goldOpportunityList.length > 0 && (
            <div className="mt-4 border-t border-black/5 pt-4">
              <button
                type="button"
                onClick={() => setListOpen(v => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-amber-600 hover:text-amber-700 mb-3"
              >
                {listOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {listOpen ? '隐藏' : '展开'}核心黄金机会 ASIN（表格）
                <span className="text-xs font-normal text-[#86868b] ml-1">({goldOpportunityList.length} 个)</span>
              </button>
              <p className="text-[10px] text-[#86868b] mb-2 -mt-1">仅含右下角「高价+低评分」象限，可排序并打开单 ASIN 详情。</p>
              {listOpen && (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-[#86868b]">
                      <thead className="text-xs text-[#1d1d1f] uppercase bg-[#f5f5f7] border-b border-black/5">
                        <tr>
                          <th className="px-4 py-3 font-medium min-w-[260px]">产品</th>
                          <th className="px-3 py-3 font-medium whitespace-nowrap">细分市场</th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">
                            价格<PrSortBtn col="price" current={sortKey} dir={sortDir} onClick={handleListSort} />
                          </th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">
                            星级<PrSortBtn col="rating" current={sortKey} dir={sortDir} onClick={handleListSort} />
                          </th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">
                            评论<PrSortBtn col="reviewCount" current={sortKey} dir={sortDir} onClick={handleListSort} />
                          </th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">
                            销量<PrSortBtn col="monthlySales" current={sortKey} dir={sortDir} onClick={handleListSort} />
                          </th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">
                            销售额<PrSortBtn col="monthlyRevenue" current={sortKey} dir={sortDir} onClick={handleListSort} />
                          </th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">
                            FBA<PrSortBtn col="fbaFee" current={sortKey} dir={sortDir} onClick={handleListSort} />
                          </th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">
                            小类BSR<PrSortBtn col="subBsr" current={sortKey} dir={sortDir} onClick={handleListSort} />
                          </th>
                          <th className="px-3 py-3 font-medium text-center whitespace-nowrap">
                            上架天数<PrSortBtn col="daysSinceLaunch" current={sortKey} dir={sortDir} onClick={handleListSort} />
                          </th>
                          <th className="px-3 py-3 font-medium text-center whitespace-nowrap">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedList.map(p => (
                          <tr key={p.asin} className="border-b border-black/5 hover:bg-[#f5f5f7]/50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {p.image ? (
                                  <img src={p.image} alt={p.title} className="w-10 h-10 rounded-lg object-cover border border-black/5 shrink-0" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-[#f5f5f7] border border-black/5 flex items-center justify-center text-xs text-[#86868b] shrink-0">无图</div>
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium text-[#1d1d1f] truncate max-w-[200px]" title={p.title}>{p.title || p.asin}</div>
                                  <div className="text-xs text-[#86868b] flex items-center gap-2 mt-0.5">
                                    <span className="font-mono bg-[#f5f5f7] px-1 py-0.5 rounded text-[10px]">{p.asin}</span>
                                    <a href={`https://www.${domain}/dp/${p.asin}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800">
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                    <span>{p.brand}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {asinToSegment[p.asin] ? (
                                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-medium whitespace-nowrap">{asinToSegment[p.asin]}</span>
                              ) : (
                                <span className="text-[10px] text-[#86868b]">未分类</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-medium text-[#1d1d1f]">{currency}{p.price.toFixed(2)}</td>
                            <td className="px-3 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="font-medium text-[#1d1d1f]">{p.rating.toFixed(1)}</span>
                                <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right">{p.reviewCount.toLocaleString()}</td>
                            <td className="px-3 py-3 text-right font-mono">{p.monthlySales.toLocaleString()}</td>
                            <td className="px-3 py-3 text-right font-medium text-emerald-600">{currency}{Math.round(p.monthlyRevenue).toLocaleString()}</td>
                            <td className="px-3 py-3 text-right">{p.fbaFee > 0 ? `${currency}${p.fbaFee.toFixed(2)}` : '-'}</td>
                            <td className="px-3 py-3 text-right">
                              {p.subBsr > 0 ? (
                                <div>
                                  <span className="font-medium">#{p.subBsr.toLocaleString()}</span>
                                  {p.subCategory && <span className="block text-[10px] text-[#86868b] truncate max-w-[80px]" title={p.subCategory}>{p.subCategory}</span>}
                                </div>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="px-3 py-3 text-center text-xs">{p.daysSinceLaunch > 0 ? `${p.daysSinceLaunch}天` : '-'}</td>
                            <td className="px-3 py-3 text-center">
                              <button
                                type="button"
                                onClick={() => setSelectedProducts([p])}
                                className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 p-1.5 rounded-lg transition-colors"
                                title="查看详情"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {listTotalPages > 1 && (
                    <div className="flex items-center justify-between mt-3 px-1">
                      <span className="text-xs text-[#86868b]">
                        第 {listPage}/{listTotalPages} 页，共 {sortedList.length} 条
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setListPage(pg => Math.max(1, pg - 1))}
                          disabled={listPage === 1}
                          className="p-1.5 rounded-lg hover:bg-[#f5f5f7] disabled:opacity-30"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setListPage(pg => Math.min(listTotalPages, pg + 1))}
                          disabled={listPage === listTotalPages}
                          className="p-1.5 rounded-lg hover:bg-[#f5f5f7] disabled:opacity-30"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
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
