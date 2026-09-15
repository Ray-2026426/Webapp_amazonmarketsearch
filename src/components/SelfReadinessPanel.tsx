import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, History, Info, Loader2, Wallet } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  CAPABILITY_DIMENSION_LABELS,
  CAPABILITY_DIMENSION_ORDER,
  CAPABILITY_STATUS_LABELS,
  capabilityBoundaryWarnings,
  capabilityHardConstraints,
  clearCapabilityOverride,
  loadCapabilityLibrary,
  manualOverrideCount,
  saveCapabilityLibrary,
  setCapabilityEntry,
  type CapabilityLibrary,
} from '../utils/capabilityLibrary';
import {
  buildDecisionQuestions,
  boundaryItemsFromQuiz,
  computeQuizProgress,
  defaultQuizData,
  marginFloorFromQuiz,
  refreshDecisionQuestions,
  setAnswer,
  setAnswerNote,
  toAnswersForFit,
  toOurCapabilityFromQuiz,
  toggleMultiAnswer,
  QUIZ_CATEGORY_LABELS,
  type QuizData,
  type QuizProgress,
} from '../utils/categoryQuiz';
import { computeFitScore, buildFitAnswers, buildHardConstraintVerdict, hardConstraintsFromSelfAssessment } from '../utils/ourCapability';
import { loadCompetitorLook, saveCompetitorLook } from '../utils/competitorLook';
import {
  loadSelfAssessment,
  saveSelfAssessment,
  defaultSelfAssessment,
  SELF_STATUS_LABELS,
  type SelfAssessment,
  type SelfStatus,
} from '../utils/selfAssessment';
import {
  BACKGROUND_GROUPS,
  BACKGROUND_UPDATED_EVENT,
  computeBackgroundCompleteness,
  describeBackgroundCompleteness,
  loadUserBackgroundById,
  summarizeBackground,
  weakestBackgroundGroup,
  type BackgroundCompleteness,
  type UserBackgroundProfile,
} from '../utils/userBackground';
import {
  resolveCapabilities,
  resolveCapabilityLibrary,
  summarizeDerivation,
  type DerivedCapability,
} from '../utils/capabilityDerivation';
import type { ResearchProject } from '../types/researchProject';
import type { L3Id } from '../utils/l3Pages';
import type { L3BlockVariant, L3BodyRender } from './L3Sheet';

/**
 * 「看自己」V3（PRD §6.4，用户诉求："有了背景信息，还要我确认 42 项，很奇怪，3 个问题就够了"）。
 *
 * 结构（比 V2 短得多）：
 *   ① 背景信息摘要（只读，去设置里补全）+ **能力推导**（由背景信息确定性推出，可展开看"这条是怎么推出来的"、可逐条覆盖）
 *   ② **3 个拍板问题**（最低毛利率 / 止损条件 / 必须满足的进入条件）
 *   ③ 适配度与硬约束结论
 *
 * 三条硬规则（与 V2 一致，不许破坏）：
 * 1. **不强迫填完**：背景信息完整度只影响可信度，随时能补，空缺也能继续分析；
 * 2. **完成度与适配度分离**：适配度 = 相关题均分 × 背景信息完整度，绝不是"填了多少"；
 * 3. **硬约束否决**：决策边界类答"不具备"（含背景信息推导出的合规/MOQ 红线）→ 关联机会不能"直接进入"
 *    （红条 + 联动看竞对的赢的路径）。这条链路的读数路径（hardConstraintVerdict / capabilityHardConstraints /
 *    hardBlocks）本轮**没有改动**，只是数据来源从 42 项手填换成了"3 个问题 + 背景信息推导"。
 */
