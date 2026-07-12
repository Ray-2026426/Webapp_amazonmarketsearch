import React, { useState } from 'react';
import { Product } from '../utils/parser';
import { Target, Shield, TrendingUp, Sparkles, Star, BarChart3, Info, Settings, X, RotateCcw } from 'lucide-react';

interface DimRule {
  label: string;
  icon: string;
  tooltip: string;
  valueKey: string;       // 计算函数名
  display: string;        // 展示文本（由计算逻辑填充）
  value: number;          // 当前得分（0-100，由计算逻辑填充）
  tiers: { max: number; color: string; label: string }[];
}

interface ScorecardRules {
  concentrationMaxLow: number;    // ≤此值为"分散"（绿）
  concentrationMaxMid: number;    // ≤此值为"中度"（黄），超为"集中"（红）
  reviewThresholdLow: number;     // ≤此值为低壁垒
  reviewThresholdMid: number;     // ≤此值为中壁垒
  priceCvMaxLow: number;          // CV ≤此为趋同
  priceCvMaxMid: number;          // CV ≤此为分化
  newProductMinActive: number;    // ≥此为活跃（%）
  newProductMinStable: number;    // ≥此为平稳（%）
  ratingThresholdPoor: number;    // <此为差
  ratingThresholdGood: number;    // ≥此为良，≥4.3为优
  fbaRatioMaxLow: number;         // ≤此为低（%）
  fbaRatioMaxMid: number;         // ≤此为中（%）
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
};

interface MarketScorecardProps {
  products: Product[];
}

