import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2, Wallet } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  CAPABILITY_DIMENSION_LABELS,
  CAPABILITY_DIMENSION_ORDER,
  CAPABILITY_ITEMS,
  CAPABILITY_STATUS_LABELS,
  capabilityHardConstraints,
  computeCompleteness,
  describeCompleteness,
  loadCapabilityLibrary,
  saveCapabilityLibrary,
  setCapabilityEntry,
  weakestDimension,
  type CapabilityLibrary,
} from '../utils/capabilityLibrary';
import {
  buildSeedQuestions,
  computeQuizProgress,
  ensureSeedQuestions,
  setAnswer,
  toAnswersForFit,
  toOurCapabilityFromQuiz,
  QUIZ_CATEGORY_LABELS,
  defaultQuizData,
} from '../utils/categoryQuiz';
import { computeFitScore } from '../utils/ourCapability';
import { loadUserLook } from '../utils/userLook';
import { loadMarketLook } from '../utils/marketLook';
import { loadCompetitorLook, saveCompetitorLook } from '../utils/competitorLook';
import { loadSelfAssessment, saveSelfAssessment, type SelfStatus } from '../utils/selfAssessment';
import { loadSnapshot } from '../utils/projectSnapshot';
import { synthesizeSegmentSchemes } from '../utils/segmentSynthesis';
import { buildSatisfactionMatrix, decideWinningPath } from '../utils/competitorAnalysis';
import { buildOurCapability } from '../utils/ourCapability';
import type { ResearchProject } from '../types/researchProject';

/**
 * M3⑤ · 看自己 V2（PRD §6.4）：背景库（六维度四态，渐进完善）+ 项目内品类选择题 + 适配度。
 *
 * 三条硬规则：
 * 1. **不强迫填完**：完整度只影响可信度，随时能补，空缺也能继续分析；
 * 2. **完成度与适配度分离**：适配度 = 相关题均分 × 背景库完整度，绝不是"填了多少"；
 * 3. **硬约束否决**：决策边界类答"不具备" → 关联机会不能"直接进入"（红条 + 联动看竞对的赢的路径）。
 */
