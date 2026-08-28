import React, { useState } from 'react';
import type { Product, HistoryRecord } from '../utils/parser';
import { Target, Shield, TrendingUp, Sparkles, Star, BarChart3, Info, Settings, X, RotateCcw, DollarSign, GripVertical } from 'lucide-react';

type DimKey = 'marketSize' | 'growth' | 'concentration' | 'reviews' | 'priceDispersion' | 'newProduct' | 'rating' | 'fbaCost';

interface DimRule {
  key: DimKey;
  label: string;
  icon: string;
  display: string;
  value: number;          // 0-100
  scoreText: string;      // "72 分"
  weight: number;         // 1-10
  tiers: { max: number; color: string; label: string }[];
}

interface WeightsMap {
  marketSize: number;
  growth: number;
  concentration: number;
  reviews: number;
  priceDispersion: number;
  newProduct: number;
  rating: number;
  fbaCost: number;
}

interface ScorecardRules {
  concentrationMaxLow: number;
  concentrationMaxMid: number;
  reviewThresholdLow: number;
  reviewThresholdMid: number;
  priceCvMaxLow: number;
  priceCvMaxMid: number;
  newProductMinActive: number;
  newProductMinStable: number;
  ratingThresholdPoor: number;
  ratingThresholdGood: number;
  fbaRatioMaxLow: number;
  fbaRatioMaxMid: number;
  marketSizeMinHigh: number;
  marketSizeMinMid: number;
  growthMinHigh: number;
  growthMinMid: number;
  weights: WeightsMap;
}

const DEFAULT_WEIGHTS: WeightsMap = {
  marketSize: 10,
  growth: 9,
  concentration: 7,
  reviews: 6,
  newProduct: 5,
  rating: 4,
  fbaCost: 6,
  priceDispersion: 4,
};

const DEFAULT_RULES: ScorecardRules = {
  concentrationMaxLow: 30,
  concentrationMaxMid: 50,
  reviewThresholdLow: 100,
  reviewThresholdMid: 500,
  priceCvMaxLow: 0.3,
  priceCvMaxMid: 0.6,
  newProductMinActive: 15,
  newProductMinStable: 8,
  ratingThresholdPoor: 4.0,
  ratingThresholdGood: 4.3,
  fbaRatioMaxLow: 15,
  fbaRatioMaxMid: 25,
  marketSizeMinHigh: 300000,
  marketSizeMinMid: 70000,
  growthMinHigh: 15,
  growthMinMid: 0,
  weights: { ...DEFAULT_WEIGHTS },
};

const RULES_STORAGE_KEY = 'amz_market_scorecard_rules';

const loadRules = (): ScorecardRules => {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // merge weights separately to handle partial saves
      return {
        ...DEFAULT_RULES,
        ...parsed,
        weights: { ...DEFAULT_WEIGHTS, ...(parsed.weights || {}) },
      };
    }
  } catch {}
  return { ...DEFAULT_RULES };
};

