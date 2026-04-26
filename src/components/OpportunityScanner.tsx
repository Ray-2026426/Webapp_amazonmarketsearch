import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { Product, HistoryRecord, getCurrencySymbol } from '../utils/parser';
import { ProductModal } from './ProductModal';
import { Crosshair, Info, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Star, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

interface Props {
  products: Product[];
  history: HistoryRecord[];
  months: string[];
  domain?: string;
  asinToSegment?: Record<string, string>;
}

const OPPORTUNITY_COLORS = {
  '黄金坑位': '#10b981',
  '潜力新品': '#6366f1',
  '红海竞争': '#ef4444',
  '普通': '#94a3b8',
};

function classifyOpportunity(p: Product): string {
  const lowReviews = p.reviewCount < 100;
  const newProduct = p.daysSinceLaunch < 365;
  const highSales = p.monthlySales > 100;
  if (lowReviews && highSales) return '黄金坑位';
  if (lowReviews && newProduct) return '潜力新品';
  if (!lowReviews && highSales) return '红海竞争';
  return '普通';
}

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  const color = OPPORTUNITY_COLORS[payload.opportunity as keyof typeof OPPORTUNITY_COLORS] ?? '#94a3b8';
  const r = typeof payload.bubbleR === 'number' && payload.bubbleR > 0 ? payload.bubbleR : 4;
  return <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.85} stroke="white" strokeWidth={1} />;
};

