import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Lock,
  Play,
  ShieldAlert,
  Sparkles,
  Swords,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  loadOpportunities,
  saveOpportunities,
  loadOpportunityConclusion,
  saveOpportunityConclusion,
  createOpportunityFromUnmetNeed,
} from '../utils/opportunityStore';
import { generateOpportunityCandidates, reviewOpportunityCard, mergeGeneratedCards } from '../utils/opportunityAi';
import { buildOpportunityHtmlReport, buildOpportunityMarkdownReportForProject, downloadHtmlReport, downloadMarkdownReport } from '../utils/opportunityHtmlReport';
import { loadProjectDecisionSummary, PROJECT_DECISION_LABELS, type ProjectDecisionSummary } from '../utils/projectDecision';
import { rankOpportunities } from '../utils/opportunityPlan';
import { loadEvidence, describeEvidence } from '../utils/evidence';
import { loadUserLook } from '../utils/userLook';
import { loadSelfAssessment } from '../utils/selfAssessment';
import { loadMarketSegmentContext } from '../utils/opportunityContext';
import { updateLookProgress, setProjectStatus } from '../utils/projectStore';
import { computeOpportunityProgress } from '../utils/opportunityStore';
import {
  CONFIDENCE_LABELS,
  CONTROL_POINT_LABELS,
  NO_OPPORTUNITY_BLOCKER_LABELS,
  NO_OPPORTUNITY_LABELS,
  OPPORTUNITY_KIND_LABELS,
  RESOURCE_CATEGORY_LABELS,
  ROADMAP_PHASE_LABELS,
  type ControlPointKind,
  type NoOpportunityBlocker,
  type OpportunityConclusion,
} from '../types/opportunity';
import { SCORE_DIMENSION_LABELS, SCORE_WEIGHTS, type ScoreDimension } from '../utils/opportunityScoreV2';
import type { OpportunityCard, OpportunityDecision, ResearchProject } from '../types/researchProject';

/**
 * M4 · 看机会「决策看板」（PRD §6.5）。
 *
 * 用户要回答的五个问题，全部在这一屏里按顺序给出：
 * 有没有机会（Go/No-Go 汇总 + 零机会结论）→ 机会是什么（机会卡 + 评分拆解 + 证据）
 * → 先做什么后做什么（路线图）→ 要投入哪些前置资源（含已知缺口）→ 卡哪些控制点（准入/过程/止损）。
 *
 * 三条硬规则：
 * 1. 评分、覆盖度、控制点阈值、资源缺口全部来自确定性模块，AI 只负责解释与候选；
 * 2. 「确认」与「拍板」只能由人点（AI 生成的卡一律 ai_candidate、控制点一律未确认）；
 * 3. 硬约束否决时卡顶红条 + 进入方式最多「验证后进入」。
 */
