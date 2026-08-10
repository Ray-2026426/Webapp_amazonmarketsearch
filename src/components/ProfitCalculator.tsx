import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { Plus, Trash2, Calculator, Globe, Save, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
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

/** vatRate：标准税率%。亚马逊前台售价多为「含税价」，需先拆出 VAT 再算真实毛利 */
const COUNTRIES = [
  { code: 'US', name: '美国', currency: '$', rmbRate: 7.2, vatRate: 0 },
  { code: 'UK', name: '英国', currency: '£', rmbRate: 9.1, vatRate: 20 },
  { code: 'DE', name: '德国', currency: '€', rmbRate: 7.8, vatRate: 19 },
  { code: 'FR', name: '法国', currency: '€', rmbRate: 7.8, vatRate: 20 },
  { code: 'IT', name: '意大利', currency: '€', rmbRate: 7.8, vatRate: 22 },
  { code: 'ES', name: '西班牙', currency: '€', rmbRate: 7.8, vatRate: 21 },
  { code: 'EU', name: '欧洲(其他)', currency: '€', rmbRate: 7.8, vatRate: 20 },
  { code: 'JP', name: '日本', currency: '¥', rmbRate: 0.048, vatRate: 10 },
  { code: 'CA', name: '加拿大', currency: 'C$', rmbRate: 5.3, vatRate: 5 },
  { code: 'AU', name: '澳大利亚', currency: 'A$', rmbRate: 4.7, vatRate: 10 },
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
  'VAT': '#64748b', '退款': '#ef4444', '其他': '#94a3b8',
  '净利润': '#10b981', '亏损': '#ef4444',
};

type SavedPlan = {
  name: string;
  variants: Variant[];
  country: string;
  rmbRate: number;
  vatRate: number;
  savedAt: string;
  variantCount: number;
};

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 兼容老存档：把缺失/异常的字段统一回退到默认值，避免出现 NaN/undefined 或渲染崩溃 */
function sanitizeVariant(v: unknown, idx: number): Variant {
  const obj = (v ?? {}) as Record<string, unknown>;
  const num = (x: unknown, fallback: number) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    id: typeof obj.id === 'string' && obj.id ? obj.id : `${Date.now()}_${idx}`,
    name: typeof obj.name === 'string' && obj.name ? obj.name : `变体 ${idx + 1}`,
    monthlySales: num(obj.monthlySales, DEFAULT_VARIANT.monthlySales),
    price: num(obj.price, DEFAULT_VARIANT.price),
    procurementCost: num(obj.procurementCost, DEFAULT_VARIANT.procurementCost),
    shippingCost: num(obj.shippingCost, DEFAULT_VARIANT.shippingCost),
    storageFee: round1(num(obj.storageFee, DEFAULT_VARIANT.storageFee)),
    refundRate: num(obj.refundRate, DEFAULT_VARIANT.refundRate),
    commissionRate: num(obj.commissionRate, DEFAULT_VARIANT.commissionRate),
    fbaFee: num(obj.fbaFee, DEFAULT_VARIANT.fbaFee),
    otherCost: num(obj.otherCost, DEFAULT_VARIANT.otherCost),
    cvr: num(obj.cvr, DEFAULT_VARIANT.cvr),
    cpc: num(obj.cpc, DEFAULT_VARIANT.cpc),
    adOrderShare: num(obj.adOrderShare, DEFAULT_VARIANT.adOrderShare),
  };
}

/** 从 localStorage 读入后统一成可靠结构，避免缺字段导致界面崩溃或「先空后有」的错觉 */
function normalizeSavedPlans(raw: unknown): SavedPlan[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPlan[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '未命名方案';
    const variantsRaw = item.variants;
    const rawVars = Array.isArray(variantsRaw) ? variantsRaw : [];
    const variants = rawVars.map((v, i) => sanitizeVariant(v, i));
    const country = typeof item.country === 'string' ? item.country : 'US';
    const rmbN = Number(item.rmbRate);
    const rmbRate = Number.isFinite(rmbN) ? rmbN : COUNTRIES[0].rmbRate;
    const matched = COUNTRIES.find((c) => c.code === country);
    const vatN = Number(item.vatRate);
    const vatRate = Number.isFinite(vatN) ? vatN : (matched?.vatRate ?? 0);
    const savedAt = typeof item.savedAt === 'string' && item.savedAt ? item.savedAt : '';
    const vcN = Number(item.variantCount);
    const variantCount = Number.isFinite(vcN) && vcN >= 0 ? Math.floor(vcN) : variants.length;
    out.push({ name, variants, country, rmbRate, vatRate, savedAt, variantCount });
  }
  return out;
}

