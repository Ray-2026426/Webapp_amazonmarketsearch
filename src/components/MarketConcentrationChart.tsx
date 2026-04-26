import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { ComposedChart, Bar, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, ReferenceLine } from 'recharts';
import { Product, HistoryRecord, getCurrencySymbol } from '../utils/parser';
import { BarChart2, HelpCircle } from 'lucide-react';

interface Props {
  products: Product[];
  history: HistoryRecord[];
  months: string[];
  domain?: string;
}

const HHI_LEVELS = [
  { label: '分散市场', max: 1000, color: '#10b981', desc: '竞争充分，易进入' },
  { label: '中等集中', max: 1800, color: '#f59e0b', desc: '中等壁垒' },
  { label: '高度集中', max: 10000, color: '#ef4444', desc: '寡头垄断，难进入' },
];

function getHhiLevel(hhi: number) {
  return HHI_LEVELS.find(l => hhi <= l.max) ?? HHI_LEVELS[HHI_LEVELS.length - 1];
}

const HHI_EXPLANATION = `HHI（赫芬达尔-赫希曼指数）是衡量市场集中度的标准指标。\n\n计算方法：将市场中每个品牌的销售额份额（%）平方后求和。\n\n判断标准：\n• HHI < 1000：分散市场，竞争充分\n• 1000 ≤ HHI < 1800：中等集中，存在壁垒\n• HHI ≥ 1800：高度集中，寡头垄断`;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const hhi = payload.find((p: any) => p.dataKey === 'hhi');
  const top3 = payload.find((p: any) => p.dataKey === 'top3Share');
  const top5 = payload.find((p: any) => p.dataKey === 'top5Share');
  const top10 = payload.find((p: any) => p.dataKey === 'top10Share');
  const level = hhi ? getHhiLevel(hhi.value) : null;
  return (
    <div className="bg-white border border-black/10 rounded-2xl shadow-xl p-3 min-w-[190px]">
      <div className="font-bold text-sm text-[#1d1d1f] mb-2">{label}</div>
      <div className="space-y-1 text-xs">
        {hhi && <div className="flex justify-between gap-4"><span className="text-[#86868b]">HHI指数</span><span className="font-bold" style={{color:level?.color}}>{Math.round(hhi.value)} ({level?.label})</span></div>}
        {top3 && <div className="flex justify-between gap-4"><span className="text-[#86868b]">Top3品牌份额</span><span className="font-semibold">{top3.value.toFixed(1)}%</span></div>}
        {top5 && <div className="flex justify-between gap-4"><span className="text-[#86868b]">Top5品牌份额</span><span className="font-semibold">{top5.value.toFixed(1)}%</span></div>}
        {top10 && <div className="flex justify-between gap-4"><span className="text-[#86868b]">Top10品牌份额</span><span className="font-semibold">{top10.value.toFixed(1)}%</span></div>}
      </div>
    </div>
  );
};

