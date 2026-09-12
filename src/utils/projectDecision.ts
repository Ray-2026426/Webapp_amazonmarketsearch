// M4 · 项目决策摘要（Go / No-Go 汇总，PRD §6.5）。
//
// 判断逻辑是**纯函数**（summarizeProjectDecision），因为它是全项目对外的一句话结论，
// 必须可测、可复核、不依赖 AI：AI 只负责把理由写得更清楚，不负责决定状态。
//
// 六种状态（§6.5 的 Go/No-Go 汇总口径）：
//   go              进入（有已决策为"进入"的卡，且无硬约束否决）
//   validate_first  验证后进入（有已决策为"验证后进入"，或硬约束否决）
//   hold            暂缓
//   reject          放弃
//   no_opportunity  无机会（零机会结论 = 已判断无机会）
//   insufficient    证据不足（零机会结论 = 证据不足）
//   undecided       还没拍板

import type { OpportunityCard, ResearchProject } from '../types/researchProject';
import type { OpportunityConclusion } from '../types/opportunity';
import { loadOpportunities, loadOpportunityConclusion } from './opportunityStore';
import { loadSelfAssessment } from './selfAssessment';
import { rankOpportunities } from './opportunityPlan';

export type ProjectDecisionStatus =
  | 'go'
  | 'validate_first'
  | 'hold'
  | 'reject'
  | 'no_opportunity'
  | 'insufficient'
  | 'undecided';

export const PROJECT_DECISION_LABELS: Record<ProjectDecisionStatus, string> = {
  go: '进入',
  validate_first: '验证后进入',
  hold: '暂缓',
  reject: '放弃',
  no_opportunity: '无机会',
  insufficient: '证据不足',
  undecided: '还未拍板',
};

export interface ProjectDecisionSummary {
  status: ProjectDecisionStatus;
  /** 一句话结论（可直接放报告页/导出件顶部） */
  headline: string;
  /** 判断依据（每条都能复核） */
  reasons: string[];
  cardCount: number;
  decidedCount: number;
  /** 硬约束是否否决（决定"进入"能否成立） */
  hardBlocked: boolean;
  hardNotes: string[];
  /** 下一步该做什么（人话） */
  nextAction: string;
  /** 最高分机会（供报告展示） */
  topOpportunity?: { title: string; score: number; coverage: number; decision: OpportunityCard['decision'] };
}

/**
 * 纯函数：由机会卡 + 零机会结论 + 硬约束推出项目级结论。
 * 优先级（严格顺序）：硬约束 → 无机会/证据不足 → 已拍板的卡 → 未拍板。
 */
