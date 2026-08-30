// 看/找机会（FR-07）：机会卡存储 + 从「看用户」未满足需求生成机会 + 确定性评分。
import { get, set } from 'idb-keyval';
import type {
  FiveLookProgress,
  OpportunityCard,
  OpportunityScoreBreakdown,
  ResearchProject,
} from '../types/researchProject';
import type { UnmetNeedCandidate, UserLookData } from './userLook';
import type { SelfAssessment } from './selfAssessment';
import type { MarketLookData } from './marketLook';
import type { CompetitorLookData } from './competitorLook';

const KEY_PREFIX = 'amzdev_opp:';
const CONCLUSION_KEY_PREFIX = 'amzdev_opp_conclusion:';
function storageKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

export interface OpportunityConclusion {
  resultStatus: 'opportunities' | 'no_opportunity' | 'insufficient_evidence';
  reasons: string[];
  reviewed: boolean;
  updatedAt: string;
}

export async function loadOpportunityConclusion(userId: string, projectId: string): Promise<OpportunityConclusion | null> {
  try {
    const raw = await get<OpportunityConclusion>(`${CONCLUSION_KEY_PREFIX}${userId}:${projectId}`);
    if (raw && ['opportunities', 'no_opportunity', 'insufficient_evidence'].includes(raw.resultStatus)) {
      return { ...raw, reasons: Array.isArray(raw.reasons) ? raw.reasons : [], reviewed: Boolean(raw.reviewed) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function saveOpportunityConclusion(userId: string, projectId: string, conclusion: OpportunityConclusion): Promise<void> {
  await set(`${CONCLUSION_KEY_PREFIX}${userId}:${projectId}`, { ...conclusion, updatedAt: new Date().toISOString() });
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
    title: candidate.needStatement?.trim() || candidate.category?.trim() || '未命名机会',
    targetUser: candidate.targetUser || '',
    scenario: candidate.scenario || '',
    jobToBeDone: candidate.jobToBeDone || '',
    needStatement: candidate.needStatement || candidate.unmetPart || '',
    currentAlternative: candidate.currentAlternative || '',
    currentAlternativeCost: '',
    solutionHypothesis: '',
    marketEvidenceIds: [],
    userEvidenceIds: [],
    competitorEvidenceIds: [],
    selfAssessmentId: '',
    profitScenarioIds: [],
    risks: [],
    validationActions: [],
    opportunityType: 'competitor_gap',
    reviewStatus: 'ai_candidate',
    confidence: candidate.evidenceStrength,
    scoreBreakdown: {
      demandStrength: candidate.evidenceStrength === 'high' ? 25 : candidate.evidenceStrength === 'medium' ? 17 : 9,
      marketOpportunity: 0,
      competitorGap: 0,
      selfFit: 0,
      evidenceConfidence: candidate.evidenceNotes?.length ? 4 : 2,
    },
    evidenceRefs: (candidate.evidenceNotes ?? []).map((excerpt, index) => ({
      id: `user:${candidate.id}:${index}`,
      look: 'user' as const,
      sourceType: 'analysis' as const,
      label: candidate.category || candidate.needStatement || '用户需求证据',
      excerpt,
      sourceId: candidate.id,
    })),
    reasoning: [],
    counterEvidence: [],
    missingEvidence: ['缺少细分市场证据', '缺少竞对需求缺口证据', '缺少自身适配证据'],
    humanEdits: [],
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
  project: ResearchProject,
  conclusion?: OpportunityConclusion | null
): Pick<FiveLookProgress, 'status' | 'completionPercent' | 'missingRequirements'> {
  const fourLooksComplete = ['market', 'user', 'competitor', 'self'].every(
    (l) => project.fiveLookProgress[l as 'market' | 'user' | 'competitor' | 'self'].status === 'completed'
  );
  const hasOutcome = cards.length > 0 || conclusion?.resultStatus === 'no_opportunity';
  const hasReviewed = cards.some((c) => c.reviewStatus === 'confirmed' && c.decision !== 'undecided')
    || Boolean(conclusion?.resultStatus === 'no_opportunity' && conclusion.reviewed);
  const filled = (hasOutcome ? 1 : 0) + (hasReviewed ? 1 : 0) + (fourLooksComplete ? 1 : 0);
  const completionPercent = Math.round((filled / 3) * 100);
  let status: FiveLookProgress['status'] = 'not_started';
  if (filled > 0 && filled < 3) status = 'in_progress';
  else if (filled === 3) status = 'completed';
  const missing: string[] = [];
  if (!hasOutcome) missing.push('尚未形成“有机会”或“无机会”的明确结论');
  if (!hasReviewed) missing.push('AI 结论尚未人工确认');
  if (!fourLooksComplete) missing.push('前四看尚未全部完成');
  return { status, completionPercent, missingRequirements: missing };
}

export async function loadOpportunities(userId: string, projectId: string): Promise<OpportunityCard[]> {
  try {
    const raw = await get<OpportunityCard[]>(storageKey(userId, projectId));
    if (Array.isArray(raw)) return raw.map((card) => normalizeOpportunityCard(card, projectId));
  } catch {
    /* ignore */
  }
  return [];
}

export function normalizeOpportunityCard(card: OpportunityCard, projectId = card.projectId): OpportunityCard {
  return {
    ...card,
    projectId: card.projectId || projectId,
    unmetNeedId: card.unmetNeedId || '',
    title: card.title || card.needStatement || '未命名机会',
    targetUser: card.targetUser || '',
    scenario: card.scenario || '',
    jobToBeDone: card.jobToBeDone || '',
    needStatement: card.needStatement || '',
    currentAlternative: card.currentAlternative || '',
    currentAlternativeCost: card.currentAlternativeCost || '',
    solutionHypothesis: card.solutionHypothesis || '',
    marketEvidenceIds: Array.isArray(card.marketEvidenceIds) ? card.marketEvidenceIds : [],
    userEvidenceIds: Array.isArray(card.userEvidenceIds) ? card.userEvidenceIds : [],
    competitorEvidenceIds: Array.isArray(card.competitorEvidenceIds) ? card.competitorEvidenceIds : [],
    selfAssessmentId: card.selfAssessmentId || '',
    profitScenarioIds: Array.isArray(card.profitScenarioIds) ? card.profitScenarioIds : [],
    risks: Array.isArray(card.risks) ? card.risks : [],
    validationActions: Array.isArray(card.validationActions) ? card.validationActions : [],
    opportunityType: card.opportunityType ?? 'competitor_gap',
    reviewStatus: card.reviewStatus ?? 'confirmed',
    confidence: card.confidence ?? (card.coverage >= 0.8 ? 'high' : card.coverage >= 0.5 ? 'medium' : 'low'),
    scoreBreakdown: card.scoreBreakdown ?? {
      demandStrength: 0,
      marketOpportunity: 0,
      competitorGap: 0,
      selfFit: 0,
      evidenceConfidence: 0,
    },
    evidenceRefs: Array.isArray(card.evidenceRefs) ? card.evidenceRefs : [],
    reasoning: Array.isArray(card.reasoning) ? card.reasoning : [],
    counterEvidence: Array.isArray(card.counterEvidence) ? card.counterEvidence : [],
    missingEvidence: Array.isArray(card.missingEvidence) ? card.missingEvidence : [],
    humanEdits: Array.isArray(card.humanEdits) ? card.humanEdits : [],
    score: Number.isFinite(card.score) ? card.score : 0,
    coverage: Number.isFinite(card.coverage) ? card.coverage : 0,
    decision: card.decision ?? 'undecided',
    createdAt: card.createdAt || new Date().toISOString(),
    updatedAt: card.updatedAt || new Date().toISOString(),
  };
}

export async function saveOpportunities(
  userId: string,
  projectId: string,
  cards: OpportunityCard[]
): Promise<void> {
  await set(storageKey(userId, projectId), cards);
}

/**
 * 机会专属评分：需求25 + 市场25 + 竞对25 + 自身15 + 证据可信度10。
 * 只读取该机会实际绑定的证据；禁止用五看页面完成度冒充机会质量。
 */
export function scoreOpportunity(
  card: OpportunityCard,
  _project: ResearchProject,
  userLook: UserLookData | null,
  self: SelfAssessment | null,
  marketLook?: MarketLookData | null,
  competitorLook?: CompetitorLookData | null
): { score: number; coverage: number; breakdown: OpportunityScoreBreakdown } {
  const src = userLook?.unmetNeedCandidates.find((c) => c.id === card.unmetNeedId) ?? null;
  const refs = card.evidenceRefs ?? [];
  const userRefs = refs.filter((ref) => ref.look === 'user');
  const marketRefs = refs.filter((ref) => ref.look === 'market');
  const competitorRefs = refs.filter((ref) => ref.look === 'competitor');
  const selfRefs = refs.filter((ref) => ref.look === 'self');

  const demandStrength = src
    ? src.evidenceStrength === 'high' ? 25 : src.evidenceStrength === 'medium' ? 17 : 9
    : userRefs.length ? Math.min(25, 9 + userRefs.length * 4) : 0;

  const marketEvidenceCount = new Set([
    ...(card.marketEvidenceIds ?? []),
    ...marketRefs.map((ref) => ref.id),
  ]).size;
  const isBoundToSelectedSegment = Boolean(
    marketLook?.selectedOpportunitySegment?.trim()
    && (marketLook.selectedNeedId === card.unmetNeedId
      || card.scenario.includes(marketLook.selectedOpportunitySegment)
      || card.needStatement.includes(marketLook.selectedOpportunitySegment))
  );
  const marketOpportunity = marketEvidenceCount
    ? Math.min(25, 9 + marketEvidenceCount * 4 + (card.opportunityType === 'market_growth' ? 4 : 0))
    : isBoundToSelectedSegment && (marketLook?.keyEvidences.length ?? 0) > 0 ? 8 : 0;

  const competitorEvidenceCount = new Set([
    ...(card.competitorEvidenceIds ?? []),
    ...competitorRefs.map((ref) => ref.id),
  ]).size;
  const matchingGap = competitorLook?.gaps.some((gap) => {
    const tokens = [src?.category, src?.needStatement, card.needStatement].filter(Boolean) as string[];
    return tokens.some((token) => token.length >= 2 && gap.includes(token));
  }) ?? false;
  const competitorGap = competitorEvidenceCount
    ? Math.min(25, 9 + competitorEvidenceCount * 4 + (card.opportunityType === 'competitor_gap' ? 4 : 0))
    : matchingGap ? 8 : 0;

  const answeredSelf = self?.guidingQuestions?.filter((question) => question.answer.trim()).length ?? 0;
  const hasSpecificSelfEvidence = Boolean(card.selfAssessmentId || selfRefs.length);
  let selfFit = 0;
  if (hasSpecificSelfEvidence) {
    const legacyGaps = self?.items.filter((item) => item.status === 'lack').length ?? 0;
    const legacyStrengths = self?.items.filter((item) => item.status === 'have').length ?? 0;
    const guidedStrengths = self?.guidingQuestions?.filter((question) => question.answer.trim() && question.impactDimension === 'strength').length ?? 0;
    const guidedFits = self?.guidingQuestions?.filter((question) => question.answer.trim() && question.impactDimension === 'fit').length ?? 0;
    const guidedConstraints = self?.guidingQuestions?.filter((question) => question.answer.trim() && (question.impactDimension === 'gap' || question.impactDimension === 'boundary')).length ?? 0;
    selfFit = Math.max(1, Math.min(15,
      7 + Math.min(6, legacyStrengths + guidedStrengths) + Math.min(2, guidedFits) - Math.min(7, legacyGaps + guidedConstraints)
    ));
  }

  const representedLooks = [
    Boolean(src || userRefs.length),
    Boolean(marketEvidenceCount || isBoundToSelectedSegment),
    Boolean(competitorEvidenceCount || matchingGap),
    hasSpecificSelfEvidence,
  ].filter(Boolean).length;
  const evidenceConfidence = Math.min(10, representedLooks * 2 + (refs.length >= 6 ? 2 : refs.length >= 3 ? 1 : 0));

  const breakdown: OpportunityScoreBreakdown = {
    demandStrength,
    marketOpportunity,
    competitorGap,
    selfFit,
    evidenceConfidence,
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const coverage = Math.round((representedLooks / 4) * 100) / 100;
  return { score, coverage, breakdown };
}
