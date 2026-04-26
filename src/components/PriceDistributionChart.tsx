import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { ComposedChart, Bar, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, ReferenceLine } from 'recharts';
import { Product, HistoryRecord, getCurrencySymbol } from '../utils/parser';
import { ProductModal } from './ProductModal';
import { ChevronDown } from 'lucide-react';

interface PriceDistributionChartProps {
  products: Product[];
  domain?: string;
  history?: HistoryRecord[];
  months?: string[];
  asinToSegment?: Record<string, string>;
}

type Metric = 'sales' | 'revenue';

const METRIC_LABELS: Record<Metric, string> = {
  sales: '销量',
  revenue: '销售额',
};

/** 把当期选中的月份映射到数据里存在的「去年同期」月份（年减1，月不变，格式 YYYY-MM） */
function monthsToPreviousYearSamePeriod(currentMonths: string[], allMonths: string[]): string[] {
  const set = new Set(allMonths);
  const out: string[] = [];
  for (const m of [...currentMonths].sort()) {
    const parts = m.split('-');
    if (parts.length !== 2) continue;
    const y = parseInt(parts[0], 10);
    const mon = parts[1].padStart(2, '0');
    if (Number.isNaN(y)) continue;
    const prev = `${y - 1}-${mon}`;
    if (set.has(prev)) out.push(prev);
  }
  return out;
}