export function OpportunityDecisionBoard({
  userId,
  project,
  onProjectChange,
}: {
  userId: string;
  project: ResearchProject;
  onProjectChange?: (updated: ResearchProject) => void;
}) {
  const [cards, setCards] = useState<OpportunityCard[]>([]);
  const [conclusion, setConclusion] = useState<OpportunityConclusion | null>(null);
  const [decision, setDecision] = useState<ProjectDecisionSummary | null>(null);
  const [hardNotes, setHardNotes] = useState<string[]>([]);
  const [hardBlocked, setHardBlocked] = useState(false);
  const [evidenceLines, setEvidenceLines] = useState<string[]>([]);
  const [segmentNote, setSegmentNote] = useState('');
  const [busy, setBusy] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [openCard, setOpenCard] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [list, concl, summary, self, ev, userLook] = await Promise.all([
        loadOpportunities(userId, project.id),
        loadOpportunityConclusion(userId, project.id),
        loadProjectDecisionSummary(userId, project),
        loadSelfAssessment(userId, project.id),
        loadEvidence(userId, project.id),
        loadUserLook(userId, project.id),
      ]);
      setCards(list);
      setConclusion(concl);
      setDecision(summary);
      setHardBlocked(Boolean(self.hardConstraintVerdict?.blocked));
      setHardNotes(self.hardConstraintVerdict?.notes ?? []);
      setEvidenceLines(ev.slice(0, 20).map((e) => `[${e.id}] ${describeEvidence(e)}`));
      const ctx = await loadMarketSegmentContext(
        userId,
        project.id,
        (userLook.unmetNeedCandidates ?? []).filter((n) => (n.needStatement || '').trim())
      );
      setSegmentNote(ctx.note);
    } finally {
      setBusy(false);
    }
  }, [userId, project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persistCards = async (next: OpportunityCard[], toastMsg?: string) => {
    setCards(next);
    await saveOpportunities(userId, project.id, next);
    const progress = computeOpportunityProgress(next, project);
    const updated = await updateLookProgress(userId, project.id, 'opportunity', {
      ...project.fiveLookProgress.opportunity,
      status: progress.status,
      completionPercent: progress.completionPercent,
      missingRequirements: progress.missingRequirements,
      updatedAt: new Date().toISOString(),
    });
    if (updated) onProjectChange?.(updated);
    const summary = await loadProjectDecisionSummary(userId, project);
    setDecision(summary);
    if (toastMsg) toast.success(toastMsg);
  };

  const onGenerate = async () => {
    setGenerating(true);
    try {
      const res = await generateOpportunityCandidates(userId, project);
      if (!res.ok && res.conclusion) {
        await saveOpportunityConclusion(userId, project.id, res.conclusion);
        setConclusion(res.conclusion);
        toast.info(res.error || res.conclusion.reason);
        await refresh();
        return;
      }
      if (!res.ok) {
        toast.error(res.error || '生成失败');
        return;
      }
      if (res.cards.length === 0) {
        // 已判断无机会：存结论，且**不动**任何已有卡
        if (res.conclusion) {
          await saveOpportunityConclusion(userId, project.id, res.conclusion);
          setConclusion(res.conclusion);
        }
        toast.warning(res.note);
        await refresh();
        return;
      }
      const merged = mergeGeneratedCards(cards, res.cards);
      await saveOpportunityConclusion(userId, project.id, {
        kind: 'insufficient_evidence',
        reason: '',
        missingData: [],
        confirmed: false,
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
      await persistCards(merged.next, `${res.note}；新增 ${merged.added} 张，保留原有 ${merged.preserved} 张`);
      setConclusion(null);
      await refresh();
    } finally {
      setGenerating(false);
    }
  };

  const setCardDecision = async (card: OpportunityCard, d: OpportunityDecision, statusConfirmed: boolean) => {
    const next = cards.map((c) =>
      c.id === card.id
        ? { ...c, decision: d, status: (statusConfirmed ? 'confirmed' : c.status) as OpportunityCard['status'], updatedAt: new Date().toISOString() }
        : c
    );
    await persistCards(next, d === 'undecided' ? '已重置为未决定' : `已拍板：${PROJECT_DECISION_LABELS[d === 'enter' ? 'go' : d === 'validate_first' ? 'validate_first' : d === 'hold' ? 'hold' : 'reject']}`);
  };

  const confirmCard = async (card: OpportunityCard) => {
    const next = cards.map((c) => (c.id === card.id ? { ...c, status: 'confirmed' as const, updatedAt: new Date().toISOString() } : c));
    await persistCards(next, '已确认这张机会卡（人工确认后 AI 重生成不会覆盖它）');
  };

  const removeCard = async (card: OpportunityCard) => {
    await persistCards(cards.filter((c) => c.id !== card.id), '已删除这张机会卡');
  };

  const toggleControlPoint = async (card: OpportunityCard, cpId: string) => {
    const next = cards.map((c) =>
      c.id === card.id && c.decisionPackage
        ? {
            ...c,
            decisionPackage: {
              ...c.decisionPackage,
              controlPoints: c.decisionPackage.controlPoints.map((p) => (p.id === cpId ? { ...p, confirmed: !p.confirmed } : p)),
            },
            updatedAt: new Date().toISOString(),
          }
        : c
    );
    await persistCards(next);
  };

  const addCardFromNeed = async (needId: string) => {
    const userLook = await loadUserLook(userId, project.id);
    const need = (userLook.unmetNeedCandidates ?? []).find((n) => n.id === needId);
    if (!need) {
      toast.error('这条需求找不到了');
      return;
    }
    const card = createOpportunityFromUnmetNeed(project.id, need);
    await persistCards([...cards, { ...card, kind: 'new_product', status: 'confirmed', confidence: 'low' }], '已手动新增一张机会卡');
  };

  const saveConclusion = async (kind: OpportunityConclusion['kind'], blocker?: NoOpportunityBlocker, missing?: string[]) => {
    const reason =
      kind === 'judged_none'
        ? blocker
          ? `已判断无机会：卡在「${NO_OPPORTUNITY_BLOCKER_LABELS[blocker]}」（人工判定）`
          : '已判断无机会（人工判定，未写卡点）'
        : '证据不足，暂不能判断（人工判定）';
    const next: OpportunityConclusion = {
      kind,
      blocker,
      reason,
      missingData: missing,
      confirmed: true,
      updatedAt: new Date().toISOString(),
    };
    await saveOpportunityConclusion(userId, project.id, next);
    setConclusion(next);
    const summary = await loadProjectDecisionSummary(userId, project);
    setDecision(summary);
    // 零机会也是结论：项目状态转为研究中（不自动判"已完成"，等用户推进）
    await setProjectStatus(userId, project.id, 'researching').catch(() => undefined);
    toast.success('零机会结论已记录（已人工确认）');
  };

  const onExport = async () => {
    try {
      const html = await buildOpportunityHtmlReport(userId, project);
      downloadHtmlReport(html, `${project.name}-选品决策审核报告`);
      toast.success('HTML 审核报告已导出（可离线打开）');
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** M5：Markdown 审核件（与 HTML 同源同口径；不做 PPT） */
  const onExportMd = async () => {
    try {
      const md = await buildOpportunityMarkdownReportForProject(userId, project);
      downloadMarkdownReport(md, `${project.name}-选品决策审核报告`);
      toast.success('Markdown 审核报告已导出');
    } catch (e) {
      toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const ranked = rankOpportunities(
    cards.map((c) => ({
      id: c.id,
      title: c.title,
      score: c.score,
      coverage: c.coverage,
      knownResourceGaps: (c.decisionPackage?.resources ?? []).filter((r) => r.knownGap).length,
    }))
  );

  if (busy && cards.length === 0 && !decision) {
    return (
      <Card>
        <div className="p-5 flex items-center justify-center text-sm text-[#aeaeb2]">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在载入机会卡与决策汇总…
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ① Go / No-Go 汇总 */}
      <Card>
        <div className="p-5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Swords className="w-4 h-4 text-indigo-600" />
              <p className="text-sm font-semibold text-[#1d1d1f]">Go / No-Go 汇总</p>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  decision?.status === 'go'
                    ? 'bg-emerald-50 text-emerald-700'
                    : decision?.status === 'no_opportunity'
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-indigo-50 text-indigo-700'
                )}
              >
                {decision ? PROJECT_DECISION_LABELS[decision.status] : '—'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void onGenerate()}
                disabled={generating}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60"
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                AI 生成机会卡
              </button>
              <button
                type="button"
                onClick={() => void onExport()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-black/10 bg-white text-xs font-semibold text-[#424245] hover:border-indigo-300 hover:text-indigo-700"
              >
                <Download className="w-3.5 h-3.5" /> 导出 HTML 审核报告
              </button>
              <button
                type="button"
                onClick={() => void onExportMd()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-black/10 bg-white text-xs font-semibold text-[#424245] hover:border-indigo-300 hover:text-indigo-700"
              >
                <Download className="w-3.5 h-3.5" /> 导出 MD
              </button>
            </div>
          </div>

          {hardBlocked && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
              <b className="inline-flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" /> 硬约束否决
              </b>
              ：{hardNotes.join('；') || '看自己里存在不满足的决策边界'} → 所有机会最高只能"验证后进入"，不得直接进入。
            </div>
          )}

          {decision && (
            <>
              <p className="text-sm font-bold text-[#1d1d1f]">{decision.headline}</p>
              <ul className="space-y-0.5">
                {decision.reasons.map((r, i) => (
                  <li key={i} className="text-[11px] text-[#424245] leading-relaxed">
                    · {r}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-indigo-700">
                <b>下一步：</b>
                {decision.nextAction}
              </p>
            </>
          )}
          {segmentNote && <p className="text-[10px] text-[#86868b]">{segmentNote}</p>}
        </div>
      </Card>

      {/* ② 零机会结论（两种合法结论，人工确认） */}
      <Card>
        <div className="p-5 space-y-2">
          <p className="text-sm font-semibold text-[#1d1d1f]">零机会结论（0 个机会也是合法结论）</p>
          <p className="text-[11px] text-[#86868b] leading-relaxed">
            只有下面两种写法是被允许的：<b>已判断无机会</b>（必须写明卡在哪一环）或
            <b>证据不足，暂不能判断</b>（必须写明缺什么、怎么补）。系统不会替你写这个结论。
          </p>
          {conclusion && (
            <div className="rounded-xl border border-black/8 bg-[#f8f9fb] px-3 py-2">
              <p className="text-[11px] font-semibold text-[#1d1d1f]">
                {NO_OPPORTUNITY_LABELS[conclusion.kind]}
                {conclusion.confirmed ? '（已确认）' : '（待确认）'}
              </p>
              {conclusion.reason && <p className="text-[11px] text-[#424245] leading-relaxed mt-0.5">{conclusion.reason}</p>}
              {(conclusion.missingData ?? []).length > 0 && (
                <ul className="mt-1">
                  {conclusion.missingData!.map((m, i) => (
                    <li key={i} className="text-[10px] text-amber-700">
                      · 缺：{m}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {(['need_satisfied', 'no_gap', 'cannot_deliver', 'no_profit'] as NoOpportunityBlocker[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => void saveConclusion('judged_none', b)}
                className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[10px] font-semibold text-[#86868b] hover:border-rose-300 hover:text-rose-700"
              >
                判为无机会：{NO_OPPORTUNITY_BLOCKER_LABELS[b]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void saveConclusion('insufficient_evidence', undefined, ['需求证据', '竞对满足矩阵', '自身品类题答案'])}
              className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[10px] font-semibold text-[#86868b] hover:border-amber-300 hover:text-amber-700"
            >
              判为：证据不足
            </button>
          </div>
        </div>
      </Card>

      {/* ③ 优先级矩阵（分数 × 覆盖度，§6.5） */}
      {ranked.length > 0 && (
        <Card>
          <div className="p-5">
            <p className="text-sm font-semibold text-[#1d1d1f] mb-1">优先级矩阵（评分 × 覆盖度）</p>
            <p className="text-[11px] text-[#86868b] mb-2">
              横轴评分、纵轴覆盖度；右上角是"又高分又有证据"，右下角是"高分但证据单薄"（要先补证据，别急着投钱）。
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'high-high', title: '高分 · 高覆盖（优先做）', test: (s: number, c: number) => s >= 60 && c >= 0.7, cls: 'border-emerald-200 bg-emerald-50/50' },
                { key: 'high-low', title: '高分 · 低覆盖（先补证据）', test: (s: number, c: number) => s >= 60 && c < 0.7, cls: 'border-amber-200 bg-amber-50/50' },
                { key: 'low-high', title: '低分 · 高覆盖（证据够但价值低）', test: (s: number, c: number) => s < 60 && c >= 0.7, cls: 'border-black/8 bg-[#f8f9fb]' },
                { key: 'low-low', title: '低分 · 低覆盖（先放一放）', test: (s: number, c: number) => s < 60 && c < 0.7, cls: 'border-black/8 bg-[#f8f9fb]' },
              ].map((q) => {
                const items = ranked.filter((r) => {
                  const card = cards.find((c) => c.id === r.cardId);
                  return card ? q.test(card.score, card.coverage) : false;
                });
                return (
                  <div key={q.key} className={cn('rounded-xl border px-3 py-2', q.cls)}>
                    <p className="text-[11px] font-semibold text-[#1d1d1f]">{q.title}</p>
                    {items.length === 0 ? (
                      <p className="text-[10px] text-[#aeaeb2] mt-0.5">（无）</p>
                    ) : (
                      <ul className="mt-0.5 space-y-0.5">
                        {items.map((r) => (
                          <li key={r.cardId} className="text-[10px] text-[#424245]">
                            {r.title}
                            <span className="text-[#aeaeb2]">
                              （{r.score} / {(r.coverage * 100).toFixed(0)}%）
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* ④ 机会卡（含决策包） */}
      {cards.length === 0 ? (
        <Card>
          <div className="p-5">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-700">还没有机会卡</p>
                <p className="text-xs text-amber-700/80 mt-1 leading-relaxed">
                  点上方「AI 生成机会卡」由系统综合四看证据出候选；也可以直接从「看用户」的未满足需求手动建卡。
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {ranked.length === 0 && evidenceLines.length > 0 && (
                    <span className="text-[10px] text-[#86868b]">项目已有 {evidenceLines.length} 条证据可引用</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {ranked.map((r, index) => {
            const card = cards.find((c) => c.id === r.cardId)!;
            const open = openCard === card.id;
            const b = card.scoreBreakdown;
            const pkg = card.decisionPackage;
            return (
              <Card key={card.id}>
                <div className="p-5 space-y-2.5">
                  {/* 卡头 */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[15px] font-bold text-[#1d1d1f]">
                        <span className="text-[#aeaeb2]">#{index + 1}</span> {card.title}
                        <span className="ml-2 text-[10px] font-normal text-[#86868b]">
                          {OPPORTUNITY_KIND_LABELS[card.kind ?? 'new_product']} · {CONFIDENCE_LABELS[card.confidence ?? 'low']}
                        </span>
                        {card.status === 'confirmed' ? (
                          <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            已确认
                          </span>
                        ) : (
                          <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            AI 候选
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-[#424245] mt-0.5 leading-relaxed">{card.needStatement}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {card.status !== 'confirmed' && (
                        <button
                          type="button"
                          onClick={() => void confirmCard(card)}
                          className="rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:border-emerald-400"
                        >
                          <CheckCircle2 className="inline w-3 h-3 mr-0.5" /> 确认这张卡
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void removeCard(card)}
                        className="rounded-lg border border-black/10 bg-white px-2 py-1 text-[10px] font-semibold text-[#86868b] hover:border-rose-300 hover:text-rose-700"
                      >
                        <Trash2 className="inline w-3 h-3 mr-0.5" /> 删除
                      </button>
                    </div>
                  </div>

                  {/* 红条 */}
                  {(hardBlocked || card.enterMode === 'validate_first') && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-[10px] text-rose-700">
                      <Lock className="inline w-3 h-3 mr-1" />
                      硬约束未通过：这张卡最高只能「验证后进入」，不得推荐「直接进入」
                    </div>
                  )}

                  {/* 评分拆解（确定性） */}
                  <div className="rounded-xl border border-black/8 bg-[#f8f9fb] px-3 py-2">
                    <p className="text-[11px] font-semibold text-[#1d1d1f]">
                      评分 {card.score}/100
                      <span className="ml-2 font-normal text-[#86868b]">覆盖度 {(card.coverage * 100).toFixed(0)}%（独立展示，不进 100 分）</span>
                    </p>
                    {b ? (
                      <div className="mt-1 grid grid-cols-2 md:grid-cols-5 gap-1.5">
                        {(Object.keys(SCORE_WEIGHTS) as ScoreDimension[]).map((d) => (
                          <div key={d} className="rounded-lg bg-white border border-black/8 px-2 py-1">
                            <p className="text-[9px] text-[#86868b]">
                              {SCORE_DIMENSION_LABELS[d]}（{SCORE_WEIGHTS[d]}）
                            </p>
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] font-bold text-[#1d1d1f] tabular-nums">{b[d]}</span>
                              <div className="flex-1 h-1 rounded-full bg-[#e5e5ea] overflow-hidden">
                                <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, b[d])}%` }} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-[#86868b] mt-0.5">这张卡还没有评分拆解（手动建的卡：跑一次 AI 生成或重算即可补齐）</p>
                    )}
                  </div>

                  {/* 决策包：路线图 */}
                  {pkg && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      <div>
                        <p className="text-[11px] font-semibold text-[#424245] mb-1">执行路线图</p>
                        {(['now', 'next'] as const).map((phase) => {
                          const items = pkg.roadmap.filter((a) => a.phase === phase);
                          if (items.length === 0) return null;
                          return (
                            <div key={phase} className="mb-1.5">
                              <p className="text-[10px] font-semibold text-indigo-700">{ROADMAP_PHASE_LABELS[phase]}</p>
                              <ol className="ml-3.5 list-decimal">
                                {items.map((a) => (
                                  <li key={a.id} className="text-[10px] text-[#424245] leading-relaxed">
                                    {a.action}
                                    {typeof a.cost === 'number' && <span className="text-[#86868b]">（约 ${a.cost.toLocaleString()}）</span>}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          );
                        })}
                      </div>

                      <div>
                        <p className="text-[11px] font-semibold text-[#424245] mb-1">前置资源</p>
                        <ul className="space-y-0.5">
                          {pkg.resources.map((res) => (
                            <li key={res.id} className="text-[10px] leading-relaxed">
                              {res.knownGap && <span className="mr-1 font-bold text-rose-600">[缺口]</span>}
                              <span className="text-[#86868b]">{RESOURCE_CATEGORY_LABELS[res.category]}｜</span>
                              <span className="text-[#424245]">{res.label}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <p className="text-[11px] font-semibold text-[#424245] mb-1">控制点（点一下即确认）</p>
                        {(['entry', 'process', 'stop'] as ControlPointKind[]).map((kind) => {
                          const items = pkg.controlPoints.filter((c) => c.kind === kind);
                          if (items.length === 0) return null;
                          return (
                            <div key={kind} className="mb-1.5">
                              <p className="text-[10px] font-semibold text-[#86868b]">{CONTROL_POINT_LABELS[kind]}</p>
                              <ul className="space-y-0.5">
                                {items.map((c) => (
                                  <li key={c.id}>
                                    <button
                                      type="button"
                                      onClick={() => void toggleControlPoint(card, c.id)}
                                      className={cn(
                                        'text-left text-[10px] leading-relaxed rounded px-1 py-0.5 w-full',
                                        c.confirmed ? 'text-emerald-700' : 'text-[#424245] hover:bg-[#f5f5f7]'
                                      )}
                                    >
                                      {c.confirmed ? '☑' : '☐'} {c.label}：{c.metric} {c.threshold}
                                      {!c.confirmed && <span className="text-amber-600">（待确认）</span>}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 决策按钮 */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-black/5">
                    <span className="text-[10px] text-[#86868b]">拍板：</span>
                    {(
                      [
                        ['enter', '进入'],
                        ['validate_first', '验证后进入'],
                        ['hold', '暂缓'],
                        ['reject', '放弃'],
                        ['undecided', '重置'],
                      ] as [OpportunityDecision, string][]
                    ).map(([d, label]) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => void setCardDecision(card, d, d !== 'undecided')}
                        className={cn(
                          'rounded-lg border px-2 py-1 text-[10px] font-semibold',
                          card.decision === d
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'bg-white border-black/10 text-[#86868b] hover:border-indigo-300 hover:text-indigo-700'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setOpenCard(open ? null : card.id)}
                      className="ml-auto text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      {open ? '收起证据/推理/反证' : '展开证据/推理/反证'}
                    </button>
                  </div>

                  {open && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 pt-1">
                      <div>
                        <p className="text-[11px] font-semibold text-[#424245] mb-1">证据</p>
                        {(card.evidenceRefs ?? []).length > 0 ? (
                          <ul className="space-y-0.5">
                            {card.evidenceRefs!.map((e, i) => (
                              <li key={i} className="text-[10px] text-[#424245] leading-relaxed">
                                <span className="font-mono text-[#86868b]">{e.sourceRef || e.evidenceId}</span> — {e.summary}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[10px] text-[#aeaeb2]">没有证据引用（这张卡还不成立）</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-[#424245] mb-1">推理</p>
                        {(card.reasoningSteps ?? []).length > 0 ? (
                          <ol className="ml-3.5 list-decimal">
                            {card.reasoningSteps!.map((s, i) => (
                              <li key={i} className="text-[10px] text-[#424245] leading-relaxed">
                                <b>{s.step}</b>：{s.detail}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-[10px] text-[#aeaeb2]">没有推理步骤</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-[#424245] mb-1">反证 / 还缺什么</p>
                        <ul className="space-y-0.5">
                          {(card.counterEvidence ?? []).map((c, i) => (
                            <li key={`c${i}`} className="text-[10px] text-rose-700 leading-relaxed">
                              · {c}
                            </li>
                          ))}
                          {(card.missingEvidence ?? []).map((c, i) => (
                            <li key={`m${i}`} className="text-[10px] text-amber-700 leading-relaxed">
                              · 缺：{c}
                            </li>
                          ))}
                          {(card.counterEvidence ?? []).length === 0 && (card.missingEvidence ?? []).length === 0 && (
                            <li className="text-[10px] text-[#aeaeb2]">还没有反证审查（可重新生成机会卡）</li>
                          )}
                        </ul>
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await reviewOpportunityCard(card, evidenceLines.slice(0, 10).join('\n'));
                            if (!res.ok) {
                              toast.error(res.error || '审查失败');
                              return;
                            }
                            const next = cards.map((c) =>
                              c.id === card.id
                                ? { ...c, counterEvidence: res.counterEvidence, missingEvidence: res.missingEvidence, updatedAt: new Date().toISOString() }
                                : c
                            );
                            await persistCards(next, '已完成反证审查（只写反证与缺失证据，不改评分）');
                          }}
                          className="mt-1 rounded-lg border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#86868b] hover:border-indigo-300 hover:text-indigo-700"
                        >
                          <Play className="inline w-3 h-3 mr-0.5" /> 让 AI 找反证
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-[#86868b]">{r.reason}</p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ④ 证据池（可追溯） */}
      {evidenceLines.length > 0 && (
        <Card>
          <div className="p-5">
            <p className="text-sm font-semibold text-[#1d1d1f] mb-1">项目证据池（{evidenceLines.length} 条，可追溯）</p>
            <ul className="space-y-0.5">
              {evidenceLines.slice(0, 8).map((l, i) => (
                <li key={i} className="text-[10px] text-[#86868b] leading-relaxed font-mono">
                  {l}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}