function readPlansFromStorage(): { plans: SavedPlan[]; hadParseError: boolean } {
  try {
    const s = localStorage.getItem('profit_calc_plans');
    if (s == null || s.trim() === '') return { plans: [], hadParseError: false };
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return { plans: [], hadParseError: true };
    return { plans: normalizeSavedPlans(parsed), hadParseError: false };
  } catch {
    return { plans: [], hadParseError: true };
  }
}

function calcVariant(v: Variant, rmbRate: number, vatRatePct: number) {
  const storage = round1(v.storageFee);
  const procLocal = v.procurementCost / rmbRate;
  const vatRate = Math.max(0, vatRatePct) / 100;
  /** 前台售价多为含税价：净销售额 = 含税价 / (1+VAT) */
  const netPrice = vatRate > 0 ? v.price / (1 + vatRate) : v.price;
  const vatAmount = Math.max(0, v.price - netPrice);
  /** 佣金通常按含税成交价计提 */
  const commission = v.price * (v.commissionRate / 100);
  const refundCost = v.price * (v.refundRate / 100);
  const adCostPerOrder = v.cvr > 0 ? v.cpc / (v.cvr / 100) : 0;
  const adCostPerItem = adCostPerOrder * (v.adOrderShare / 100);
  const acos = v.price > 0 ? (adCostPerItem / v.price) * 100 : 0;
  const operatingCost =
    procLocal + v.shippingCost + v.fbaFee + storage + commission + refundCost + adCostPerItem + v.otherCost;
  const totalCost = operatingCost + vatAmount;
  /** 毛利按「不含税净收入 − 经营成本」；VAT 单独列出，不算你的钱 */
  const profit = netPrice - operatingCost;
  const margin = netPrice > 0 ? (profit / netPrice) * 100 : 0;
  const monthlyProfit = profit * v.monthlySales;
  /** 月销售额（含税 GMV） */
  const monthlySalesRevenue = v.price * v.monthlySales;
  const monthlyNetRevenue = netPrice * v.monthlySales;
  const adOrders = Math.round(v.monthlySales * (v.adOrderShare / 100));
  const organicOrders = v.monthlySales - adOrders;
  const totalAdSpend = adCostPerItem * v.monthlySales;
  const tacos =
    monthlySalesRevenue > 0 ? (totalAdSpend / monthlySalesRevenue) * 100 : 0;
  const fixedCost = procLocal + v.shippingCost + v.fbaFee + storage + v.otherCost;
  /** 盈亏平衡「含税售价」：使净收入刚好覆盖经营成本 */
  const keepRate = 1 / (1 + vatRate) - v.commissionRate / 100 - v.refundRate / 100 - acos / 100;
  const breakEvenPrice = keepRate > 0 ? fixedCost / keepRate : 0;
  const safetyMargin = v.price > 0 ? ((v.price - breakEvenPrice) / v.price) * 100 : 0;
  const costBreakdown = [
    { name: '采购', value: procLocal },
    { name: '头程', value: v.shippingCost },
    { name: 'FBA', value: v.fbaFee },
    { name: '仓储', value: storage },
    { name: '佣金', value: commission },
    { name: '广告', value: adCostPerItem },
    { name: 'VAT', value: vatAmount },
    { name: '退款', value: refundCost },
    { name: '其他', value: v.otherCost },
    { name: profit >= 0 ? '净利润' : '亏损', value: Math.abs(profit) },
  ].filter(c => c.value > 0.001);
  return { ...v, procLocal, commission, refundCost, adCostPerOrder, adCostPerItem, acos, tacos,
    netPrice, vatAmount, totalCost, profit, margin, monthlyProfit, monthlyRevenue: monthlySalesRevenue,
    monthlyNetRevenue, adOrders, organicOrders,
    totalAdSpend, breakEvenPrice, safetyMargin, costBreakdown };
}

/** 数字输入：用文本态编辑，避免出现 039.99 这类前导 0 */
function normalizeNumericTyping(raw: string): string {
  let s = raw.replace(/[^\d.-]/g, '');
  const neg = s.startsWith('-');
  s = (neg ? '-' : '') + s.replace(/-/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }
  // 去掉整数前多余的 0：039.99 → 39.99；保留 0 / 0.xx / -0.xx
  s = s.replace(/^(-?)0+(\d)/, '$1$2');
  return s;
}

