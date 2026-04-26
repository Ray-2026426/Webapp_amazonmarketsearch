import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { Plus, Trash2, Calculator, Globe, Save } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, ReferenceLine, Cell, PieChart, Pie } from 'recharts';

interface Variant {
  id: string;
  name: string;
  monthlySales: number;
  price: number;
  procurementCost: number;
  shippingCost: number;
  storageFee: number;
  refundRate: number;
  commissionRate: number;
  fbaFee: number;
  otherCost: number;
  cvr: number;
  cpc: number;
  adOrderShare: number;
}

/** 默认：仓储费 = 当地币种售价 × 该比例；仓储费在界面与计算中按 1 位小数四舍五入 */
const DEFAULT_STORAGE_PCT = 0.015;

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

const COUNTRIES = [
  { code: 'US', name: '美国', currency: '$', rmbRate: 7.2 },
  { code: 'UK', name: '英国', currency: '£', rmbRate: 9.1 },
  { code: 'EU', name: '欧洲', currency: '€', rmbRate: 7.8 },
  { code: 'JP', name: '日本', currency: '¥', rmbRate: 0.048 },
  { code: 'CA', name: '加拿大', currency: 'C$', rmbRate: 5.3 },
  { code: 'AU', name: '澳大利亚', currency: 'A$', rmbRate: 4.7 },
];

const DEFAULT_LIST_PRICE = 29.99;
const DEFAULT_VARIANT: Omit<Variant, 'id'> = {
  name: '默认变体', monthlySales: 300, price: DEFAULT_LIST_PRICE,
  procurementCost: 36, shippingCost: 2, storageFee: round1(DEFAULT_LIST_PRICE * DEFAULT_STORAGE_PCT),
  refundRate: 3, commissionRate: 15, fbaFee: 4.5,
  otherCost: 0, cvr: 10, cpc: 1, adOrderShare: 30,
};

const COST_COLORS: Record<string, string> = {
  '采购': '#6366f1', '头程': '#3b82f6', 'FBA': '#8b5cf6',
  '仓储': '#14b8a6', '佣金': '#ec4899', '广告': '#f59e0b',
  '退款': '#ef4444', '其他': '#94a3b8', '净利润': '#10b981', '亏损': '#ef4444',
};

function calcVariant(v: Variant, rmbRate: number) {
  const storage = round1(v.storageFee);
  const procLocal = v.procurementCost / rmbRate;
  const commission = v.price * (v.commissionRate / 100);
  const refundCost = v.price * (v.refundRate / 100);
  const adCostPerOrder = v.cvr > 0 ? v.cpc / (v.cvr / 100) : 0;
  const adCostPerItem = adCostPerOrder * (v.adOrderShare / 100);
  const acos = v.price > 0 ? (adCostPerItem / v.price) * 100 : 0;
  const totalCost = procLocal + v.shippingCost + v.fbaFee + storage + commission + refundCost + adCostPerItem + v.otherCost;
  const profit = v.price - totalCost;
  const margin = v.price > 0 ? (profit / v.price) * 100 : 0;
  const monthlyProfit = profit * v.monthlySales;
  /** 月销售额（元）：自然单 + 广告单，不剔除任何来源 */
  const monthlySalesRevenue = v.price * v.monthlySales;
  const adOrders = Math.round(v.monthlySales * (v.adOrderShare / 100));
  const organicOrders = v.monthlySales - adOrders;
  /** 月度广告总花费 = 每件上摊分的广告费 × 全月销量（与 P&L 中广告线一致，避免用「广告单数取整」产生偏差） */
  const totalAdSpend = adCostPerItem * v.monthlySales;
  const tacos =
    monthlySalesRevenue > 0 ? (totalAdSpend / monthlySalesRevenue) * 100 : 0;
  const fixedCost = procLocal + v.shippingCost + v.fbaFee + storage + v.otherCost;
  const breakEvenPrice = (1 - v.commissionRate/100 - v.refundRate/100 - acos/100) > 0
    ? fixedCost / (1 - v.commissionRate/100 - v.refundRate/100 - acos/100) : 0;
  const safetyMargin = v.price > 0 ? ((v.price - breakEvenPrice) / v.price) * 100 : 0;
  const costBreakdown = [
    { name: '采购', value: procLocal },
    { name: '头程', value: v.shippingCost },
    { name: 'FBA', value: v.fbaFee },
    { name: '仓储', value: storage },
    { name: '佣金', value: commission },
    { name: '广告', value: adCostPerItem },
    { name: '退款', value: refundCost },
    { name: '其他', value: v.otherCost },
    { name: profit >= 0 ? '净利润' : '亏损', value: Math.abs(profit) },
  ].filter(c => c.value > 0.001);
  return { ...v, procLocal, commission, refundCost, adCostPerOrder, adCostPerItem, acos, tacos,
    totalCost, profit, margin, monthlyProfit, monthlyRevenue: monthlySalesRevenue, adOrders, organicOrders,
    totalAdSpend, breakEvenPrice, safetyMargin, costBreakdown };
}

