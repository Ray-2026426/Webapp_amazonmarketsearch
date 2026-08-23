// 亚马逊市场调研「项目化」核心数据模型
// 依据 docs/amazon-market-research-prd.md 第 13 节，并补充 FR-01 / FR-07 所需字段。
// 这里的类型是 Phase 1 本地项目化 MVP 的唯一真源；新增页面不得另建一套项目模型。

export type FiveLookId = 'market' | 'user' | 'competitor' | 'self' | 'opportunity';

export type LookStatus = 'not_started' | 'in_progress' | 'completed' | 'stale';

export type ProjectStatus =
  | 'draft'
  | 'researching'
  | 'ready_for_review'
  | 'approved'
  | 'rejected'
  | 'archived';

export type OpportunityDecision = 'enter' | 'validate_first' | 'hold' | 'reject' | 'undecided';

export type UnmetNeedStatus = 'candidate' | 'validated' | 'rejected';

export const FIVE_LOOKS: FiveLookId[] = ['market', 'user', 'competitor', 'self', 'opportunity'];

export const FIVE_LOOK_LABELS: Record<FiveLookId, string> = {
  market: '看市场',
  user: '看用户',
  competitor: '看竞品',
  self: '看自己',
  opportunity: '看/找机会',
};

export const LOOK_STATUS_LABELS: Record<LookStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  stale: '需复核',
};

export interface FiveLookProgress {
  look: FiveLookId;
  status: LookStatus;
  /** 由必要证据项自动计算，0-100；禁止用户拖动，也不由 AI 主观判断 */
  completionPercent: number;
  completedEvidenceIds: string[];
  missingRequirements: string[];
  staleReasons: string[];
  updatedAt?: string;
}

/** FR-01 选填：目标售价范围 */
export interface PriceRange {
  min: number;
  max: number;
}

export interface ResearchProject {
  id: string;
  workspaceId: string;
  name: string;
  marketplace: string;
  objective: string;
  ownerId: string;
  memberIds: string[];
  status: ProjectStatus;
  activeLook: FiveLookId;
  fiveLookProgress: Record<FiveLookId, FiveLookProgress>;
  createdAt: string;
  updatedAt: string;
  version: number;
  // FR-01 选填字段
  categories?: string[];
  coreKeywords?: string[];
  seedAsins?: string[];
  targetUsers?: string;
  targetPriceRange?: PriceRange;
  targetGrossMargin?: number;
  plannedLaunchDate?: string;
  description?: string;
}

export interface UnmetNeed {
  id: string;
  projectId: string;
  targetUser: string;
  scenario: string;
  jobToBeDone: string;
  needStatement: string;
  currentAlternative: string;
  currentAlternativeCost: string;
  keywordEvidenceIds: string[];
  vocEvidenceIds: string[];
  competitorEvidenceIds: string[];
  /** 证据强度，0-100，由证据覆盖与跨来源一致性计算 */
  evidenceStrength: number;
  status: UnmetNeedStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RiskItem {
  id: string;
  category: 'demand' | 'competition' | 'product' | 'supply' | 'compliance' | 'profit';
  label: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  mitigation?: string;
}

export interface ValidationAction {
  id: string;
  action: string;
  owner: string;
  dueDate?: string;
  successCriteria: string;
}

/** 利润情景引用；完整计算模型由利润计算器维护（Phase 2 嵌入机会卡） */
export interface ProfitScenarioRef {
  id: string;
  label: string;
  grossMargin?: number;
  unitProfit?: number;
}

/** 机会卡内的轻量利润假设（售价/采购成本/CPC），用于商业可行性测算 */
export interface ProfitAssumption {
  price: number;
  cost: number;
  cpc: number;
}

export interface OpportunityCard {
  id: string;
  projectId: string;
  unmetNeedId: string;
  title: string;
  targetUser: string;
  scenario: string;
  jobToBeDone: string;
  needStatement: string;
  currentAlternative: string;
  currentAlternativeCost: string;
  solutionHypothesis: string;
  marketEvidenceIds: string[];
  userEvidenceIds: string[];
  competitorEvidenceIds: string[];
  selfAssessmentId: string;
  profitScenarioIds: string[];
  profitAssumption?: ProfitAssumption;
  risks: RiskItem[];
  validationActions: ValidationAction[];
  /** 确定性公式计算的基础分，0-100；AI 只解释，不修改 */
  score: number;
  /** 数据覆盖度，0-1，独立展示，不纳入 100 分 */
  coverage: number;
  decision: OpportunityDecision;
  createdAt: string;
  updatedAt: string;
}

/** 创建项目的输入（必填 + 选填） */
export interface CreateProjectInput {
  name: string;
  marketplace: string;
  objective: string;
  ownerId: string;
  categories?: string[];
  coreKeywords?: string[];
  seedAsins?: string[];
  targetUsers?: string;
  targetPriceRange?: PriceRange;
  targetGrossMargin?: number;
  plannedLaunchDate?: string;
  description?: string;
}