export function summarizeProjectDecision(input: {
  cards: OpportunityCard[];
  conclusion?: OpportunityConclusion | null;
  hardConstraint?: { blocked: boolean; notes: string[] } | null;
}): ProjectDecisionSummary {
  const cards = Array.isArray(input.cards) ? input.cards : [];
  const conclusion = input.conclusion ?? null;
  const hardBlocked = Boolean(input.hardConstraint?.blocked);
  const hardNotes = input.hardConstraint?.notes ?? [];
  const reasons: string[] = [];

  const decided = cards.filter((c) => c.decision !== 'undecided');
  const ranked = rankOpportunities(
    cards.map((c) => ({
      id: c.id,
      title: c.title,
      score: c.score,
      coverage: c.coverage,
      knownResourceGaps: (c.decisionPackage?.resources ?? []).filter((r) => r.knownGap).length,
    }))
  );
  const topCard = ranked.length > 0 ? cards.find((c) => c.id === ranked[0].cardId) : undefined;
  const topOpportunity = topCard
    ? { title: topCard.title, score: topCard.score, coverage: topCard.coverage, decision: topCard.decision }
    : undefined;

  const base = {
    cardCount: cards.length,
    decidedCount: decided.length,
    hardBlocked,
    hardNotes,
    nextAction: '',
    topOpportunity,
  };

  // ① 硬约束否决最优先：进入这条路直接封死
  if (hardBlocked) {
    reasons.push(`硬约束否决：${hardNotes.join('；') || '存在不满足的决策边界'}`);
    reasons.push('按 §6.4，关联机会最高只能"验证后进入"，不能推荐"直接进入"');
    return {
      ...base,
      status: 'validate_first',
      headline: '验证后进入（硬约束未通过）',
      reasons,
      nextAction: '先解决硬约束（认证/毛利红线/MOQ），或把机会降级为"先验证"的小规模测试',
    };
  }

  // ② 零机会结论（人工确认过的才作为项目结论）
  if (cards.length === 0 && conclusion) {
    if (conclusion.kind === 'judged_none') {
      reasons.push(conclusion.reason);
      reasons.push(conclusion.confirmed ? '该结论已人工确认' : '该结论尚未人工确认（零机会也是结论，需要拍板）');
      return {
        ...base,
        status: 'no_opportunity',
        headline: '无机会',
        reasons,
        nextAction: '换细分/换需求方向，或把这个品类的结论归档（写清卡在哪一环即可复用）',
      };
    }
    reasons.push(conclusion.reason);
    if (conclusion.missingData?.length) reasons.push(`缺：${conclusion.missingData.join('、')}`);
    return {
      ...base,
      status: 'insufficient',
      headline: '证据不足，暂不能判断',
      reasons,
      nextAction: `补齐这些数据后再下结论：${(conclusion.missingData ?? []).slice(0, 3).join('、') || '需求证据 / 竞对矩阵 / 自身适配'}`,
    };
  }

  // ③ 有卡但还没生成零机会结论（且没有任何卡被拍板）
  if (decided.length === 0) {
    reasons.push(cards.length > 0 ? `已有 ${cards.length} 张机会卡，但都还没拍板（状态：AI 候选）` : '还没有机会卡');
    reasons.push('机会卡需要你逐条确认（确认/编辑/合并/删除），系统不替你拍板');
    return {
      ...base,
      status: 'undecided',
      headline: '还未拍板',
      reasons,
      nextAction: cards.length > 0 ? '逐条核对机会卡的证据与决策包，给出 Go / No-Go' : '先点「生成机会卡」',
    };
  }

  // ④ 已拍板的卡：按"最保守的结论"汇总（放弃/暂缓优先于进入）
  const counts = {
    enter: decided.filter((c) => c.decision === 'enter').length,
    validate_first: decided.filter((c) => c.decision === 'validate_first').length,
    hold: decided.filter((c) => c.decision === 'hold').length,
    reject: decided.filter((c) => c.decision === 'reject').length,
  };
  reasons.push(`已拍板 ${decided.length} 张：进入 ${counts.enter} / 验证后进入 ${counts.validate_first} / 暂缓 ${counts.hold} / 放弃 ${counts.reject}`);

  let status: ProjectDecisionStatus = 'undecided';
  let headline = '还未拍板';
  let nextAction = '';
  if (counts.enter > 0) {
    status = 'go';
    headline = '进入';
    const top = ranked.find((r) => cards.find((c) => c.id === r.cardId)?.decision === 'enter');
    reasons.push(
      top
        ? `最先做「${top.title}」（评分 ${top.score}）：${top.reason}`
        : '有已确认进入的机会卡'
    );
    nextAction = '按机会卡里的执行路线图推进：先做 0-30 天的打样/测评/认证，并盯住准入控制点';
  } else if (counts.validate_first > 0) {
    status = 'validate_first';
    headline = '验证后进入';
    reasons.push('没有直接进入的卡，但有需要先验证的机会：先花最小成本证伪');
    nextAction = '按路线图"先做"段执行验证动作，达到准入控制点后再进入';
  } else if (counts.hold > 0) {
    status = 'hold';
    headline = '暂缓';
    reasons.push('全部已拍板机会都是"暂缓"：条件未成熟');
    nextAction = '写清暂缓的触发条件（什么变化后重新评估），避免无限期挂着';
  } else if (counts.reject > 0 && counts.reject === decided.length) {
    status = 'reject';
    headline = '放弃';
    reasons.push('已拍板的机会全部放弃');
    nextAction = '换个细分或需求方向重新走一遍五看';
  }

  return { ...base, status, headline, reasons, nextAction };
}

/** 异步装载 + 汇总（UI 与导出件共用，保证口径一致） */
export async function loadProjectDecisionSummary(
  userId: string,
  project: ResearchProject
): Promise<ProjectDecisionSummary> {
  const [cards, conclusion, self] = await Promise.all([
    loadOpportunities(userId, project.id),
    loadOpportunityConclusion(userId, project.id),
    loadSelfAssessment(userId, project.id),
  ]);
  return summarizeProjectDecision({ cards, conclusion, hardConstraint: self.hardConstraintVerdict ?? null });
}
