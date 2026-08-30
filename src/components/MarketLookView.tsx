import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import { SegmentScoreCards } from './SegmentScoreCards';
import {
  computeMarketProgress,
  loadMarketLook,
  makeMarketEvidence,
  saveMarketLook,
  type MarketContext,
  type MarketLookData,
} from '../utils/marketLook';
import { updateLookProgress } from '../utils/projectStore';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';
import type { SegmentScoreResult } from '../utils/segmentScore';
import type { HistoryRecord, Product } from '../utils/parser';
import { loadUserLook, type UserLookData } from '../utils/userLook';
import { MarketTrendChart } from './MarketTrendChart';
import { SeasonalHeatmap } from './SeasonalHeatmap';
import { MarketConcentrationChart } from './MarketConcentrationChart';
import { OpportunityScanner } from './OpportunityScanner';
import { BrandLeaderboard } from './BrandLeaderboard';
import { PriceDistributionChart } from './PriceDistributionChart';
import { RatingDistributionChart } from './RatingDistributionChart';
import { SellerTypeChart } from './SellerTypeChart';
import { SellerLocationChart } from './SellerLocationChart';
import { LaunchDateChart } from './LaunchDateChart';
import { NewVsOldChart } from './NewVsOldChart';
import { BsrDistributionChart } from './BsrDistributionChart';
import { PriceRatingChart } from './PriceRatingChart';
import { TopProductsTable } from './TopProductsTable';
import { runLookAnalysis } from '../utils/lookAi';

