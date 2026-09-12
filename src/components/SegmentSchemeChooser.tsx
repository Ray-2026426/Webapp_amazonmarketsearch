import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Layers, Loader2, Sparkles } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { loadSnapshot } from '../utils/projectSnapshot';
import { loadUserLook } from '../utils/userLook';
import {
  synthesizeSegmentSchemes,
  recommendScheme,
  type SegmentScheme,
  type SynthSegment,
} from '../utils/segmentSynthesis';

/**
 * M2③ · 细分方案选择题（PRD §6.2 步骤 3）。
 *
 * 用户原话：「市场细分的逻辑没有跟上一步挂钩，需要结合竞对标题和用户板块的理解，来做市场细分」。
 * 这里把三个来源各切一版（需求域 / 价格×属性 / 标题聚类）摆在一起，给出**确定性**指标
 * （覆盖率、需求挂钩度、收入加权机会分）与一个建议，最终由用户拍板。
 *
 * 三条硬规则：
 * 1. 分数与归属全部来自确定性规则，AI 只给文字解释（segmentAdvice），改不了任何数字；
 * 2. 没被任何细分覆盖的商品显式计数（unassigned），不藏长尾；
 * 3. 用户选定的方案与目标细分会被写回「看市场」，供看竞对的样本池联动使用（M2④）。
 */