const saveRules = (rules: ScorecardRules) => {
  try {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch {}
};

const SCORE_COLORS: Record<string, { bar: string; bg: string; text: string; border: string; ring: string }> = {
  green: { bar: 'from-emerald-500 to-teal-400', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', ring: 'ring-emerald-100' },
  yellow: { bar: 'from-amber-500 to-orange-400', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', ring: 'ring-amber-100' },
  red: { bar: 'from-rose-500 to-red-400', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', ring: 'ring-rose-100' },
};

function getTier(value: number, tiers: { max: number; color: string }[]): string {
  for (const tier of tiers) {
    if (value <= tier.max) return tier.color;
  }
  return tiers[tiers.length - 1]?.color || 'red';
}

const ICON_MAP: Record<string, React.ReactNode> = {
  target: <Target className="w-3.5 h-3.5" />,
  shield: <Shield className="w-3.5 h-3.5" />,
  barchart: <BarChart3 className="w-3.5 h-3.5" />,
  sparkles: <Sparkles className="w-3.5 h-3.5" />,
  star: <Star className="w-3.5 h-3.5" />,
  trendingup: <TrendingUp className="w-3.5 h-3.5" />,
  dollarsign: <DollarSign className="w-3.5 h-3.5" />,
};

const DIM_LABELS: Record<DimKey, string> = {
  marketSize: '市场体量',
  growth: '增长趋势',
  concentration: '市场集中度',
  reviews: '评论壁垒',
  priceDispersion: '价格离散度',
  newProduct: '新品活力',
  rating: '评分空间',
  fbaCost: 'FBA成本率',
};

interface MarketScorecardProps {
  products: Product[];
  history?: HistoryRecord[];
  months?: string[];
}

const ScoreBar = ({ dim }: { dim: DimRule }) => {
  const activeColor = getTier(dim.value, dim.tiers);
  const s = SCORE_COLORS[activeColor];

  return (
    <div className={`relative overflow-hidden rounded-xl border ${s.border} ${s.bg} p-3 ring-1 ${s.ring}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={s.text}>{ICON_MAP[dim.icon] || dim.icon}</span>
          <span className="text-xs font-semibold text-slate-700">{dim.label}</span>
          <span className="text-[9px] text-slate-300 font-medium">×{dim.weight}</span>
        </div>
        <span className={`text-lg font-bold font-mono ${s.text}`}>{dim.scoreText}</span>
      </div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-slate-400">{dim.display}</span>
        <span className={`text-[10px] font-medium ${s.text}`}>
          {activeColor === 'green' ? '优' : activeColor === 'yellow' ? '良' : '差'}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200/70">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${s.bar} transition-all duration-700`}
          style={{ width: `${Math.min(dim.value, 100)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        {dim.tiers.map((t) => {
          const isActive = getTier(dim.value, dim.tiers) === t.color;
          return (
            <span
              key={t.label}
              className={`text-[9px] font-medium rounded-full px-1.5 py-0.5 ${
                isActive
                  ? SCORE_COLORS[t.color].text + ' ' + SCORE_COLORS[t.color].bg
                  : 'text-slate-400 bg-slate-100'
              }`}
            >
              {t.label}
            </span>
          );
        })}
      </div>
    </div>
  );
};

/** Rule editing modal */
const RulesModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  rules: ScorecardRules;
  onSave: (r: ScorecardRules) => void;
}> = ({ isOpen, onClose, rules, onSave }) => {
  const [draft, setDraft] = useState<ScorecardRules>(() => ({
    ...rules,
    weights: { ...rules.weights },
  }));
  const [activeTab, setActiveTab] = useState<'doc' | 'edit' | 'weights'>('doc');

  if (!isOpen) return null;

  const update = (k: keyof ScorecardRules, v: any) => {
    setDraft(prev => ({ ...prev, [k]: v }));
  };

  const updateWeight = (key: DimKey, v: number) => {
    setDraft(prev => ({
      ...prev,
      weights: { ...prev.weights, [key]: Math.max(0, Math.min(10, v)) },
    }));
  };

  const handleSave = () => {
    onSave(draft);
  };

  const handleReset = () => {
    setDraft({ ...DEFAULT_RULES, weights: { ...DEFAULT_WEIGHTS } });
  };

  const RuleRow = ({ label, value, onChange, unit, min = 0, max = 999999, step = 1 }: {
    label: string; value: number; onChange: (v: number) => void; unit?: string; min?: number; max?: number; step?: number;
  }) => (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-600 flex-1">{label}</span>
      <div className="flex items-center gap-1.5">
        <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
          min={min} max={max} step={step}
          className="w-20 px-1.5 py-1 text-xs text-right font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        {unit && <span className="text-[10px] text-slate-400 w-8">{unit}</span>}
      </div>
    </div>
  );

  const dimKeys: DimKey[] = ['marketSize', 'growth', 'concentration', 'reviews', 'priceDispersion', 'newProduct', 'rating', 'fbaCost'];

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-indigo-500" />
            <span className="text-sm font-bold text-slate-800">评分规则配置</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-lg bg-slate-200 p-0.5">
              <button onClick={() => setActiveTab('doc')} className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${activeTab === 'doc' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>规则说明</button>
              <button onClick={() => setActiveTab('edit')} className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${activeTab === 'edit' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>调整阈值</button>
              <button onClick={() => setActiveTab('weights')} className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${activeTab === 'weights' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>权重</button>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-200 text-slate-400"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'weights' ? (
            <div className="space-y-4">
              <div className="bg-indigo-50 rounded-xl p-3 text-indigo-800 border border-indigo-100 text-xs">
                <p className="font-semibold mb-1">权重说明</p>
                <p>综合评分 = 各维度分数 × 权重 / 权重总和。权重越高该维度对最终得分影响越大。设为 0 则该维度不参与评分。</p>
              </div>
              <div className="space-y-1.5">
                {dimKeys.map(key => (
                  <div key={key} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                    <span className="text-xs text-slate-600 w-20 flex-shrink-0">{DIM_LABELS[key]}</span>
                    <input
                      type="range"
                      min={0} max={10} step={1}
                      value={draft.weights[key]}
                      onChange={e => updateWeight(key, parseInt(e.target.value))}
                      className="flex-1 h-1.5 accent-indigo-600"
                    />
                    <span className={`text-sm font-bold font-mono w-6 text-right ${draft.weights[key] === 0 ? 'text-slate-300' : draft.weights[key] >= 8 ? 'text-emerald-600' : draft.weights[key] >= 4 ? 'text-amber-600' : 'text-rose-500'}`}>
                      {draft.weights[key]}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-3">
                <button onClick={handleSave} className="flex-1 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700 transition-colors">应用设置</button>
                <button onClick={handleReset} className="flex items-center gap-1 px-3 py-2 border border-slate-200 text-slate-500 text-xs font-medium rounded-xl hover:bg-slate-50 transition-colors"><RotateCcw className="w-3 h-3" /> 恢复默认</button>
              </div>
            </div>
          ) : activeTab === 'doc' ? (
            <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
              <div className="bg-indigo-50 rounded-xl p-3 text-indigo-800 border border-indigo-100">
                <p className="font-semibold mb-1">评分说明</p>
                <p>8 个维度各分 3 档（绿/黄/红），每维 0-100 分。综合评分为加权平均（默认体量/增长率权重最高）。可切换 Tab 调整阈值和权重。</p>
              </div>
              <div className="space-y-3">
                {([
                  { k: 'marketSize', d: `全市场近 3 个月月均营收。`, g: `≥$${rules.marketSizeMinHigh.toLocaleString()}`, y: `≥$${rules.marketSizeMinMid.toLocaleString()}`, r: `<$${rules.marketSizeMinMid.toLocaleString()}` },
                  { k: 'growth', d: `近 6 月 vs 前 6 月营收 CAGR。`, g: `≥${rules.growthMinHigh}%`, y: `≥${rules.growthMinMid}%`, r: `<${rules.growthMinMid}%` },
                  { k: 'concentration', d: `Top10 ASIN 销量占比。越低越好。`, g: `≤${rules.concentrationMaxLow}%`, y: `≤${rules.concentrationMaxMid}%`, r: `>${rules.concentrationMaxMid}%` },
                  { k: 'reviews', d: `全市场 ASIN 平均评论数。`, g: `≤${rules.reviewThresholdLow}`, y: `≤${rules.reviewThresholdMid}`, r: `>${rules.reviewThresholdMid}` },
                  { k: 'priceDispersion', d: `价格 CV = 标准差/均值。`, g: `≤${rules.priceCvMaxLow}`, y: `≤${rules.priceCvMaxMid}`, r: `>${rules.priceCvMaxMid}` },
                  { k: 'newProduct', d: `近 90 天上架占比。越高越好。`, g: `≥${rules.newProductMinActive}%`, y: `≥${rules.newProductMinStable}%`, r: `<${rules.newProductMinStable}%` },
                  { k: 'rating', d: `全市场平均评分。`, g: `≥${rules.ratingThresholdGood}`, y: `≥${rules.ratingThresholdPoor}`, r: `<${rules.ratingThresholdPoor}` },
                  { k: 'fbaCost', d: `FBA 费/售价均值。越低越好。`, g: `≤${rules.fbaRatioMaxLow}%`, y: `≤${rules.fbaRatioMaxMid}%`, r: `>${rules.fbaRatioMaxMid}%` },
                ] as { k: DimKey; d: string; g: string; y: string; r: string }[]).map(item => (
                  <div key={item.k} className="bg-white border border-slate-100 rounded-xl p-3">
                    <div className="font-semibold text-slate-700 mb-1">{DIM_LABELS[item.k]}<span className="text-[10px] text-slate-400 ml-1">权重 ×{rules.weights[item.k]}</span></div>
                    <p>{item.d}<br /><span className="text-emerald-600">{item.g}</span> · <span className="text-amber-600">{item.y}</span> · <span className="text-rose-600">{item.r}</span></p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="font-semibold text-slate-700 mb-1">市场体量（月度营收，美元）</div>
              <RuleRow label="大体量下限（≥此值绿灯）" value={draft.marketSizeMinHigh} onChange={v => update('marketSizeMinHigh', v)} step={10000} />
              <RuleRow label="中体量下限（≥此值黄灯）" value={draft.marketSizeMinMid} onChange={v => update('marketSizeMinMid', v)} step={5000} />

              <div className="font-semibold text-slate-700 mt-5 mb-1">增长趋势（营收 CAGR，%）</div>
              <RuleRow label="高增长下限（≥此值绿灯）" value={draft.growthMinHigh} onChange={v => update('growthMinHigh', v)} unit="%" />
              <RuleRow label="平稳下限（≥此值黄灯）" value={draft.growthMinMid} onChange={v => update('growthMinMid', v)} unit="%" />

              <div className="font-semibold text-slate-700 mt-5 mb-1">市场集中度</div>
              <RuleRow label="分散上限（≤此值绿灯）" value={draft.concentrationMaxLow} onChange={v => update('concentrationMaxLow', v)} unit="%" />
              <RuleRow label="中度假顶（≤此值黄灯）" value={draft.concentrationMaxMid} onChange={v => update('concentrationMaxMid', v)} unit="%" />

              <div className="font-semibold text-slate-700 mt-5 mb-1">评论壁垒</div>
              <RuleRow label="低壁垒上限（≤此值绿灯）" value={draft.reviewThresholdLow} onChange={v => update('reviewThresholdLow', v)} step={10} />
              <RuleRow label="中壁垒上限（≤此值黄灯）" value={draft.reviewThresholdMid} onChange={v => update('reviewThresholdMid', v)} step={100} />

              <div className="font-semibold text-slate-700 mt-5 mb-1">价格离散度（CV）</div>
              <RuleRow label="趋同上限（≤此值绿灯）" value={draft.priceCvMaxLow} onChange={v => update('priceCvMaxLow', v)} step={0.05} />
              <RuleRow label="分化上限（≤此值黄灯）" value={draft.priceCvMaxMid} onChange={v => update('priceCvMaxMid', v)} step={0.05} />

              <div className="font-semibold text-slate-700 mt-5 mb-1">新品活力</div>
              <RuleRow label="活跃下限（≥此值绿灯）" value={draft.newProductMinActive} onChange={v => update('newProductMinActive', v)} unit="%" />
              <RuleRow label="平稳下限（≥此值黄灯）" value={draft.newProductMinStable} onChange={v => update('newProductMinStable', v)} unit="%" />

              <div className="font-semibold text-slate-700 mt-5 mb-1">评分空间</div>
              <RuleRow label="差评起点（<此值红灯）" value={draft.ratingThresholdPoor} onChange={v => update('ratingThresholdPoor', v)} min={1} max={5} step={0.1} />
              <RuleRow label="优质起点（≥此值绿灯）" value={draft.ratingThresholdGood} onChange={v => update('ratingThresholdGood', v)} min={1} max={5} step={0.1} />

              <div className="font-semibold text-slate-700 mt-5 mb-1">FBA 成本率</div>
              <RuleRow label="低费率上限（≤此值绿灯）" value={draft.fbaRatioMaxLow} onChange={v => update('fbaRatioMaxLow', v)} unit="%" />
              <RuleRow label="中费率上限（≤此值黄灯）" value={draft.fbaRatioMaxMid} onChange={v => update('fbaRatioMaxMid', v)} unit="%" />

              <div className="flex items-center gap-2 pt-3">
                <button onClick={handleSave} className="flex-1 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700 transition-colors">应用设置</button>
                <button onClick={handleReset} className="flex items-center gap-1 px-3 py-2 border border-slate-200 text-slate-500 text-xs font-medium rounded-xl hover:bg-slate-50 transition-colors"><RotateCcw className="w-3 h-3" /> 恢复默认</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const fmtMoney = (v: number): string => {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
};

export const MarketScorecard: React.FC<MarketScorecardProps> = ({ products, history = [], months = [] }) => {
  const [rules, setRules] = useState<ScorecardRules>(loadRules);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSaveRules = (newRules: ScorecardRules) => {
    setRules(newRules);
    saveRules(newRules);
    setIsModalOpen(false);
  };

  if (products.length === 0) return null;

  // ── computations (unchanged) ──
  const sortedBySales = [...products].sort((a, b) => b.monthlySales - a.monthlySales);
  const top10Sales = sortedBySales.slice(0, 10).reduce((s, p) => s + p.monthlySales, 0);
  const totalSales = products.reduce((s, p) => s + p.monthlySales, 0);
  const concentration = totalSales > 0 ? (top10Sales / totalSales) * 100 : 0;

  const avgReviews = products.length > 0 ? products.reduce((s, p) => s + p.reviewCount, 0) / products.length : 0;

  const prices = products.map(p => p.price).filter(p => p > 0);
  const avgPrice = prices.length > 0 ? prices.reduce((s, v) => s + v, 0) / prices.length : 0;
  const priceVariance = prices.length > 0 ? prices.reduce((s, v) => s + (v - avgPrice) ** 2, 0) / prices.length : 0;
  const priceCV = avgPrice > 0 ? Math.sqrt(priceVariance) / avgPrice : 0;

  const newProductCount = products.filter(p => p.daysSinceLaunch > 0 && p.daysSinceLaunch <= 90).length;
  const newProductRatio = products.length > 0 ? (newProductCount / products.length) * 100 : 0;

  const avgRating = products.length > 0 ? products.reduce((s, p) => s + p.rating, 0) / products.length : 0;

  const fbaPs = products.filter(p => p.fbaFee > 0 && p.price > 0);
  const avgFbaRatio = fbaPs.length > 0 ? (fbaPs.reduce((s, p) => s + p.fbaFee / p.price, 0) / fbaPs.length) * 100 : 0;

  const sortedMonths = [...months].sort();

  let marketSize = 0;
  const recentMonths = sortedMonths.slice(-3);
  if (recentMonths.length > 0 && history.length > 0) {
    let totalRevenue = 0; let monthCount = 0;
    recentMonths.forEach(m => { history.forEach(h => { const d = h.history[m]; if (d) totalRevenue += d.revenue; }); monthCount++; });
    marketSize = monthCount > 0 ? totalRevenue / monthCount : 0;
  }

  let growthRate = 0;
  if (sortedMonths.length >= 12 && history.length > 0) {
    const sumRev = (mlist: string[]) => { let s = 0; mlist.forEach(m => { history.forEach(h => { const d = h.history[m]; if (d) s += d.revenue; }); }); return s; };
    const recentSum = sumRev(sortedMonths.slice(-6));
    const priorSum = sumRev(sortedMonths.slice(-12, -6));
    if (priorSum > 0 && recentSum > 0) growthRate = ((recentSum / priorSum) - 1) * 100;
  }

  const makeScore = (raw: number, thresholds: { low: number; mid: number; high: number }, direction: 'lower' | 'higher') => {
    if (direction === 'lower') {
      if (raw <= thresholds.low) return 85;
      if (raw <= thresholds.mid) return 55;
      return 25;
    }
    if (raw >= thresholds.high) return 85;
    if (raw >= thresholds.mid) return 55;
    return 25;
  };

  const scores: Record<DimKey, number> = {
    marketSize: makeScore(marketSize, { low: rules.marketSizeMinMid, mid: rules.marketSizeMinHigh, high: rules.marketSizeMinHigh }, 'higher'),
    growth: makeScore(growthRate, { low: rules.growthMinMid, mid: rules.growthMinHigh, high: rules.growthMinHigh }, 'higher'),
    concentration: makeScore(concentration, { low: rules.concentrationMaxLow, mid: rules.concentrationMaxMid, high: rules.concentrationMaxLow }, 'lower'),
    reviews: makeScore(avgReviews, { low: rules.reviewThresholdLow, mid: rules.reviewThresholdMid, high: rules.reviewThresholdLow }, 'lower'),
    priceDispersion: makeScore(priceCV, { low: rules.priceCvMaxLow, mid: rules.priceCvMaxMid, high: rules.priceCvMaxLow }, 'lower'),
    newProduct: makeScore(newProductRatio, { low: rules.newProductMinStable, mid: rules.newProductMinActive, high: rules.newProductMinActive }, 'higher'),
    rating: makeScore(avgRating, { low: rules.ratingThresholdPoor, mid: rules.ratingThresholdPoor, high: rules.ratingThresholdGood }, 'higher'),
    fbaCost: makeScore(avgFbaRatio, { low: rules.fbaRatioMaxLow, mid: rules.fbaRatioMaxMid, high: rules.fbaRatioMaxLow }, 'lower'),
  };

  const dims: { key: DimKey; icon: string; display: string }[] = [
    { key: 'marketSize', icon: 'dollarsign', display: fmtMoney(marketSize) },
    { key: 'growth', icon: 'trendingup', display: `${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}%` },
    { key: 'concentration', icon: 'target', display: `${concentration.toFixed(0)}%` },
    { key: 'reviews', icon: 'shield', display: avgReviews >= 1000 ? `${(avgReviews / 1000).toFixed(1)}k` : `${avgReviews.toFixed(0)}` },
    { key: 'priceDispersion', icon: 'barchart', display: `${(priceCV * 100).toFixed(0)}%` },
    { key: 'newProduct', icon: 'sparkles', display: `${newProductRatio.toFixed(1)}%` },
    { key: 'rating', icon: 'star', display: avgRating.toFixed(1) },
    { key: 'fbaCost', icon: 'trendingup', display: `${avgFbaRatio.toFixed(1)}%` },
  ];

  const TIER_MAPS: Record<DimKey, { max: number; color: string; label: string }[]> = {
    marketSize: [{ max: 33, color: 'red', label: '小' }, { max: 66, color: 'yellow', label: '中' }, { max: 100, color: 'green', label: '大' }],
    growth: [{ max: 30, color: 'red', label: '下降' }, { max: 60, color: 'yellow', label: '平稳' }, { max: 100, color: 'green', label: '增长' }],
    concentration: [{ max: 30, color: 'green', label: '分散' }, { max: 65, color: 'yellow', label: '中度' }, { max: 100, color: 'red', label: '集中' }],
    reviews: [{ max: 30, color: 'green', label: '低壁垒' }, { max: 65, color: 'yellow', label: '中壁垒' }, { max: 100, color: 'red', label: '高壁垒' }],
    priceDispersion: [{ max: 30, color: 'green', label: '趋同' }, { max: 65, color: 'yellow', label: '分化' }, { max: 100, color: 'red', label: '割裂' }],
    newProduct: [{ max: 30, color: 'red', label: '老化' }, { max: 60, color: 'yellow', label: '平稳' }, { max: 100, color: 'green', label: '活跃' }],
    rating: [{ max: 35, color: 'red', label: '差' }, { max: 65, color: 'yellow', label: '良' }, { max: 100, color: 'green', label: '优' }],
    fbaCost: [{ max: 30, color: 'green', label: '低' }, { max: 65, color: 'yellow', label: '中' }, { max: 100, color: 'red', label: '高' }],
  };

  const dimensions: DimRule[] = dims.map(d => ({
    key: d.key,
    label: DIM_LABELS[d.key],
    icon: d.icon,
    display: d.display,
    value: scores[d.key],
    scoreText: `${scores[d.key]} 分`,
    weight: rules.weights[d.key],
    tiers: TIER_MAPS[d.key],
  }));

  const greenCount = dimensions.filter(d => getTier(d.value, d.tiers) === 'green').length;
  const historyAsins = new Set(history.map((h) => h.asin));
  const historyCoverage = products.length ? (products.filter((p) => historyAsins.has(p.asin)).length / products.length) * 100 : 0;
  const fbaCoverage = products.length ? (fbaPs.length / products.length) * 100 : 0;
  const launchCoverage = products.length ? (products.filter((p) => p.daysSinceLaunch > 0 || p.launchDate).length / products.length) * 100 : 0;
  const confidenceNotes = [
    sortedMonths.length < 12 ? '历史少于12个月，增长率只能作弱信号' : '',
    historyCoverage < 70 ? `历史匹配率 ${historyCoverage.toFixed(0)}%，趋势与体量可能低估` : '',
    fbaCoverage < 50 ? `FBA覆盖率 ${fbaCoverage.toFixed(0)}%，成本分置信度低` : '',
    launchCoverage < 50 ? `上架时间覆盖率 ${launchCoverage.toFixed(0)}%，新品活力可能失真` : '',
  ].filter(Boolean);
  const dimEvidence: Record<DimKey, string> = {
    marketSize: `近3个月月均销售额 ${fmtMoney(marketSize)}；依赖历史销售额覆盖率。`,
    growth: sortedMonths.length >= 12
      ? `近6个月销售额对比前6个月 ${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}%。`
      : `历史月份 ${sortedMonths.length} 个，不足12个月时默认按 0% 增长处理。`,
    concentration: `Top10 ASIN 销量占比 ${concentration.toFixed(1)}%；越高说明头部垄断越强。`,
    reviews: `平均评论数 ${avgReviews.toFixed(0)}；用作进入壁垒的粗略代理。`,
    priceDispersion: `价格CV ${(priceCV * 100).toFixed(1)}%；反映价格带是否分层。`,
    newProduct: `近90天新品占比 ${newProductRatio.toFixed(1)}%；依赖上架时间覆盖率 ${launchCoverage.toFixed(0)}%。`,
    rating: `平均评分 ${avgRating.toFixed(2)}；高评分代表口碑稳定，但也可能意味着改进空间小。`,
    fbaCost: `平均FBA/售价 ${avgFbaRatio.toFixed(1)}%；覆盖 ${fbaPs.length}/${products.length} 个 ASIN。`,
  };

  // Weighted average
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const totalScore = totalWeight > 0
    ? Math.round(dimensions.reduce((s, d) => s + d.value * d.weight, 0) / totalWeight)
    : Math.round(dimensions.reduce((s, d) => s + d.value, 0) / dimensions.length);

  const summaryGrade = greenCount >= 5 ? '🟢 机会充足' : greenCount >= 3 ? '🟡 谨慎进入' : '🔴 竞争激烈';

  return (
    <>
      <RulesModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} rules={rules} onSave={handleSaveRules} />

      <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-black/5 bg-gradient-to-r from-indigo-50/50 via-white to-emerald-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-bold text-slate-800">市场准入评估</span>
              <span className="text-xs font-medium text-slate-500">{`8 维 · 加权评分`}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-500">
                综合评定：<span className="text-sm text-slate-800">{summaryGrade}</span>
                <span className="text-[10px] text-slate-400 ml-1">（加权 {totalScore} 分 · {greenCount}/8 绿灯）</span>
              </span>
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-slate-200"
                title="查看评分规则、调整阈值与权重"
              >
                <Settings className="w-3 h-3" />
                规则
              </button>
            </div>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          {dimensions.map(dim => (
            <ScoreBar key={dim.key} dim={dim} />
          ))}
        </div>
        <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="text-xs font-bold text-slate-700 mb-1">评分置信度</div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {confidenceNotes.length
                ? confidenceNotes.join('；')
                : '历史、FBA 与上架时间覆盖较好，评分可作为主要参考。'}
            </p>
          </div>
          <div className="lg:col-span-2 rounded-xl border border-slate-100 bg-white p-3">
            <div className="text-xs font-bold text-slate-700 mb-2">各维度依据</div>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {dimensions.map((dim) => (
                <div key={dim.key} className="text-[11px] text-slate-500 leading-relaxed">
                  <span className="font-semibold text-slate-700">{dim.label}：</span>{dimEvidence[dim.key]}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