export function SelfReadinessPanel({
  userId,
  project,
  onOpenL3,
  onRegisterL3Bodies,
  onAssessmentSaved,
}: {
  userId: string;
  project: ResearchProject;
  /** 线框图 ⏳3：打开二级页⑪背景信息与推导 / ⑫拍板问题与依据 */
  onOpenL3?: (id: L3Id) => void;
  /** 线框图 ⏳3：把 ⑪⑫ 的正文（与内联同一份实现）注册给全屏页壳 */
  onRegisterL3Bodies?: (render: L3BodyRender | null) => void;
  /**
   * 本面板写回后通知外层（外层据此更新"已答 x/3"、AI 输入与五看进度）。
   * 没有它的话，答完题后头部的进度会停在 0/3（同一个项目里两份状态会不一致）。
   */
  onAssessmentSaved?: (assessment: SelfAssessment) => void;
}) {
  const [lib, setLib] = useState<CapabilityLibrary>(() => loadCapabilityLibrary(userId));
  const [background, setBackground] = useState<UserBackgroundProfile>(() => loadUserBackgroundById(userId));
  const [assessment, setAssessment] = useState<SelfAssessment | null>(null);
  const [busy, setBusy] = useState(true);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [showDerivation, setShowDerivation] = useState(false);
  const [fit, setFit] = useState<{ fitScore: number; note: string } | null>(null);
  const [hardFromOtherLooks, setHardFromOtherLooks] = useState<string[]>([]);

  const assessmentRef = useRef<SelfAssessment | null>(null);
  assessmentRef.current = assessment;
  const noteTimer = useRef<number | null>(null);

  const derived = useMemo(() => resolveCapabilities(background, lib), [background, lib]);
  const report = useMemo(() => computeBackgroundCompleteness(background), [background]);
  const weak = weakestBackgroundGroup(report);

  /**
   * 唯一的"重新计算 + 落盘"入口（题目答案 / 逐条覆盖 / 背景信息变化都走它）：
   * 决策边界项 → 硬约束结论 → 适配度 → 看竞对（赢的路径要用的"我们行不行"+ 毛利红线）。
   */
  const persist = useCallback(
    async (nextQuiz: QuizData, nextLib: CapabilityLibrary, legacyNotes?: string[]) => {
      const bg = loadUserBackgroundById(userId);
      const entries = resolveCapabilities(bg, nextLib);
      const resolvedLib = resolveCapabilityLibrary(bg, nextLib);
      const items = boundaryItemsFromQuiz(nextQuiz);
      const quizCap = toOurCapabilityFromQuiz(nextQuiz);
      const libraryNotes = capabilityHardConstraints(resolvedLib);
      const warnings = capabilityBoundaryWarnings(resolvedLib);
      const verdict = buildHardConstraintVerdict({
        items,
        libraryNotes,
        quizNotes: quizCap.quizHardNotes,
        legacyNotes,
      });
      const base = assessmentRef.current ?? defaultSelfAssessment(project.id);
      const next: SelfAssessment = { ...base, quiz: nextQuiz, items, hardConstraintVerdict: verdict };
      assessmentRef.current = next;
      setAssessment(next);
      await saveSelfAssessment(userId, project.id, next);
      onAssessmentSaved?.(next);

      // 适配度（确定性公式）：3 个拍板问题 + 背景信息推导出的能力结论
      const r = computeFitScore({
        answers: buildFitAnswers({
          decisionAnswers: toAnswersForFit(nextQuiz),
          capabilityEntries: entries,
        }),
        backgroundCompleteness: computeBackgroundCompleteness(bg).fraction,
      });
      setFit({ fitScore: r.fitScore, note: r.note });
      setHardFromOtherLooks([...libraryNotes, ...warnings, ...hardConstraintsFromSelfAssessment(items).notes]);

      // 把答题结果同步给看竞对（赢的路径要用的"我们行不行"+ 财务口径）
      const comp = await loadCompetitorLook(userId, project.id);
      const floor = marginFloorFromQuiz(nextQuiz);
      await saveCompetitorLook(userId, project.id, {
        ...comp,
        ourCapabilityByNeedId: { ...(comp.ourCapabilityByNeedId ?? {}), ...quizCap.byNeedId },
        ourCapabilityFinancials: {
          ...(comp.ourCapabilityFinancials ?? {}),
          ...(floor !== undefined ? { marginFloor: floor } : {}),
        },
      });
    },
    [userId, project.id, onAssessmentSaved]
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const bg = loadUserBackgroundById(userId);
      const library = loadCapabilityLibrary(userId);
      setBackground(bg);
      setLib(library);
      const sa = await loadSelfAssessment(userId, project.id);
      assessmentRef.current = sa;
      const entries = resolveCapabilities(bg, library);
      // 出题（Q3 的每个选项都带背景信息推出的满足情况）→ 刷新题目（背景变了结论要跟着变）→ 保留答案
      const fresh = buildDecisionQuestions({ background: bg, capabilityEntries: entries });
      const quiz = refreshDecisionQuestions(sa.quiz ?? defaultQuizData(), fresh);
      await persist(quiz, library, sa.legacyBoundaryNotes);
    } finally {
      setBusy(false);
    }
  }, [userId, project.id, persist]);

  useEffect(() => {
    void refresh();
    // 只在项目/用户变化时重跑（题目与推导变化由 persist / 覆盖 / 背景事件驱动）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, project.id]);

  // 设置里保存了背景信息 → 立刻重新推导、刷新问题选项（否则用户会看到过期结论）
  useEffect(() => {
    const onBackgroundUpdated = () => {
      void refresh();
    };
    try {
      window.addEventListener(BACKGROUND_UPDATED_EVENT, onBackgroundUpdated);
      return () => window.removeEventListener(BACKGROUND_UPDATED_EVENT, onBackgroundUpdated);
    } catch {
      return undefined;
    }
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (noteTimer.current) window.clearTimeout(noteTimer.current);
    };
  }, []);

  const quiz = assessment?.quiz ?? defaultQuizData();
  const progress = computeQuizProgress(quiz);
  const quizCap = toOurCapabilityFromQuiz(quiz);

  const onAnswer = (questionId: string, optionIndex: number | undefined) => {
    void persist(setAnswer(quiz, questionId, optionIndex), lib, assessmentRef.current?.legacyBoundaryNotes);
  };

  const onToggleMulti = (questionId: string, optionIndex: number) => {
    void persist(toggleMultiAnswer(quiz, questionId, optionIndex), lib, assessmentRef.current?.legacyBoundaryNotes);
  };

  /** 备注（止损条件可补充）：本地即时反映，落盘防抖 400ms，避免每敲一个字写一次 IDB */
  const onNote = (questionId: string, note: string) => {
    const nextQuiz = setAnswerNote(quiz, questionId, note);
    setAssessment((prev) => (prev ? { ...prev, quiz: nextQuiz } : prev));
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => {
      void persist(nextQuiz, lib, assessmentRef.current?.legacyBoundaryNotes);
    }, 400);
  };

  /** 逐条覆盖（显式标记 manual；AI 不得改）→ 立刻重算硬约束结论 */
  const onOverride = (key: string, status: SelfStatus) => {
    const nextLib = setCapabilityEntry(lib, key, status);
    setLib(nextLib);
    saveCapabilityLibrary(userId, nextLib);
    void persist(quiz, nextLib, assessmentRef.current?.legacyBoundaryNotes);
  };

  /** 取消覆盖 → 回到"由背景信息推导" */
  const onClearOverride = (key: string) => {
    const nextLib = clearCapabilityOverride(lib, key);
    setLib(nextLib);
    saveCapabilityLibrary(userId, nextLib);
    void persist(quiz, nextLib, assessmentRef.current?.legacyBoundaryNotes);
  };

  /**
   * ⏳3（线框图 ⑪⑫）：二级页正文 = 与内联**同一个区块组件**，只把 variant 换成 'sheet'，
   * 数据与写回路径完全共用。用 ref 存"当前数据能渲染什么"，注册给页壳的是一层稳定壳，
   * 避免父组件因函数身份每次渲染都变化而无限重注册。
   */
  const l3BodyRef = useRef<L3BodyRender | null>(null);
  l3BodyRef.current = (id) => {
    if (id === '11') {
      return (
        <AccountBackgroundBlock
          background={background}
          report={report}
          derived={derived}
          overrides={manualOverrideCount(lib)}
          showDerivation={showDerivation}
          openGroup={openGroup}
          onToggleDerivation={() => setShowDerivation((v) => !v)}
          onToggleGroup={(g) => setOpenGroup(openGroup === g ? null : g)}
          onOverride={onOverride}
          onClearOverride={onClearOverride}
          variant="sheet"
        />
      );
    }
    if (id === '12') {
      return (
        <CategoryQuizBlock
          quiz={quiz}
          progress={progress}
          quizCap={quizCap}
          fit={fit}
          report={report}
          busy={busy}
          hardFromOtherLooks={hardFromOtherLooks}
          legacyBoundaryNotes={assessment?.legacyBoundaryNotes ?? []}
          onAnswer={onAnswer}
          onToggleMulti={onToggleMulti}
          onNote={onNote}
          variant="sheet"
        />
      );
    }
    return null;
  };

  useEffect(() => {
    if (!onRegisterL3Bodies) return;
    onRegisterL3Bodies((id, cardId) => l3BodyRef.current?.(id, cardId) ?? null);
    return () => onRegisterL3Bodies(null);
    // 只在这些"会改变二级页内容"的状态变化时重新注册
  }, [onRegisterL3Bodies, background, assessment, fit, openGroup, showDerivation, hardFromOtherLooks, busy, lib, derived, report]);
  return (
    <div className="space-y-4">
      {/* ① 背景信息摘要 + 能力推导（线框图二级页⑪）：内联与二级页⑪ 共用同一份实现 */}
      <AccountBackgroundBlock
        background={background}
        report={report}
        derived={derived}
        overrides={manualOverrideCount(lib)}
        showDerivation={showDerivation}
        openGroup={openGroup}
        onToggleDerivation={() => setShowDerivation((v) => !v)}
        onToggleGroup={(g) => setOpenGroup(openGroup === g ? null : g)}
        onOverride={onOverride}
        onClearOverride={onClearOverride}
        onOpenDetail={() => onOpenL3?.('11')}
      />

      {/* ② 3 个拍板问题 + 适配度与硬约束（线框图二级页⑫）：内联与二级页⑫ 共用同一份实现 */}
      <CategoryQuizBlock
        quiz={quiz}
        progress={progress}
        quizCap={quizCap}
        fit={fit}
        report={report}
        busy={busy}
        hardFromOtherLooks={hardFromOtherLooks}
        legacyBoundaryNotes={assessment?.legacyBoundaryNotes ?? []}
        onAnswer={onAnswer}
        onToggleMulti={onToggleMulti}
        onNote={onNote}
        onOpenDetail={() => onOpenL3?.('12')}
      />
    </div>
  );
}