export function SegmentSchemeChooser({
  userId,
  projectId,
  chosenSchemeId,
  chosenSegmentIds,
  onChoose,
  onOpenMarketTool,
}: {
  userId: string;
  projectId: string;
  /** 已选方案（写在看市场数据里，跨会话保留） */
  chosenSchemeId?: string;
  /** 已选目标细分（细分 id 列表） */
  chosenSegmentIds: string[];
  onChoose: (schemeId: string, segmentIds: string[]) => void;
  /** 线框图 ⑤：查看该细分对应的完整大盘（老版大盘 + 自动筛选上下文）；也可不带参数直接打开大盘 */
  onOpenMarketTool?: (segment?: string) => void;
}) {
  const [schemes, setSchemes] = useState<SegmentScheme[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [needCount, setNeedCount] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [snap, userLook] = await Promise.all([loadSnapshot(userId, projectId), loadUserLook(userId, projectId)]);
      const needs = Array.isArray(userLook.unmetNeedCandidates) ? userLook.unmetNeedCandidates : [];
      setNeedCount(needs.filter((n) => (n.needStatement || '').trim()).length);
      setSchemes(
        synthesizeSegmentSchemes({
          products: snap?.products ?? [],
          history: snap?.history ?? [],
          needs,
        })
      );
    } catch {
      setSchemes([]);
    } finally {
      setLoading(false);
    }
  }, [userId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rec = schemes && schemes.length > 0 ? recommendScheme(schemes) : null;
  const hasAny = !!schemes && schemes.some((s) => s.segments.length > 0);

  const toggleSegment = (segment: SynthSegment) => {
    if (!chosenSchemeId) return;
    const has = chosenSegmentIds.includes(segment.id);
    const next = has ? chosenSegmentIds.filter((id) => id !== segment.id) : [...chosenSegmentIds, segment.id];
    onChoose(chosenSchemeId, next);
  };

  return (
    <Card>
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">市场细分方案（三选一）</p>
            <span className="text-[11px] text-[#aeaeb2]">需求域 × 商品属性 × 竞品标题聚类</span>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-medium text-[#86868b] hover:text-indigo-600 hover:border-indigo-200 transition-all"
          >
            重新切分
          </button>
        </div>
        <p className="text-[11px] text-[#86868b] leading-relaxed mb-4">
          同一批商品，三种切法。分数（趋势 × 体量 × 竞争 → 机会分）与商品归属全部由确定性规则算出，
          <b>AI 只能解释差异、不能改数字，也不替你选</b>。
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-[#aeaeb2]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在按三个来源切分…
          </div>
        ) : !hasAny ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-700">还没有可切分的数据</p>
                <p className="text-xs text-amber-700/80 mt-1 leading-relaxed">
                  细分需要「本项目数据快照」里的商品（标题 / 价格 / 月收入），以及在「看用户」里填好的需求域。
                  先在概览页捕获快照、并跑一次看用户，再回来这里。
                </p>
                {onOpenMarketTool && (
                  <button
                    type="button"
                    onClick={() => onOpenMarketTool?.()}
                    className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                  >
                    打开市场大盘取数
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {needCount === 0 && (
              <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3.5 py-2.5 text-[11px] text-amber-700 leading-relaxed">
                还没有「看用户」的需求域，所以<b>方案 A 会是空的</b>：先去「看用户」跑一次 AI 分析或手填需求，才能让细分跟上一步挂钩。
              </div>
            )}

            {rec && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3.5 py-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-indigo-800">{rec.reason}</p>
                    <p className="text-[11px] text-indigo-700/70 mt-1">
                      排序依据（确定性）：需求挂钩度 50% + 覆盖率 30% + 收入加权机会分 20%。
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {schemes.map((s) => {
                const picked = chosenSchemeId === s.id;
                const isRecommended = rec?.schemeId === s.id;
                const open = expanded === s.id;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      'rounded-2xl border bg-white flex flex-col',
                      picked ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-black/8'
                    )}
                  >
                    <div className="p-3.5 flex-1">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-[13px] font-bold text-[#1d1d1f] leading-snug">{s.name}</p>
                        {isRecommended && (
                          <span className="shrink-0 rounded-full bg-indigo-600 text-white px-2 py-0.5 text-[10px] font-semibold">
                            系统建议
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-[#86868b] leading-relaxed mb-2.5">{s.description}</p>

                      <div className="grid grid-cols-3 gap-1.5 mb-2.5">
                        <Metric label="覆盖" value={`${Math.round(s.coverage * 100)}%`} />
                        <Metric label="需求挂钩" value={`${Math.round(s.grounding * 100)}%`} />
                        <Metric label="机会分" value={String(s.avgOpportunity)} />
                      </div>

                      <p className="text-[10px] text-[#aeaeb2]">
                        切出 {s.segments.length} 个细分 · 未归属商品 {s.unassigned} 个
                      </p>

                      {open && (
                        <div className="mt-3 space-y-2">
                          {s.segments.length === 0 && (
                            <p className="text-[11px] text-amber-600">这个方案在当前数据下切不出细分。</p>
                          )}
                          {s.segments.map((seg) => {
                            const asTarget = chosenSchemeId === s.id && chosenSegmentIds.includes(seg.id);
                            return (
                              <div key={seg.id} className="rounded-xl border border-black/8 bg-[#f8f9fb] p-2.5">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-[11px] font-semibold text-[#1d1d1f] leading-snug">{seg.name}</p>
                                  {chosenSchemeId === s.id && (
                                    <button
                                      type="button"
                                      onClick={() => toggleSegment(seg)}
                                      className={cn(
                                        'shrink-0 inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold border transition-colors',
                                        asTarget
                                          ? 'bg-emerald-600 border-emerald-600 text-white'
                                          : 'bg-white border-black/10 text-[#86868b] hover:border-indigo-300 hover:text-indigo-700'
                                      )}
                                    >
                                      {asTarget ? '已设为目标' : '设为目标细分'}
                                    </button>
                                  )}
                                </div>
                                <p className="text-[10px] text-[#86868b] mt-1 leading-relaxed">切法：{seg.rule}</p>
                                <button
                                  type="button"
                                  onClick={() => onOpenMarketTool?.(seg.name)}
                                  className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-700"
                                >
                                  查看完整大盘 →（自动带入该细分）
                                </button>
                                <p className="text-[10px] text-[#86868b] mt-0.5">
                                  {seg.productCount} 个商品 · 收入占比 {(seg.revenueShare * 100).toFixed(1)}% · 机会分{' '}
                                  <b className="text-[#1d1d1f]">{seg.score.opportunity}</b>
                                  <span className="text-[#aeaeb2]">
                                    （趋势 {seg.score.trend} / 体量 {seg.score.volume} / 竞争 {seg.score.competition}）
                                  </span>
                                </p>
                                <div className="mt-1.5">
                                  {seg.demandHits.length > 0 ? (
                                    <div className="space-y-1">
                                      {seg.demandHits.slice(0, 3).map((h, i) => (
                                        <p key={i} className="text-[10px] text-emerald-700 leading-relaxed">
                                          需求挂钩：{h.needStatement}
                                          <span className="text-emerald-600/70">
                                            （{h.category} · 证据分 {h.evidenceScore}/100）
                                          </span>
                                        </p>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-[10px] text-[#aeaeb2]">暂无需求挂钩（看用户里没有匹配到该细分的需求）</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : s.id)}
                        className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        {open ? '收起细分明细' : `查看 ${s.segments.length} 个细分明细`}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onChoose(s.id, chosenSchemeId === s.id ? chosenSegmentIds : []);
                        setExpanded(s.id);
                      }}
                      className={cn(
                        'w-full rounded-b-2xl px-3 py-2.5 text-xs font-semibold border-t transition-colors',
                        picked
                          ? 'bg-indigo-50 border-indigo-100 text-indigo-700'
                          : 'bg-white border-black/8 text-[#424245] hover:bg-[#f8f9fb]'
                      )}
                    >
                      {picked ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> 已选此方案
                        </span>
                      ) : (
                        '选这个方案'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#f8f9fb] px-2 py-1.5 text-center">
      <p className="text-[10px] text-[#86868b]">{label}</p>
      <p className="text-[13px] font-bold text-[#1d1d1f] tabular-nums">{value}</p>
    </div>
  );
}