function parseNumericInput(raw: string): number {
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

const InputField = ({
  label,
  value,
  onChange,
  step = '0.01',
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  step?: string;
}) => {
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value) : ''));
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setText(Number.isFinite(value) ? String(value) : '');
  }, [value]);

  return (
    <div className="space-y-1">
      <label className="text-xs text-[#86868b] font-medium block">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        step={step}
        value={text}
        onFocus={() => { focused.current = true; }}
        onBlur={() => {
          focused.current = false;
          const n = parseNumericInput(text);
          const cleaned = Number.isFinite(n) ? String(n) : '0';
          setText(cleaned);
          onChange(cleaned);
        }}
        onChange={(e) => {
          const next = normalizeNumericTyping(e.target.value);
          setText(next);
          if (next !== '' && next !== '-' && next !== '.' && next !== '-.') {
            onChange(String(parseNumericInput(next)));
          } else if (next === '') {
            onChange('0');
          }
        }}
        className="w-full border border-black/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
      />
    </div>
  );
};

export const ProfitCalculator = React.memo(function ProfitCalculator() {
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [rmbRate, setRmbRate] = useState(COUNTRIES[0].rmbRate);
  const [vatRate, setVatRate] = useState(COUNTRIES[0].vatRate);
  const [variants, setVariants] = useState<Variant[]>([{ id: '1', ...DEFAULT_VARIANT }]);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [planName, setPlanName] = useState('');
  /** 从列表「加载」的方案在存档数组中的下标；用于「保存修改」覆盖原条目，另存为新方案后会指向新条目 */
  const [activeSavedPlanIndex, setActiveSavedPlanIndex] = useState<number | null>(null);
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [activeTab, setActiveTab] = useState<'input' | 'breakeven'>('input');
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  const showNotification = (type: 'success' | 'error' | 'warning', message: string) => {
    setNotification({ type, message });
  };

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 3500);
    return () => clearTimeout(t);
  }, [notification]);

  const loadErrorShownRef = useRef(false);
  useEffect(() => {
    const { plans, hadParseError } = readPlansFromStorage();
    setSavedPlans(plans);
    if (hadParseError && !loadErrorShownRef.current) {
      loadErrorShownRef.current = true;
      showNotification('error', '本地存档列表读取失败，可能数据已损坏。');
    }
  }, []);

  const savePlanAsNew = () => {
    const name = planName.trim();
    if (!name) return;
    try {
      const { plans: existing } = readPlansFromStorage();
      const entry = {
        name,
        variants,
        country: country.code,
        rmbRate,
        vatRate,
        savedAt: new Date().toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),
        variantCount: variants.length,
      };
      const plans = [...existing, entry];
      localStorage.setItem('profit_calc_plans', JSON.stringify(plans));
      setSavedPlans(normalizeSavedPlans(plans));
      setActiveSavedPlanIndex(plans.length - 1);
      setPlanName(name);
      setShowSavePanel(false);
      showNotification('success', `已另存为新方案「${name}」`);
    } catch (err) {
      console.error('[ProfitCalc] 保存失败：', err);
      showNotification('error', `保存失败：${err instanceof Error ? err.message : '浏览器本地存储可能已满'}`);
    }
  };

  /** 把当前编辑内容写回「加载」时的那一条存档（可改上方名称后一并改名） */
  const savePlanOverwrite = () => {
    if (activeSavedPlanIndex === null) return;
    try {
      const { plans: existing } = readPlansFromStorage();
      const idx = activeSavedPlanIndex;
      if (idx < 0 || idx >= existing.length) {
        setActiveSavedPlanIndex(null);
        showNotification('warning', '原存档位置已变化，请重新在列表里点「加载」后再保存修改。');
        return;
      }
      const name = planName.trim() || existing[idx].name;
      const entry = {
        name,
        variants,
        country: country.code,
        rmbRate,
        vatRate,
        savedAt: new Date().toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),
        variantCount: variants.length,
      };
      const plans = existing.map((pl, j) => (j === idx ? entry : pl));
      localStorage.setItem('profit_calc_plans', JSON.stringify(plans));
      setSavedPlans(normalizeSavedPlans(plans));
      setPlanName(name);
      setShowSavePanel(false);
      showNotification('success', `已更新存档「${name}」`);
    } catch (err) {
      console.error('[ProfitCalc] 覆盖保存失败：', err);
      showNotification('error', `保存失败：${err instanceof Error ? err.message : '浏览器本地存储可能已满'}`);
    }
  };

  const loadPlan = (p: SavedPlan, listIndex: number) => {
    try {
      const raw = Array.isArray(p?.variants) && p.variants.length > 0 ? p.variants : [{}];
      const safeVariants = raw.map((v, i) => sanitizeVariant(v, i));
      setVariants(safeVariants);

      const safeRate = Number.isFinite(Number(p?.rmbRate)) ? Number(p.rmbRate) : rmbRate;
      setRmbRate(safeRate);

      const matched = COUNTRIES.find(x => x.code === p?.country);
      if (matched) setCountry(matched);
      const safeVat = Number.isFinite(Number(p?.vatRate))
        ? Number(p.vatRate)
        : (matched?.vatRate ?? vatRate);
      setVatRate(safeVat);

      setActiveSavedPlanIndex(listIndex);
      setPlanName(typeof p?.name === 'string' ? p.name : '');

      setShowSavePanel(false);

      if (!matched) {
        showNotification('warning', `已加载「${p?.name ?? '未命名方案'}」，但存档里的国家信息无法识别，已保留当前国家(${country.name})。`);
      } else {
        showNotification('success', `已加载方案「${p.name}」`);
      }
    } catch (err) {
      console.error('[ProfitCalc] 加载失败：', err);
      showNotification('error', `加载失败：${err instanceof Error ? err.message : '存档数据异常'}`);
    }
  };

  const deletePlan = (i: number) => {
    try {
      const { plans: fromDisk } = readPlansFromStorage();
      const plans = fromDisk.filter((_, j) => j !== i);
      localStorage.setItem('profit_calc_plans', JSON.stringify(plans));
      setSavedPlans(normalizeSavedPlans(plans));
      setActiveSavedPlanIndex(prev => {
        if (prev === null) return null;
        if (i < prev) return prev - 1;
        if (i === prev) return null;
        return prev;
      });
    } catch (err) {
      console.error('[ProfitCalc] 删除失败：', err);
      showNotification('error', `删除失败：${err instanceof Error ? err.message : '存储异常'}`);
    }
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
    const vr = variants.map(v => calcVariant(v, rmbRate, vatRate));
    const totalSales = vr.reduce((s, v) => s + v.monthlySales, 0);
    const totalMonthlyProfit = vr.reduce((s, v) => s + v.monthlyProfit, 0);
    const totalMonthlyRevenue = vr.reduce((s, v) => s + v.monthlyRevenue, 0);
    const totalMonthlyNetRevenue = vr.reduce((s, v) => s + v.monthlyNetRevenue, 0);
    const totalAdSpend = vr.reduce((s, v) => s + v.totalAdSpend, 0);
    /** 父体毛利率按不含税净销售额计算，避免 VAT 虚高 */
    const parentMargin = totalMonthlyNetRevenue > 0 ? (totalMonthlyProfit / totalMonthlyNetRevenue) * 100 : 0;
    const parentTacos = totalMonthlyRevenue > 0 ? (totalAdSpend / totalMonthlyRevenue) * 100 : 0;
    const w = (key: keyof ReturnType<typeof calcVariant>) =>
      totalSales > 0 ? vr.reduce((s, v) => s + (v[key] as number) * v.monthlySales, 0) / totalSales : 0;
    const avgPrice = w('price');
    const cvrRange = [2,4,6,8,10,12,15,20].map(cvr => {
      const av = variants.map(v => calcVariant({...v, cvr}, rmbRate, vatRate));
      const rev = av.reduce((s,v)=>s+v.monthlyNetRevenue,0);
      const prt = av.reduce((s,v)=>s+v.monthlyProfit,0);
      return { cvr: `${cvr}%`, margin: rev>0 ? parseFloat(((prt/rev)*100).toFixed(1)) : 0 };
    });
    const priceRange = [-20,-15,-10,-5,0,5,10,15,20].map(delta => {
      const av = variants.map(v => calcVariant({...v, price: Math.max(0.01, v.price*(1+delta/100))}, rmbRate, vatRate));
      const rev = av.reduce((s,v)=>s+v.monthlyNetRevenue,0);
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

    return { vr, totalSales, totalMonthlyProfit, totalMonthlyRevenue, totalMonthlyNetRevenue, totalAdSpend, parentMargin, parentTacos, avgPrice, cvrRange, priceRange, parentCostDisplay };
  }, [variants, rmbRate, vatRate]);

  const cur = country.currency;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl"><Calculator className="w-6 h-6"/></div>
          <div>
            <h2 className="text-xl font-semibold text-[#1d1d1f]">利润计算器</h2>
            <p className="text-sm text-[#86868b]">多变体成本 · VAT · 广告效率 · 父体综合利润率</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5" title="用于把「采购成本(人民币)」换算为站点当地币种：1 美元 ≈ 7.2 人民币 即填 7.2">
            <span className="text-xs text-[#86868b] whitespace-nowrap">1{cur} ≈</span>
            <input
              type="text"
              inputMode="decimal"
              value={String(rmbRate)}
              onChange={(e) => {
                const next = normalizeNumericTyping(e.target.value);
                if (next === '' || next === '.' || next === '-' || next === '-.') return;
                setRmbRate(parseNumericInput(next) || rmbRate);
              }}
              className="w-16 text-sm border border-black/10 rounded-lg px-2 py-1.5 focus:outline-none"
            />
            <span className="text-xs text-[#86868b]">人民币(¥)</span>
          </div>
          <div className="flex items-center gap-1.5" title="前台售价按含税价理解：VAT 会从售价中拆出，不计入你的净利润">
            <span className="text-xs text-[#86868b] whitespace-nowrap">VAT</span>
            <input
              type="text"
              inputMode="decimal"
              value={String(vatRate)}
              onChange={(e) => {
                const next = normalizeNumericTyping(e.target.value);
                if (next === '' || next === '.' || next === '-' || next === '-.') {
                  setVatRate(0);
                  return;
                }
                setVatRate(Math.max(0, parseNumericInput(next)));
              }}
              className="w-14 text-sm border border-black/10 rounded-lg px-2 py-1.5 focus:outline-none"
            />
            <span className="text-xs text-[#86868b]">%</span>
          </div>
          <select value={country.code} onChange={e => { const c=COUNTRIES.find(x=>x.code===e.target.value)!; setCountry(c); setRmbRate(c.rmbRate); setVatRate(c.vatRate); }}
            className="border border-black/10 rounded-lg px-3 py-2 bg-white text-sm focus:outline-none">
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name} ({c.currency}){c.vatRate>0?` · VAT ${c.vatRate}%`:''}</option>)}
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
          {activeSavedPlanIndex !== null && savedPlans[activeSavedPlanIndex] && (
            <div className="mb-3 text-xs text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
              正在编辑已存档方案「{savedPlans[activeSavedPlanIndex].name}」。改完参数后点右侧「保存修改」即可覆盖该条存档；也可改名称后一并改名。
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input value={planName} onChange={e=>setPlanName(e.target.value)} placeholder="方案名称（另存必填；覆盖时可改名）"
              className="flex-1 min-w-[160px] border border-black/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none"/>
            <button type="button" onClick={savePlanOverwrite} disabled={activeSavedPlanIndex === null}
              className="border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 disabled:pointer-events-none shrink-0">
              保存修改
            </button>
            <button type="button" onClick={savePlanAsNew} disabled={!planName.trim()}
              className="bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 shrink-0">
              另存为新方案
            </button>
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
                  <button onClick={()=>loadPlan(p, i)} className="text-xs text-indigo-600 hover:underline">加载</button>
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
                {vatRate > 0 && (
                  <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                    <span>含税售价 {cur}{v.price.toFixed(2)}</span>
                    <span>VAT {vatRate}% = {cur}{v.vatAmount.toFixed(2)}</span>
                    <span>不含税净收入 {cur}{v.netPrice.toFixed(2)}</span>
                    <span className="text-[#86868b]">毛利率按净收入计算</span>
                  </div>
                )}
                <div className="pt-3 border-t border-black/5 grid grid-cols-4 md:grid-cols-7 gap-3">
                  {[
                    {l:'单件广告费',val:`${cur}${v.adCostPerItem.toFixed(2)}`},
                    {l:'ACOS',val:`${v.acos.toFixed(1)}%`},
                    {l:'TACos',val:`${v.tacos.toFixed(1)}%`},
                    {l:'总成本(含VAT)',val:`${cur}${v.totalCost.toFixed(2)}`},
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
                  {l:'月总销售额(含税)',v:`${cur}${Math.round(results.totalMonthlyRevenue).toLocaleString()}`},
                  ...(vatRate > 0 ? [{l:'月净销售额(不含税)',v:`${cur}${Math.round(results.totalMonthlyNetRevenue).toLocaleString()}`}] : []),
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
 