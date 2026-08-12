import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { Product, HistoryRecord, getCurrencySymbol } from '../utils/parser';
import { buildAsinPeriodStatsMap, getAsinPeriodStats } from '../utils/chartHistory';
import { formatSegmentLabel } from '../utils/subSegments';
import { Star, ExternalLink, TrendingUp, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Sparkles, Loader2, Search, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ComposedChart, Bar, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { getPrompt } from './AiPromptManager';
import { toast } from 'sonner';
import { DateRangeSelector } from './DateRangeSelector';

type SortKey = 'price' | 'monthlySales' | 'monthlyRevenue' | 'launchDate' | 'fbaFee' | 'subBsr' | 'reviewGrowth' | 'salesGrowth3m' | 'salesGrowth1y';

// 计算月销量增速：取最近N个月历史数据，用末段均值/首段均值求增速
function calcSalesGrowth(asin: string, history: HistoryRecord[], months: string[], windowMonths: number): number {
  const record = history.find(h => h.asin === asin);
  if (!record) return 0;
  const validMonths = months.filter(m => record.history[m] && record.history[m].sales > 0);
  if (validMonths.length < 2) return 0;
  const recent = validMonths.slice(-Math.min(windowMonths, validMonths.length));
  if (recent.length < 2) return 0;
  const half = Math.max(1, Math.floor(recent.length / 2));
  const firstHalf = recent.slice(0, half);
  const lastHalf = recent.slice(-half);
  const avgFirst = firstHalf.reduce((s, m) => s + record.history[m].sales, 0) / firstHalf.length;
  const avgLast = lastHalf.reduce((s, m) => s + record.history[m].sales, 0) / lastHalf.length;
  if (avgFirst === 0) return 0;
  return Math.round(((avgLast - avgFirst) / avgFirst) * 100);
}
type SortDir = 'asc' | 'desc';

function SortBtn({ col, current, dir, onClick }: { col: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void }) {
  const active = current === col;
  return (
    <button onClick={() => onClick(col)} className={`ml-1 inline-flex ${active ? 'text-indigo-600' : 'text-gray-300 hover:text-gray-500'}`}>
      {active ? (dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3" />}
    </button>
  );
}

interface TopProductsTableProps {
  products: Product[];
  history?: HistoryRecord[];
  months?: string[];
  domain?: string;
  asinToSegment?: Record<string, string>;
  asinToSubSegment?: Record<string, string>;
  asinToLevel3Segment?: Record<string, string>;
  selectedAsins?: string[];
  onToggleSelectAsin?: (asin: string) => void;
  /** 已勾选后跳转竞品对比 */
  onGoToCompetitorCompare?: () => void;
  maxSelect?: number;
}

export const TopProductsTable = React.memo(function TopProductsTable({
  products, history = [], months = [], domain = 'amazon.com', asinToSegment = {}, asinToSubSegment = {}, asinToLevel3Segment = {},
  selectedAsins = [], onToggleSelectAsin, onGoToCompetitorCompare, maxSelect = 5,
}: TopProductsTableProps) {
  const cur = getCurrencySymbol(domain);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const usePeriodStats = selectedMonths.length > 0;
  const asinPeriodStats = useMemo(
    () => (usePeriodStats ? buildAsinPeriodStatsMap(products, history, selectedMonths) : new Map()),
    [products, history, selectedMonths, usePeriodStats]
  );
  const getSales = (p: Product) => usePeriodStats ? getAsinPeriodStats(asinPeriodStats, p.asin).sales : p.monthlySales;
  const getRevenue = (p: Product) => usePeriodStats ? getAsinPeriodStats(asinPeriodStats, p.asin).revenue : p.monthlyRevenue;
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('monthlyRevenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aggregation, setAggregation] = useState<'month' | 'quarter' | 'year'>('month');
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMonths]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
    setCurrentPage(1);
  };

  // 预计算所有 ASIN 的销量增速，避免渲染时重复计算
  const salesGrowthMap = useMemo(() => {
    const map3m = new Map<string, number>();
    const map1y = new Map<string, number>();
    products.forEach(p => {
      map3m.set(p.asin, calcSalesGrowth(p.asin, history, months, 3));
      map1y.set(p.asin, calcSalesGrowth(p.asin, history, months, 12));
    });
    return { map3m, map1y };
  }, [products, history, months]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.trim().toLowerCase();
    return products.filter(p =>
      p.asin.toLowerCase().includes(q) ||
      (p.title || '').toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === 'launchDate') {
        av = a.launchDate ? new Date(a.launchDate).getTime() : 0;
        bv = b.launchDate ? new Date(b.launchDate).getTime() : 0;
      } else if (sortKey === 'salesGrowth3m') {
        av = salesGrowthMap.map3m.get(a.asin) ?? 0;
        bv = salesGrowthMap.map3m.get(b.asin) ?? 0;
      } else if (sortKey === 'salesGrowth1y') {
        av = salesGrowthMap.map1y.get(a.asin) ?? 0;
        bv = salesGrowthMap.map1y.get(b.asin) ?? 0;
      } else if (sortKey === 'monthlySales') {
        av = getSales(a); bv = getSales(b);
      } else if (sortKey === 'monthlyRevenue') {
        av = getRevenue(a); bv = getRevenue(b);
      } else {
        av = (a[sortKey as keyof Product] as number) || 0;
        bv = (b[sortKey as keyof Product] as number) || 0;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [filteredProducts, sortKey, sortDir, salesGrowthMap, asinPeriodStats, usePeriodStats]);

  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / itemsPerPage));
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedProducts.slice(start, start + itemsPerPage);
  }, [sortedProducts, currentPage]);

  const handleAiAnalysis = async (asin: string) => {
    const product = products.find(p => p.asin === asin);
    if (!product) return;
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) { toast.error('请先在「AI 设置」中配置 API Key'); return; }
    setIsAiLoading(true);
    setAiAnalysis(null);
    try {
      const record = history.find(h => h.asin === asin);
      const historyLines = record
        ? months.filter(m => record.history[m]).map(m => {
            const d = record.history[m];
            return `${m}: 销量=${d.sales}, 销售额=${cur}${Math.round(d.revenue)}, 均价=${cur}${d.sales > 0 ? (d.revenue / d.sales).toFixed(2) : (d.price ?? 0).toFixed(2)}`;
          }).join('\n')
        : '无历史数据';
      const basePrompt = getPrompt('asin_analysis') || '你是一位资深亚马逊运营专家，请对单个ASIN进行深度分析。';
      const prompt = `${basePrompt}\n\n---\n\n## 本次 ASIN 数据（请严格基于以下数据撰写）\n\n## ASIN基本信息\n- ASIN: ${product.asin}\n- 标题: ${product.title || '未知'}\n- 品牌: ${product.brand}\n- 当前价格: ${cur}${product.price.toFixed(2)}\n- 月销量: ${getSales(product).toLocaleString()}\n- 月销售额: ${cur}${Math.round(getRevenue(product)).toLocaleString()}\n- 评分: ${product.rating.toFixed(1)} (${product.reviewCount.toLocaleString()} 条评论)\n- FBA费用: ${product.fbaFee > 0 ? cur + product.fbaFee.toFixed(2) : '未知'}\n- 小类BSR: ${product.subBsr > 0 ? '#' + product.subBsr.toLocaleString() : '未知'}\n- 上架时间: ${product.launchDate || '未知'}\n\n## 历史月度数据\n${historyLines}\n\n请开始撰写分析报告：`;
      const result = await generateText(prompt, aiSettings);
      setAiAnalysis(result);
    } catch (err: any) {
      toast.error('AI分析失败: ' + (err.message || '请检查API配置'));
    } finally {
      setIsAiLoading(false);
    }
  };

  const getAsinHistoryData = (asin: string) => {
    const record = history.find(h => h.asin === asin);
    if (!record) return [];
    const rawData = months.map(month => {
      const d = record.history[month];
      const sales = d ? d.sales : 0;
      const revenue = d ? d.revenue : 0;
      const price = d ? (d.price ?? (sales > 0 ? revenue / sales : 0)) : 0;
      return { month, sales, revenue, price: parseFloat(price.toFixed(2)) };
    });
    if (aggregation === 'month') return rawData;
    const agg = new Map<string, { sales: number; revenue: number; priceSum: number; priceCount: number }>();
    rawData.forEach(item => {
      const parts = item.month.split('-');
      if (parts.length !== 2) return;
      let y = parts[0]; if (y.length === 2) y = '20' + y;
      const mn = parseInt(parts[1], 10);
      const key = aggregation === 'year' ? y : `${y}-Q${Math.ceil(mn / 3)}`;
      if (!agg.has(key)) agg.set(key, { sales: 0, revenue: 0, priceSum: 0, priceCount: 0 });
      const c = agg.get(key)!;
      c.sales += item.sales; c.revenue += item.revenue;
      if (item.price > 0) { c.priceSum += item.price; c.priceCount++; }
    });
    return Array.from(agg.entries()).map(([key, s]) => ({
      month: key, sales: s.sales, revenue: s.revenue,
      price: s.priceCount > 0 ? parseFloat((s.priceSum / s.priceCount).toFixed(2)) : 0,
    })).sort((a, b) => a.month.localeCompare(b.month));
  };

  const selectedProduct = useMemo(() => products.find(p => p.asin === selectedAsin), [products, selectedAsin]);
  const asinHistoryData = useMemo(() => selectedAsin ? getAsinHistoryData(selectedAsin) : [], [selectedAsin, history, months, aggregation]);

  const handleExportExcel = () => {
    if (products.length === 0) {
      toast.error('当前没有可导出的 ASIN 数据');
      return;
    }

    const rows = products.map((p) => ({
      ASIN: p.asin,
      品牌: p.brand,
      标题: p.title,
      主图链接: p.image,
      商品链接: `https://www.${domain}/dp/${p.asin}`,
      细分市场: asinToSegment[p.asin]
        ? formatSegmentLabel(asinToSegment[p.asin], asinToSubSegment[p.asin], asinToLevel3Segment[p.asin])
        : '未分类',
      价格: p.price,
      星级: p.rating,
      评论数: p.reviewCount,
      月销量: getSales(p),
      月销售额: getRevenue(p),
      FBA费用: p.fbaFee,
      小类BSR: p.subBsr,
      小类目: p.subCategory,
      上架时间: p.launchDate,
      评论增速: p.reviewGrowth,
      '近3月销量增速(%)': salesGrowthMap.map3m.get(p.asin) ?? 0,
      '近1年销量增速(%)': salesGrowthMap.map1y.get(p.asin) ?? 0,
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ASIN列表');
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    XLSX.writeFile(workbook, `市场大盘_ASIN列表_${y}${m}${d}.xlsx`);
    toast.success(`导出成功，共 ${rows.length} 条 ASIN`);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>ASIN 列表</CardTitle>
            <CardDescription>
              左侧勾选可加入竞品对比（最多 {maxSelect} 个）。展示市场中所有 ASIN 的详细指标
              {months.length === 0 && ' · 上传「历史表现」文件后可按时间段筛选销量/销售额'}
              {usePeriodStats && months.length > 0 && ` · 数据时段：${selectedMonths.length === 1 ? selectedMonths[0] : `${selectedMonths[0]} ~ ${selectedMonths[selectedMonths.length - 1]}`}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <DateRangeSelector
              availableMonths={months}
              onRangeChange={(selected) => {
                setSelectedMonths(selected);
                setCurrentPage(1);
              }}
            />
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={products.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f5f7] border border-black/5 rounded-lg text-xs font-medium text-[#86868b] hover:text-emerald-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" />
              导出 Excel
            </button>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#86868b]" />
              <input type="text" placeholder="搜索 ASIN / 标题 / 品牌" value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="pl-8 pr-3 py-1.5 text-xs border border-black/5 rounded-lg bg-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-indigo-300 w-56" />
            </div>
            <span className="text-xs text-[#86868b] whitespace-nowrap">第 {currentPage} / {totalPages} 页 (共 {filteredProducts.length} 个)</span>
            <div className="flex items-center bg-[#f5f5f7] rounded-lg p-1 border border-black/5">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1 hover:bg-white rounded-md disabled:opacity-30 transition-all"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1 hover:bg-white rounded-md disabled:opacity-30 transition-all"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {onToggleSelectAsin && selectedAsins.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2">
              <div className="text-xs text-indigo-800">
                已选 <strong>{selectedAsins.length}</strong> / {maxSelect} 个用于竞品对比：
                <span className="ml-1 font-mono">{selectedAsins.join('、')}</span>
              </div>
              <div className="flex gap-2">
                {onGoToCompetitorCompare && (
                  <button
                    type="button"
                    onClick={onGoToCompetitorCompare}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                  >
                    去竞品对比
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-[#86868b]">
              <thead className="text-xs text-[#1d1d1f] uppercase bg-[#f5f5f7] border-b border-black/5">
                <tr>
                  {onToggleSelectAsin && <th className="px-2 py-3 w-10 text-center text-[10px] normal-case tracking-normal text-indigo-700">对比</th>}
                  <th className="px-4 py-3 font-medium min-w-[320px]">产品</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">细分市场</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">价格<SortBtn col="price" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">星级</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">评分</th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">销量<SortBtn col="monthlySales" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">销售额<SortBtn col="monthlyRevenue" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">FBA费用<SortBtn col="fbaFee" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">小类BSR<SortBtn col="subBsr" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                  <th className="px-4 py-3 font-medium text-center whitespace-nowrap">上架时间<SortBtn col="launchDate" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">评论增速<SortBtn col="reviewGrowth" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">近3月销量增速<SortBtn col="salesGrowth3m" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                  <th className="px-4 py-3 font-medium text-right whitespace-nowrap">近1年销量增速<SortBtn col="salesGrowth1y" current={sortKey} dir={sortDir} onClick={handleSort}/></th>
                  <th className="px-4 py-3 font-medium text-center whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedProducts.map(product => (
                  <tr key={product.asin} className="border-b border-black/5 hover:bg-[#f5f5f7]/50 transition-colors">
                    {onToggleSelectAsin && (
                      <td className="px-2 py-3">
                        <input
                          type="checkbox"
                          checked={selectedAsins.includes(product.asin)}
                          onChange={() => onToggleSelectAsin(product.asin)}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-3">
                        {product.image
                          ? <img src={product.image} alt={product.title} className="w-12 h-12 rounded-lg object-cover border border-black/5 shrink-0" referrerPolicy="no-referrer" />
                          : <div className="w-12 h-12 rounded-lg bg-[#f5f5f7] border border-black/5 flex items-center justify-center text-xs text-[#86868b] shrink-0">无图</div>}
                        <div className="min-w-0">
                          <div className="font-medium text-[#1d1d1f] truncate max-w-[240px]" title={product.title}>{product.title}</div>
                          <div className="text-xs text-[#86868b] flex items-center space-x-2 mt-1">
                            <span className="font-mono bg-[#f5f5f7] px-1 py-0.5 rounded text-[10px]">{product.asin}</span>
                            <a href={`https://www.${domain}/dp/${product.asin}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800"><ExternalLink className="w-3 h-3" /></a>
                            <span>{product.brand}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {asinToSegment[product.asin]
                        ? <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-medium whitespace-nowrap">{formatSegmentLabel(asinToSegment[product.asin], asinToSubSegment[product.asin], asinToLevel3Segment[product.asin])}</span>
                        : <span className="text-[10px] text-[#86868b]">未分类</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{cur}{product.price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end space-x-1">
                        <span className="font-medium text-[#1d1d1f]">{product.rating.toFixed(1)}</span>
                        <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">{product.reviewCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{getSales(product).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">{cur}{Math.round(getRevenue(product)).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{product.fbaFee > 0 ? `${cur}${product.fbaFee.toFixed(2)}` : '-'}</td>
                    <td className="px-4 py-3 text-right">
                      {product.subBsr > 0 ? (<div><span className="font-medium">#{product.subBsr.toLocaleString()}</span>
                        {product.subCategory && <span className="block text-[10px] text-[#86868b] truncate max-w-[80px]" title={product.subCategory}>{product.subCategory}</span>}</div>) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center"><span className="text-xs text-[#86868b]">{product.launchDate || '未知'}</span></td>
                    <td className="px-4 py-3 text-right">
                      {product.reviewGrowth > 0 ? (
                        <span className="text-emerald-600 font-medium text-xs">+{product.reviewGrowth.toFixed(1)}/月</span>
                      ) : product.reviewGrowth < 0 ? (
                        <span className="text-rose-500 font-medium text-xs">{product.reviewGrowth.toFixed(1)}/月</span>
                      ) : <span className="text-[#86868b] text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const g = salesGrowthMap.map3m.get(product.asin) ?? 0;
                        if (g === 0) return <span className="text-[#86868b] text-xs">-</span>;
                        return <span className={`font-semibold text-xs ${g > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{g > 0 ? '+' : ''}{g}%</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const g = salesGrowthMap.map1y.get(product.asin) ?? 0;
                        if (g === 0) return <span className="text-[#86868b] text-xs">-</span>;
                        return <span className={`font-semibold text-xs ${g > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{g > 0 ? '+' : ''}{g}%</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => { setSelectedAsin(product.asin); setAiAnalysis(null); }}
                        className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 p-1.5 rounded-lg transition-colors" title="深度分析">
                        <TrendingUp className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Deep Dive Modal */}
      {selectedAsin && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-black/5 flex items-center justify-between gap-4 bg-[#f5f5f7]/50">
              <div className="flex items-center space-x-4 min-w-0">
                {selectedProduct.image && <img src={selectedProduct.image} alt={selectedProduct.title} className="w-16 h-16 rounded-xl object-cover border border-black/5 shadow-sm shrink-0" referrerPolicy="no-referrer" />}
                <div className="min-w-0">
                  <h3 className="text-xl font-bold text-[#1d1d1f] flex items-center gap-2 flex-wrap">
                    <span>ASIN 深度分析:</span>
                    <span className="font-mono text-indigo-600">{selectedAsin}</span>
                    <a href={`https://www.${domain}/dp/${selectedAsin}`} target="_blank" rel="noopener noreferrer" className="text-[#86868b] hover:text-indigo-600"><ExternalLink className="w-5 h-5" /></a>
                  </h3>
                  <p className="text-sm text-[#86868b] mt-1 truncate" title={selectedProduct.title}>{selectedProduct.title}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <label className="text-xs text-[#86868b] font-medium">聚合:</label>
                <select value={aggregation} onChange={e => setAggregation(e.target.value as 'month' | 'quarter' | 'year')}
                  className="text-sm border border-black/5 rounded-lg px-2 py-1 bg-[#f5f5f7] focus:outline-none">
                  <option value="month">月</option><option value="quarter">季度</option><option value="year">年</option>
                </select>
                <button onClick={() => setSelectedAsin(null)} className="p-2 text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/5 rounded-full"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                {[{label:'当前价格', val:`${cur}${selectedProduct.price.toFixed(2)}`},
                  {label:'星级', val:`${selectedProduct.rating.toFixed(1)} ★`},
                  {label:'评论数', val:selectedProduct.reviewCount.toLocaleString()},
                  {label:'月销量', val:getSales(selectedProduct).toLocaleString()},
                  {label:'月销售额', val:`${cur}${Math.round(getRevenue(selectedProduct)).toLocaleString()}`, green:true},
                  {label:'FBA费用', val:selectedProduct.fbaFee > 0 ? `${cur}${selectedProduct.fbaFee.toFixed(2)}` : '-'},
                ].map(item => (
                  <div key={item.label} className="bg-[#f5f5f7] p-4 rounded-2xl border border-black/5">
                    <div className="text-xs text-[#86868b] mb-1 uppercase tracking-wider">{item.label}</div>
                    <div className={`text-lg font-semibold ${item.green ? 'text-emerald-600' : 'text-[#1d1d1f]'}`}>{item.val}</div>
                  </div>
                ))}
              </div>

              
              {/* AI Analysis */}
              <div className="mb-6">
                <button onClick={() => handleAiAnalysis(selectedAsin!)} disabled={isAiLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl text-sm font-semibold hover:from-indigo-700 hover:to-violet-700 transition-all shadow-md disabled:opacity-60">
                  {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
                  {isAiLoading ? 'AI 分析中...' : 'AI 深度分析'}
                </button>
                {aiAnalysis && (
                  <div className="mt-4 p-4 bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-2xl text-sm text-[#1d1d1f] leading-relaxed whitespace-pre-wrap">{aiAnalysis}</div>
                )}
              </div>

              {asinHistoryData.length > 0 ? (
                <div>
                  <h4 className="text-md font-semibold text-[#1d1d1f] mb-4">历史趋势（销量 / 销售额 / 价格）</h4>
                  <div className="h-[420px] w-full border border-black/5 rounded-2xl p-4 bg-white shadow-sm">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={asinHistoryData} margin={{ top: 10, right: 55, left: 0, bottom: 0 }}>
                        <XAxis dataKey="month" stroke="#86868b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => v.substring(2)} />
                        <YAxis yAxisId="rev" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${cur}${(v/1000).toFixed(0)}k`} />
                        <YAxis yAxisId="sales" orientation="right" stroke="#10b981" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis yAxisId="price" orientation="right" stroke="#f59e0b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${cur}${v}`} width={55} />
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <Tooltip contentStyle={{ borderRadius:'12px', border:'none', boxShadow:'0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: number, name: string) => {
                            if (name === '销售额') return [`${cur}${Math.round(value).toLocaleString()}`, name];
                            if (name === '价格') return [`${cur}${value.toFixed(2)}`, name];
                            return [value.toLocaleString(), name];
                          }} />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                        <Bar yAxisId="sales" dataKey="sales" name="销量" fill="#10b981" radius={[4,4,0,0]} barSize={24} />
                        <Line yAxisId="rev" type="monotone" dataKey="revenue" name="销售额" stroke="#4f46e5" strokeWidth={2.5} dot={{ r:3, fill:'#4f46e5', stroke:'#fff', strokeWidth:2 }} activeDot={{ r:5 }} />
                        <Line yAxisId="price" type="monotone" dataKey="price" name="价格" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" dot={{ r:3, fill:'#f59e0b', stroke:'#fff', strokeWidth:2 }} activeDot={{ r:5 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-[#86868b] bg-[#f5f5f7] rounded-2xl border border-black/5">
                  <TrendingUp className="w-12 h-12 mb-4 text-zinc-300" />
                  <p>未找到该ASIN的历史数据</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
});
