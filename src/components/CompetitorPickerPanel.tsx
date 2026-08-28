// 看竞品 · 自动挑选对标：从机会分最高的细分市场，选 1 头部 + 1 跟随者 + 1 新品。
import { useCallback, useEffect, useState } from 'react';
import { Crosshair, Crown, Star, Sparkles, Loader2, AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { pickCompetitors, type PickedCompetitor } from '../utils/competitorPicker';
import { scoreSegments } from '../utils/segmentScore';
import { gatherGlobalMarketData } from '../utils/lookAi';

const ROLE_META: Record<PickedCompetitor['role'], { label: string; icon: typeof Crown; cls: string }> = {
  head: { label: '头部', icon: Crown, cls: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  follower: { label: '跟随者', icon: Star, cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  newcomer: { label: '新品', icon: Sparkles, cls: 'bg-amber-50 text-amber-700 border-amber-100' },
};

export function CompetitorPickerPanel({
  onOpenCompetitorTool,
  onPicked,
  preferredSegment,
}: {
  onOpenCompetitorTool: () => void;
  onPicked: (asins: string[], segment: string) => void;
  preferredSegment?: string;
}) {
  const [state, setState] = useState<'loading' | 'empty' | 'nopick' | 'ready'>('loading');
  const [picked, setPicked] = useState<PickedCompetitor[]>([]);
  const [segment, setSegment] = useState('');
  const [opportunity, setOpportunity] = useState(0);
  const [applied, setApplied] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    const g = await gatherGlobalMarketData();
    if (!g.segments || g.segments.length === 0) {
      setState('empty');
      return;
    }
    if (!g.products || g.products.length === 0) {
      setState('nopick');
      return;
    }
    const scored = scoreSegments(g.segments, g.asinToSegment, g.products, g.history);
    const preferred = preferredSegment?.trim()
      ? scored.find((s) => s.segment === preferredSegment.trim())
      : null;
    const top = preferred ?? scored[0];
    if (!top || top.opportunity <= 0) {
      setState('nopick');
      return;
    }
    const topProducts = g.products.filter((p) => g.asinToSegment[p.asin] === top.segment);
    const list = pickCompetitors(topProducts, { sameBandTolerance: 0.2 });
    setPicked(list);
    setSegment(top.segment);
    setOpportunity(top.opportunity);
    setApplied(false);
    setState('ready');
  }, [preferredSegment]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">自动挑选对标竞品</p>
            <span className="text-[11px] text-[#aeaeb2]">机会细分 → 头部 / 跟随者 / 新品</span>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-medium text-[#86868b] hover:text-indigo-600 hover:border-indigo-200 transition-all"
          >
            {state === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} 重新挑选
          </button>
        </div>

        {state === 'loading' ? (
          <div className="flex items-center justify-center py-8 text-sm text-[#aeaeb2]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在分析机会细分…
          </div>
        ) : state === 'empty' ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-700">还没有细分市场</p>
                <p className="text-xs text-amber-700/80 mt-1 leading-relaxed">
                  自动挑选需要先切分市场。请到「市场大盘」做细分后，回到「看市场」查看机会细分，再来这里挑对标。
                </p>
                <button
                  type="button"
                  onClick={onOpenCompetitorTool}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
                >
                  去市场大盘 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : state === 'nopick' ? (
          <p className="text-xs text-[#aeaeb2] py-4 text-center">当前数据不足以挑选对标竞品（无商品或样本不足）。</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#86868b]">
              机会细分：<span className="font-semibold text-[#1d1d1f]">{segment}</span>（机会分 <span className="font-semibold text-indigo-600">{opportunity}</span>）
              {preferredSegment?.trim() && segment === preferredSegment.trim() && <span className="ml-2 text-[11px] text-indigo-600">来自看市场选择</span>}
              {applied && <span className="ml-2 text-[11px] text-emerald-600">✓ 已填充到样本池</span>}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {picked.map((p) => {
                const meta = ROLE_META[p.role];
                const Icon = meta.icon;
                return (
                  <div key={p.asin + p.role} className="rounded-2xl border border-black/8 p-3.5 bg-white">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border', meta.cls)}>
                        <Icon className="w-3 h-3" /> {meta.label}
                      </span>
                      <span className="text-[11px] font-mono text-[#aeaeb2]">{p.asin}</span>
                    </div>
                    <p className="text-xs font-semibold text-[#1d1d1f] truncate">{p.brand || p.title || p.asin}</p>
                    <p className="text-[11px] text-[#86868b] mt-1 line-clamp-2">{p.title}</p>
                    <p className="text-[11px] text-[#86868b] mt-1.5">月收入 ${Math.round(p.monthlyRevenue).toLocaleString()} · 星 {p.rating}</p>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                onPicked(picked.map((p) => p.asin), segment);
                setApplied(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
            >
              <Crosshair className="w-3.5 h-3.5" /> 填充到竞品样本池
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