// 简单月份选择器组件
function MonthRangePicker({
  label,
  allMonths,
  selected,
  onChange,
}: {
  label: string;
  allMonths: string[];
  selected: string[];
  onChange: (m: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (m: string) => {
    if (selected.includes(m)) {
      onChange(selected.filter(x => x !== m));
    } else {
      onChange([...selected, m].sort());
    }
  };

  const selectAll = () => onChange([...allMonths]);
  const clearAll = () => onChange([]);

  const displayText = selected.length === 0
    ? '未选择'
    : selected.length === allMonths.length
    ? '全部月份'
    : selected.length <= 2
    ? selected.join(', ')
    : `${selected[0]} 等${selected.length}个月`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs border border-black/10 rounded-lg px-2.5 py-1.5 bg-white hover:bg-[#f5f5f7] transition-colors min-w-[120px] justify-between"
      >
        <span className="text-[#86868b] font-medium shrink-0">{label}:</span>
        <span className="text-[#1d1d1f] font-semibold truncate max-w-[90px]">{displayText}</span>
        <ChevronDown className="w-3 h-3 text-[#86868b] shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30 bg-white border border-black/10 rounded-xl shadow-xl p-3 w-56">
          <div className="flex justify-between mb-2">
            <button onClick={selectAll} className="text-xs text-indigo-600 hover:underline">全选</button>
            <button onClick={clearAll} className="text-xs text-rose-500 hover:underline">清空</button>
            <button onClick={() => setOpen(false)} className="text-xs text-[#86868b] hover:text-[#1d1d1f]">确定</button>
          </div>
          <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
            {allMonths.map(m => (
              <button
                key={m}
                onClick={() => toggle(m)}
                className={`text-xs px-2 py-1 rounded-lg text-left transition-colors ${
                  selected.includes(m)
                    ? 'bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200'
                    : 'bg-[#f5f5f7] text-[#86868b] hover:bg-indigo-50 hover:text-indigo-600'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 自定义 Tooltip
const CustomTooltip = ({ active, payload, label, metric, currency, hasCompare }: any) => {
  if (!active || !payload?.length) return null;
  const curr = payload.find((p: any) => p.dataKey === 'currVal');
  const comp = payload.find((p: any) => p.dataKey === 'compVal');
  const count = payload.find((p: any) => p.dataKey === 'productCount');
  const growth = payload.find((p: any) => p.dataKey === 'growthRate');

  const fmt = (v: number) => {
    if (metric === 'revenue') return `${currency}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  return (
    <div className="bg-white border border-black/10 rounded-2xl shadow-xl p-3 min-w-[160px]">
      <div className="font-bold text-[#1d1d1f] text-sm mb-2">{currency}{label}</div>
      {count && (
        <div className="flex justify-between text-xs text-[#86868b] mb-1">
          <span>ASIN数量</span>
          <span className="font-semibold text-[#1d1d1f]">{count.value}</span>
        </div>
      )}
      {curr && (
        <div className="flex justify-between text-xs text-[#86868b] mb-1">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500 inline-block"/>{METRIC_LABELS[metric as Metric]}（当期）</span>
          <span className="font-semibold text-[#1d1d1f]">{fmt(curr.value)}</span>
        </div>
      )}
      {hasCompare && comp && (
        <div className="flex justify-between text-xs text-[#86868b] mb-1">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400 inline-block"/>{METRIC_LABELS[metric as Metric]}（对比）</span>
          <span className="font-semibold text-[#1d1d1f]">{fmt(comp.value)}</span>
        </div>
      )}
      {hasCompare && growth && growth.value != null && (
        <div className="flex justify-between text-xs border-t border-black/5 pt-1 mt-1">
          <span className="text-[#86868b]">增长率</span>
          <span className={`font-bold ${growth.value >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {growth.value >= 0 ? '+' : ''}{growth.value.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
};

export const PriceDistributionChart = React.memo(function PriceDistributionChart({
  products,
  domain = 'amazon.com',
  history = [],
  months = [],
  asinToSegment = {},
}: PriceDistributionChartProps) {
  const currency = getCurrencySymbol(domain);
  const [selectedProducts, setSelectedProducts] = useState<Product[] | null>(null);
  const [step, setStep] = useState<number>(5);
  const [metric, setMetric] = useState<Metric>('sales');
  const defaultCurrMonths = useMemo(() => months.slice(-3), [months]);
  const [currMonths, setCurrMonths] = useState<string[]>([]);
  /** null=跟随当期自动算去年同期；非 null=用户手动选过的对比月（可清空） */
  const [compOverride, setCompOverride] = useState<string[] | null>(null);
  const [showCompare, setShowCompare] = useState(false);

  const resolvedCurr = currMonths.length > 0 ? currMonths : defaultCurrMonths;
  const defaultCompMonths = useMemo(
    () => monthsToPreviousYearSamePeriod(resolvedCurr, months),
    [resolvedCurr, months],
  );
  const resolvedComp = compOverride !== null ? compOverride : defaultCompMonths;

  // 构建 ASIN -> 历史数据 Map（性能优化）
  const historyMap = useMemo(() => {
    const map = new Map<string, HistoryRecord>();
    history.forEach(h => map.set(h.asin, h));
    return map;
  }, [history]);

  // 计算某组月份在某价格桶内的 sales/revenue 总和
  const buildBuckets = (targetMonths: string[]) => {
    const buckets = new Map<number, { products: Product[]; sales: number; revenue: number }>();
    products.forEach(p => {
      const idx = Math.floor(p.price / step);
      if (!buckets.has(idx)) buckets.set(idx, { products: [], sales: 0, revenue: 0 });
      const b = buckets.get(idx)!;
      b.products.push(p);
      if (targetMonths.length === 0) {
        b.sales += p.monthlySales;
        b.revenue += p.monthlyRevenue;
      } else {
        const h = historyMap.get(p.asin);
        if (h) {
          targetMonths.forEach(m => {
            const d = h.history[m];
            if (d) { b.sales += d.sales; b.revenue += d.revenue; }
          });
        }
      }
    });
    return buckets;
  };

  const hasGrowth = showCompare && resolvedComp.length > 0;

  const data = useMemo(() => {
    const currBuckets = buildBuckets(resolvedCurr);
    const compBuckets = showCompare ? buildBuckets(resolvedComp) : null;

    const allKeys = new Set([...currBuckets.keys(), ...(compBuckets ? [...compBuckets.keys()] : [])]);

    return Array.from(allKeys)
      .map(idx => {
        const cb = currBuckets.get(idx);
        const ob = compBuckets?.get(idx);

        const currVal = cb ? (metric === 'sales' ? cb.sales : cb.revenue) : 0;
        const compVal = ob ? (metric === 'sales' ? ob.sales : ob.revenue) : 0;
        const growthRate = compBuckets
          ? compVal > 0 ? ((currVal - compVal) / compVal) * 100 : currVal > 0 ? 100 : 0
          : null;

        return {
          bucket: `${idx * step}-${(idx + 1) * step}`,
          sortKey: idx,
          products: cb?.products ?? [],
          productCount: cb?.products.length ?? 0,
          currVal,
          compVal,
          growthRate,
        };
      })
      .sort((a, b) => a.sortKey - b.sortKey);
  }, [products, step, historyMap, resolvedCurr, resolvedComp, showCompare, metric]);

  // Y轴右侧：增长率范围
  const growthDomain = useMemo(() => {
    if (!hasGrowth) return [0, 100];
    const vals = data.map(d => d.growthRate ?? 0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max(20, Math.abs(max - min) * 0.2);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [data, hasGrowth]);

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>价格范围分布</CardTitle>
                <CardDescription>
                  各价格区间的ASIN数量与{METRIC_LABELS[metric]}，
                  {resolvedCurr.length > 0 ? `当期：${resolvedCurr[0]}${resolvedCurr.length > 1 ? ` ~ ${resolvedCurr[resolvedCurr.length-1]}` : ''}` : '静态数据'}
                  {hasGrowth && resolvedComp.length > 0 ? `，对比：${resolvedComp[0]}${resolvedComp.length > 1 ? ` ~ ${resolvedComp[resolvedComp.length - 1]}` : ''}` : ''}
                </CardDescription>
              </div>
              {/* 指标 & 步长 */}
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-[#86868b] font-medium">指标:</label>
                  <select
                    value={metric}
                    onChange={e => setMetric(e.target.value as Metric)}
                    className="text-xs border border-black/10 rounded-lg px-2 py-1.5 bg-[#f5f5f7] text-[#1d1d1f] focus:outline-none"
                  >
                    <option value="sales">销量</option>
                    <option value="revenue">销售额</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-[#86868b] font-medium">跨度:</label>
                  <select
                    value={step}
                    onChange={e => setStep(Number(e.target.value))}
                    className="text-xs border border-black/10 rounded-lg px-2 py-1.5 bg-[#f5f5f7] text-[#1d1d1f] focus:outline-none"
                  >
                    <option value={5}>{currency}5</option>
                    <option value={10}>{currency}10</option>
                    <option value={20}>{currency}20</option>
                    <option value={50}>{currency}50</option>
                    <option value={100}>{currency}100</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 时间选择行 */}
            <div className="flex items-center gap-3 flex-wrap">
              {months.length > 0 && (
                <MonthRangePicker
                  label="当期"
                  allMonths={months}
                  selected={currMonths.length > 0 ? currMonths : defaultCurrMonths}
                  onChange={setCurrMonths}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  if (showCompare) {
                    setShowCompare(false);
                    setCompOverride(null);
                  } else {
                    setCompOverride(null);
                    setShowCompare(true);
                  }
                }}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                  showCompare
                    ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
                    : 'bg-[#f5f5f7] text-[#86868b] border-black/10 hover:text-[#1d1d1f]'
                }`}
              >
                {showCompare ? '取消对比' : '+ 添加对比周期'}
              </button>
              {showCompare && months.length > 0 && (
                <MonthRangePicker
                  label="对比"
                  allMonths={months}
                  selected={resolvedComp}
                  onChange={setCompOverride}
                />
              )}
              {hasGrowth && (
                <div className="flex items-center gap-2 text-xs text-[#86868b]">
                  <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded"/><span>增长</span>
                  <span className="w-3 h-0.5 bg-rose-500 inline-block rounded"/><span>下降</span>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[340px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 10, right: hasGrowth ? 50 : 50, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="bucket"
                  stroke="#86868b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => `${currency}${v}`}
                />
                <YAxis
                  yAxisId="left"
                  stroke="#86868b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}
                />
                <YAxis
                  yAxisId="count"
                  orientation="right"
                  stroke="#3b82f6"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => String(Math.round(v))}
                  width={40}
                />
                {hasGrowth && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#86868b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    domain={growthDomain}
                    tickFormatter={(v: number) => `${v>0?'+':''}${v.toFixed(0)}%`}
                    width={48}
                  />
                )}
                <Tooltip
                  cursor={{ fill: '#f5f5f7' }}
                  content={<CustomTooltip metric={metric} currency={currency} hasCompare={hasGrowth} />}
                />
                <Legend verticalAlign="bottom" height={28} iconType="circle" wrapperStyle={{fontSize:'12px'}} />

                {/* 固定 ASIN 数量曲线 */}
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="productCount"
                  name="ASIN数量"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={{ r: 3, fill: '#3b82f6', stroke: 'white', strokeWidth: 1.5 }}
                  activeDot={{ r: 5 }}
                />

                {/* 当期柱 */}
                <Bar
                  yAxisId="left"
                  dataKey="currVal"
                  name={`${METRIC_LABELS[metric]}（当期）`}
                  fill="#6366f1"
                  radius={hasGrowth ? [4,4,0,0] : [4,4,0,0]}
                  barSize={hasGrowth ? 14 : 20}
                  onClick={(d: any) => setSelectedProducts(d.products)}
                  className="cursor-pointer"
                />

                {/* 对比柱 */}
                {hasGrowth && (
                  <Bar
                    yAxisId="left"
                    dataKey="compVal"
                    name={`${METRIC_LABELS[metric]}（对比）`}
                    fill="#94a3b8"
                    radius={[4,4,0,0]}
                    barSize={14}
                    onClick={(d: any) => setSelectedProducts(d.products)}
                    className="cursor-pointer"
                  />
                )}

                {/* 增长率折线 */}
                {hasGrowth && (
                  <>
                    <ReferenceLine yAxisId="right" y={0} stroke="#e5e7eb" strokeDasharray="4 4" />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="growthRate"
                      name="环比增长率"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={(props: any) => {
                        const { cx, cy, payload } = props;
                        const color = payload.growthRate >= 0 ? '#10b981' : '#ef4444';
                        return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={color} stroke="white" strokeWidth={1.5} />;
                      }}
                      activeDot={{ r: 6 }}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      {selectedProducts && (
        <ProductModal
          products={selectedProducts}
          onClose={() => setSelectedProducts(null)}
          domain={domain}
          history={history}
          months={months}
          asinToSegment={asinToSegment}
        />
      )}
    </>
  );
});