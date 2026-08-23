// 看/找机会（FR-07）：机会卡存储 + 从「看用户」未满足需求生成机会 + 确定性评分。
import { get, set } from 'idb-keyval';
import type {
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

  const boundaryItems = self?.items.filter((i) => i.category === 'boundary') ?? [];
  const boundaryAnswered = boundaryItems.filter((i) => i.status !== 'unknown').length;
  const boundaryTotal = boundaryItems.length || 1;
  const commercial = Math.round((boundaryAnswered / boundaryTotal) * 15);

  const score = Math.min(100, needStrength + market + competitor + selfFit + commercial);

  let covered = 0;
  if (src) covered++;
  if (project.fiveLookProgress.market.completionPercent > 0) covered++;
  if (project.fiveLookProgress.competitor.completionPercent > 0) covered++;
  if (project.fiveLookProgress.self.completionPercent > 0) covered++;
  if (boundaryAnswered > 0) covered++;
  const coverage = Math.round((covered / 5) * 100) / 100;

  return { score, coverage };
}