const OppTooltip = ({ active, payload, currency }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const color = OPPORTUNITY_COLORS[d.opportunity as keyof typeof OPPORTUNITY_COLORS] ?? '#94a3b8';
  return (
    <div className="bg-white border border-black/10 rounded-2xl shadow-xl p-3 max-w-[220px]">
      <div className="font-bold text-[#1d1d1f] text-xs mb-1 truncate">{d.title || d.asin}</div>
      <div className="text-[10px] text-[#86868b] mb-2">{d.brand}</div>
      <div className="space-y-1 text-xs">
        {[['评论数',d.reviewCount.toLocaleString()],['月销量',d.monthlySales.toLocaleString()],['价格',`${currency}${d.price.toFixed(2)}`],['评分',d.rating.toFixed(1)],['上架天数',`${d.daysSinceLaunch}天`]].map(([l,v])=>(
          <div key={String(l)} className="flex justify-between gap-3"><span className="text-[#86868b]">{l}</span><span className="font-semibold text-[#1d1d1f]">{v}</span></div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-black/5 text-[10px] font-bold" style={{color}}>{d.opportunity}</div>
    </div>
  );
};

type SortKey = 'monthlySales'|'monthlyRevenue'|'price'|'rating'|'reviewCount'|'fbaFee'|'subBsr'|'daysSinceLaunch';
type SortDir = 'asc'|'desc';

function SortBtn({col,current,dir,onClick}:{col:SortKey;current:SortKey;dir:SortDir;onClick:(k:SortKey)=>void}){
  const active=current===col;
  return(<button onClick={()=>onClick(col)} className={`ml-1 inline-flex ${active?'text-indigo-600':'text-gray-300 hover:text-gray-500'}`}>
    {active?(dir==='asc'?<ArrowUp className="w-3 h-3"/>:<ArrowDown className="w-3 h-3"/>):<ArrowUpDown className="w-3 h-3"/>}
  </button>);
}

const PAGE_SIZE=10;

export const OpportunityScanner = React.memo(function OpportunityScanner({products,history,months,domain='amazon.com',asinToSegment={}}: Props){
  const currency=getCurrencySymbol(domain);
  const [selectedProducts,setSelectedProducts]=useState<Product[]|null>(null);
  const [maxReviews,setMaxReviews]=useState(100);
  const [minSales,setMinSales]=useState(100);
  const [highlightOnly,setHighlightOnly]=useState(false);
  const [tableOpen,setTableOpen]=useState(false);
  const [page,setPage]=useState(1);
  const [sortKey,setSortKey]=useState<SortKey>('monthlySales');
  const [sortDir,setSortDir]=useState<SortDir>('desc');

  const handleSort=(k:SortKey)=>{
    if(sortKey===k)setSortDir(d=>d==='asc'?'desc':'asc');
    else{setSortKey(k);setSortDir('desc');}
    setPage(1);
  };

  const scatterData=useMemo(()=>{
    const base = products
      .filter(p=>p.reviewCount<=maxReviews&&p.monthlySales>=minSales&&p.price>0)
      .map(p=>({...p,opportunity:classifyOpportunity(p)}))
      .filter(p=>!highlightOnly||p.opportunity==='黄金坑位'||p.opportunity==='潜力新品');
    const prices = base.map(p => p.price);
    const minP = prices.length ? Math.min(...prices) : 0;
    const maxP = prices.length ? Math.max(...prices, minP + 1e-6) : 1;
    const span = maxP - minP || 1;
    const rMin = 3;
    const rMax = 14;
    return base.map(p => ({
      ...p,
      bubbleR: rMin + ((p.price - minP) / span) * (rMax - rMin),
    }));
  },[products,maxReviews,minSales,highlightOnly]);

  const goldList=useMemo(()=>{
    return products
      .map(p=>({...p,opportunity:classifyOpportunity(p)}))
      .filter(p=>p.opportunity==='黄金坑位')
      .sort((a,b)=>{
        const av=(a[sortKey as keyof Product] as number)??0;
        const bv=(b[sortKey as keyof Product] as number)??0;
        return sortDir==='asc'?av-bv:bv-av;
      });
  },[products,sortKey,sortDir]);

  const totalPages=Math.max(1,Math.ceil(goldList.length/PAGE_SIZE));
  const pagedGold=useMemo(()=>goldList.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[goldList,page]);

  const reviewMedian=useMemo(()=>{
    const sorted=[...products].map(p=>p.reviewCount).sort((a,b)=>a-b);
    return sorted[Math.floor(sorted.length/2)]??0;
  },[products]);

  const salesMedian=useMemo(()=>{
    const sorted=[...products].map(p=>p.monthlySales).sort((a,b)=>a-b);
    return sorted[Math.floor(sorted.length/2)]??0;
  },[products]);

  return(
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Crosshair className="w-5 h-5 text-emerald-500"/>竞争空白扫描器</CardTitle>
              <CardDescription>X轴=评论数（竞争壁垒）· Y轴=月销量（市场需求）· 气泡越大价格越高 · 左上角为最佳机会区</CardDescription>
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[#86868b] font-medium">评论上限:</label>
                <select value={maxReviews} onChange={e=>setMaxReviews(Number(e.target.value))} className="text-xs border border-black/10 rounded-lg px-2 py-1.5 bg-[#f5f5f7] focus:outline-none">
                  <option value={100}>≤100</option><option value={200}>≤200</option><option value={500}>≤500</option><option value={1000}>≤1000</option><option value={99999}>全部</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[#86868b] font-medium">销量下限:</label>
                <select value={minSales} onChange={e=>setMinSales(Number(e.target.value))} className="text-xs border border-black/10 rounded-lg px-2 py-1.5 bg-[#f5f5f7] focus:outline-none">
                  <option value={0}>不限</option><option value={50}>≥50</option><option value={100}>≥100</option><option value={300}>≥300</option><option value={500}>≥500</option>
                </select>
              </div>
              <button onClick={()=>setHighlightOnly(v=>!v)} className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${highlightOnly?'bg-emerald-50 text-emerald-600 border-emerald-200':'bg-[#f5f5f7] text-[#86868b] border-black/10 hover:text-[#1d1d1f]'}`}>{highlightOnly?'仅显示机会':'显示全部'}</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 mt-3">
            {Object.entries(OPPORTUNITY_COLORS).map(([label,color])=>{
              const count=scatterData.filter(p=>p.opportunity===label).length;
              return(<div key={label} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:color}}/><span className="text-xs text-[#86868b]">{label}</span><span className="text-xs font-bold text-[#1d1d1f]">{count}</span></div>);
            })}
            <div className="ml-auto flex items-center gap-1 text-xs text-[#86868b]"><Info className="w-3.5 h-3.5"/><span>虚线=中位数 · 气泡大小=价格 · 点击散点查看商品</span></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[420px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{top:10,right:20,bottom:20,left:-10}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                <XAxis type="number" dataKey="reviewCount" name="评论数" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                  label={{value:'评论数（竞争壁垒）',position:'insideBottom',offset:-12,fontSize:11,fill:'#86868b'}}
                  tickFormatter={(v:number)=>v>=1000?`${(v/1000).toFixed(1)}k`:String(v)}/>
                <YAxis type="number" dataKey="monthlySales" name="月销量" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                  label={{value:'月销量（需求强度）',angle:-90,position:'insideLeft',offset:16,fontSize:11,fill:'#86868b'}}
                  tickFormatter={(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)}/>
                <ReferenceLine x={reviewMedian} stroke="#6366f1" strokeDasharray="4 4" strokeOpacity={0.6} label={{value:`评论中位数 ${reviewMedian}`,position:'top',fontSize:10,fill:'#6366f1'}}/>
                <ReferenceLine y={salesMedian} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.6} label={{value:`销量中位数 ${salesMedian}`,position:'right',fontSize:10,fill:'#f59e0b'}}/>
                <Tooltip content={<OppTooltip currency={currency}/>}/>
                <Scatter data={scatterData} shape={<CustomDot/>} onClick={(d:any)=>setSelectedProducts([d])} cursor="pointer"/>
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* 黄金坑位列表，可折叠 */}
          {goldList.length>0&&(
            <div className="mt-4 border-t border-black/5 pt-4">
              <button onClick={()=>setTableOpen(v=>!v)} className="flex items-center gap-2 text-sm font-semibold text-emerald-600 hover:text-emerald-700 mb-3">
                {tableOpen ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                {tableOpen ? '隐藏' : '展开'}全部黄金坑位 ASIN
                <span className="text-xs font-normal text-[#86868b] ml-1">({goldList.length} 个)</span>
              </button>
              {tableOpen&&(
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-[#86868b]">
                      <thead className="text-xs text-[#1d1d1f] uppercase bg-[#f5f5f7] border-b border-black/5">
                        <tr>
                          <th className="px-4 py-3 font-medium min-w-[280px]">产品</th>
                          <th className="px-3 py-3 font-medium whitespace-nowrap">细分市场</th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">价格<SortBtn col="price" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">星级</th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">评分<SortBtn col="reviewCount" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">销量<SortBtn col="monthlySales" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">销售额<SortBtn col="monthlyRevenue" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">FBA费用<SortBtn col="fbaFee" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                          <th className="px-3 py-3 font-medium text-right whitespace-nowrap">小类BSR<SortBtn col="subBsr" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                          <th className="px-3 py-3 font-medium text-center whitespace-nowrap">上架时间<SortBtn col="daysSinceLaunch" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                          <th className="px-3 py-3 font-medium text-center whitespace-nowrap">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedGold.map(p=>(
                          <tr key={p.asin} className="border-b border-black/5 hover:bg-[#f5f5f7]/50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {p.image
                                  ?<img src={p.image} alt={p.title} className="w-10 h-10 rounded-lg object-cover border border-black/5 shrink-0" referrerPolicy="no-referrer"/>
                                  :<div className="w-10 h-10 rounded-lg bg-[#f5f5f7] border border-black/5 flex items-center justify-center text-xs text-[#86868b] shrink-0">无图</div>}
                                <div className="min-w-0">
                                  <div className="font-medium text-[#1d1d1f] truncate max-w-[200px]" title={p.title}>{p.title||p.asin}</div>
                                  <div className="text-xs text-[#86868b] flex items-center gap-2 mt-0.5">
                                    <span className="font-mono bg-[#f5f5f7] px-1 py-0.5 rounded text-[10px]">{p.asin}</span>
                                    <a href={`https://www.${domain}/dp/${p.asin}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800"><ExternalLink className="w-3 h-3"/></a>
                                    <span>{p.brand}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {asinToSegment[p.asin]
                                ?<span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-medium whitespace-nowrap">{asinToSegment[p.asin]}</span>
                                :<span className="text-[10px] text-[#86868b]">未分类</span>}
                            </td>
                            <td className="px-3 py-3 text-right font-medium text-[#1d1d1f]">{currency}{p.price.toFixed(2)}</td>
                            <td className="px-3 py-3 text-right">
                              <div className="flex items-center justify-end gap-1"><span className="font-medium text-[#1d1d1f]">{p.rating.toFixed(1)}</span><Star className="w-3 h-3 text-amber-500 fill-amber-500"/></div>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-semibold">{p.reviewCount.toLocaleString()}</span>
                            </td>
                            <td className="px-3 py-3 text-right font-mono">{p.monthlySales.toLocaleString()}</td>
                            <td className="px-3 py-3 text-right font-medium text-emerald-600">{currency}{Math.round(p.monthlyRevenue).toLocaleString()}</td>
                            <td className="px-3 py-3 text-right">{p.fbaFee>0?`${currency}${p.fbaFee.toFixed(2)}`:'-'}</td>
                            <td className="px-3 py-3 text-right">
                              {p.subBsr>0?(<div><span className="font-medium">#{p.subBsr.toLocaleString()}</span>{p.subCategory&&<span className="block text-[10px] text-[#86868b] truncate max-w-[80px]" title={p.subCategory}>{p.subCategory}</span>}</div>):'-'}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className="text-xs text-[#86868b]">{p.launchDate||'未知'}</span>
                              {p.daysSinceLaunch>0&&<span className="block text-[10px] text-[#86868b]">{p.daysSinceLaunch}天前</span>}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <button onClick={()=>setSelectedProducts([p])} className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 p-1.5 rounded-lg transition-colors" title="查看详情"><ExternalLink className="w-3.5 h-3.5"/></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPages>1&&(
                    <div className="flex items-center justify-between mt-3 px-1">
                      <span className="text-xs text-[#86868b]">第 {page}/{totalPages} 页，共 {goldList.length} 条</span>
                      <div className="flex items-center gap-1">
                        <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} className="p-1.5 rounded-lg hover:bg-[#f5f5f7] disabled:opacity-30"><ChevronLeft className="w-4 h-4"/></button>
                        <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} className="p-1.5 rounded-lg hover:bg-[#f5f5f7] disabled:opacity-30"><ChevronRight className="w-4 h-4"/></button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {selectedProducts&&(
        <ProductModal products={selectedProducts} onClose={()=>setSelectedProducts(null)} domain={domain} history={history} months={months} asinToSegment={asinToSegment}/>
      )}
    </>
  );
});