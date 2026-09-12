// M4 · 看机会 V2 的数据结构（PRD §6.5）。
//
// 为什么单独一个文件：机会卡在 V2 里膨胀成一个「决策包」（路线图/前置资源/控制点/评分拆解/证据引用），
// 这些类型被评分、决策包推导、HTML 报告、Go/No-Go 汇总、UI 五处共用，放一处避免各写一套。

import type { FiveLookId } from './researchProject';

/** 机会卡状态：AI 候选 → 已确认（phase-0 防线的状态机口径） */
export type OpportunityStatus = 'ai_candidate' | 'confirmed';

/** 进入方式：硬约束否决时只能是 validate_first（最高"验证后进入"，§6.4） */
export type OpportunityEnterMode = 'direct' | 'validate_first';

export type OpportunityKind = 'new_product' | 'improve_existing' | 'bundle' | 'niche';

export const OPPORTUNITY_KIND_LABELS: Record<OpportunityKind, string> = {
  new_product: '新品机会',
  improve_existing: '老品改版',
  bundle: '组合/套装',
  niche: '细分卡位',
};

export type OpportunityConfidence = 'low' | 'medium' | 'high';

export const CONFIDENCE_LABELS: Record<OpportunityConfidence, string> = {
  low: '可信度低',
  medium: '可信度中',
  high: '可信度高',
};

/** 证据引用：机会卡必须挂"哪一看的哪条证据"，可追溯到 Evidence.sourceRef */
export interface OpportunityEvidenceRef {
  /** Evidence.id（可点回原始来源） */
  evidenceId: string;
  look: FiveLookId;
  /** 人话来源，例如 'review:B0XXX #34' / 'chart:价格带@侧睡细分' */
  sourceRef: string;
  summary: string;
}

/** 推理步骤（二级页⑬ 的"推理"栏；每一步都要能指回证据） */
export interface OpportunityReasoningStep {
  step: string;
  detail: string;
  evidenceIds: string[];
}

/** 评分拆解（§8.1 五维 25/25/25/15/10） */
export interface OpportunityScoreBreakdown {
  demandStrength: number;
  marketOpportunity: number;
  competitorGap: number;
  selfFit: number;
  evidenceConfidence: number;
  /** 各维权重，便于展示与复核 */
  weights: typeof import('../utils/opportunityScoreV2').SCORE_WEIGHTS;
  total: number;
}

/* ── 决策包（§6.5 核心新增） ── */

export type RoadmapPhase = 'now' | 'next';

export const ROADMAP_PHASE_LABELS: Record<RoadmapPhase, string> = {
  now: '先做（0-30 天）',
  next: '后做（30-90 天）',
};

export interface RoadmapAction {
  id: string;
  phase: RoadmapPhase;
  action: string;
  /** 预估花费（美元）；0 = 主要是人力/时间成本 */
  cost?: number;
  note?: string;
  done?: boolean;
}

export type ResourceCategory = 'funding' | 'supply' | 'compliance' | 'content' | 'team' | 'data';

export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, string> = {
  funding: '资金',
  supply: '供应链',
  compliance: '合规',
  content: '素材内容',
  team: '团队',
  data: '数据',
};

export interface RequiredResource {
  id: string;
  label: string;
  category: ResourceCategory;
  /** 对照背景库：已知缺口（界面标红，不假装都有） */
  knownGap?: boolean;
  note?: string;
}

export type ControlPointKind = 'entry' | 'process' | 'stop';

export const CONTROL_POINT_LABELS: Record<ControlPointKind, string> = {
  entry: '准入控制点（满足才继续）',
  process: '过程控制点（监控指标）',
  stop: '止损控制点（触发即撤）',
};

export interface ControlPoint {
  id: string;
  kind: ControlPointKind;
  label: string;
  metric: string;
  threshold: string;
  /**
   * 是否被人工改过（线框图二级页⑭「阈值要能改」）。
   * 语义：`threshold` 这一格已经被用户**手工写过**，不再等于确定性规则的推导值。
   * 硬规则：**人工改过的阈值必须活过"重算 / 重新生成决策包"**——重算时按 id（退化为
   * kind+label+metric）对齐，编辑值不得被静默覆盖（见 `utils/controlPointEditing.ts` 的
   * `mergeControlPointsPreservingEdits`，由 `buildDecisionPackage` 统一调用）。
   */
  thresholdEdited?: boolean;
  /** 默认由系统推导，**必须用户确认**（确认是拍板动作）；阈值一改，之前的确认作废 */
  confirmed: boolean;
  note?: string;
}

export interface OpportunityDecisionPackage {
  roadmap: RoadmapAction[];
  resources: RequiredResource[];
  controlPoints: ControlPoint[];
}

/** 零机会的两种合法结论（§6.5） */
export type NoOpportunityKind = 'judged_none' | 'insufficient_evidence';

export const NO_OPPORTUNITY_LABELS: Record<NoOpportunityKind, string> = {
  judged_none: '已判断无机会',
  insufficient_evidence: '证据不足，暂不能判断',
};

/** "已判断无机会"卡在哪一环 */
export type NoOpportunityBlocker = 'need_satisfied' | 'no_gap' | 'cannot_deliver' | 'no_profit';

export const NO_OPPORTUNITY_BLOCKER_LABELS: Record<NoOpportunityBlocker, string> = {
  need_satisfied: '需求已被满足',
  no_gap: '竞争没有缝隙',
  cannot_deliver: '自身接不住',
  no_profit: '利润不成立',
};

export interface OpportunityConclusion {
  kind: NoOpportunityKind;
  /** kind = judged_none 时必填：卡在哪一环 */
  blocker?: NoOpportunityBlocker;
  /** 人话理由（必须能指向证据或缺口） */
  reason: string;
  /** kind = insufficient_evidence 时必填：缺什么、怎么补 */
  missingData?: string[];
  /** 人工确认过（零机会也是结论，需要拍板） */
  confirmed: boolean;
  updatedAt: string;
}