const ScoreBar = ({ dim }: { dim: DimRule }) => {
  const activeColor = getTier(dim.value, dim.tiers);
  const s = SCORE_COLORS[activeColor];

  return (
    <div className={`relative overflow-hidden rounded-xl border ${s.border} ${s.bg} p-3 ring-1 ${s.ring}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={s.text}>{ICON_MAP[dim.icon] || dim.icon}</span>
          <span className="text-xs font-semibold text-slate-700">{dim.label}</span>
        </div>
        <span className={`text-sm font-bold font-mono ${s.text}`}>{dim.display}</span>
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

  const RuleRow = ({ label, value, onChange, unit, min = 0, max = 100, step = 1 }: {
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
          className="w-16 px-1.5 py-1 text-xs text-right font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        {unit && <span className="text-[10px] text-slate-400 w-6">{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'doc' ? (
            <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
              <div className="bg-indigo-50 rounded-xl p-3 text-indigo-800 border border-indigo-100">
                <p className="font-semibold mb-1">💡 评分说明</p>
                <p>6 个维度各分 3 档（绿/黄/红），在当前市场数据上自动计算。你可以切换到「调整阈值」修改各档位的判断标准。</p>
              </div>

              <div className="space-y-3">
                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <span className="text-emerald-600">●</span> 市场集中度
                  </div>
                  <p>
                    计算 Top10 ASIN 的销量占全市场比。<br />
                    <span className="text-emerald-600 font-medium">分散 ≤{rules.concentrationMaxLow}%</span> · <span className="text-amber-600 font-medium">中度 ≤{rules.concentrationMaxMid}%</span> · <span className="text-rose-600 font-medium">集中 &gt;{rules.concentrationMaxMid}%</span><br />
                    越低说明市场份额越分散，新品进入难度越小。
                  </p>
                </div>

                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <span className="text-emerald-600">●</span> 评论壁垒
                  </div>
                  <p>
                    全市场 ASIN 评论数的算术平均值。<br />
                    <span className="text-emerald-600 font-medium">低壁垒 ≤{rules.reviewThresholdLow}</span> · <span className="text-amber-600 font-medium">中壁垒 ≤{rules.reviewThresholdMid}</span> · <span className="text-rose-600 font-medium">高壁垒 &gt;{rules.reviewThresholdMid}</span><br />
                    越低说明现有品评论积累不多，新品不需要大量评论就能竞争。
                  </p>
                </div>

                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <span className="text-emerald-600">●</span> 价格离散度
                  </div>
                  <p>
                    价格变异系数 CV = 标准差 / 均值。<br />
                    <span className="text-emerald-600 font-medium">趋同 ≤{rules.priceCvMaxLow}</span> · <span className="text-amber-600 font-medium">分化 ≤{rules.priceCvMaxMid}</span> · <span className="text-rose-600 font-medium">割裂 &gt;{rules.priceCvMaxMid}</span><br />
                    越低说明定价趋同，差异化定价空间有限（但竞争规则透明）；越高说明市场定价混乱，可尝试差异化。
                  </p>
                </div>

                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <span className="text-emerald-600">●</span> 新品活力
                  </div>
                  <p>
                    近 90 天内上架的 ASIN 占比。<br />
                    <span className="text-emerald-600 font-medium">活跃 ≥{rules.newProductMinActive}%</span> · <span className="text-amber-600 font-medium">平稳 ≥{rules.newProductMinStable}%</span> · <span className="text-rose-600 font-medium">老化 &lt;{rules.newProductMinStable}%</span><br />
                    越高说明新陈代谢快，新品不断入场抢占份额。
                  </p>
                </div>

                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <span className="text-emerald-600">●</span> 评分空间
                  </div>
                  <p>
                    全市场 ASIN 评分的算术平均值。<br />
                    <span className="text-rose-600 font-medium">差 &lt;{rules.ratingThresholdPoor}</span> · <span className="text-amber-600 font-medium">良 ≥{rules.ratingThresholdPoor}</span> · <span className="text-emerald-600 font-medium">优 ≥{rules.ratingThresholdGood}</span><br />
                    市场均分低于 {rules.ratingThresholdPoor} 可能是"差评重灾区"，新品有机会靠品质破局。
                  </p>
                </div>

                <div className="bg-white border border-slate-100 rounded-xl p-3">
                  <div className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <span className="text-emerald-600">●</span> FBA 成本率
                  </div>
                  <p>
                    FBA 费用 ÷ 售价的平均比值。<br />
                    <span className="text-emerald-600 font-medium">低 ≤{rules.fbaRatioMaxLow}%</span> · <span className="text-amber-600 font-medium">中 ≤{rules.fbaRatioMaxMid}%</span> · <span className="text-rose-600 font-medium">高 &gt;{rules.fbaRatioMaxMid}%</span><br />
                    越低说明物流成本对利润挤压越小。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="font-semibold text-slate-700 flex items-center gap-1.5 mb-1">
                <span className="text-emerald-600">●</span> 市场集中度
              </div>
              <RuleRow label="分散上限（≤此值绿灯）" value={draft.concentrationMaxLow} onChange={v => update('concentrationMaxLow', v)} unit="%" />
              <RuleRow label="中度假顶（≤此值黄灯）" value={draft.concentrationMaxMid} onChange={v => update('concentrationMaxMid', v)} unit="%" />

              <div className="font-semibold text-slate-700 flex items-center gap-1.5 mt-5 mb-1">
                <span className="text-emerald-600">●</span> 评论壁垒
              </div>
              <RuleRow label="低壁垒上限（≤此值绿灯）" value={draft.reviewThresholdLow} onChange={v => update('reviewThresholdLow', v)} max={5000} step={10} />
              <RuleRow label="中壁垒上限（≤此值黄灯）" value={draft.reviewThresholdMid} onChange={v => update('reviewThresholdMid', v)} max={50000} step={100} />

              <div className="font-semibold text-slate-700 flex items-center gap-1.5 mt-5 mb-1">
                <span className="text-emerald-600">●</span> 价格离散度（CV）
              </div>
              <RuleRow label="趋同上限（≤此值绿灯）" value={draft.priceCvMaxLow} onChange={v => update('priceCvMaxLow', v)} step={0.05} />
              <RuleRow label="分化上限（≤此值黄灯）" value={draft.priceCvMaxMid} onChange={v => update('priceCvMaxMid', v)} step={0.05} />

              <div className="font-semibold text-slate-700 flex items-center gap-1.5 mt-5 mb-1">
                <span className="text-emerald-600">●</span> 新品活力
              </div>
              <RuleRow label="活跃下限（≥此值绿灯）" value={draft.newProductMinActive} onChange={v => update('newProductMinActive', v)} unit="%" />
              <RuleRow label="平稳下限（≥此值黄灯）" value={draft.newProductMinStable} onChange={v => update('newProductMinStable', v)} unit="%" />

              <div className="font-semibold text-slate-700 flex items-center gap-1.5 mt-5 mb-1">
                <span className="text-emerald-600">●</span> 评分空间
              </div>
              <RuleRow label="差评起点（<此值红灯）" value={draft.ratingThresholdPoor} onChange={v => update('ratingThresholdPoor', v)} min={1} max={5} step={0.1} />
              <RuleRow label="优质起点（≥此值绿灯）" value={draft.ratingThresholdGood} onChange={v => update('ratingThresholdGood', v)} min={1} max={5} step={0.1} />

              <div className="font-semibold text-slate-700 flex items-center gap-1.5 mt-5 mb-1">
                <span className="text-emerald-600">●</span> FBA 成本率
              </div>
              <RuleRow label="低费率上限（≤此值绿灯）" value={draft.fbaRatioMaxLow} onChange={v => update('fbaRatioMaxLow', v)} unit="%" />
              <RuleRow label="中费率上限（≤此值黄灯）" value={draft.fbaRatioMaxMid} onChange={v => update('fbaRatioMaxMid', v)} unit="%" />

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

export const MarketScorecard: React.FC<MarketScorecardProps> = ({ products }) => {
  const [rules, setRules] = useState<ScorecardRules>(loadRules);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSaveRules = (newRules: ScorecardRules) => {
    setRules(newRules);
    saveRules(newRules);
    setIsModalOpen(false);
  };

  if (products.length === 0) return null;

  // ── 计算各维度 ──
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

  // ── 生成维度（标记都用 green/yellow/red，新品活力逻辑反转）──
  const dimensions: DimRule[] = [
    {
      label: '市场集中度', icon: 'target',
      valueKey: 'concentration', display: `${concentration.toFixed(0)}%`,
      tooltip: 'Top10 销量占大盘比。',
      value: Math.min(Math.min((concentration / rules.concentrationMaxMid) * 100, 100), concentration <= rules.concentrationMaxLow ? 20 : concentration > rules.concentrationMaxMid ? 80 : 55),
      tiers: [
        { max: 30, color: 'green', label: '分散' },
        { max: 65, color: 'yellow', label: '中度' },
        { max: 100, color: 'red', label: '集中' },
      ],
    },
    {
      label: '评论壁垒', icon: 'shield',
      valueKey: 'reviews', display: avgReviews >= 1000 ? `${(avgReviews / 1000).toFixed(1)}k` : `${avgReviews.toFixed(0)}`,
      tooltip: '全市场 ASIN 平均评论数。',
      value: Math.min(Math.min((avgReviews / (rules.reviewThresholdMid + 1)) * 100, 100), avgReviews <= rules.reviewThresholdLow ? 20 : avgReviews > rules.reviewThresholdMid ? 80 : 55),
      tiers: [
        { max: 30, color: 'green', label: '低壁垒' },
        { max: 65, color: 'yellow', label: '中壁垒' },
        { max: 100, color: 'red', label: '高壁垒' },
      ],
    },
    {
      label: '价格离散度', icon: 'barchart',
      valueKey: 'priceDispersion', display: `${(priceCV * 100).toFixed(0)}%`,
      tooltip: '价格变异系数。',
      value: Math.min(Math.min((priceCV / rules.priceCvMaxMid) * 100, 100), priceCV <= rules.priceCvMaxLow ? 25 : priceCV > rules.priceCvMaxMid ? 80 : 55),
      tiers: [
        { max: 30, color: 'green', label: '趋同' },
        { max: 65, color: 'yellow', label: '分化' },
        { max: 100, color: 'red', label: '割裂' },
      ],
    },
    {
      label: '新品活力', icon: 'sparkles',
      valueKey: 'newProduct', display: `${newProductRatio.toFixed(1)}%`,
      tooltip: '近90天上架占比。',
      // 反转：越高越好
      value: Math.min(newProductRatio >= rules.newProductMinActive ? 85 : newProductRatio >= rules.newProductMinStable ? 60 : 25, 100),
      tiers: [
        { max: 30, color: 'red', label: '老化' },
        { max: 60, color: 'yellow', label: '平稳' },
        { max: 100, color: 'green', label: '活跃' },
      ],
    },
    {
      label: '评分空间', icon: 'star',
      valueKey: 'rating', display: avgRating.toFixed(1),
      tooltip: '全市场平均评分。',
      value: Math.min(avgRating >= rules.ratingThresholdGood ? 85 : avgRating >= rules.ratingThresholdPoor ? 55 : 25, 100),
      tiers: [
        { max: 35, color: 'red', label: '差' },
        { max: 65, color: 'yellow', label: '良' },
        { max: 100, color: 'green', label: '优' },
      ],
    },
    {
      label: 'FBA成本率', icon: 'trendingup',
      valueKey: 'fbaCost', display: `${avgFbaRatio.toFixed(1)}%`,
      tooltip: 'FBA费/售价均值。',
      value: Math.min(Math.min((avgFbaRatio / rules.fbaRatioMaxMid) * 100, 100), avgFbaRatio <= rules.fbaRatioMaxLow ? 25 : avgFbaRatio > rules.fbaRatioMaxMid ? 80 : 55),
      tiers: [
        { max: 30, color: 'green', label: '低' },
        { max: 65, color: 'yellow', label: '中' },
        { max: 100, color: 'red', label: '高' },
      ],
    },
  ];

  const greenCount = dimensions.filter(d => getTier(d.value, d.tiers) === 'green').length;
  const summaryGrade = greenCount >= 4 ? '🟢 机会充足' : greenCount >= 2 ? '🟡 谨慎进入' : '🔴 竞争激烈';

  return (
    <>
      <RulesModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} rules={rules} onSave={handleSaveRules} />

      <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-black/5 bg-gradient-to-r from-indigo-50/50 via-white to-emerald-50/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-bold text-slate-800">市场准入评估</span>
              <span className="text-xs font-medium text-slate-500">· 6 维自动评分</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-500">
                综合评定：<span className="text-sm text-slate-800">{summaryGrade}</span>
                <span className="text-[10px] text-slate-400 ml-1">（{greenCount}/6）</span>
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
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {dimensions.map(dim => (
            <ScoreBar dim={dim} />
          ))}
        </div>
      </div>
    </>
  );
};