export const MarketConcentrationChart = React.memo(function MarketConcentrationChart({ products, history, months, domain = 'amazon.com' }: Props) {
  const [showHint, setShowHint] = useState(false);
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());

  const toggleLine = (key: string) => {
    setHiddenLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const data = useMemo(() => {
    return months.map(m => {
      // 计算每个品牌当月销售额
      const brandRevMap = new Map<string, number>();
      let totalRev = 0;
      history.forEach(h => {
        const p = products.find(x => x.asin === h.asin);
        const d = h.history[m];
        if (!d || !p) return;
        brandRevMap.set(p.brand, (brandRevMap.get(p.brand) ?? 0) + d.revenue);
        totalRev += d.revenue;
      });
      if (totalRev === 0) return null;

      const shares = Array.from(brandRevMap.values())
        .map(v => (v / totalRev) * 100)
        .sort((a, b) => b - a);

      // HHI = sum of squared market shares (in %)
      const hhi = shares.reduce((s, sh) => s + sh * sh, 0);
      const top3Share = shares.slice(0, 3).reduce((s, v) => s + v, 0);
      const top5Share = shares.slice(0, 5).reduce((s, v) => s + v, 0);
      const top10Share = shares.slice(0, 10).reduce((s, v) => s + v, 0);

      return {
        month: m.substring(2),
        hhi: parseFloat(hhi.toFixed(1)),
        top3Share: parseFloat(top3Share.toFixed(1)),
        top5Share: parseFloat(top5Share.toFixed(1)),
        top10Share: parseFloat(top10Share.toFixed(1)),
      };
    }).filter(Boolean);
  }, [history, months, products]);

  // 最新月数据摘要
  const latest = data[data.length - 1] as any;
  const latestLevel = latest ? getHhiLevel(latest.hhi) : null;

  if (data.length === 0) return null;

  const LINE_CONFIG = [
    { key: 'top3Share', label: 'Top3份额', color: '#f59e0b' },
    { key: 'top5Share', label: 'Top5份额', color: '#3b82f6' },
    { key: 'top10Share', label: 'Top10份额', color: '#10b981' },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-violet-500"/>
              市场集中度趋势
              <div className="relative inline-block">
                <button onMouseEnter={()=>setShowHint(true)} onMouseLeave={()=>setShowHint(false)} onClick={()=>setShowHint(v=>!v)}
                  className="w-5 h-5 rounded-full bg-[#f5f5f7] border border-black/10 flex items-center justify-center text-[#86868b] hover:text-indigo-600 hover:border-indigo-300 transition-colors">
                  <HelpCircle className="w-3.5 h-3.5"/>
                </button>
                {showHint && (
                  <div className="absolute left-6 top-0 z-50 bg-white border border-black/10 rounded-2xl shadow-2xl p-4 w-72 text-xs text-[#1d1d1f] leading-relaxed whitespace-pre-line">
                    {HHI_EXPLANATION}
                  </div>
                )}
              </div>
            </CardTitle>
            <CardDescription>HHI指数月度变化 + Top3/Top5/Top10品牌份额，判断市场是否在垄断化</CardDescription>
          </div>
          {latest && latestLevel && (
            <div className="text-right">
              <div className="text-xs text-[#86868b]">当前HHI</div>
              <div className="text-xl font-bold" style={{color: latestLevel.color}}>{Math.round(latest.hhi)}</div>
              <div className="text-xs font-medium" style={{color: latestLevel.color}}>{latestLevel.label} · {latestLevel.desc}</div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-4 mt-3">
          {HHI_LEVELS.map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{background: l.color}}/>
              <span className="text-xs text-[#86868b]">{l.label}</span>
              <span className="text-xs text-[#1d1d1f]">{l === HHI_LEVELS[0] ? '<1000' : l === HHI_LEVELS[1] ? '1000-1800' : '>1800'}</span>
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{top:10, right:10, left:-10, bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
              <XAxis dataKey="month" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}/>
              <YAxis yAxisId="hhi" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                label={{value:'HHI', angle:-90, position:'insideLeft', offset:16, fontSize:11, fill:'#86868b'}}/>
              <YAxis yAxisId="share" orientation="right" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}
                tickFormatter={(v:number)=>`${v}%`} domain={[0,100]}/>
              <ReferenceLine yAxisId="hhi" y={1000} stroke="#10b981" strokeDasharray="4 3" strokeOpacity={0.7}
                label={{value:'1000 分散', position:'right', fontSize:10, fill:'#10b981'}}/>
              <ReferenceLine yAxisId="hhi" y={1800} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.7}
                label={{value:'1800 集中', position:'right', fontSize:10, fill:'#ef4444'}}/>
              <Tooltip content={<CustomTooltip/>}/>
              <Bar yAxisId="hhi" dataKey="hhi" name="HHI指数" fill="#8b5cf6" fillOpacity={0.25} radius={[3,3,0,0]} barSize={10} hide={hiddenLines.has('hhi')}/>
              <Line yAxisId="hhi" type="monotone" dataKey="hhi" name="HHI指数" stroke="#8b5cf6" strokeWidth={2.5}
                dot={{r:3,fill:'#8b5cf6',stroke:'white',strokeWidth:1.5}} activeDot={{r:5}} hide={hiddenLines.has('hhi')}/>
              {LINE_CONFIG.map(lc => (
                <Line key={lc.key} yAxisId="share" type="monotone" dataKey={lc.key} name={lc.label}
                  stroke={lc.color} strokeWidth={2} strokeDasharray="5 3"
                  dot={{r:3,fill:lc.color,stroke:'white',strokeWidth:1.5}} activeDot={{r:5}}
                  hide={hiddenLines.has(lc.key)}/>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {[{key:'hhi',label:'HHI指数',color:'#8b5cf6'},...LINE_CONFIG].map(lc => (
            <button key={lc.key} onClick={()=>toggleLine(lc.key)}
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-colors ${
                hiddenLines.has(lc.key) ? 'opacity-40 border-black/5 bg-[#f5f5f7]' : 'border-black/10 bg-white hover:bg-[#f5f5f7]'
              }`}>
              <span className="w-3 h-0.5 rounded" style={{background:lc.color,opacity:hiddenLines.has(lc.key)?0.3:1}}/>
              <span className={hiddenLines.has(lc.key)?'line-through text-[#86868b]':'text-[#1d1d1f]'}>{lc.label}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
});

