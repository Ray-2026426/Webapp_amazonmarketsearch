// M4 · 零机会结论的确定性推导（PRD §6.5）。
//
// 关键设计：**这个函数可以返回 null**。
// "没有机会"是合法结论，但"数据支持机会却被系统写成没机会"是不可接受的——
// 所以规则是：只有在真的能指出卡点（需求已满足 / 竞争没缝隙 / 自身接不住 / 利润不成立）
// 或数据不足（并说明缺什么、怎么补）时才产出结论；否则返回 null，交给 AI 生成候选机会卡。
//
// 两种合法零结论（§6.5）：
//   judged_none           已判断无机会 —— 必须写明卡在哪一环
//   insufficient_evidence 证据不足，暂不能判断 —— 必须写明缺什么数据、怎么补

import type { OpportunityConclusion, NoOpportunityBlocker } from '../types/opportunity';
import { NO_OPPORTUNITY_BLOCKER_LABELS } from '../types/opportunity';
import type { ProfitAssumption } from '../types/researchProject';
import type { UnmetNeedCandidate } from './userLook';
import type { SatisfactionMatrix } from './competitorAnalysis';
import { profitMetrics } from './opportunityPlan';

export interface ConclusionInput {
  needs: UnmetNeedCandidate[];
  /** 竞对满足矩阵（看竞对 M3） */
  satisfaction?: SatisfactionMatrix[] | null;
  /** 目标细分机会分 0-100 */
  segmentOpportunity?: number;
  /** 是否已选目标细分 */
  hasTargetSegment?: boolean;
  /** 适配度与计入题数（看自己 §6.4） */
  fitScore?: number;
  fitAnswered?: number;
  /** 硬约束结论（SelfAssessment.hardConstraintVerdict） */
  hardConstraint?: { blocked: boolean; notes: string[] } | null;
  /** 利润假设（轻量三字段） */
  profit?: ProfitAssumption | null;
  /** 竞对样本数（<3 视为还没做对比） */
  competitorCount?: number;
  /** 项目 Evidence 条数 */
  evidenceCount?: number;
  now?: string;
}

export interface ConclusionSuggestion {
  /** null = 数据支持机会，不要写零机会结论 */
  conclusion: OpportunityConclusion | null;
  /** 为什么给出/不给结论（可复核） */
  rationale: string;
}

function blankConclusion(kind: OpportunityConclusion['kind'], reason: string, missing: string[] | undefined, now: string): OpportunityConclusion {
  return { kind, reason, missingData: missing, confirmed: false, updatedAt: now };
}

/**
 * 确定性推导零机会结论。AI 只能解释，不能改这个判定。
 */
