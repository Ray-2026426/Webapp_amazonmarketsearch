// 看市场 · 细分市场评分卡片：读取全局市场数据，用确定性公式给每个细分打分。
// 无细分时提示去「市场大盘」做细分/AI 智能分类；有细分时展示趋势/体量/竞争/机会分卡片。

import { useCallback, useEffect, useState } from 'react';
import { Layers, TrendingUp, Coins, Swords, Gauge, Loader2, ArrowRight, AlertTriangle } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { scoreSegments, type SegmentScoreResult } from '../utils/segmentScore';
import { gatherGlobalMarketData } from '../utils/lookAi';

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

function DimBar({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-[11px] text-[#86868b] flex items-center gap-1">{icon}{label}</span>
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
}: {
  onOpenMarketTool: () => void;
  onSelectOpportunitySegment?: (segment: string | null) => void;
  selectedOpportunitySegment?: string;
  onCaptured?: (segments: string[]) => void;
}) {
  const [results, setResults] = useState<SegmentScoreResult[] | null>(null);
  const [hasSegments, setHasSegments] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

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
    const scored = scoreSegments(g.segments, g.asinToSegment, g.products, g.history);
    setResults(scored);
    onCaptured?.(g.segments);
  }, [onCaptured]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">细分市场评分</p>
            <span className="text-[11px] text-[#aeaeb2]">趋势 × 体量 × 竞争 → 机会分</span>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-medium text-[#86868b] hover:text-indigo-600 hover:border-indigo-200 transition-all"
          >
            <Gauge className="w-3.5 h-3.5" /> 刷新
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-[#aeaeb2]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> 计算细分评分…
          </div>
        ) : !hasSegments ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-700">还没有细分市场</p>
                <p className="text-xs text-amber-700/80 mt-1 leading-relaxed">
                  细分评分需要先切分市场。请到「市场大盘」上传数据后做「细分管理 / AI 智能分类」，生成细分后再回来看评分。
                </p>
                <button
                  type="button"
                  onClick={onOpenMarketTool}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
                >
                  去市场大盘做细分 <ArrowRight className="w-3.5 h-3.5" />
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
                  <p className="text-[11px] text-[#aeaeb2] mt-0.5 mb-3">{r.productCount} 商品 · ${Math.round(r.totalRevenue).toLocaleString()} 月销</p>
                  <div className="space-y-1.5">
                    <DimBar label="趋势" value={r.trend} icon={<TrendingUp className="w-3 h-3" />} />
                    <DimBar label="体量" value={r.volume} icon={<Coins className="w-3 h-3" />} />
                    <DimBar label="竞争" value={r.competition} icon={<Swords className="w-3 h-3" />} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
