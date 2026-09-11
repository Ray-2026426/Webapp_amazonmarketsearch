// 看/找机会（FR-07）：机会卡存储 + 从「看用户」未满足需求生成机会 + 确定性评分。
import { get, set } from 'idb-keyval';
import type {
  FiveLookProgress,
  OpportunityCard,
  ResearchProject,
} from '../types/researchProject';
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
