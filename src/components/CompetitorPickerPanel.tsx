// 看竞对 · 自动挑选对标：从「目标细分」里选 1 头部 + 1 跟随者 + 1 新品。
//
// M2④：优先读**看市场选定的目标细分**（用户拍的板），而不是自己另算一个"机会分最高"的细分——
// 否则用户在看市场选了"侧睡/可调高度"，看竞对却在比"低价段"，两边对不上。
// 选定的方案与细分是确定性可复算的（方案 id + 细分 id 存在看市场数据里），所以这里重算一遍即可。
import { useCallback, useEffect, useState } from 'react';
import { Crosshair, Crown, Star, Sparkles, Loader2, AlertTriangle, ArrowRight, Target } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { pickCompetitors, type PickedCompetitor } from '../utils/competitorPicker';
import { scoreSegments } from '../utils/segmentScore';
import { gatherGlobalMarketData } from '../utils/lookAi';
import { loadSnapshot, hasSnapshotContent } from '../utils/projectSnapshot';
import { loadUserLook } from '../utils/userLook';
import { loadMarketLook } from '../utils/marketLook';
import { synthesizeSegmentSchemes } from '../utils/segmentSynthesis';
import type { Product, HistoryRecord } from '../utils/parser';

const ROLE_META: Record<PickedCompetitor['role'], { label: string; icon: typeof Crown; cls: string }> = {
  head: { label: '头部', icon: Crown, cls: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  follower: { label: '跟随者', icon: Star, cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  newcomer: { label: '新品', icon: Sparkles, cls: 'bg-amber-50 text-amber-700 border-amber-100' },
};

export function CompetitorPickerPanel({
  onOpenCompetitorTool,
  onPicked,
  userId,
  projectId,
}: {
  onOpenCompetitorTool: () => void;
  onPicked: (asins: string[], segment: string) => void;
  /** M2④：项目作用域，用于读取看市场的目标细分与项目快照 */
  userId?: string;
  projectId?: string;
}) {
  const [state, setState] = useState<'loading' | 'nopick' | 'ready'>('loading');
  const [picked, setPicked] = useState<PickedCompetitor[]>([]);
  const [segment, setSegment] = useState('');
  const [opportunity, setOpportunity] = useState(0);
  const [applied, setApplied] = useState(false);
  /** 细分来源：用户在看市场选的目标细分 / 系统按机会分兜底 / 全局回退 */
  const [origin, setOrigin] = useState<'chosen' | 'auto' | 'global'>('auto');

  const load = useCallback(async () => {
    setState('loading');

    // 1) 项目快照优先（避免跨项目污染）；空快照回退全局
    let products: Product[] = [];
    let history: HistoryRecord[] = [];
    let scope: 'project' | 'global' = 'project';
    if (userId && projectId) {
      const snap = await loadSnapshot(userId, projectId);
      if (snap && hasSnapshotContent(snap)) {
        products = snap.products;
        history = snap.history;
      }
    }
    if (products.length === 0) {
      const g = await gatherGlobalMarketData();
      products = g.products ?? [];
      history = g.history ?? [];
      scope = 'global';
    }
    if (products.length === 0) {
      setState('nopick');
      return;
    }

    // 2) 优先用「看市场」选定的目标细分（用户拍板的那一版切法）
    if (userId && projectId) {
      const [market, userLook] = await Promise.all([loadMarketLook(userId, projectId), loadUserLook(userId, projectId)]);
      const chosenSchemeId = market.segmentSchemeId;
      const chosenSegmentIds = market.chosenSegmentIds ?? [];
      if (chosenSchemeId && chosenSegmentIds.length > 0) {
        const schemes = synthesizeSegmentSchemes({
          products,
          history,
          needs: Array.isArray(userLook.unmetNeedCandidates) ? userLook.unmetNeedCandidates : [],
        });
        const scheme = schemes.find((s) => s.id === chosenSchemeId);
        const targets = scheme?.segments.filter((s) => chosenSegmentIds.includes(s.id)) ?? [];
        const asinSet = new Set(targets.flatMap((t) => t.asins));
        const pool = products.filter((p) => asinSet.has(p.asin));
        if (pool.length > 0) {
          const list = pickCompetitors(pool, { sameBandTolerance: 0.2 });
          setPicked(list);
          setSegment(targets.map((t) => t.name).join(' + '));
          setOpportunity(
            targets.length > 0 ? Math.round(targets.reduce((s, t) => s + t.score.opportunity, 0) / targets.length) : 0
          );
          setOrigin('chosen');
          setApplied(false);
          setState(list.length > 0 ? 'ready' : 'nopick');
          return;
        }
      }
    }

    // 3) 兜底：按机会分最高的细分（老行为，标注出来，不假装是用户选的）
    const g = await gatherGlobalMarketData();
    const segments = scope === 'project' ? undefined : g.segments;
    if (!segments || segments.length === 0) {
      const list = pickCompetitors(products, { sameBandTolerance: 0.2 });
      setPicked(list);
      setSegment('全部样本');
      setOpportunity(0);
      setOrigin('global');
      setApplied(false);
      setState(list.length > 0 ? 'ready' : 'nopick');
      return;
    }
    const scored = scoreSegments(segments, g.asinToSegment, products, history);
    const top = scored[0];
    if (!top || top.opportunity <= 0) {
      setState('nopick');
      return;
    }
    const topProducts = products.filter((p) => g.asinToSegment[p.asin] === top.segment);
    const list = pickCompetitors(topProducts, { sameBandTolerance: 0.2 });
    setPicked(list);
    setSegment(top.segment);
    setOpportunity(top.opportunity);
    setOrigin('auto');
    setApplied(false);
    setState('ready');
  }, [userId, projectId]);

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
        ) : state === 'nopick' ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-700">还挑不出对标竞品</p>
                <p className="text-xs text-amber-700/80 mt-1 leading-relaxed">
                  先在「概览」捕获本项目数据快照（需要商品 + 价格 + 月收入），再回来看竞对。
                </p>
                <button
                  type="button"
                  onClick={onOpenCompetitorTool}
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
                >
                  去加载数据 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#86868b] flex flex-wrap items-center gap-x-2 gap-y-1">
              {origin === 'chosen' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 text-[11px] font-semibold">
                  <Target className="w-3 h-3" /> 来自看市场选定的目标细分
                </span>
              ) : origin === 'auto' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 text-[11px] font-semibold">
                  系统兜底（还没在看市场选定目标细分，先用机会分最高细分）
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f5f7] text-[#86868b] border border-black/8 px-2 py-0.5 text-[11px] font-semibold">
                  全部样本（本项目快照为空，已回退全局数据）
                </span>
              )}
              <span>
                细分：<span className="font-semibold text-[#1d1d1f]">{segment}</span>
                {opportunity > 0 && (
                  <>
                    （机会分 <span className="font-semibold text-indigo-600">{opportunity}</span>）
                  </>
                )}
              </span>
              {applied && <span className="text-[11px] text-emerald-600">✓ 已填充到样本池</span>}
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