/** 3 个拍板问题的答案 → 决策边界项（单一实现：categoryQuiz.boundaryItemsFromQuiz） */

/* ────────────────────────────────────────────────────────────────────────────
 * ⏳3：看自己侧的 2 个二级页区块（⑪⑫）
 * 每个区块只实现一次：variant='inline' 就是主屏上今天的样子，variant='sheet' 是二级页正文
 * （由 ProjectWorkspace 的全屏页壳 L3Sheet 渲染）。业务数据与写回回调都由外层传入。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 线框图 ⑪：背景信息摘要 + 能力推导（只读 + 逐条覆盖），内联与二级页⑪ 同一份实现 */
export function AccountBackgroundBlock({
  background,
  report,
  derived,
  overrides,
  showDerivation,
  openGroup,
  onToggleDerivation,
  onToggleGroup,
  onOverride,
  onClearOverride,
  onOpenDetail,
  variant = 'inline',
}: {
  background: UserBackgroundProfile;
  report: BackgroundCompleteness;
  derived: DerivedCapability[];
  overrides: number;
  showDerivation: boolean;
  openGroup: string | null;
  onToggleDerivation: () => void;
  onToggleGroup: (group: string) => void;
  onOverride: (key: string, status: SelfStatus) => void;
  onClearOverride: (key: string) => void;
  onOpenDetail?: () => void;
  variant?: L3BlockVariant;
}) {
  const sheet = variant === 'sheet';
  const summary = summarizeBackground(background);
  const s = summarizeDerivation(derived);
  const weak = weakestBackgroundGroup(report);
  return (
    <Card>
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">
              {sheet ? '⑪ 背景信息与能力推导（只读）' : '背景信息（只读摘要）'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!sheet && (
              <button
                type="button"
                onClick={onOpenDetail}
                title="打开二级页⑪：背景信息与能力推导"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-100 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-200 transition-all active:scale-[0.98]"
              >
                补全背景
              </button>
            )}
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                report.fraction >= 0.8 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              )}
            >
              背景信息完整度 {report.filled}/{report.total}
            </span>
          </div>
        </div>
        <p className="text-[11px] text-[#86868b] leading-relaxed mb-3">
          {describeBackgroundCompleteness(report)}
          {weak && (
            <>
              ；建议先补 <b>{weak.title}</b>（还差 {weak.empty} 项）
            </>
          )}
          。背景信息在「设置 → 背景信息」里填，这里只读；它决定下面推导出什么能力，也决定你要回答的问题有多少。
        </p>

        {/* 分组摘要：每组写清"它影响五看里的哪一个判断" */}
        <div className="space-y-2">
          {BACKGROUND_GROUPS.map((g) => {
            const items = summary.filter((i) => i.group === g.id);
            const stat = report.byGroup[g.id];
            const open = openGroup === g.id;
            return (
              <div key={g.id} className="rounded-xl border border-black/8 bg-white">
                <button
                  type="button"
                  onClick={() => onToggleGroup(g.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                >
                  <span className="text-xs font-semibold text-[#1d1d1f]">{g.title}</span>
                  <span className="text-[10px] text-[#86868b]">
                    {stat.filled}/{stat.total} 已填
                  </span>
                </button>
                <div className="px-3 pb-2">
                  <p className="text-[10px] text-[#86868b] leading-relaxed">{g.affects}</p>
                  {open && (
                    <div className="mt-1.5 space-y-1">
                      {items.length === 0 ? (
                        <p className="text-[10px] text-amber-700">这一组还没填 → 去「设置 → 背景信息」补全</p>
                      ) : (
                        items.map((i) => (
                          <p key={i.key} className="text-[11px] text-[#424245] leading-relaxed">
                            <span className="text-[#86868b]">{i.label}：</span>
                            {i.value}
                          </p>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 能力推导：背景信息 → 能力结论（确定性规则，可复核、可逐条覆盖） */}
        <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-indigo-800">
              能力推导：由背景信息自动推出 {s.total} 项（已具备 {s.have} / 部分具备 {s.partial} / 不具备 {s.lack} / 判断不了{' '}
              {s.unknown}）
              {overrides > 0 && <span className="ml-1 font-normal">· 你已逐条覆盖 {overrides} 项</span>}
            </p>
            <button
              type="button"
              onClick={onToggleDerivation}
              className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 underline"
            >
              {showDerivation ? '收起推导明细' : '展开看每一条怎么推的'}
            </button>
          </div>
          <p className="text-[10px] text-indigo-700/80 mt-0.5 leading-relaxed">
            规则是确定性的（同输入同输出，AI 不参与、也不能改）。判断不了的项会显示"判断不了"，不是"不具备"。
            需要不同结论时**逐条覆盖**，覆盖会显式标记，AI 永远不会改写它。
          </p>
          {showDerivation && (
            <div className="mt-2 space-y-1.5">
              {CAPABILITY_DIMENSION_ORDER.map((dim) => {
                const rows = derived.filter((d) => d.dimension === dim);
                if (rows.length === 0) return null;
                return (
                  <div key={dim} className="rounded-lg bg-white/70 px-2.5 py-2">
                    <p className="text-[10px] font-semibold text-[#86868b] mb-1">{CAPABILITY_DIMENSION_LABELS[dim]}</p>
                    <div className="space-y-1">
                      {rows.map((d) => (
                        <div key={d.key} className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-[#1d1d1f]">
                              {d.label}
                              <span
                                className={cn(
                                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                  d.status === 'have'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : d.status === 'partial'
                                      ? 'bg-amber-50 text-amber-700'
                                      : d.status === 'lack'
                                        ? 'bg-rose-50 text-rose-700'
                                        : 'bg-[#f5f5f7] text-[#86868b]'
                                )}
                              >
                                {CAPABILITY_STATUS_LABELS[d.status]}
                              </span>
                              {d.source === 'manual' && (
                                <span className="ml-1 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                  已人工覆盖
                                </span>
                              )}
                            </p>
                            <p className="text-[10px] text-[#86868b] leading-relaxed">
                              {d.source === 'manual' ? '覆盖' : '推导'}依据（{d.ruleId}）：{d.reason}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {(['have', 'partial', 'lack'] as SelfStatus[]).map((st) => (
                              <button
                                key={st}
                                type="button"
                                onClick={() => onOverride(d.key, st)}
                                title={`把「${d.label}」覆盖为${SELF_STATUS_LABELS[st]}`}
                                className={cn(
                                  'rounded-lg border px-1.5 py-0.5 text-[10px] font-semibold',
                                  d.source === 'manual' && d.status === st
                                    ? 'bg-indigo-600 border-indigo-600 text-white'
                                    : 'bg-white border-black/10 text-[#86868b] hover:border-indigo-300 hover:text-indigo-700'
                                )}
                              >
                                {SELF_STATUS_LABELS[st]}
                              </button>
                            ))}
                            {d.source === 'manual' && (
                              <button
                                type="button"
                                onClick={() => onClearOverride(d.key)}
                                className="rounded-lg border border-black/10 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#86868b] hover:border-indigo-300 hover:text-indigo-700"
                              >
                                恢复推导
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** 线框图 ⑫：3 个拍板问题与依据（每题带"为什么问"+ 选项 why），内联与二级页⑫ 同一份实现 */
export function CategoryQuizBlock({
  quiz,
  progress,
  quizCap,
  fit,
  report,
  busy,
  hardFromOtherLooks,
  legacyBoundaryNotes,
  onAnswer,
  onToggleMulti,
  onNote,
  onOpenDetail,
  variant = 'inline',
}: {
  quiz: QuizData;
  progress: QuizProgress;
  quizCap: ReturnType<typeof toOurCapabilityFromQuiz>;
  fit: { fitScore: number; note: string } | null;
  report: BackgroundCompleteness;
  busy: boolean;
  hardFromOtherLooks: string[];
  legacyBoundaryNotes: string[];
  onAnswer: (questionId: string, optionIndex: number | undefined) => void;
  onToggleMulti: (questionId: string, optionIndex: number) => void;
  onNote: (questionId: string, note: string) => void;
  onOpenDetail?: () => void;
  variant?: L3BlockVariant;
}) {
  const sheet = variant === 'sheet';
  const computed = computeFitScore({
    answers: buildFitAnswers({ decisionAnswers: toAnswersForFit(quiz) }),
    backgroundCompleteness: report.fraction,
  });
  const decisionIds = ['decision:margin_floor', 'decision:stop_loss', 'decision:entry_conditions'];
  const others = quiz.questions.filter((q) => !decisionIds.includes(q.id));
  const answeredDecision = quiz.questions.filter(
    (q) => decisionIds.includes(q.id) && selectedCount(quiz, q.id) > 0
  ).length;
  return (
    <Card>
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">
              {sheet ? '⑫ 拍板问题与依据' : '拍板问题（3 个，问的是这个项目）'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!sheet && (
              <button
                type="button"
                onClick={onOpenDetail}
                title="打开二级页⑫：拍板问题与依据"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-100 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-200 transition-all active:scale-[0.98]"
              >
                查看本题依据
              </button>
            )}
            <span className="text-[11px] font-semibold text-[#86868b]">
              {answeredDecision}/3 已答（另有 {others.length} 道 AI 增补）
            </span>
          </div>
        </div>
        <p className="text-[11px] text-[#86868b] leading-relaxed mb-3 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-500" />
          只问背景信息答不了、但决定拍板的三件事：最低毛利率 / 止损条件 / 必须满足的进入条件。能力与资源不再逐条问你，已由背景信息推导。
        </p>

        {busy && quiz.questions.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-sm text-[#aeaeb2]">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在生成拍板问题…
          </div>
        ) : quiz.questions.length === 0 ? (
          <p className="text-xs text-[#aeaeb2] py-3">还没有问题（生成失败时可以在设置里检查背景信息，或重进本页）。</p>
        ) : (
          <div className="space-y-2.5">
            {quiz.questions.map((q) => {
              const a = quiz.answers.find((x) => x.questionId === q.id);
              const chosen = Array.isArray(a?.optionIndexes)
                ? a!.optionIndexes!
                : a?.optionIndex !== undefined
                  ? [a.optionIndex]
                  : [];
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
                    {q.multiple && (
                      <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                        可多选
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
                        onClick={() =>
                          q.multiple ? onToggleMulti(q.id, i) : onAnswer(q.id, chosen.includes(i) ? undefined : i)
                        }
                        className={cn(
                          'w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors',
                          chosen.includes(i) ? 'border-indigo-400 bg-indigo-50' : 'border-black/8 bg-white hover:border-indigo-300'
                        )}
                      >
                        <span className="text-[11px] text-[#1d1d1f]">{o.label}</span>
                        {q.multiple && (
                          <span
                            className={cn(
                              'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                              o.status === 'have'
                                ? 'bg-emerald-50 text-emerald-700'
                                : o.status === 'partial'
                                  ? 'bg-amber-50 text-amber-700'
                                  : o.status === 'lack'
                                    ? 'bg-rose-50 text-rose-700'
                                    : 'bg-[#f5f5f7] text-[#86868b]'
                            )}
                          >
                            你现在：{CAPABILITY_STATUS_LABELS[o.status]}
                          </span>
                        )}
                        <span className="block text-[10px] text-[#86868b] leading-relaxed">{o.why}</span>
                      </button>
                    ))}
                  </div>
                  {q.id === 'decision:stop_loss' && (
                    <input
                      type="text"
                      value={a?.note ?? ''}
                      onChange={(e) => onNote(q.id, e.target.value)}
                      placeholder="补充具体止损线（选填）：例如「累计亏损 $5,000 或 60 天不达标即撤」"
                      className="mt-2 w-full px-3 py-2 rounded-xl border border-black/8 bg-white text-[11px] text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 适配度 + 硬约束 */}
        <div className="mt-4 space-y-2">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2">
            <p className="text-[11px] font-semibold text-indigo-800">
              适配度：{fit ? `${fit.fitScore}/100` : `${computed.fitScore}/100`}
              <span className="ml-2 font-normal text-indigo-700/80">
                （相关题均分 × 背景信息完整度；完成度不参与适配度）
              </span>
            </p>
            <p className="text-[10px] text-indigo-700/80 mt-0.5 leading-relaxed">{fit?.note ?? computed.note}</p>
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
              <p className="text-[11px] font-semibold text-amber-700">来自背景信息推导的约束提醒</p>
              {hardFromOtherLooks.slice(0, 4).map((n, i) => (
                <p key={i} className="text-[10px] text-amber-700/90 leading-relaxed">
                  · {n}
                </p>
              ))}
            </div>
          )}

          {legacyBoundaryNotes.length > 0 && (
            <div className="rounded-xl border border-black/8 bg-[#f5f5f7] px-3 py-2">
              <p className="text-[11px] font-semibold text-[#424245] flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> 旧版 42 项里的决策边界记录（继续参与硬约束判定）
              </p>
              {legacyBoundaryNotes.slice(0, 4).map((n, i) => (
                <p key={i} className="text-[10px] text-[#86868b] leading-relaxed">
                  · {n}
                </p>
              ))}
            </div>
          )}

          {progress.answered > 0 && (
            <p className="text-[10px] text-[#86868b] flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              已把「{Object.keys(quizCap.byNeedId).length} 条需求的可做性」与毛利红线同步给看竞对的赢的路径判定
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** 某题是否已有回答（多选/单选统一口径） */
function selectedCount(quiz: QuizData, questionId: string): number {
  const a = quiz.answers.find((x) => x.questionId === questionId);
  if (!a) return 0;
  if (Array.isArray(a.optionIndexes)) return a.optionIndexes.length;
  return a.optionIndex !== undefined ? 1 : 0;
}