export function SelfReadinessPanel({
  userId,
  project,
}: {
  userId: string;
  project: ResearchProject;
}) {
  const [lib, setLib] = useState<CapabilityLibrary>(() => loadCapabilityLibrary(userId));
  const [assessment, setAssessment] = useState<Awaited<ReturnType<typeof loadSelfAssessment>> | null>(null);
  const [busy, setBusy] = useState(true);
  const [openDimension, setOpenDimension] = useState<string | null>('funding');
  const [fit, setFit] = useState<{ fitScore: number; note: string } | null>(null);
  const [hardFromOtherLooks, setHardFromOtherLooks] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [sa, userLook, market, comp, snap] = await Promise.all([
        loadSelfAssessment(userId, project.id),
        loadUserLook(userId, project.id),
        loadMarketLook(userId, project.id),
        loadCompetitorLook(userId, project.id),
        loadSnapshot(userId, project.id),
      ]);
      const needs = (userLook.unmetNeedCandidates ?? []).filter((n) => (n.needStatement || '').trim().length > 0);
      const products = snap?.products ?? [];

      // 目标细分里的竞对（用于出题：竞对数量、满足矩阵、赢的路径）
      let pool = products;
      if (market.segmentSchemeId && (market.chosenSegmentIds ?? []).length > 0) {
        const schemes = synthesizeSegmentSchemes({ products, history: snap?.history ?? [], needs });
        const scheme = schemes.find((s) => s.id === market.segmentSchemeId);
        const targets = scheme?.segments.filter((s) => (market.chosenSegmentIds ?? []).includes(s.id)) ?? [];
        const asinSet = new Set(targets.flatMap((t) => t.asins));
        const sub = products.filter((p) => asinSet.has(p.asin));
        if (sub.length > 0) pool = sub;
      }
      const columns = (comp.samplePool ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 3);
      const matrices = columns.map((a) =>
        buildSatisfactionMatrix(a, products.find((p) => p.asin === a), snap?.reviews ?? [], needs, comp.listingDetails?.[a])
      );
      const capability = buildOurCapability({
        items: sa.items,
        byNeedId: comp.ourCapabilityByNeedId ?? {},
        financials: comp.ourCapabilityFinancials,
      });
      const decision =
        columns.length > 0 && matrices.length > 0
          ? decideWinningPath({
              needs,
              competitors: columns.map((a) => ({ asin: a, price: products.find((p) => p.asin === a)?.price })),
              matrices,
              ours: capability,
            })
          : undefined;

      const seeds = buildSeedQuestions({ needs, decision, competitorCount: columns.length, library: lib });
      const withSeeds = ensureSeedQuestions(sa.quiz ?? defaultQuizData(), seeds);
      if (withSeeds.questions.length !== (sa.quiz?.questions.length ?? 0)) {
        const nextSa = { ...sa, quiz: withSeeds };
        await saveSelfAssessment(userId, project.id, nextSa);
        setAssessment(nextSa);
      } else {
        setAssessment(sa);
      }

      setHardFromOtherLooks([...(capability.hardConstraintNotes ?? []), ...capabilityHardConstraints(lib)]);
    } finally {
      setBusy(false);
    }
  }, [userId, project.id, lib]);

  useEffect(() => {
    void refresh();
    // 只在项目/用户变化时重跑（lib 变化由保存时自行触发）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, project.id]);

  const report = computeCompleteness(lib);
  const weak = weakestDimension(report);

  const persistLib = async (next: CapabilityLibrary) => {
    setLib(next);
    saveCapabilityLibrary(userId, next);
  };

  const onAnswer = async (questionId: string, optionIndex: number | undefined) => {
    if (!assessment) return;
    const next = { ...assessment, quiz: setAnswer(assessment.quiz ?? defaultQuizData(), questionId, optionIndex) };
    setAssessment(next);
    await saveSelfAssessment(userId, project.id, next);
    // 把答题结果同步给看竞对（赢的路径要用的"我们行不行"+财务口径）
    if (assessment.quiz) {
      const cap = toOurCapabilityFromQuiz(next.quiz!);
      const comp = await loadCompetitorLook(userId, project.id);
      await saveCompetitorLook(userId, project.id, {
        ...comp,
        ourCapabilityByNeedId: { ...(comp.ourCapabilityByNeedId ?? {}), ...cap.byNeedId },
      });
    }
    // 适配度（确定性公式）
    const answers = toAnswersForFit(next.quiz!);
    const r = computeFitScore({ answers, backgroundCompleteness: report.completeness });
    setFit({ fitScore: r.fitScore, note: r.note });
  };

  const quiz = assessment?.quiz ?? defaultQuizData();
  const progress = computeQuizProgress(quiz);
  const cap = toOurCapabilityFromQuiz(quiz);

  const setStatus = (key: string, status: SelfStatus) => {
    void persistLib(setCapabilityEntry(lib, key, status, lib.entries[key]?.note));
    setFit(null);
  };

  return (
    <div className="space-y-4">
      {/* ① 背景库 */}
      <Card>
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-indigo-600" />
              <p className="text-sm font-semibold text-[#1d1d1f]">账号背景库（六维度）</p>
            </div>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                report.completeness >= 0.8 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              )}
            >
              完整度 {Math.round(report.completeness * 100)}%
            </span>
          </div>
          <p className="text-[11px] text-[#86868b] leading-relaxed mb-3">
            {describeCompleteness(report)}
            {weak && (
              <>
                ；建议先补 <b>{CAPABILITY_DIMENSION_LABELS[weak.dimension]}</b>（还差 {weak.empty} 项）
              </>
            )}
          </p>

          <div className="space-y-2">
            {CAPABILITY_DIMENSION_ORDER.map((d) => {
              const items = CAPABILITY_ITEMS.filter((i) => i.dimension === d);
              const stat = report.byDimension[d];
              const open = openDimension === d;
              return (
                <div key={d} className="rounded-xl border border-black/8 bg-white">
                  <button
                    type="button"
                    onClick={() => setOpenDimension(open ? null : d)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <span className="text-xs font-semibold text-[#1d1d1f]">{CAPABILITY_DIMENSION_LABELS[d]}</span>
                    <span className="text-[10px] text-[#86868b]">
                      {stat.filled}/{stat.total} 已明确
                    </span>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 space-y-2">
                      {items.map((it) => {
                        const cur = lib.entries[it.key];
                        return (
                          <div key={it.key} className="rounded-lg bg-[#f8f9fb] px-2.5 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] text-[#1d1d1f]">
                                {it.label}
                                {it.hint && <span className="ml-1 text-[10px] text-[#aeaeb2]">{it.hint}</span>}
                              </p>
                              <div className="flex items-center gap-1">
                                {(['have', 'partial', 'lack', 'unknown'] as SelfStatus[]).map((s) => (
                                  <button
                                    key={s}
                                    type="button"
                                    onClick={() => setStatus(it.key, s)}
                                    className={cn(
                                      'rounded-lg border px-2 py-0.5 text-[10px] font-semibold',
                                      cur?.status === s
                                        ? 'bg-indigo-600 border-indigo-600 text-white'
                                        : 'bg-white border-black/10 text-[#86868b] hover:border-indigo-300 hover:text-indigo-700'
                                    )}
                                  >
                                    {CAPABILITY_STATUS_LABELS[s]}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ② 品类选择题（项目内，AI 增补 + 确定性种子题） */}
      <Card>
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-indigo-600" />
              <p className="text-sm font-semibold text-[#1d1d1f]">品类选择题</p>
              <span className="text-[11px] text-[#aeaeb2]">问的是这个项目，不是通用问卷</span>
            </div>
            <span className="text-[11px] font-semibold text-[#86868b]">
              {progress.answered}/{progress.total} 已答
            </span>
          </div>

          {busy && quiz.questions.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-sm text-[#aeaeb2]">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在依据本项目数据出题…
            </div>
          ) : quiz.questions.length === 0 ? (
            <p className="text-xs text-[#aeaeb2] py-3">
              还没有可出的题：先在「看用户」填需求、在「看市场」选定目标细分、在看竞对挑 3 个竞对，题目会自动生成。
            </p>
          ) : (
            <div className="space-y-2.5">
              {quiz.questions.map((q) => {
                const a = quiz.answers.find((x) => x.questionId === q.id);
                return (
                  <div
                    key={q.id}
                    className={cn(
                      'rounded-xl border px-3 py-2.5',
                      q.isBoundary ? 'border-rose-100 bg-rose-50/40' : 'border-black/8 bg-white'
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="rounded-full bg-[#f5f5f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#86868b]">
                        {QUIZ_CATEGORY_LABELS[q.category]}
                      </span>
                      {q.isBoundary && (
                        <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                          决策边界
                        </span>
                      )}
                      {q.origin === 'ai' && <span className="text-[10px] text-[#aeaeb2]">AI 增补</span>}
                    </div>
                    <p className="text-[12px] font-semibold text-[#1d1d1f] leading-snug">{q.question}</p>
                    <p className="text-[10px] text-[#86868b] mt-0.5 leading-relaxed">为什么问：{q.basis}</p>
                    <div className="mt-2 space-y-1">
                      {q.options.map((o, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => void onAnswer(q.id, a?.optionIndex === i ? undefined : i)}
                          className={cn(
                            'w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors',
                            a?.optionIndex === i
                              ? 'border-indigo-400 bg-indigo-50'
                              : 'border-black/8 bg-white hover:border-indigo-300'
                          )}
                        >
                          <span className="text-[11px] text-[#1d1d1f]">{o.label}</span>
                          <span className="block text-[10px] text-[#86868b] leading-relaxed">{o.why}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 适配度 + 硬约束 */}
          <div className="mt-4 space-y-2">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2">
              <p className="text-[11px] font-semibold text-indigo-800">
                适配度：{fit ? `${fit.fitScore}/100` : `${computeFitScore({ answers: toAnswersForFit(quiz), backgroundCompleteness: report.completeness }).fitScore}/100`}
                <span className="ml-2 font-normal text-indigo-700/80">
                  （相关题均分 × 背景库完整度；完成度不参与适配度）
                </span>
              </p>
              <p className="text-[10px] text-indigo-700/80 mt-0.5 leading-relaxed">
                {fit?.note ?? computeFitScore({ answers: toAnswersForFit(quiz), backgroundCompleteness: report.completeness }).note}
              </p>
            </div>

            {progress.hardBlocks.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-rose-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> 硬约束已触发（{progress.hardBlocks.length} 条）：不可直接进入
                </p>
                {progress.hardBlocks.map((b) => (
                  <p key={b.id} className="text-[10px] text-rose-700/90 leading-relaxed mt-0.5">
                    · {b.question} → {b.why}
                  </p>
                ))}
              </div>
            )}

            {hardFromOtherLooks.length > 0 && progress.hardBlocks.length === 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-amber-700">来自背景库/自评的约束提醒</p>
                {hardFromOtherLooks.slice(0, 3).map((n, i) => (
                  <p key={i} className="text-[10px] text-amber-700/90 leading-relaxed">
                    · {n}
                  </p>
                ))}
              </div>
            )}

            {progress.answered > 0 && (
              <p className="text-[10px] text-[#86868b] flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                已把「{Object.keys(cap.byNeedId).length} 条需求的可做性」同步给看竞对的赢的路径判定
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
