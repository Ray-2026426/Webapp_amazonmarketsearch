// 五看「AI 起草」的每看回填适配层（M1）。
//
// 为什么单独抽出来：四个看原本各自在组件里写回填逻辑，一键向导（LookWizardPanel）也需要同一套合并，
// 因此把「AI 输出 → 各看数据结构」的映射收敛到这里，组件与向导共用，避免两份逻辑漂移。
//
// 所有合并都走 lookAiMerge 的非破坏性规则：**只填空字段，绝不覆盖人工已填内容**。

import { makeMergeAcc, mergeText, mergeList, mergeUnmetNeedCandidates, type MergeAcc } from './lookAiMerge';
import { createUnmetNeedId, type UserLookData } from './userLook';
import type { MarketLookData } from './marketLook';
import type { CompetitorLookData } from './competitorLook';
import type { SelfAssessment, SelfAiDraft } from './selfAssessment';

export interface MergeResult<T> {
  next: T;
  filled: string[];
  skipped: string[];
}

export function mergeUserLookAi(data: UserLookData, out: Record<string, unknown>): MergeResult<UserLookData> {
  const acc = makeMergeAcc();
  const next: UserLookData = {
    ...data,
    targetUser: mergeText(data.targetUser, out.targetUser, '目标用户', acc),
    scenario: mergeText(data.scenario, out.scenario, '使用场景', acc),
    jobToBeDone: mergeText(data.jobToBeDone, out.jobToBeDone, '用户任务 / JTBD', acc),
    satisfiedNeeds: mergeList(data.satisfiedNeeds, out.satisfiedNeeds, '已满足需求', acc),
    unmetNeedCandidates: mergeUnmetNeedCandidates(
      data.unmetNeedCandidates,
      out.unmetNeedCandidates,
      createUnmetNeedId,
      '未满足需求候选',
      acc
    ),
  };
  return { next, filled: acc.filled, skipped: acc.skipped };
}

export function mergeMarketLookAi(data: MarketLookData, out: Record<string, unknown>): MergeResult<MarketLookData> {
  const acc = makeMergeAcc();
  const next: MarketLookData = {
    ...data,
    attractiveness: mergeText(data.attractiveness, out.attractiveness, '市场吸引力判断', acc),
    keyEvidences: mergeList(data.keyEvidences, out.keyEvidences, '关键证据', acc),
    risks: mergeList(data.risks, out.risks, '主要风险', acc),
    openQuestions: mergeList(data.openQuestions, out.openQuestions, '待验证问题', acc),
  };
  return { next, filled: acc.filled, skipped: acc.skipped };
}

export function mergeCompetitorLookAi(
  data: CompetitorLookData,
  out: Record<string, unknown>
): MergeResult<CompetitorLookData> {
  const acc = makeMergeAcc();
  const next: CompetitorLookData = {
    ...data,
    samplePool: mergeList(data.samplePool, out.samplePool, '竞品样本池', acc),
    benchmarkAsins: mergeList(data.benchmarkAsins, out.benchmarkAsins, '标杆 ASIN', acc),
    barriers: mergeText(data.barriers, out.barriers, '竞争壁垒与经营能力', acc),
    needMatrix: mergeText(data.needMatrix, out.needMatrix, '需求满足矩阵', acc),
    gaps: mergeList(data.gaps, out.gaps, '未充分满足的产品缺口', acc),
  };
  return { next, filled: acc.filled, skipped: acc.skipped };
}

/** 看自己：AI 只写 aiDraft，绝不改动 items 里的人工自评 */
export function mergeSelfAi(assessment: SelfAssessment, out: Record<string, unknown>): MergeResult<SelfAssessment> {
  const acc = makeMergeAcc();
  const cur: SelfAiDraft = assessment.aiDraft ?? {};
  const aiDraft: SelfAiDraft = {
    conclusion: mergeText(cur.conclusion ?? '', out.conclusion, '适配度总体判断', acc),
    strengths: mergeList(cur.strengths ?? [], out.strengths, '自身优势', acc),
    gaps: mergeList(cur.gaps ?? [], out.gaps, '能力缺口', acc),
    hardConstraints: mergeList(cur.hardConstraints ?? [], out.hardConstraints, '硬约束与止损边界', acc),
    fitAssessment: mergeText(cur.fitAssessment ?? '', out.fitAssessment, '对机会卡的适配度评价', acc),
    updatedAt: new Date().toISOString(),
  };
  return { next: { ...assessment, aiDraft }, filled: acc.filled, skipped: acc.skipped };
}

/** 把「看自己」已作答项整理成 AI 可读的问答对（未作答项不传，避免 AI 凭空判断） */
export function buildSelfAnswers(
  assessment: SelfAssessment,
  categoryLabels: Record<string, string>,
  statusLabels: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const it of assessment.items) {
    if (it.status === 'unknown') continue;
    const label = `${categoryLabels[it.category] ?? it.category}·${it.label}`;
    out[label] = `${statusLabels[it.status] ?? it.status}${it.note?.trim() ? `；${it.note.trim()}` : ''}`;
  }
  return out;
}
