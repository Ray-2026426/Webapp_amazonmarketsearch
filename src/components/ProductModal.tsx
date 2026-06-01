import React, { useState, useMemo } from 'react';
import { X, ExternalLink, Star, TrendingUp, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Sparkles, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/Card';
import { Product, HistoryRecord, getCurrencySymbol } from '../utils/parser';
import { formatSegmentLabel } from '../utils/subSegments';
import { ComposedChart, Bar, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { toast } from 'sonner';

type SortKey = 'monthlySales' | 'monthlyRevenue' | 'launchDate' | 'fbaFee' | 'subBsr';
type SortDir = 'asc' | 'desc';

interface ProductModalProps {
  products: Product[];
  onClose: () => void;
  domain: string;
  asinToSegment?: Record<string, string>;
  asinToSubSegment?: Record<string, string>;
  asinToLevel3Segment?: Record<string, string>;
  history?: HistoryRecord[];
  months?: string[];
  title?: string;
}

function SortBtn({ col, current, dir, onClick }: { col: SortKey; current: SortKey | null; dir: SortDir; onClick: (k: SortKey) => void }) {
  const active = current === col;
  return (
    <button onClick={() => onClick(col)} className={`ml-1 inline-flex ${active ? 'text-indigo-600' : 'text-gray-300 hover:text-gray-500'}`}>
      {active ? (dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
    </button>
  );
}

export const ProductModal = React.memo(function ProductModal({
  products, onClose, domain,
  asinToSegment = {}, asinToSubSegment = {}, asinToLevel3Segment = {}, history = [], months = [], title = 'ASIN 列表',
}: ProductModalProps) {
  const cur = getCurrencySymbol(domain);
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [aggregation, setAggregation] = useState<'month' | 'quarter' | 'year'>('month');
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey | null>('monthlyRevenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const pageSize = 20;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
    setPage(1);
  };

  const sorted = useMemo(() => {
    if (!sortKey) return products;
    return [...products].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === 'launchDate') {
        av = a.launchDate ? new Date(a.launchDate).getTime() : 0;
        bv = b.launchDate ? new Date(b.launchDate).getTime() : 0;
      } else {
        av = (a[sortKey] as number) || 0;
        bv = (b[sortKey] as number) || 0;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [products, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);
  const selectedProduct = useMemo(() => products.find(p => p.asin === selectedAsin) ?? null, [products, selectedAsin]);

  const asinHistoryData = useMemo(() => {
    if (!selectedAsin) return [];
    const record = history.find(h => h.asin === selectedAsin);
    if (!record) return [];
    const rawData = months.map(month => {
      const d = record.history[month];
      const sales = d?.sales ?? 0;
      const revenue = d?.revenue ?? 0;
      const price = sales > 0 && revenue > 0 ? revenue / sales : (d?.price ?? 0);
      return { month, sales, revenue, price };
    });
    if (aggregation === 'month') return rawData;
    const aggMap = new Map<string, { sales: number; revenue: number; price: number; cnt: number }>();
    rawData.forEach(item => {
      const parts = item.month.split('-');
      if (parts.length !== 2) return;
      const yr = parts[0].length === 2 ? '20' + parts[0] : parts[0];
      const mn = parseInt(parts[1], 10);
      const key = aggregation === 'year' ? yr : `${yr}-Q${Math.ceil(mn / 3)}`;
      const cur2 = aggMap.get(key) ?? { sales: 0, revenue: 0, price: 0, cnt: 0 };
      cur2.sales += item.sales; cur2.revenue += item.revenue;
      if (item.price > 0) { cur2.price += item.price; cur2.cnt++; }
      aggMap.set(key, cur2);
    });
    return Array.from(aggMap.entries())
      .map(([k, s]) => ({ month: k, sales: s.sales, revenue: s.revenue, price: s.cnt > 0 ? s.price / s.cnt : 0 }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [selectedAsin, history, months, aggregation]);

  const handleAiAnalysis = async () => {
    if (!selectedProduct) return;
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) {
      toast.error('请先在「AI 设置」中配置 API Key');
      return;
    }
    setIsAiLoading(true);
    setAiAnalysis(null);
    try {
      const record = history.find(h => h.asin === selectedAsin);
      const historyLines = record
        ? months.filter(m => record.history[m]).map(m => {
            const d = record.history[m];
            return `${m}: 销量=${d.sales}, 销售额=${cur}${Math.round(d.revenue)}, 均价=${cur}${d.sales > 0 ? (d.revenue / d.sales).toFixed(2) : (d.price ?? 0).toFixed(2)}`;
          }).join('\n')
        : '无历史数据';

      const prompt = `你是一位资深亚马逊运营专家，请对以下单个ASIN进行深度分析。

## ASIN基本信息
- ASIN: ${selectedProduct.asin}
- 标题: ${selectedProduct.title || '未知'}
- 品牌: ${selectedProduct.brand}
- 当前价格: ${cur}${selectedProduct.price.toFixed(2)}
- 月销量: ${selectedProduct.monthlySales.toLocaleString()}
- 月销售额: ${cur}${Math.round(selectedProduct.monthlyRevenue).toLocaleString()}
- 评分: ${selectedProduct.rating.toFixed(1)} (${selectedProduct.reviewCount.toLocaleString()} 条评论)
- FBA费用: ${selectedProduct.fbaFee > 0 ? cur + selectedProduct.fbaFee.toFixed(2) : '未知'}
- 小类BSR: ${selectedProduct.subBsr > 0 ? '#' + selectedProduct.subBsr.toLocaleString() : '未知'}
- 上架时间: ${selectedProduct.launchDate || '未知'}

## 历史月度数据
${historyLines}

## 分析要求
请按以下结构输出分析报告（使用Markdown格式）：

### 1. 销售趋势分析
分析历史销量和销售额的变化趋势，识别增长、下降或季节性规律。

### 2. 价格策略分析
分析价格变化对销量的影响，评估当前定价是否合理。

### 3. 竞争力评估
基于评分、评论数、BSR排名，评估该ASIN的市场竞争力。

### 4. 增长机会与风险
指出该ASIN的潜在增长机会和主要风险点。

### 5. 运营建议
给出3-5条具体可执行的运营优化建议。`;

      const result = await generateText(prompt, aiSettings);
      setAiAnalysis(result);
    } catch (err: any) {
      toast.error('AI分析失败: ' + (err.message || '请检查API配置'));
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <Card className="w-full max-w-6xl max-h-[88vh] flex flex-col shadow-2xl rounded-[24px]">
        <CardHeader className="flex flex-row items-center justify-between border-b border-black/5 pb-4 bg-[#f5f5f7]/50 rounded-t-[24px] shrink-0">
          <div><CardTitle className="text-xl">{title}</CardTitle><CardDescription>共 {products.length} 个 ASIN</CardDescription></div>
          <div className="flex items-center gap-3">
            {totalPages > 1 && (<div className="flex items-center gap-1 text-xs text-[#86868b]"><button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="p-1 hover:bg-black/5 rounded disabled:opacity-30"><ChevronLeft className="w-4 h-4"/></button><span>{page}/{totalPages}</span><button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} className="p-1 hover:bg-black/5 rounded disabled:opacity-30"><ChevronRight className="w-4 h-4"/></button></div>)}
            <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full"><X className="w-5 h-5 text-[#86868b]"/></button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-0">
          <table className="w-full text-sm text-left text-[#86868b]">
            <thead className="text-xs text-[#1d1d1f] uppercase bg-[#f5f5f7] sticky top-0 border-b border-black/5"><tr>
              <th className="px-3 py-3">图片</th>
              <th className="px-3 py-3">ASIN</th>
              <th className="px-3 py-3">标题</th>
              <th className="px-3 py-3">细分市场</th>
              <th className="px-3 py-3 text-right">价格</th>
              <th className="px-3 py-3 text-right">销量<SortBtn col="monthlySales" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
              <th className="px-3 py-3 text-right">销售额<SortBtn col="monthlyRevenue" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
              <th className="px-3 py-3 text-right">FBA<SortBtn col="fbaFee" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
              <th className="px-3 py-3 text-right">小类BSR<SortBtn col="subBsr" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
              <th className="px-3 py-3 text-right">星级</th>
              <th className="px-3 py-3 text-right">评分数</th>
              <th className="px-3 py-3 text-center">上架时间<SortBtn col="launchDate" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
              {history.length > 0 && <th className="px-3 py-3 text-center">深度分析</th>}
            </tr></thead>
            <tbody>{paged.map(p => { const seg = asinToSegment[p.asin]; return (
              <tr key={p.asin} className="border-b border-black/5 hover:bg-[#f5f5f7]/50">
                <td className="px-3 py-2">{p.image ? <img src={p.image} alt={p.asin} className="w-9 h-9 object-cover rounded shadow-sm" referrerPolicy="no-referrer"/> : <div className="w-9 h-9 bg-gray-100 rounded flex items-center justify-center text-[10px] text-gray-400">无图</div>}</td>
                <td className="px-3 py-2 font-mono text-xs text-[#1d1d1f]"><div className="flex items-center gap-1"><span>{p.asin}</span><a href={`https://www.${domain}/dp/${p.asin}`} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:text-indigo-700"><ExternalLink className="w-3 h-3"/></a></div></td>
                <td className="px-3 py-2 truncate max-w-[150px]" title={p.title}>{p.title}</td>
                <td className="px-3 py-2">{seg ? <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-medium whitespace-nowrap">{formatSegmentLabel(seg, asinToSubSegment[p.asin], asinToLevel3Segment[p.asin])}</span> : <span className="text-[10px] text-[#86868b]">未分类</span>}</td>
                <td className="px-3 py-2 text-right">{cur}{p.price.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{p.monthlySales.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-medium text-emerald-600">{cur}{Math.round(p.monthlyRevenue).toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{p.fbaFee > 0 ? `${cur}${p.fbaFee.toFixed(2)}` : '-'}</td>
                <td className="px-3 py-2 text-right">{p.subBsr > 0 ? <div><span className="font-medium">#{p.subBsr.toLocaleString()}</span>{p.subCategory && <span className="block text-[10px] text-[#86868b] truncate max-w-[80px]" title={p.subCategory}>{p.subCategory}</span>}</div> : '-'}</td>
                <td className="px-3 py-2 text-right"><div className="flex items-center justify-end gap-0.5"><span>{p.rating.toFixed(1)}</span><Star className="w-3 h-3 text-amber-500 fill-amber-500"/></div></td>
                <td className="px-3 py-2 text-right">{p.reviewCount.toLocaleString()}</td>
                <td className="px-3 py-2 text-center text-xs">{p.launchDate || '-'}</td>
                {history.length > 0 && <td className="px-3 py-2 text-center"><button onClick={() => { setSelectedAsin(p.asin); setAiAnalysis(null); }} className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 p-1.5 rounded-lg transition-colors" title="深度分析"><TrendingUp className="w-4 h-4"/></button></td>}
              </tr>);})} </tbody>
          </table>
        </CardContent>
      </Card>

      {selectedAsin && selectedProduct && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-black/5 flex items-center justify-between bg-[#f5f5f7]/50 shrink-0">
              <div className="flex items-center gap-3">
                {selectedProduct.image && <img src={selectedProduct.image} alt={selectedProduct.title} className="w-12 h-12 rounded-xl object-cover border border-black/5" referrerPolicy="no-referrer"/>}
                <div>
                  <h3 className="text-base font-bold text-[#1d1d1f] flex items-center gap-2">ASIN 深度分析: <span className="font-mono text-indigo-600">{selectedAsin}</span><a href={`https://www.${domain}/dp/${selectedAsin}`} target="_blank" rel="noopener noreferrer" className="text-[#86868b] hover:text-indigo-600"><ExternalLink className="w-4 h-4"/></a></h3>
                  <p className="text-xs text-[#86868b] mt-0.5 truncate max-w-xl">{selectedProduct.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[#86868b]">聚合:</label>
                <select value={aggregation} onChange={e => setAggregation(e.target.value as any)} className="text-sm border border-black/5 rounded-lg px-2 py-1 bg-[#f5f5f7] focus:outline-none">
                  <option value="month">月</option><option value="quarter">季度</option><option value="year">年</option>
                </select>
                <button onClick={() => { setSelectedAsin(null); setAiAnalysis(null); }} className="p-2 hover:bg-black/5 rounded-full"><X className="w-5 h-5 text-[#86868b]"/></button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
                {[{label:'价格',val:`${cur}${selectedProduct.price.toFixed(2)}`},{label:'销量',val:selectedProduct.monthlySales.toLocaleString()},{label:'销售额',val:`${cur}${Math.round(selectedProduct.monthlyRevenue).toLocaleString()}`},{label:'星级',val:`${selectedProduct.rating.toFixed(1)} ★`},{label:'评分数',val:selectedProduct.reviewCount.toLocaleString()},{label:'FBA费用',val:selectedProduct.fbaFee>0?`${cur}${selectedProduct.fbaFee.toFixed(2)}`:'-'}].map(item => (
                  <div key={item.label} className="bg-[#f5f5f7] p-3 rounded-2xl border border-black/5"><div className="text-[10px] text-[#86868b] uppercase tracking-wider mb-1">{item.label}</div><div className="text-sm font-semibold text-[#1d1d1f]">{item.val}</div></div>
                ))}
              </div>

              {/* AI Analysis Button & Result */}
              <div className="mb-6">
                <button
                  onClick={handleAiAnalysis}
                  disabled={isAiLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl text-sm font-semibold hover:from-indigo-700 hover:to-violet-700 transition-all shadow-md disabled:opacity-60"
                >
                  {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
                  {isAiLoading ? 'AI 分析中...' : 'AI 深度分析'}
                </button>
                {aiAnalysis && (
                  <div className="mt-4 p-4 bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-2xl text-sm text-[#1d1d1f] leading-relaxed whitespace-pre-wrap">
                    {aiAnalysis}
                  </div>
                )}
              </div>

              {asinHistoryData.length > 0 ? (
                <div>
                  <h4 className="text-sm font-semibold text-[#1d1d1f] mb-3">历史销量、销售额与价格趋势</h4>
                  <div className="h-[320px] w-full border border-black/5 rounded-2xl p-4 bg-white shadow-sm">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={asinHistoryData} margin={{top:10,right:40,left:0,bottom:0}}>
                        <XAxis dataKey="month" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => v.substring(2)}/>
                        <YAxis yAxisId="left" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${cur}${(v/1000).toFixed(0)}k`}/>
                        <YAxis yAxisId="right" orientation="right" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}`}/>
                        <YAxis yAxisId="price" orientation="right" stroke="#f59e0b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${cur}${v.toFixed(0)}`} dx={10}/>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                        <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 15px -3px rgb(0 0 0/0.1)'}} formatter={(value:number,_name:string,props:any) => { if(props.dataKey==='revenue') return [`${cur}${Math.round(value).toLocaleString()}`,'销售额']; if(props.dataKey==='sales') return [value.toLocaleString(),'销量']; if(props.dataKey==='price') return [`${cur}${value.toFixed(2)}`,'均价']; return [value,_name]; }}/>
                        <Legend verticalAlign="bottom" height={36} iconType="circle"/>
                        <Bar yAxisId="right" dataKey="sales" name="销量" fill="#10b981" radius={[4,4,0,0]} barSize={20}/>
                        <Line yAxisId="left" type="monotone" dataKey="revenue" name="销售额" stroke="#4f46e5" strokeWidth={2} dot={{r:3,fill:'#4f46e5',strokeWidth:2,stroke:'#fff'}} activeDot={{r:5}}/>
                        <Line yAxisId="price" type="monotone" dataKey="price" name="均价" stroke="#f59e0b" strokeWidth={2} dot={{r:3,fill:'#f59e0b',strokeWidth:2,stroke:'#fff'}} activeDot={{r:5}}/>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-[#86868b] bg-[#f5f5f7] rounded-2xl border border-black/5"><TrendingUp className="w-10 h-10 mb-3 text-zinc-300"/><p className="text-sm">未找到该ASIN的历史数据</p></div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
