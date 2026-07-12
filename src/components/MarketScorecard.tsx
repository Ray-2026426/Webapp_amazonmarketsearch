import React, { useState } from 'react';
import { Product, HistoryRecord, getCurrencySymbol } from '../utils/parser';
import { Target, Shield, TrendingUp, Sparkles, Star, BarChart3, Info, Settings, X, RotateCcw, DollarSign } from 'lucide-react';

interface DimRule {
  label: string;
  icon: string;
  valueKey: string;
  display: string;
  value: number;          // 0-100
  scoreText: string;      // "72 分"
  tiers: { max: number; color: string; label: string }[];
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
  marketSizeMinHigh: number;   // ≥此值绿灯
  marketSizeMinMid: number;    // ≥此值黄灯
  growthMinHigh: number;       // ≥此值绿灯，单位 %
  growthMinMid: number;        // ≥此值黄灯，单位 %
}

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
};

const RULES_STORAGE_KEY = 'amz_market_scorecard_rules';

const loadRules = (): ScorecardRules => {
  try {
    const raw = localStorage.getItem(RULES_STORAGE_KEY);
    if (raw) return { ...DEFAULT_RULES, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_RULES;
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
        </div>
        <span className={`text-lg font-bold font-mono ${s.text}`}>{dim.scoreText}</span>
      </div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-slate-400">{dim.display}</span>
        <span className={`text-[10px] font-medium ${s.text}`}>
          {getTier(dim.value, dim.tiers) === 'green' ? '优' : getTier(dim.value, dim.tiers) === 'yellow' ? '良' : '差'}
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
  const [draft, setDraft] = useState<ScorecardRules>(() => ({ ...rules }));
  const [activeTab, setActiveTab] = useState<'edit' | 'doc'>('doc');

  if (!isOpen) return null;

  const update = (k: keyof ScorecardRules, v: number) => {
    setDraft(prev => ({ ...prev, [k]: v }));
  };

  const handleSave = () => {
    onSave(draft);
  };

  const handleReset = () => {
    setDraft({ ...DEFAULT_RULES });
  };

  const RuleRow = ({ label, value, onChange, unit, min = 0, max = 999999, step = 1 }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
  }) => (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-600 flex-1">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step}
          className="w-20 px-1.5 py-1 text-xs text-right font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        {unit && <span className="text-[10px] text-slate-400 w-8">{unit}</span>}
      </div>
    </div>
  );

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
              <button
                onClick={() => setActiveTab('doc')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${activeTab === 'doc' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
              >
                规则说明
              </button>
              <button
                onClick={() => setActiveTab('edit')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${activeTab === 'edit' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
              >
                调整阈值
              </button>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-200 text-slate-400"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'doc' ? (
            <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
              <div className="bg-indigo-50 rounded-xl p-3 text-indigo-800 border border-indigo-100">
                <p className="font-semibold mb-1">评分说明</p>
                <p>8 个维度各分 3 档（绿/黄/红），在当前市场数据上自动计算，每维显示 0-100 分数。可切换到「调整阈值」修改判断标准。</p>
              </div>

              <div className="space-y-3">
                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1">市场集中度</div>
                  <p>Top10 ASIN 销量占全市场比。越低越好。<br /><span className="text-emerald-600">分散 ≤{rules.concentrationMaxLow}%</span> · <span className="text-amber-600">中度 ≤{rules.concentrationMaxMid}%</span> · <span className="text-rose-600">集中 &gt;{rules.concentrationMaxMid}%</span></p>
                </div>
                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1">评论壁垒</div>
                  <p>全市场 ASIN 平均评论数。越低越好。<br /><span className="text-emerald-600">低 ≤{rules.reviewThresholdLow}</span> · <span className="text-amber-600">中 ≤{rules.reviewThresholdMid}</span> · <span className="text-rose-600">高 &gt;{rules.reviewThresholdMid}</span></p>
                </div>
                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1">价格离散度</div>
                  <p>价格 CV = 标准差/均值。<br /><span className="text-emerald-600">趋同 ≤{rules.priceCvMaxLow}</span> · <span className="text-amber-600">分化 ≤{rules.priceCvMaxMid}</span> · <span className="text-rose-600">割裂 &gt;{rules.priceCvMaxMid}</span></p>
                </div>
                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1">新品活力</div>
                  <p>近 90 天上架 ASIN 占比。越高越好。<br /><span className="text-emerald-600">活跃 ≥{rules.newProductMinActive}%</span> · <span className="text-amber-600">平稳 ≥{rules.newProductMinStable}%</span> · <span className="text-rose-600">老化 &lt;{rules.newProductMinStable}%</span></p>
                </div>
                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1">评分空间</div>
                  <p>全市场平均评分。<br /><span className="text-rose-600">差 &lt;{rules.ratingThresholdPoor}</span> · <span className="text-amber-600">良 ≥{rules.ratingThresholdPoor}</span> · <span className="text-emerald-600">优 ≥{rules.ratingThresholdGood}</span></p>
                </div>
                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1">FBA 成本率</div>
                  <p>FBA 费/售价均值。越低越好。<br /><span className="text-emerald-600">低 ≤{rules.fbaRatioMaxLow}%</span> · <span className="text-amber-600">中 ≤{rules.fbaRatioMaxMid}%</span> · <span className="text-rose-600">高 &gt;{rules.fbaRatioMaxMid}%</span></p>
                </div>
                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1">市场体量</div>
                  <p>全市场近 3 个月月均营收（美元）。越大越好。<br /><span className="text-emerald-600">大 ≥${rules.marketSizeMinHigh.toLocaleString()}</span> · <span className="text-amber-600">中 ≥${rules.marketSizeMinMid.toLocaleString()}</span> · <span className="text-rose-600">小 &lt;${rules.marketSizeMinMid.toLocaleString()}</span></p>
                </div>
                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1">增长趋势</div>
                  <p>近 6 个月 vs 前 6 个月的营收复合增长率。<br /><span className="text-emerald-600">高 ≥{rules.growthMinHigh}%</span> · <span className="text-amber-600">平稳 ≥{rules.growthMinMid}%</span> · <span className="text-rose-600">下降 &lt;{rules.growthMinMid}%</span></p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="font-semibold text-slate-700 mb-1">市场集中度</div>
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

              <div className="font-semibold text-slate-700 mt-5 mb-1">市场体量（月度营收，美元）</div>
              <RuleRow label="大体量下限（≥此值绿灯）" value={draft.marketSizeMinHigh} onChange={v => update('marketSizeMinHigh', v)} step={10000} />
              <RuleRow label="中体量下限（≥此值黄灯）" value={draft.marketSizeMinMid} onChange={v => update('marketSizeMinMid', v)} step={5000} />

              <div className="font-semibold text-slate-700 mt-5 mb-1">增长趋势（营收 CAGR，%）</div>
              <RuleRow label="高增长下限（≥此值绿灯）" value={draft.growthMinHigh} onChange={v => update('growthMinHigh', v)} unit="%" />
              <RuleRow label="平稳下限（≥此值黄灯）" value={draft.growthMinMid} onChange={v => update('growthMinMid', v)} unit="%" />

              <div className="flex items-center gap-2 pt-3">
                <button onClick={handleSave} className="flex-1 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
                  保存设置
                </button>
                <button onClick={handleReset} className="flex items-center gap-1 px-3 py-2 border border-slate-200 text-slate-500 text-xs font-medium rounded-xl hover:bg-slate-50 transition-colors">
                  <RotateCcw className="w-3 h-3" /> 恢复默认
                </button>
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

  // ── 6 original dimensions ──
  const sortedBySales = [...products].sort((a, b) => b.monthlySales - a.monthlySales);
  const top10Sales = sortedBySales.slice(0, 10).reduce((s, p) => s + p.monthlySales, 0);
  const totalSales = products.reduce((s, p) => s + p.monthlySales, 0);
  const concentration = totalSales > 0 ? (top10Sales / totalSales) * 100 : 0;

  const avgReviews = products.length > 0
    ? products.reduce((s, p) => s + p.reviewCount, 0) / products.length
    : 0;

  const prices = products.map(p => p.price).filter(p => p > 0);
  const avgPrice = prices.length > 0 ? prices.reduce((s, v) => s + v, 0) / prices.length : 0;
  const priceVariance = prices.length > 0
    ? prices.reduce((s, v) => s + (v - avgPrice) ** 2, 0) / prices.length
    : 0;
  const priceCV = avgPrice > 0 ? Math.sqrt(priceVariance) / avgPrice : 0;

  const newProductCount = products.filter(p => p.daysSinceLaunch > 0 && p.daysSinceLaunch <= 90).length;
  const newProductRatio = products.length > 0 ? (newProductCount / products.length) * 100 : 0;

  const avgRating = products.length > 0
    ? products.reduce((s, p) => s + p.rating, 0) / products.length
    : 0;

  const fbaPs = products.filter(p => p.fbaFee > 0 && p.price > 0);
  const avgFbaRatio = fbaPs.length > 0
    ? (fbaPs.reduce((s, p) => s + p.fbaFee / p.price, 0) / fbaPs.length) * 100
    : 0;

  // ── 2 new dimensions from history ──
  const sortedMonths = [...months].sort();

  // Market size: average monthly revenue over the last up-to-3 months
  let marketSize = 0;
  const recentMonths = sortedMonths.slice(-3);
  if (recentMonths.length > 0 && history.length > 0) {
    let totalRevenue = 0;
    let monthCount = 0;
    recentMonths.forEach(m => {
      history.forEach(h => {
        const d = h.history[m];
        if (d) totalRevenue += d.revenue;
      });
      monthCount++;
    });
    marketSize = monthCount > 0 ? totalRevenue / monthCount : 0;
  }

  // Growth: compare last 6 months vs prior 6 months
  let growthRate = 0;
  if (sortedMonths.length >= 12 && history.length > 0) {
    const recent6 = sortedMonths.slice(-6);
    const prior6 = sortedMonths.slice(-12, -6);

    const sumRev = (mlist: string[]) => {
      let sum = 0;
      mlist.forEach(m => {
        history.forEach(h => {
          const d = h.history[m];
          if (d) sum += d.revenue;
        });
      });
      return sum;
    };

    const recentSum = sumRev(recent6);
    const priorSum = sumRev(prior6);

    if (priorSum > 0 && recentSum > 0) {
      // CAGR-like: (recent/prior)^(1/periods) - 1 where periods=1 (half-year to half-year)
      growthRate = ((recentSum / priorSum) - 1) * 100;
    }
  }

  // ── Build 8 dimensions ──
  const makeScore = (raw: number, thresholds: { low: number; mid: number; high: number }, direction: 'lower' | 'higher'): { score: number; tier: 'red' | 'yellow' | 'green' } => {
    if (direction === 'lower') {
      if (raw <= thresholds.low) return { score: 85, tier: 'green' };
      if (raw <= thresholds.mid) return { score: 55, tier: 'yellow' };
      return { score: 25, tier: 'red' };
    } else {
      if (raw >= thresholds.high) return { score: 85, tier: 'green' };
      if (raw >= thresholds.mid) return { score: 55, tier: 'yellow' };
      return { score: 25, tier: 'red' };
    }
  };

  const concScore = makeScore(concentration, { low: rules.concentrationMaxLow, mid: rules.concentrationMaxMid, high: rules.concentrationMaxLow }, 'lower');
  const reviewScore = makeScore(avgReviews, { low: rules.reviewThresholdLow, mid: rules.reviewThresholdMid, high: rules.reviewThresholdLow }, 'lower');
  const cvScore = makeScore(priceCV, { low: rules.priceCvMaxLow, mid: rules.priceCvMaxMid, high: rules.priceCvMaxLow }, 'lower');
  const newScore = makeScore(newProductRatio, { low: rules.newProductMinStable, mid: rules.newProductMinActive, high: rules.newProductMinActive }, 'higher');
  const ratingScore = makeScore(avgRating, { low: rules.ratingThresholdPoor, mid: rules.ratingThresholdPoor, high: rules.ratingThresholdGood }, 'higher');
  const fbaScore = makeScore(avgFbaRatio, { low: rules.fbaRatioMaxLow, mid: rules.fbaRatioMaxMid, high: rules.fbaRatioMaxLow }, 'lower');
  const sizeScore = makeScore(marketSize, { low: rules.marketSizeMinMid, mid: rules.marketSizeMinHigh, high: rules.marketSizeMinHigh }, 'higher');
  const growthScore = makeScore(growthRate, { low: rules.growthMinMid, mid: rules.growthMinHigh, high: rules.growthMinHigh }, 'higher');

  const dimensions: DimRule[] = [
    {
      label: '市场体量', icon: 'dollarsign', valueKey: 'marketSize',
      display: fmtMoney(marketSize),
      value: sizeScore.score, scoreText: `${sizeScore.score} 分`,
      tiers: [{ max: 33, color: 'red', label: '小' }, { max: 66, color: 'yellow', label: '中' }, { max: 100, color: 'green', label: '大' }],
    },
    {
      label: '增长趋势', icon: 'trendingup', valueKey: 'growth',
      display: `${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}%`,
      value: growthScore.score, scoreText: `${growthScore.score} 分`,
      tiers: [{ max: 30, color: 'red', label: '下降' }, { max: 60, color: 'yellow', label: '平稳' }, { max: 100, color: 'green', label: '增长' }],
    },
    {
      label: '市场集中度', icon: 'target',
      valueKey: 'concentration', display: `${concentration.toFixed(0)}%`,
      value: concScore.score, scoreText: `${concScore.score} 分`,
      tiers: [{ max: 30, color: 'green', label: '分散' }, { max: 65, color: 'yellow', label: '中度' }, { max: 100, color: 'red', label: '集中' }],
    },
    {
      label: '评论壁垒', icon: 'shield',
      valueKey: 'reviews', display: avgReviews >= 1000 ? `${(avgReviews / 1000).toFixed(1)}k` : `${avgReviews.toFixed(0)}`,
      value: reviewScore.score, scoreText: `${reviewScore.score} 分`,
      tiers: [{ max: 30, color: 'green', label: '低壁垒' }, { max: 65, color: 'yellow', label: '中壁垒' }, { max: 100, color: 'red', label: '高壁垒' }],
    },
    {
      label: '价格离散度', icon: 'barchart',
      valueKey: 'priceDispersion', display: `${(priceCV * 100).toFixed(0)}%`,
      value: cvScore.score, scoreText: `${cvScore.score} 分`,
      tiers: [{ max: 30, color: 'green', label: '趋同' }, { max: 65, color: 'yellow', label: '分化' }, { max: 100, color: 'red', label: '割裂' }],
    },
    {
      label: '新品活力', icon: 'sparkles',
      valueKey: 'newProduct', display: `${newProductRatio.toFixed(1)}%`,
      value: newScore.score, scoreText: `${newScore.score} 分`,
      tiers: [{ max: 30, color: 'red', label: '老化' }, { max: 60, color: 'yellow', label: '平稳' }, { max: 100, color: 'green', label: '活跃' }],
    },
    {
      label: '评分空间', icon: 'star',
      valueKey: 'rating', display: avgRating.toFixed(1),
      value: ratingScore.score, scoreText: `${ratingScore.score} 分`,
      tiers: [{ max: 35, color: 'red', label: '差' }, { max: 65, color: 'yellow', label: '良' }, { max: 100, color: 'green', label: '优' }],
    },
    {
      label: 'FBA成本率', icon: 'trendingup',
      valueKey: 'fbaCost', display: `${avgFbaRatio.toFixed(1)}%`,
      value: fbaScore.score, scoreText: `${fbaScore.score} 分`,
      tiers: [{ max: 30, color: 'green', label: '低' }, { max: 65, color: 'yellow', label: '中' }, { max: 100, color: 'red', label: '高' }],
    },
  ];

  const greenCount = dimensions.filter(d => getTier(d.value, d.tiers) === 'green').length;
  const totalScore = Math.round(dimensions.reduce((s, d) => s + d.value, 0) / dimensions.length);
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
              <span className="text-xs font-medium text-slate-500">· 8 维自动评分</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-500">
                综合评定：<span className="text-sm text-slate-800">{summaryGrade}</span>
                <span className="text-[10px] text-slate-400 ml-1">（均分 {totalScore} 分 · {greenCount}/8 绿灯）</span>
              </span>
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition-colors border border-slate-200"
                title="查看评分规则并调整"
              >
                <Settings className="w-3 h-3" />
                规则
              </button>
            </div>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          {dimensions.map(dim => (
            <ScoreBar dim={dim} />
          ))}
        </div>
      </div>
    </>
  );
};