export function suggestConclusion(input: ConclusionInput): ConclusionSuggestion {
  const now = input.now ?? new Date().toISOString();
  const needs = (input.needs ?? []).filter((n) => (n.needStatement || '').trim().length > 0);
  const satisfaction = Array.isArray(input.satisfaction) ? input.satisfaction : [];
  const cells = satisfaction.flatMap((m) => m.cells);
  const competitorCount = input.competitorCount ?? 0;

  // ── 第一步：数据够不够（不够就明说缺什么） ──
  const missingData: string[] = [];
  if (needs.length === 0) missingData.push('「看用户」还没有需求（至少 1 条带证据的需求）');
  if (cells.length === 0) missingData.push('「看竞对」还没有满足矩阵（先挑 3 个竞对并做完三块分析）');
  if (competitorCount > 0 && competitorCount < 3) missingData.push(`竞对样本只有 ${competitorCount} 个（口径是 3 个：头部/跟随者/新人）`);
  if (typeof input.segmentOpportunity !== 'number' || input.segmentOpportunity <= 0) {
    missingData.push('「看市场」还没有细分机会分（先选定目标细分）');
  }
  if ((input.fitAnswered ?? 0) === 0) missingData.push('「看自己」还没有可计入的品类选择题答案（"待确认"不算）');
  if ((input.evidenceCount ?? 0) === 0) missingData.push('项目还没有任何 Evidence（评论/关键词/图表证据都没沉淀）');

  if (missingData.length > 0) {
    return {
      conclusion: blankConclusion(
        'insufficient_evidence',
        `证据不足，暂不能判断：还缺 ${missingData.length} 项关键数据，补齐后再下结论（不猜）`,
        missingData,
        now
      ),
      rationale: `缺数据：${missingData.join('；')}`,
    };
  }

  // ── 第二步：能不能指出卡点 ──
  const blockers: { blocker: NoOpportunityBlocker; reason: string }[] = [];

  // ① 需求已被满足：没有一格是未满足，且至少有一格明确"满足"
  const unmet = cells.filter((c) => c.status === 'unmet').length;
  const met = cells.filter((c) => c.status === 'met').length;
  if (unmet === 0 && met > 0) {
    blockers.push({
      blocker: 'need_satisfied',
      reason: `${cells.length} 个「需求 × 竞对」格子里没有一格是未满足，且有 ${met} 格明确满足——用户已经被现有产品服务到了`,
    });
  }

  // ② 竞争没有缝隙：既没有未满足，也没有"自称满足但缺证据"的部分满足
  const partial = cells.filter((c) => c.status === 'partial').length;
  if (unmet === 0 && partial === 0 && met === 0) {
    blockers.push({
      blocker: 'no_gap',
      reason: '所有格子都是"未提及"：既没有竞对做到、也没有竞对宣称，等于没有可对标的需求落点（要么需求不成立，要么数据没抓到）',
    });
  }

  // ③ 自身接不住：硬约束否决（毛利红线/认证/MOQ 等）
  if (input.hardConstraint?.blocked) {
    blockers.push({
      blocker: 'cannot_deliver',
      reason: `硬约束否决：${(input.hardConstraint.notes ?? []).join('；') || '存在不满足的决策边界'}`,
    });
  } else if (typeof input.fitScore === 'number' && input.fitScore < 30) {
    blockers.push({
      blocker: 'cannot_deliver',
      reason: `适配度只有 ${input.fitScore}/100（相关题均分 × 背景库完整度）：自身能力与这个方向不匹配`,
    });
  }

  // ④ 利润不成立：利润假设存在且单位经济为负
  const metrics = profitMetrics(input.profit ?? null);
  if (metrics && metrics.unitProfit <= 0) {
    blockers.push({
      blocker: 'no_profit',
      reason: `利润不成立：售价 $${input.profit?.price} − 采购 $${input.profit?.cost} − CPC $${input.profit?.cpc} = 单位利润 $${metrics.unitProfit.toFixed(2)}（为负）`,
    });
  }

  if (blockers.length > 0) {
    const first = blockers[0];
    return {
      conclusion: blankConclusion(
        'judged_none',
        `已判断无机会（卡在「${NO_OPPORTUNITY_BLOCKER_LABELS[first.blocker]}」）：${blockers.map((b) => b.reason).join('；')}`,
        undefined,
        now
      ),
      rationale: blockers.map((b) => `${NO_OPPORTUNITY_BLOCKER_LABELS[b.blocker]}：${b.reason}`).join('；'),
    };
  }

  // ── 第三步：数据齐全且没有卡点 → 不下零结论 ──
  return {
    conclusion: null,
    rationale:
      '数据齐全且没有发现卡点（不存在"需求已满足/没缝隙/接不住/利润不成立"），不应该写成零机会——交给 AI 生成候选机会卡，再由你拍板',
  };
}

/** 把结论压成一行（主屏/报告用） */
export function describeConclusion(c: OpportunityConclusion | null): string {
  if (!c) return '还没有零机会结论（数据支持生成机会卡）';
  if (c.kind === 'judged_none') return `已判断无机会：${c.reason}${c.confirmed ? '' : '（待你确认）'}`;
  return `证据不足：${c.reason}${c.missingData?.length ? `｜缺：${c.missingData.join('、')}` : ''}`;
}
