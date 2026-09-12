// 看/找机会（FR-07）：机会卡存储 + 从「看用户」未满足需求生成机会 + 确定性评分。
import { get, set } from 'idb-keyval';
import type {
  FiveLookProgress,
  OpportunityCard,
  OpportunityDecision,
  ProfitAssumption,
  ResearchProject,
  RiskItem,
} from '../types/researchProject';
import type {
  ControlPoint,
  OpportunityConclusion,
  OpportunityConfidence,
  OpportunityEvidenceRef,
  OpportunityKind,
  OpportunityReasoningStep,
  OpportunityStatus,
  RequiredResource,
  RoadmapAction,
} from '../types/opportunity';
import { SCORE_WEIGHTS } from './opportunityScoreV2';
import type { FiveLookId } from '../types/researchProject';
import type { UnmetNeedCandidate, UserLookData } from './userLook';
import type { SelfAssessment } from './selfAssessment';

const KEY_PREFIX = 'amzdev_opp:';
function storageKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

export function createOpportunityId(): string {
  return `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createOpportunityFromUnmetNeed(
  projectId: string,
  candidate: UnmetNeedCandidate
): OpportunityCard {
  const now = new Date().toISOString();
  return {
    id: createOpportunityId(),
    projectId,
    unmetNeedId: candidate.id,
    title: candidate.needStatement.trim() || '未命名机会',
    targetUser: candidate.targetUser,
    scenario: candidate.scenario,
    jobToBeDone: candidate.jobToBeDone,
    needStatement: candidate.needStatement,
    currentAlternative: candidate.currentAlternative,
    currentAlternativeCost: '',
    solutionHypothesis: '',
    marketEvidenceIds: [],
    userEvidenceIds: [],
    competitorEvidenceIds: [],
    selfAssessmentId: '',
    profitScenarioIds: [],
    risks: [],
    validationActions: [],
    score: 0,
    coverage: 0,
    decision: 'undecided',
    createdAt: now,
    updatedAt: now,
  };
}

/** 确定性计算「看/找机会」进度。 */
export function computeOpportunityProgress(
  cards: OpportunityCard[],
  project: ResearchProject
): Pick<FiveLookProgress, 'status' | 'completionPercent' | 'missingRequirements'> {
  const fourLooksComplete = ['market', 'user', 'competitor', 'self'].every(
    (l) => project.fiveLookProgress[l as 'market' | 'user' | 'competitor' | 'self'].status === 'completed'
  );
  const hasCards = cards.length > 0;
  const hasDecided = cards.some((c) => c.decision !== 'undecided');
  const filled = (hasCards ? 1 : 0) + (hasDecided ? 1 : 0) + (fourLooksComplete ? 1 : 0);
  const completionPercent = Math.round((filled / 3) * 100);
  let status: FiveLookProgress['status'] = 'not_started';
  if (filled > 0 && filled < 3) status = 'in_progress';
  else if (filled === 3) status = 'completed';
  const missing: string[] = [];
  if (!hasCards) missing.push('缺少「机会卡」');
  if (!hasDecided) missing.push('机会卡尚未给出决策');
  if (!fourLooksComplete) missing.push('前四看尚未全部完成');
  return { status, completionPercent, missingRequirements: missing };
}

export async function loadOpportunities(userId: string, projectId: string): Promise<OpportunityCard[]> {
  try {
    const raw = await get<OpportunityCard[]>(storageKey(userId, projectId));
    if (Array.isArray(raw)) return raw;
  } catch {
    /* ignore */
  }
  return [];
}

/* ───────────── M4 · 看机会 V2 新增 ───────────── */

const CONCLUSION_KEY_PREFIX = 'amzdev_opp_conclusion:';
function conclusionKey(userId: string, projectId: string): string {
  return `${CONCLUSION_KEY_PREFIX}${userId}:${projectId}`;
}

/** 零机会结论（§6.5）：读；没有就是"还没下结论"，不默认成"无机会" */
export async function loadOpportunityConclusion(
  userId: string,
  projectId: string
): Promise<OpportunityConclusion | null> {
  try {
    const raw = await get<OpportunityConclusion>(conclusionKey(userId, projectId));
    if (raw && typeof raw === 'object' && typeof raw.kind === 'string') return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export async function saveOpportunityConclusion(
  userId: string,
  projectId: string,
  conclusion: OpportunityConclusion
): Promise<void> {
  await set(conclusionKey(userId, projectId), { ...conclusion, updatedAt: new Date().toISOString() });
}

const VALID_STATUS: OpportunityStatus[] = ['ai_candidate', 'confirmed'];
const VALID_DECISIONS: OpportunityDecision[] = ['enter', 'validate_first', 'hold', 'reject', 'undecided'];
const VALID_KINDS: OpportunityKind[] = ['new_product', 'improve_existing', 'bundle', 'niche'];
const VALID_CONFIDENCE: OpportunityConfidence[] = ['low', 'medium', 'high'];

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];
}

/**
 * M4 · 归一化机会卡（AI 输出不可信）。
 * 用途：AI 生成候选卡 → 这里逐字段校验后再落库。规则：
 * - 枚举值必须在白名单里，否则退回安全默认（状态 ai_candidate、决策 undecided）；
 * - 评分/覆盖度**不接受 AI 给的值**（由确定性公式重算，调用方覆盖），这里只保留数字类型校验；
 * - 决策包/证据引用/推理步骤做结构清洗（去空项、限长），脏数据宁可丢字段也不留半成品。
 */
export function normalizeOpportunityCard(raw: unknown, projectId: string): OpportunityCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title);
  const needStatement = str(r.needStatement);
  if (!title && !needStatement) return null; // 连标题都没有的卡片没有意义
  const now = new Date().toISOString();

  const evidenceRefs: OpportunityEvidenceRef[] = Array.isArray(r.evidenceRefs)
    ? (r.evidenceRefs as Record<string, unknown>[])
        .map((e) => ({
          evidenceId: str(e?.evidenceId),
          look: (str(e?.look) || 'user') as FiveLookId,
          sourceRef: str(e?.sourceRef),
          summary: str(e?.summary).slice(0, 300),
        }))
        .filter((e) => e.evidenceId || e.sourceRef)
        .slice(0, 20)
    : [];

  const reasoningSteps: OpportunityReasoningStep[] = Array.isArray(r.reasoningSteps)
    ? (r.reasoningSteps as Record<string, unknown>[])
        .map((s) => ({
          step: str(s?.step).slice(0, 200),
          detail: str(s?.detail).slice(0, 600),
          evidenceIds: strArray(s?.evidenceIds).slice(0, 20),
        }))
        .filter((s) => s.step || s.detail)
        .slice(0, 10)
    : [];

  const pkgRaw = (r.decisionPackage ?? {}) as Record<string, unknown>;
  const roadmap: RoadmapAction[] = Array.isArray(pkgRaw.roadmap)
    ? (pkgRaw.roadmap as Record<string, unknown>[])
        .map((a) => ({
          id: str(a?.id) || createOpportunityId().replace('o_', 'rm_'),
          phase: (str(a?.phase) === 'next' ? 'next' : 'now') as RoadmapAction['phase'],
          action: str(a?.action).slice(0, 200),
          cost: typeof a?.cost === 'number' && Number.isFinite(a.cost) ? Math.max(0, a.cost) : undefined,
          note: str(a?.note).slice(0, 300) || undefined,
          done: Boolean(a?.done),
        }))
        .filter((a) => a.action)
        .slice(0, 20)
    : [];
  const resources: RequiredResource[] = Array.isArray(pkgRaw.resources)
    ? (pkgRaw.resources as Record<string, unknown>[])
        .map((x) => ({
          id: str(x?.id) || createOpportunityId().replace('o_', 'res_'),
          label: str(x?.label).slice(0, 120),
          category: (['funding', 'supply', 'compliance', 'content', 'team', 'data'].includes(str(x?.category))
            ? str(x?.category)
            : 'funding') as RequiredResource['category'],
          knownGap: Boolean(x?.knownGap),
          note: str(x?.note).slice(0, 300) || undefined,
        }))
        .filter((x) => x.label)
        .slice(0, 20)
    : [];
  const controlPoints: ControlPoint[] = Array.isArray(pkgRaw.controlPoints)
    ? (pkgRaw.controlPoints as Record<string, unknown>[])
        .map((c) => ({
          id: str(c?.id) || createOpportunityId().replace('o_', 'cp_'),
          kind: (['entry', 'process', 'stop'].includes(str(c?.kind)) ? str(c?.kind) : 'process') as ControlPoint['kind'],
          label: str(c?.label).slice(0, 160),
          metric: str(c?.metric).slice(0, 60),
          threshold: str(c?.threshold).slice(0, 60),
          // AI 不能替用户确认控制点：一律 false，等用户拍板
          confirmed: false,
          note: str(c?.note).slice(0, 300) || undefined,
        }))
        .filter((c) => c.label)
        .slice(0, 12)
    : [];

  return {
    id: str(r.id) || createOpportunityId(),
    projectId,
    unmetNeedId: str(r.unmetNeedId),
    title: title || needStatement,
    targetUser: str(r.targetUser),
    scenario: str(r.scenario),
    jobToBeDone: str(r.jobToBeDone),
    needStatement,
    currentAlternative: str(r.currentAlternative),
    currentAlternativeCost: str(r.currentAlternativeCost),
    solutionHypothesis: str(r.solutionHypothesis).slice(0, 400),
    marketEvidenceIds: strArray(r.marketEvidenceIds),
    userEvidenceIds: strArray(r.userEvidenceIds),
    competitorEvidenceIds: strArray(r.competitorEvidenceIds),
    selfAssessmentId: str(r.selfAssessmentId),
    profitScenarioIds: strArray(r.profitScenarioIds),
    profitAssumption:
      r.profitAssumption && typeof r.profitAssumption === 'object'
        ? {
            price: Number((r.profitAssumption as ProfitAssumption).price) || 0,
            cost: Number((r.profitAssumption as ProfitAssumption).cost) || 0,
            cpc: Number((r.profitAssumption as ProfitAssumption).cpc) || 0,
          }
        : undefined,
    risks: Array.isArray(r.risks)
      ? (r.risks as Record<string, unknown>[])
          .map((x) => ({
            id: str(x?.id) || createOpportunityId().replace('o_', 'risk_'),
            category: (['demand', 'competition', 'product', 'supply', 'compliance', 'profit'].includes(str(x?.category))
              ? str(x?.category)
              : 'demand') as RiskItem['category'],
            label: str(x?.label).slice(0, 120),
            description: str(x?.description).slice(0, 400),
            severity: (['low', 'medium', 'high'].includes(str(x?.severity)) ? str(x?.severity) : 'medium') as RiskItem['severity'],
            mitigation: str(x?.mitigation).slice(0, 300) || undefined,
          }))
          .filter((x) => x.label)
          .slice(0, 10)
      : [],
    validationActions: Array.isArray(r.validationActions)
      ? (r.validationActions as Record<string, unknown>[])
          .map((x) => ({
            id: str(x?.id) || createOpportunityId().replace('o_', 'va_'),
            action: str(x?.action).slice(0, 200),
            owner: str(x?.owner),
            dueDate: str(x?.dueDate) || undefined,
            successCriteria: str(x?.successCriteria).slice(0, 200),
          }))
          .filter((x) => x.action)
          .slice(0, 10)
      : [],
    // 评分与覆盖度由确定性公式负责：AI 给的一律忽略（置 0，调用方随后覆盖）
    score: 0,
    coverage: 0,
    // 「确认」与「拍板」是用户动作，AI 不能自称：状态一律回到 ai_candidate，决策一律 undecided
    // （否则模型自己写一句 status:"confirmed" 就绕过了人工防线）
    decision: 'undecided',
    status: 'ai_candidate',
    enterMode: str(r.enterMode) === 'direct' ? 'direct' : 'validate_first',
    kind: VALID_KINDS.includes(str(r.kind) as OpportunityKind) ? (str(r.kind) as OpportunityKind) : 'new_product',
    confidence: VALID_CONFIDENCE.includes(str(r.confidence) as OpportunityConfidence)
      ? (str(r.confidence) as OpportunityConfidence)
      : 'low',
    evidenceRefs,
    scoreBreakdown:
      r.scoreBreakdown && typeof r.scoreBreakdown === 'object'
        ? {
            demandStrength: Number((r.scoreBreakdown as Record<string, unknown>).demandStrength) || 0,
            marketOpportunity: Number((r.scoreBreakdown as Record<string, unknown>).marketOpportunity) || 0,
            competitorGap: Number((r.scoreBreakdown as Record<string, unknown>).competitorGap) || 0,
            selfFit: Number((r.scoreBreakdown as Record<string, unknown>).selfFit) || 0,
            evidenceConfidence: Number((r.scoreBreakdown as Record<string, unknown>).evidenceConfidence) || 0,
            weights: SCORE_WEIGHTS,
            total: 0,
          }
        : undefined,
    reasoningSteps,
    counterEvidence: strArray(r.counterEvidence).slice(0, 10),
    missingEvidence: strArray(r.missingEvidence).slice(0, 10),
    decisionPackage: roadmap.length || resources.length || controlPoints.length ? { roadmap, resources, controlPoints } : undefined,
    createdAt: str(r.createdAt) || now,
    updatedAt: now,
  };
}

export async function saveOpportunities(
  userId: string,
  projectId: string,
  cards: OpportunityCard[]
): Promise<void> {
  await set(storageKey(userId, projectId), cards);
}

/** 确定性评分：需求强度30 + 市场价值20 + 竞品缺口20 + 自身适配15 + 商业可行性15。 */
export function scoreOpportunity(
  card: OpportunityCard,
  project: ResearchProject,
  userLook: UserLookData | null,
  self: SelfAssessment | null
): { score: number; coverage: number } {
  const src = userLook?.unmetNeedCandidates.find((c) => c.id === card.unmetNeedId) ?? null;
  const needStrength = src
    ? src.evidenceStrength === 'high' ? 30 : src.evidenceStrength === 'medium' ? 20 : 10
    : 0;

  const market = Math.round((project.fiveLookProgress.market.completionPercent / 100) * 20);
  const competitor = Math.round((project.fiveLookProgress.competitor.completionPercent / 100) * 20);
  const selfFit = Math.round((project.fiveLookProgress.self.completionPercent / 100) * 15);

  const pa = card.profitAssumption;
  let commercial = 0;
  let commercialCovered = false;
  if (pa && pa.price > 0) {
    const margin = (pa.price - (pa.cost || 0) - (pa.cpc || 0)) / pa.price;
    commercial = margin >= 0.2 ? 15 : margin >= 0.1 ? 10 : margin > 0 ? 5 : 0;
    commercialCovered = true;
  } else {
    const boundaryItems = self?.items.filter((i) => i.category === 'boundary') ?? [];
    const boundaryAnswered = boundaryItems.filter((i) => i.status !== 'unknown').length;
    const boundaryTotal = boundaryItems.length || 1;
    commercial = Math.round((boundaryAnswered / boundaryTotal) * 15);
    commercialCovered = boundaryAnswered > 0;
  }

  const score = Math.min(100, needStrength + market + competitor + selfFit + commercial);

  let covered = 0;
  if (src) covered++;
  if (project.fiveLookProgress.market.completionPercent > 0) covered++;
  if (project.fiveLookProgress.competitor.completionPercent > 0) covered++;
  if (project.fiveLookProgress.self.completionPercent > 0) covered++;
  if (commercialCovered) covered++;
  const coverage = Math.round((covered / 5) * 100) / 100;

  return { score, coverage };
}
