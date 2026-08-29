import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Gauge, Layers, Loader2, RotateCcw, Settings, X } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  DEFAULT_SEGMENT_SCORE_WEIGHTS,
  SEGMENT_SCORE_LABELS,
  scoreSegments,
  type SegmentScoreDimKey,
  type SegmentScoreResult,
  type SegmentScoreWeights,
} from '../utils/segmentScore';
import { gatherGlobalMarketData } from '../utils/lookAi';

const STORAGE_KEY = 'amz_segment_score_weights';

function loadWeights(): SegmentScoreWeights {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SEGMENT_SCORE_WEIGHTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SEGMENT_SCORE_WEIGHTS };
}

function saveWeights(weights: SegmentScoreWeights): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(weights));
  } catch {
    /* ignore */
  }
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-600';
  if (score >= 45) return 'text-amber-600';
  return 'text-rose-500';
}

function scoreBarColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 45) return 'bg-amber-500';
  return 'bg-rose-500';
}

function DimBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-[11px] text-[#86868b]">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-black/5 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', scoreBarColor(value))} style={{ width: `${value}%` }} />
      </div>
      <span className={cn('w-7 text-right text-[11px] font-semibold tabular-nums', scoreColor(value))}>{value}</span>
    </div>
  );
}

export function SegmentScoreCards({
  onOpenMarketTool,
  onSelectOpportunitySegment,
  selectedOpportunitySegment,
  onCaptured,
  onSelectScore,
}: {
  onOpenMarketTool: () => void;
  onSelectOpportunitySegment?: (segment: string | null) => void;
  selectedOpportunitySegment?: string;
  onCaptured?: (segments: string[]) => void;
  onSelectScore?: (score: SegmentScoreResult | null) => void;
}) {
  const [results, setResults] = useState<SegmentScoreResult[] | null>(null);
  const [hasSegments, setHasSegments] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [weights, setWeights] = useState<SegmentScoreWeights>(loadWeights);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [detail, setDetail] = useState<SegmentScoreResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const g = await gatherGlobalMarketData();
    setLoading(false);
    if (!g.segments || g.segments.length === 0) {
      setHasSegments(false);
      setResults(null);
      return;
    }
    setHasSegments(true);
    const scored = scoreSegments(g.segments, g.asinToSegment, g.products, g.history, { weights });
    setResults(scored);
    onCaptured?.(g.segments);
    const current = selectedOpportunitySegment || selected;
    onSelectScore?.(scored.find((s) => s.segment === current) ?? null);
  }, [onCaptured, onSelectScore, selected, selectedOpportunitySegment, weights]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyWeights = (next: SegmentScoreWeights) => {
    setWeights(next);
    saveWeights(next);
  };

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">细分市场评分</p>
            <span className="text-[11px] text-[#aeaeb2]">8维准入模型 · 加权评分</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWeightsOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-medium text-[#86868b] hover:text-indigo-600 hover:border-indigo-200 transition-all"
            >
              <Settings className="w-3.5 h-3.5" /> 权重
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-medium text-[#86868b] hover:text-indigo-600 hover:border-indigo-200 transition-all"
            >
              <Gauge className="w-3.5 h-3.5" /> 刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-[#aeaeb2]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在计算细分评分...
          </div>
        ) : !hasSegments ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-700">还没有细分市场</p>
                <p className="text-xs text-amber-700/80 mt-1 leading-relaxed">
                  先在市场大盘里完成细分或 AI 分类，再回来看每个细分的准入评分。
                </p>
                <button
                  type="button"
                  onClick={onOpenMarketTool}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
                >
                  回到市场大盘细节 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(results ?? []).map((r) => {
              const currentSelected = selectedOpportunitySegment ?? selected ?? '';
              const isSel = currentSelected === r.segment;
              return (
                <button
                  key={r.segment}
                  type="button"
                  onClick={() => {
                    const next = isSel ? null : r.segment;
                    setSelected(next);
                    onSelectOpportunitySegment?.(next);
                    onSelectScore?.(next ? r : null);
                    setDetail(r);
                  }}
                  className={cn(
                    'text-left rounded-2xl border p-4 transition-all',
                    isSel
                      ? 'border-indigo-300 ring-2 ring-indigo-500/20 bg-indigo-50/40'
                      : 'border-black/8 bg-white hover:border-indigo-200 hover:shadow-sm'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[#1d1d1f] truncate">{r.segment}</p>
                    <div className="shrink-0 flex items-baseline gap-0.5">
                      <span className={cn('text-xl font-bold tabular-nums', scoreColor(r.opportunity))}>{r.opportunity}</span>
                      <span className="text-[10px] text-[#aeaeb2]">分</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#aeaeb2] mt-0.5 mb-3">
                    {r.productCount} 商品 · ${Math.round(r.totalRevenue).toLocaleString()} 月销额
                  </p>
                  <div className="space-y-1.5">
                    {r.dimensions.slice(0, 4).map((dim) => (
                      <DimBar key={dim.key} label={dim.label} value={dim.score} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {weightsOpen && <WeightsModal weights={weights} onClose={() => setWeightsOpen(false)} onSave={applyWeights} />}
      {detail && <SegmentDetailModal score={detail} onClose={() => setDetail(null)} onOpenMarketTool={onOpenMarketTool} />}
    </Card>
  );
}

function WeightsModal({
  weights,
  onClose,
  onSave,
}: {
  weights: SegmentScoreWeights;
  onClose: () => void;
  onSave: (weights: SegmentScoreWeights) => void;
}) {
  const [draft, setDraft] = useState<SegmentScoreWeights>({ ...weights });
  const keys = Object.keys(DEFAULT_SEGMENT_SCORE_WEIGHTS) as SegmentScoreDimKey[];
  return (
    <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-black/8 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-[#1d1d1f]">细分市场评分权重</p>
            <p className="text-xs text-[#86868b] mt-0.5">与市场准入评估一致，0 表示该维度不参与总分。</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f5f5f7] flex items-center justify-center text-[#86868b]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {keys.map((key) => (
            <label key={key} className="flex items-center gap-3">
              <span className="w-24 text-xs font-semibold text-[#424245]">{SEGMENT_SCORE_LABELS[key]}</span>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={draft[key]}
                onChange={(e) => setDraft((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                className="flex-1 accent-indigo-600"
              />
              <span className="w-6 text-right text-sm font-bold tabular-nums text-[#1d1d1f]">{draft[key]}</span>
            </label>
          ))}
          <div className="flex items-center gap-2 pt-3">
            <button type="button" onClick={() => { onSave(draft); onClose(); }} className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              应用
            </button>
            <button type="button" onClick={() => setDraft({ ...DEFAULT_SEGMENT_SCORE_WEIGHTS })} className="inline-flex items-center gap-1.5 rounded-xl border border-black/8 bg-white px-3 py-2 text-sm font-semibold text-[#86868b] hover:text-indigo-600">
              <RotateCcw className="w-3.5 h-3.5" /> 默认
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SegmentDetailModal({
  score,
  onClose,
  onOpenMarketTool,
}: {
  score: SegmentScoreResult;
  onClose: () => void;
  onOpenMarketTool: () => void;
}) {
  const grade = score.opportunity >= 70 ? '建议进入' : score.opportunity >= 45 ? '先验证再进入' : '暂缓进入';
  return (
    <div className="fixed inset-0 z-[190] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[88vh] overflow-auto rounded-2xl bg-white shadow-2xl border border-black/8" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white border-b border-black/5 px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-indigo-600">细分市场详情</p>
            <h3 className="text-xl font-bold text-[#1d1d1f] mt-0.5">{score.segment}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onOpenMarketTool} className="inline-flex items-center gap-1.5 rounded-xl border border-black/8 bg-white px-3 py-2 text-xs font-semibold text-[#424245] hover:text-indigo-600">
              回到市场大盘细节 <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f5f5f7] flex items-center justify-center text-[#86868b]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="综合判断" value={grade} />
            <Metric label="机会分" value={`${score.opportunity} 分`} />
            <Metric label="商品样本" value={`${score.productCount}`} />
            <Metric label="月销额" value={`$${Math.round(score.totalRevenue).toLocaleString()}`} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {score.dimensions.map((dim) => (
              <div key={dim.key} className="rounded-xl border border-black/5 bg-[#fafafa] p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-xs font-semibold text-[#424245]">{dim.label} <span className="text-[#aeaeb2]">x{dim.weight}</span></p>
                  <p className={cn('text-sm font-bold tabular-nums', scoreColor(dim.score))}>{dim.score}分 · {dim.display}</p>
                </div>
                <div className="h-2 rounded-full bg-black/5 overflow-hidden">
                  <div className={cn('h-full rounded-full', scoreBarColor(dim.score))} style={{ width: `${dim.score}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Summary title="进入判断" items={[`${grade}。该判断基于市场体量、增长、集中度、评论壁垒、价格离散、新品活力、评分水平和 FBA 成本率的加权结果。`]} />
            <Summary title="关键证据" items={[`Top ASIN: ${score.topAsins.join(', ') || '-'}`, `均价 $${score.avgPrice.toFixed(2)}，平均评分 ${score.avgRating.toFixed(1)}`, ...score.dimensions.slice(0, 3).map((d) => `${d.label}: ${d.display} / ${d.score}分`)]} />
            <Summary title="风险 / 待验证" items={score.confidenceNotes.length ? score.confidenceNotes : ['数据覆盖较完整，可进入下一步竞品和用户验证。']} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-[#fafafa] px-3 py-3">
      <p className="text-[11px] text-[#86868b]">{label}</p>
      <p className="mt-1 text-sm font-bold text-[#1d1d1f]">{value}</p>
    </div>
  );
}

function Summary({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-black/5 bg-[#fafafa] p-4 min-h-[140px]">
      <p className="text-xs font-semibold text-[#424245] mb-2">{title}</p>
      <div className="space-y-2">
        {items.map((item, index) => (
          <p key={`${item}-${index}`} className="text-sm text-[#424245] leading-6">{item}</p>
        ))}
      </div>
    </div>
  );
}