const InputField = ({ label, value, onChange, step = '0.01' }: { label: string; value: number; onChange: (v: string) => void; step?: string }) => (
  <div className="space-y-1">
    <label className="text-xs text-[#86868b] font-medium block">{label}</label>
    <input type="number" step={step} value={value} onChange={e => onChange(e.target.value)}
      className="w-full border border-black/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"/>
  </div>
);

export const ProfitCalculator = React.memo(function ProfitCalculator() {
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [rmbRate, setRmbRate] = useState(COUNTRIES[0].rmbRate);
  const [variants, setVariants] = useState<Variant[]>([{ id: '1', ...DEFAULT_VARIANT }]);
  const [savedPlans, setSavedPlans] = useState<{ name: string; variants: Variant[]; country: string; rmbRate: number; savedAt: string; variantCount: number }[]>([]);
  const [planName, setPlanName] = useState('');
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'breakeven'>('input');

  useEffect(() => {
    try { const s = localStorage.getItem('profit_calc_plans'); if (s) setSavedPlans(JSON.parse(s)); } catch {}
  }, []);

  const savePlan = () => {
    if (!planName.trim()) return;
    const plans = [...savedPlans, { name: planName.trim(), variants, country: country.code, rmbRate, savedAt: new Date().toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}), variantCount: variants.length }];
    setSavedPlans(plans);
    localStorage.setItem('profit_calc_plans', JSON.stringify(plans));
    setPlanName(''); setShowSavePanel(false);
  };

  const loadPlan = (p: typeof savedPlans[0]) => {
    setVariants(p.variants.map((v) => ({ ...v, storageFee: round1(v.storageFee) })));
    setRmbRate(p.rmbRate);
    const c = COUNTRIES.find(x => x.code === p.country); if (c) setCountry(c);
  };

  const deletePlan = (i: number) => {
    const plans = savedPlans.filter((_, j) => j !== i);
    setSavedPlans(plans); localStorage.setItem('profit_calc_plans', JSON.stringify(plans));
  };

  const addVariant = () => setVariants([...variants, { id: Date.now().toString(), ...DEFAULT_VARIANT, name: `变体 ${variants.length + 1}`, monthlySales: 100 }]);
  const removeVariant = (id: string) => { if (variants.length > 1) setVariants(variants.filter(v => v.id !== id)); };
  const updateVariant = (id: string, field: keyof Variant, value: string) => {
    setVariants(variants.map(v => {
      if (v.id !== id) return v;
      if (field === 'name') return { ...v, name: value };
      const n = value === '' ? 0 : parseFloat(value);
      if (isNaN(n)) return { ...v, [field]: 0 };
      if (field === 'storageFee') return { ...v, storageFee: round1(n) };
      return { ...v, [field]: n };
    }));
  };

  const results = useMemo(() => {
    const vr = variants.map(v => calcVariant(v, rmbRate));
    const totalSales = vr.reduce((s, v) => s + v.monthlySales, 0);
    const totalMonthlyProfit = vr.reduce((s, v) => s + v.monthlyProfit, 0);
    const totalMonthlyRevenue = vr.reduce((s, v) => s + v.monthlyRevenue, 0);
    const totalAdSpend = vr.reduce((s, v) => s + v.totalAdSpend, 0);
    const parentMargin = totalMonthlyRevenue > 0 ? (totalMonthlyProfit / totalMonthlyRevenue) * 100 : 0;
    const parentTacos = totalMonthlyRevenue > 0 ? (totalAdSpend / totalMonthlyRevenue) * 100 : 0;
    const w = (key: keyof ReturnType<typeof calcVariant>) =>
      totalSales > 0 ? vr.reduce((s, v) => s + (v[key] as number) * v.monthlySales, 0) / totalSales : 0;
    const avgPrice = w('price');
    const cvrRange = [2,4,6,8,10,12,15,20].map(cvr => {
      const av = variants.map(v => calcVariant({...v, cvr}, rmbRate));
      const rev = av.reduce((s,v)=>s+v.monthlyRevenue,0);
      const prt = av.reduce((s,v)=>s+v.monthlyProfit,0);
      return { cvr: `${cvr}%`, margin: rev>0 ? parseFloat(((prt/rev)*100).toFixed(1)) : 0 };
    });
    const priceRange = [-20,-15,-10,-5,0,5,10,15,20].map(delta => {
      const av = variants.map(v => calcVariant({...v, price: Math.max(0.01, v.price*(1+delta/100))}, rmbRate));
      const rev = av.reduce((s,v)=>s+v.monthlyRevenue,0);
      const prt = av.reduce((s,v)=>s+v.monthlyProfit,0);
      return { label: `${delta>0?'+':''}${delta}%`, margin: rev>0 ? parseFloat(((prt/rev)*100).toFixed(1)) : 0 };
    });
    const buildParentCostDisplay = () => {
      if (vr.length === 0) return [] as { name: string; value: number; pctOfRevenue: number }[];
      if (vr.length === 1) {
        const v = vr[0];
        return v.costBreakdown.map((c) => ({
          name: c.name,
          value: c.value,
          pctOfRevenue: v.price > 0 ? (c.value / v.price) * 100 : 0,
        }));
      }
      const merged = new Map<string, number>();
      vr.forEach((v) => v.costBreakdown.forEach((c) => {
        merged.set(c.name, (merged.get(c.name) ?? 0) + c.value * v.monthlySales);
      }));
      return Array.from(merged.entries()).map(([name, monthlyTotal]) => ({
        name,
        value: totalSales > 0 ? monthlyTotal / totalSales : 0,
        pctOfRevenue: totalMonthlyRevenue > 0 ? (monthlyTotal / totalMonthlyRevenue) * 100 : 0,
      }));
    };
    const parentCostDisplay = buildParentCostDisplay();

    return { vr, totalSales, totalMonthlyProfit, totalMonthlyRevenue, totalAdSpend, parentMargin, parentTacos, avgPrice, cvrRange, priceRange, parentCostDisplay };
  }, [variants, rmbRate]);

  const cur = country.currency;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl"><Calculator className="w-6 h-6"/></div>
          <div>
            <h2 className="text-xl font-semibold text-[#1d1d1f]">利润计算器</h2>
            <p className="text-sm text-[#86868b]">多变体成本结构 · 广告效率 · 父体综合利润率</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5" title="用于把「采购成本(人民币)」换算为站点当地币种：1 美元 ≈ 7.2 人民币 即填 7.2">
            <span className="text-xs text-[#86868b] whitespace-nowrap">1{cur} ≈</span>
            <input type="number" step="0.01" value={rmbRate} onChange={e => setRmbRate(parseFloat(e.target.value)||rmbRate)}
              className="w-16 text-sm border border-black/10 rounded-lg px-2 py-1.5 focus:outline-none"/>
            <span className="text-xs text-[#86868b]">人民币(¥)</span>
          </div>
          <select value={country.code} onChange={e => { const c=COUNTRIES.find(x=>x.code===e.target.value)!; setCountry(c); setRmbRate(c.rmbRate); }}
            className="border border-black/10 rounded-lg px-3 py-2 bg-white text-sm focus:outline-none">
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name} ({c.currency})</option>)}
          </select>
          <button onClick={()=>setShowSavePanel(v=>!v)} className="flex items-center gap-1.5 border border-black/10 rounded-xl px-3 py-2 text-sm hover:bg-[#f5f5f7]">
            <Save className="w-4 h-4"/><span>存档</span>
          </button>
          <button onClick={addVariant} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            <Plus className="w-4 h-4"/><span>添加变体</span>
          </button>
        </div>
      </div>

      {/* 存档面板 */}
      {showSavePanel && (
        <div className="bg-white border border-black/10 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center gap-3 mb-3">
            <input value={planName} onChange={e=>setPlanName(e.target.value)} placeholder="输入方案名称..."
              className="flex-1 border border-black/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none"/>
            <button onClick={savePlan} disabled={!planName.trim()} className="bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40">保存</button>
          </div>
          {savedPlans.length>0 && <div className="space-y-2">
            <div className="text-xs text-[#86868b] font-medium">已保存方案</div>
            {savedPlans.map((p,i) => (
              <div key={i} className="flex items-center justify-between bg-[#f5f5f7] rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-[#86868b] mt-0.5 flex items-center gap-2">
                    <span>{(p as any).savedAt || '未知时间'}</span>
                    <span>·</span>
                    <span>{(p as any).variantCount ?? p.variants.length} 个变体</span>
                  </div>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button onClick={()=>loadPlan(p)} className="text-xs text-indigo-600 hover:underline">加载</button>
                  <button onClick={()=>deletePlan(i)} className="text-xs text-rose-500 hover:underline">删除</button>
                </div>
              </div>
            ))}
          </div>}
        </div>
      )}

      {/* Tab */}
      <div className="flex gap-1 bg-[#f5f5f7] rounded-xl p-1 w-fit">
        {(['input','breakeven'] as const).map(tab => (
          <button key={tab} onClick={()=>setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab===tab?'bg-white text-[#1d1d1f] shadow-sm':'text-[#86868b] hover:text-[#1d1d1f]'
            }`}>{tab==='input'?'输入参数':'盈亏分析'}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">

          {/* 输入参数 Tab */}
          {activeTab==='input' && results.vr.map(v => (
            <Card key={v.id} className="overflow-hidden border-emerald-100/50">
              <div className="bg-emerald-50/50 px-4 py-3 border-b border-emerald-100/50 flex items-center justify-between">
                <input type="text" value={v.name} onChange={e=>updateVariant(v.id,'name',e.target.value)}
                  className="font-medium text-emerald-900 bg-transparent border-none focus:outline-none p-0 text-base"/>
                <button onClick={()=>removeVariant(v.id)} disabled={variants.length<=1} className="text-emerald-600/50 hover:text-rose-500 disabled:opacity-30"><Trash2 className="w-4 h-4"/></button>
              </div>
              <CardContent className="p-4 space-y-4">
                <div className="text-xs font-semibold text-[#86868b] uppercase tracking-wide">基本信息</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <InputField label="月销量（件）" value={v.monthlySales} step="1" onChange={val=>updateVariant(v.id,'monthlySales',val)}/>
                  <InputField label={`售价 (${cur})`} value={v.price} onChange={val=>updateVariant(v.id,'price',val)}/>
                  <InputField label="采购成本 (¥)" value={v.procurementCost} onChange={val=>updateVariant(v.id,'procurementCost',val)}/>
                  <InputField label={`头程运费 (${cur})`} value={v.shippingCost} onChange={val=>updateVariant(v.id,'shippingCost',val)}/>
                </div>
                <div className="text-xs font-semibold text-[#86868b] uppercase tracking-wide">平台费用</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <InputField label={`FBA费用 (${cur})`} value={v.fbaFee} onChange={val=>updateVariant(v.id,'fbaFee',val)}/>
                  <InputField label={`仓储费 (${cur}，默认定价×1.5%)`} value={v.storageFee} step="0.1" onChange={val=>updateVariant(v.id,'storageFee',val)}/>
                  <InputField label="平台佣金 (%)" value={v.commissionRate} onChange={val=>updateVariant(v.id,'commissionRate',val)}/>
                  <InputField label="退款率 (%)" value={v.refundRate} onChange={val=>updateVariant(v.id,'refundRate',val)}/>
                </div>
                <div className="text-xs font-semibold text-[#86868b] uppercase tracking-wide">广告参数</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <InputField label="广告CVR (%)" value={v.cvr} onChange={val=>updateVariant(v.id,'cvr',val)}/>
                  <InputField label={`CPC (${cur})`} value={v.cpc} onChange={val=>updateVariant(v.id,'cpc',val)}/>
                  <InputField label="广告订单占比 (%)" value={v.adOrderShare} onChange={val=>updateVariant(v.id,'adOrderShare',val)}/>
                  <InputField label={`其他成本 (${cur})`} value={v.otherCost} onChange={val=>updateVariant(v.id,'otherCost',val)}/>
                </div>
                <div className="pt-3 border-t border-black/5 grid grid-cols-4 md:grid-cols-7 gap-3">
                  {[
                    {l:'单件广告费',val:`${cur}${v.adCostPerItem.toFixed(2)}`},
                    {l:'ACOS',val:`${v.acos.toFixed(1)}%`},
                    {l:'TACos',val:`${v.tacos.toFixed(1)}%`},
                    {l:'总成本',val:`${cur}${v.totalCost.toFixed(2)}`},
                    {l:'单件净利',val:`${cur}${v.profit.toFixed(2)}`,c:v.profit>=0?'text-emerald-600':'text-rose-600'},
                    {l:'毛利率',val:`${v.margin.toFixed(1)}%`,c:v.margin>=0?'text-emerald-600':'text-rose-600',b:true},
                    {l:'月净利润',val:`${cur}${Math.round(v.monthlyProfit).toLocaleString()}`,c:v.monthlyProfit>=0?'text-emerald-600':'text-rose-600',b:true},
                  ].map(item=>(
                    <div key={item.l}>
                      <div className="text-xs text-[#86868b] mb-0.5">{item.l}</div>
                      <div className={`${item.b?'font-bold text-base':'font-semibold text-sm'} ${item.c??'text-[#1d1d1f]'}`}>{item.val}</div>
                    </div>
                  ))}
                </div>
                <div className="pt-3 border-t border-black/5">
                  <div className="text-xs font-semibold text-[#86868b] mb-2">自然订单 vs 广告订单（月度）</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <div className="bg-[#f5f5f7] rounded-xl p-3">
                      <div className="text-xs text-[#86868b]">自然订单</div>
                      <div className="text-lg font-bold text-indigo-600">{v.organicOrders}</div>
                      <div className="text-xs text-[#86868b]">{v.monthlySales>0?((v.organicOrders/v.monthlySales)*100).toFixed(0):0}% 占比</div>
                    </div>
                    <div className="bg-[#f5f5f7] rounded-xl p-3">
                      <div className="text-xs text-[#86868b]">广告订单</div>
                      <div className="text-lg font-bold text-amber-600">{v.adOrders}</div>
                      <div className="text-xs text-[#86868b]">{v.adOrderShare}% 占比</div>
                    </div>
                    <div className="bg-[#f5f5f7] rounded-xl p-3">
                      <div className="text-xs text-[#86868b]">月广告花费</div>
                      <div className="text-lg font-bold text-rose-500">{cur}{Math.round(v.totalAdSpend).toLocaleString()}</div>
                      <div className="text-xs text-[#86868b]">TACos {v.tacos.toFixed(1)}%</div>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                      <div className="text-xs text-[#86868b]">盈亏平衡价</div>
                      <div className="text-lg font-bold text-emerald-600">{cur}{v.breakEvenPrice.toFixed(2)}</div>
                      <div className="text-xs text-[#86868b]">安全边际 {v.safetyMargin.toFixed(1)}%</div>
                    </div>
                    <div className="bg-violet-50 rounded-xl p-3 border border-violet-200">
                      <div className="text-xs text-[#86868b]">子体 · 毛利率</div>
                      <div className={`text-lg font-bold ${v.margin>=0?'text-violet-700':'text-rose-600'}`}>{v.margin.toFixed(1)}%</div>
                      <div className="text-xs text-violet-600/80">单件净利÷售价，可与左侧盈亏平衡对照</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* 盈亏分析 Tab */}
          {activeTab==='breakeven' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">广告CVR敏感性 → 父体毛利率</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={results.cvrRange} margin={{top:10,right:20,left:-20,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                        <XAxis dataKey="cvr" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}/>
                        <YAxis stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v:number)=>`${v}%`}/>
                        <Tooltip formatter={(v:number)=>[`${v}%`,'毛利率']} contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}/>
                        <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 3"/>
                        <Line type="monotone" dataKey="margin" stroke="#10b981" strokeWidth={2.5} dot={{r:4,fill:'#10b981',stroke:'white',strokeWidth:2}} activeDot={{r:6}}/>
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">价格变动敏感性 → 父体毛利率</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={results.priceRange} margin={{top:10,right:20,left:-20,bottom:0}}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb"/>
                        <XAxis dataKey="label" stroke="#86868b" fontSize={11} tickLine={false} axisLine={false}/>
                        <YAxis stroke="#86868b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v:number)=>`${v}%`}/>
                        <Tooltip formatter={(v:number)=>[`${v}%`,'毛利率']} contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}/>
                        <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 3"/>
                        <Bar dataKey="margin" radius={[4,4,0,0]} barSize={24}>
                          {results.priceRange.map((_d,i)=><Cell key={i} fill={results.priceRange[i].margin>=0?'#10b981':'#ef4444'}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* 右侧汇总面板 */}
        <div className="lg:col-span-1">
          <Card className="sticky top-24 bg-emerald-50/30 border-emerald-100/50">
            <CardHeader>
              <CardTitle>父体利润分析</CardTitle>
              <CardDescription>基于各变体月销量加权</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* 成本结构环形饼图 */}
              <div className="pt-1">
                <div className="text-xs font-semibold text-[#86868b] mb-2">
                  {results.vr.length === 1 ? results.vr[0].name : '父体'} · 成本结构
                </div>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={results.parentCostDisplay}
                        cx="50%" cy="50%"
                        innerRadius={52} outerRadius={78}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                      >
                        {results.parentCostDisplay.map((c, i) => (
                          <Cell key={i} fill={COST_COLORS[c.name] ?? '#94a3b8'}/>
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: number, _name: string, item: { payload?: { name?: string; pctOfRevenue?: number } }) => {
                          const p = item?.payload ?? (item as { name?: string; pctOfRevenue?: number });
                          const pct = p?.pctOfRevenue;
                          const pctText = typeof pct === 'number' ? `，占销额 ${pct.toFixed(1)}%` : '';
                          return [`${cur}${(val as number).toFixed(2)}（单件）${pctText}`, p?.name ?? ''];
                        }}
                        contentStyle={{borderRadius:'10px',border:'none',boxShadow:'0 4px 12px rgba(0,0,0,0.1)',fontSize:'11px'}}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[10px] text-[#86868b] mb-1">各扇区占比为「对当前售价/月销额结构」的百分比</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  {results.parentCostDisplay.map((c, i) => (
                    <div key={i} className="flex items-center gap-1 text-[10px] flex-wrap min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{background: COST_COLORS[c.name] ?? '#94a3b8'}}/>
                      <span className="text-[#86868b]">{c.name}</span>
                      <span className="font-semibold text-[#1d1d1f]">{cur}{c.value.toFixed(2)}</span>
                      <span className="text-emerald-700/80 font-medium">({c.pctOfRevenue.toFixed(1)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-emerald-100/50"/>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-2xl p-3 border border-emerald-100">
                  <div className="text-xs text-[#86868b] mb-1">父体毛利率</div>
                  <div className={`text-3xl font-bold ${results.parentMargin>=0?'text-emerald-600':'text-rose-600'}`}>{results.parentMargin.toFixed(1)}%</div>
                </div>
                <div className="bg-white rounded-2xl p-3 border border-emerald-100">
                  <div className="text-xs text-[#86868b] mb-1">父体TACos</div>
                  <div className="text-3xl font-bold text-amber-600">{results.parentTacos.toFixed(1)}%</div>
                </div>
              </div>
              <div className="space-y-1">
                {[
                  {l:'月总销量',v:`${results.totalSales.toLocaleString()} 件`},
                  {l:'月总销售额',v:`${cur}${Math.round(results.totalMonthlyRevenue).toLocaleString()}`},
                  {l:'月总广告花费',v:`${cur}${Math.round(results.totalAdSpend).toLocaleString()}`},
                  {l:'月总净利润',v:`${cur}${Math.round(results.totalMonthlyProfit).toLocaleString()}`,c:results.totalMonthlyProfit>=0?'text-emerald-600':'text-rose-600'},
                ].map(item=>(
                  <div key={item.l} className="flex justify-between items-center py-1.5 border-b border-black/5 last:border-0">
                    <span className="text-sm text-[#86868b]">{item.l}</span>
                    <span className={`font-semibold text-sm ${(item as any).c??'text-[#1d1d1f]'}`}>{item.v}</span>
                  </div>
                ))}
              </div>
              {results.vr.length>1 && (
                <div className="pt-3 border-t border-emerald-100/50">
                  <div className="text-xs font-semibold text-[#86868b] mb-2">各变体月净利润</div>
                  {results.vr.map(v=>(
                    <div key={v.id} className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-[#86868b] w-20 truncate">{v.name}</span>
                      <div className="flex-1 bg-[#f5f5f7] rounded-full h-2 overflow-hidden">
                        <div className={`h-full rounded-full ${v.monthlyProfit>=0?'bg-emerald-500':'bg-rose-500'}`}
                          style={{width:`${Math.min(100,Math.abs(v.monthlyProfit)/Math.max(1,...results.vr.map(x=>Math.abs(x.monthlyProfit)))*100)}%`}}/>
                      </div>
                      <span className={`text-xs font-semibold w-20 text-right ${v.monthlyProfit>=0?'text-emerald-600':'text-rose-600'}`}>
                        {cur}{Math.round(v.monthlyProfit).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
});
 