export function MarketLookView({
  userId,
  project,
  marketContext,
  products = [],
  history = [],
  onProjectChange,
  onOpenMarketTool,
  onNavigateCompetitor,
}: {
  userId: string;
  project: ResearchProject;
  marketContext: MarketContext;
  products?: Product[];
  history?: HistoryRecord[];
  onProjectChange: (updated: ResearchProject) => void;
  onOpenMarketTool?: () => void;
  onNavigateCompetitor?: () => void;
}) {
  const [data, setData] = useState<MarketLookData | null>(null);
  const [selectedScore, setSelectedScore] = useState<SegmentScoreResult | null>(null);
  const [userLook, setUserLook] = useState<UserLookData | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [generating, setGenerating] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadMarketLook(userId, project.id), loadUserLook(userId, project.id)]).then(([d, user]) => {
      if (!cancelled) {
        setData(d);
        setUserLook(user);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  const persist = useCallback(
    async (next: MarketLookData) => {
      await saveMarketLook(userId, project.id, next);
      const progress = computeMarketProgress(next);
      const updated = await updateLookProgress(userId, project.id, 'market', {
        ...project.fiveLookProgress.market,
        status: progress.status,
        completionPercent: progress.completionPercent,
        missingRequirements: progress.missingRequirements,
        updatedAt: new Date().toISOString(),
      });
      if (updated) onProjectChange(updated);
    },
    [userId, project.id, project.fiveLookProgress.market, onProjectChange]
  );

  const update = useCallback(
    (patch: Partial<MarketLookData>) => {
      if (!data) return;
      const next = { ...data, ...patch };
      setData(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persist(next);
      }, 500);
    },
    [data, persist]
  );

  if (!data || !userLook) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载看市场结论...
      </div>
    );
  }

  const progress = project.fiveLookProgress.market;
  const selectedSegment = data.selectedOpportunitySegment?.trim() || '';
  const evidence = data.keyEvidences.filter(Boolean);
  const risks = data.risks.filter(Boolean);
  const questions = data.openQuestions.filter(Boolean);
  const selectedNeeds = userLook.unmetNeedCandidates.filter((candidate) => candidate.selectedForSegmentation);
  const userDataStale = Boolean(data.sourceUserUpdatedAt && data.sourceUserUpdatedAt !== userLook.updatedAt);
  const judgement = data.attractiveness.trim()
    ? data.attractiveness.trim()
    : selectedSegment
      ? `${selectedSegment} 细分市场已选中。`
      : '还没有形成可用于机会判断的细分市场结论。';

  const generateMarketConclusion = async () => {
    const selectedNeed = selectedNeeds.find((need) => need.id === data.selectedNeedId);
    if (!data.selectedOpportunitySegment?.trim() || !selectedNeed) {
      toast.error('请先选择目标细分市场，并关联一条来自看用户的需求分类。');
      return;
    }
    setGenerating(true);
    try {
      const result = await runLookAnalysis('market', {
        selectedSegment: data.selectedOpportunitySegment,
        selectedNeed,
      });
      if (!result.ok || !result.data) throw new Error(result.error || 'AI 未返回有效市场结论');
      const next: MarketLookData = {
        ...data,
        attractiveness: String(result.data.attractiveness || ''),
        keyEvidences: Array.isArray(result.data.keyEvidences) ? result.data.keyEvidences.map(String).filter(Boolean).slice(0, 5) : [],
        risks: Array.isArray(result.data.risks) ? result.data.risks.map(String).filter(Boolean).slice(0, 5) : [],
        openQuestions: Array.isArray(result.data.openQuestions) ? result.data.openQuestions.map(String).filter(Boolean).slice(0, 5) : [],
        evidence: makeMarketEvidence(marketContext),
        sourceUserUpdatedAt: userLook.updatedAt,
      };
      await persist(next);
      setData(next);
      toast.success('目标细分市场结论已生成');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成市场结论失败');
    } finally {
      setGenerating(false);
    }
  };

  if (showDetail && selectedSegment) {
    const segmentProducts = products.filter((product) => {
      const mapped = marketContext.asinToSegment?.[product.asin];
      return !marketContext.asinToSegment || mapped === selectedSegment;
    });
    const safeProducts = segmentProducts.length ? segmentProducts : products;
    const asinSet = new Set(safeProducts.map((product) => product.asin));
    const segmentHistory = history.filter((record) => asinSet.has(record.asin));
    const months = marketContext.months ?? [];
    const mapping = marketContext.asinToSegment ?? {};
    const domain = marketContext.domain ?? 'amazon.com';
    const totalRevenue = safeProducts.reduce((sum, product) => sum + (product.monthlyRevenue || 0), 0);
    const totalSales = safeProducts.reduce((sum, product) => sum + (product.monthlySales || 0), 0);
    const avgPrice = safeProducts.length ? safeProducts.reduce((sum, product) => sum + (product.price || 0), 0) / safeProducts.length : 0;
    const top10Sales = safeProducts.slice().sort((a, b) => b.monthlySales - a.monthlySales).slice(0, 10).reduce((sum, product) => sum + product.monthlySales, 0);
    const concentration = totalSales ? (top10Sales / totalSales) * 100 : 0;
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <button type="button" onClick={() => setShowDetail(false)} className="mt-0.5 w-9 h-9 rounded-xl border border-black/8 bg-white text-[#86868b] hover:text-indigo-600 flex items-center justify-center">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <p className="text-xs font-semibold text-indigo-600">看市场 / 细分市场详情</p>
              <h3 className="text-xl font-bold text-[#1d1d1f] mt-1">{selectedSegment}</h3>
              <p className="text-sm text-[#86868b] mt-1">趋势、体量、垄断、价格带、卖家分布与新品结构均按当前细分口径过滤。</p>
            </div>
          </div>
          <span className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">{safeProducts.length} 个 ASIN</span>
        </div>
        {!segmentProducts.length && products.length > 0 && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            当前数据还没有 ASIN→细分映射，以下暂展示全市场数据，不能作为该细分的独立证据。
          </div>
        )}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MarketMetric label="月销售额" value={`$${Math.round(totalRevenue).toLocaleString()}`} />
          <MarketMetric label="月销量" value={Math.round(totalSales).toLocaleString()} />
          <MarketMetric label="平均价格" value={`$${avgPrice.toFixed(2)}`} />
          <MarketMetric label="Top10 销量集中度" value={`${concentration.toFixed(1)}%`} />
        </div>
        <MarketTrendChart history={segmentHistory} months={months} products={safeProducts} asinToSegment={mapping} domain={domain} />
        <SeasonalHeatmap history={segmentHistory} months={months} domain={domain} />
        <MarketConcentrationChart products={safeProducts} history={segmentHistory} months={months} domain={domain} />
        <OpportunityScanner products={safeProducts} history={segmentHistory} months={months} domain={domain} asinToSegment={mapping} />
        <BrandLeaderboard products={safeProducts} history={segmentHistory} months={months} domain={domain} asinToSegment={mapping} />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <PriceDistributionChart products={safeProducts} domain={domain} history={segmentHistory} months={months} asinToSegment={mapping} />
          <RatingDistributionChart products={safeProducts} domain={domain} history={segmentHistory} months={months} selectedMonths={months} asinToSegment={mapping} />
          <SellerTypeChart products={safeProducts} domain={domain} history={segmentHistory} months={months} selectedMonths={months} asinToSegment={mapping} />
          <SellerLocationChart products={safeProducts} domain={domain} history={segmentHistory} months={months} selectedMonths={months} asinToSegment={mapping} />
          <LaunchDateChart products={safeProducts} domain={domain} history={segmentHistory} months={months} asinToSegment={mapping} />
          <NewVsOldChart products={safeProducts} domain={domain} history={segmentHistory} months={months} asinToSegment={mapping} />
          <BsrDistributionChart products={safeProducts} domain={domain} history={segmentHistory} months={months} asinToSegment={mapping} />
          <PriceRatingChart products={safeProducts} history={segmentHistory} months={months} domain={domain} asinToSegment={mapping} />
        </div>
        <TopProductsTable products={safeProducts} history={segmentHistory} months={months} domain={domain} asinToSegment={mapping} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Market"
        title="看市场 · 细分市场结论"
        judgement={judgement}
        description=""
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[progress.status]} · {progress.completionPercent}%
          </span>
        }
        metrics={[
          { label: '目标细分', value: selectedSegment || '未选择', tone: selectedSegment ? 'brand' : 'warn' },
          { label: '商品样本', value: `${marketContext.sampleSize || data.evidence?.sampleSize || 0}`, tone: marketContext.sampleSize ? 'brand' : 'neutral' },
          { label: '历史月份', value: `${marketContext.months?.length || data.evidence?.months?.length || 0}`, tone: marketContext.months?.length ? 'brand' : 'neutral' },
          { label: '市场证据', value: `${selectedScore ? selectedScore.dimensions.length : evidence.length}`, tone: selectedScore || evidence.length >= 3 ? 'good' : 'neutral' },
        ]}
        sections={[]}
      />

      <Card className={userDataStale ? 'border-amber-200 bg-amber-50/40' : ''}>
        <div className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[#424245]">需求主线</p>
            <p className="text-sm text-[#1d1d1f] mt-1">
              {selectedNeeds.length ? selectedNeeds.map((item) => item.category || item.needStatement).join(' · ') : '尚未从看用户选择细分标准'}
            </p>
            {userDataStale && <p className="text-xs text-amber-700 mt-1">看用户内容已更新，请重新确认当前细分是否仍对应这些需求。</p>}
          </div>
          {selectedNeeds.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-semibold text-[#86868b]">
              当前细分对应
              <select
                value={data.selectedNeedId ?? ''}
                onChange={(event) => update({ selectedNeedId: event.target.value, sourceUserUpdatedAt: userLook.updatedAt })}
                className="rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">请选择需求分类</option>
                {selectedNeeds.map((need) => <option key={need.id} value={need.id}>{need.category || need.needStatement}</option>)}
              </select>
            </label>
          )}
        </div>
      </Card>

      <SegmentScoreCards
        onOpenMarketTool={onOpenMarketTool ?? (() => {})}
        selectedOpportunitySegment={data.selectedOpportunitySegment}
        onSelectOpportunitySegment={(segment) => update({
          selectedOpportunitySegment: segment ?? '',
          selectedNeedId: data.selectedNeedId || (selectedNeeds.length === 1 ? selectedNeeds[0].id : ''),
          sourceUserUpdatedAt: userLook.updatedAt,
        })}
        onSelectScore={setSelectedScore}
      />

      <div className="flex justify-end">
        <button type="button" onClick={() => void generateMarketConclusion()} disabled={generating || !selectedSegment || !data.selectedNeedId} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}AI 生成当前细分结论
        </button>
      </div>

      <Card>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f]">
                {selectedSegment ? `${selectedSegment} · 细分结论` : '细分市场详情'}
              </p>
              <p className="text-xs text-[#86868b] mt-0.5">点击上方细分市场卡片后，这里展示该细分的判断依据。</p>
            </div>
            <div className="flex items-center gap-2">
              {onOpenMarketTool && (
                <button type="button" onClick={onOpenMarketTool} className="inline-flex items-center gap-1.5 rounded-xl border border-black/8 bg-white px-3 py-2 text-xs font-semibold text-[#424245] hover:text-indigo-600">
                  回到市场大盘细节 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              {onNavigateCompetitor && selectedSegment && (
                <button type="button" onClick={onNavigateCompetitor} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700">
                  去看竞对 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              {selectedSegment && (
                <button type="button" onClick={() => setShowDetail(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#1d1d1f] px-3 py-2 text-xs font-semibold text-white hover:bg-black">
                  查看完整细分大盘 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
            <SummaryBox title="进入判断" items={selectedScore ? buildSegmentJudgement(selectedScore) : (data.attractiveness ? [data.attractiveness] : [])} emptyText="暂无市场总结。" />
            <SummaryBox title="关键证据" items={selectedScore ? buildSegmentEvidence(selectedScore) : evidence} emptyText="暂无关键证据。" />
            <SummaryBox title="风险 / 待验证" items={selectedScore ? buildSegmentRisks(selectedScore) : [...risks, ...questions]} emptyText="暂无风险或待验证问题。" />
          </div>
        </div>
      </Card>
    </div>
  );
}

function MarketMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-black/5 bg-white px-4 py-3"><p className="text-[11px] text-[#86868b]">{label}</p><p className="text-lg font-bold text-[#1d1d1f] mt-1">{value}</p></div>;
}

function buildSegmentJudgement(score: SegmentScoreResult): string[] {
  const grade = score.opportunity >= 70 ? '建议进入' : score.opportunity >= 45 ? '先验证再进入' : '暂缓进入';
  return [`${grade}：综合机会分 ${score.opportunity}。该分数使用市场准入评估的 8 个维度加权计算，避免只看趋势、体量和竞争三项。`];
}

function buildSegmentEvidence(score: SegmentScoreResult): string[] {
  return [
    `样本 ${score.productCount} 个，月销额 $${Math.round(score.totalRevenue).toLocaleString()}，均价 $${score.avgPrice.toFixed(2)}。`,
    `Top ASIN：${score.topAsins.join(', ') || '-'}`,
    ...score.dimensions.slice(0, 4).map((d) => `${d.label}：${d.display}，${d.score}分，权重 ${d.weight}`),
  ];
}

function buildSegmentRisks(score: SegmentScoreResult): string[] {
  if (score.confidenceNotes.length) return score.confidenceNotes;
  const weak = score.dimensions.filter((d) => d.score < 45).slice(0, 3);
  return weak.length ? weak.map((d) => `${d.label}偏弱，需要在看竞品或看用户中继续验证。`) : ['暂无明显数据覆盖风险，下一步重点验证竞品壁垒和用户未满足需求。'];
}

function SummaryBox({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-[#fafafa] p-4 min-h-[140px]">
      <p className="text-xs font-semibold text-[#424245] mb-2">{title}</p>
      {items.length ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <p key={`${item}-${index}`} className="text-sm text-[#424245] leading-6">
              {item}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#aeaeb2] leading-6">{emptyText}</p>
      )}
    </div>
  );
}
