// 看用户（FR-04）：关键词 + VOC 合并为用户需求地图与未满足需求候选。
import { get, set } from 'idb-keyval';
import type { FiveLookProgress } from '../types/researchProject';

export interface UserContext {
  keywordsCount: number;
  reviewsCount: number;
  sourceLabel: string;
  isDemo: boolean;
}

export interface UserEvidence {
  capturedAt: string;
  keywordsCount: number;
  reviewsCount: number;
  sourceLabel: string;
  isDemo: boolean;
}

export type EvidenceStrength = 'high' | 'medium' | 'low';

export const EVIDENCE_STRENGTH_LABELS: Record<EvidenceStrength, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export interface UnmetNeedCandidate {
  id: string;
  targetUser: string;
  scenario: string;
  jobToBeDone: string;
  needStatement: string;
  currentAlternative: string;
  evidenceStrength: EvidenceStrength;
  /** 需求分类名称；作为后续看市场的细分索引。 */
  category?: string;
  decisionPath?: string;
  satisfiedPart?: string;
  unmetPart?: string;
  selectedForSegmentation?: boolean;
  evidenceNotes?: string[];
}

export interface UserLookData {
  projectId: string;
  targetUser: string;
  scenario: string;
  jobToBeDone: string;
  satisfiedNeeds: string[];
  unmetNeedCandidates: UnmetNeedCandidate[];
  evidence: UserEvidence | null;
  updatedAt: string;
}

const KEY_PREFIX = 'amzdev_user:';
function storageKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

export function createUnmetNeedId(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyUnmetNeedCandidate(): UnmetNeedCandidate {
  return {
    id: createUnmetNeedId(),
    targetUser: '',
    scenario: '',
    jobToBeDone: '',
    needStatement: '',
    currentAlternative: '',
    evidenceStrength: 'medium',
    category: '',
    decisionPath: '',
    satisfiedPart: '',
    unmetPart: '',
    selectedForSegmentation: false,
    evidenceNotes: [],
  };
}

export function defaultUserLook(projectId: string): UserLookData {
  return {
    projectId,
    targetUser: '',
    scenario: '',
    jobToBeDone: '',
    satisfiedNeeds: [],
    unmetNeedCandidates: [],
    evidence: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadUserLook(userId: string, projectId: string): Promise<UserLookData> {
  try {
    const raw = await get<UserLookData>(storageKey(userId, projectId));
    if (raw && typeof raw === 'object') {
      return {
        ...defaultUserLook(projectId),
        ...raw,
        satisfiedNeeds: Array.isArray(raw.satisfiedNeeds) ? raw.satisfiedNeeds : [],
        unmetNeedCandidates: Array.isArray(raw.unmetNeedCandidates)
          ? raw.unmetNeedCandidates.map((candidate) => ({
              ...candidate,
              id: candidate.id || createUnmetNeedId(),
              targetUser: candidate.targetUser ?? '',
              scenario: candidate.scenario ?? '',
              jobToBeDone: candidate.jobToBeDone ?? '',
              needStatement: candidate.needStatement ?? '',
              currentAlternative: candidate.currentAlternative ?? '',
              evidenceStrength: candidate.evidenceStrength === 'high' || candidate.evidenceStrength === 'low' ? candidate.evidenceStrength : 'medium',
              category: candidate.category ?? '',
              decisionPath: candidate.decisionPath ?? '',
              satisfiedPart: candidate.satisfiedPart ?? '',
              unmetPart: candidate.unmetPart ?? candidate.needStatement ?? '',
              selectedForSegmentation: candidate.selectedForSegmentation ?? false,
              evidenceNotes: Array.isArray(candidate.evidenceNotes) ? candidate.evidenceNotes : [],
            }))
          : [],
      };
    }
  } catch {
    /* ignore */
  }
  return defaultUserLook(projectId);
}

export async function saveUserLook(
  userId: string,
  projectId: string,
  data: UserLookData
): Promise<void> {
  await set(storageKey(userId, projectId), { ...data, updatedAt: new Date().toISOString() });
}

export function makeUserEvidence(ctx: UserContext): UserEvidence {
  return {
    capturedAt: new Date().toISOString(),
    keywordsCount: ctx.keywordsCount,
    reviewsCount: ctx.reviewsCount,
    sourceLabel: ctx.sourceLabel,
    isDemo: ctx.isDemo,
  };
}

export function computeUserProgress(
  data: UserLookData
): Pick<FiveLookProgress, 'status' | 'completionPercent' | 'missingRequirements'> {
  const candidates = data.unmetNeedCandidates;
  const hasTarget = data.targetUser.trim().length > 0 || candidates.some((item) => item.targetUser.trim());
  const hasScenario = data.scenario.trim().length > 0 || candidates.some((item) => item.scenario.trim());
  const hasJtbd = data.jobToBeDone.trim().length > 0 || candidates.some((item) => item.jobToBeDone.trim());
  const hasSatisfied = data.satisfiedNeeds.some((s) => s.trim().length > 0) || candidates.some((item) => item.satisfiedPart?.trim());
  const hasUnmet = candidates.some((item) => (item.unmetPart || item.needStatement).trim());
  const hasSelectedTaxonomy = candidates.some((item) => item.selectedForSegmentation && (item.category || item.needStatement).trim());

  const filled = (hasTarget ? 1 : 0) + (hasScenario ? 1 : 0) + (hasJtbd ? 1 : 0) + (hasSatisfied ? 1 : 0) + (hasUnmet ? 1 : 0) + (hasSelectedTaxonomy ? 1 : 0);
  const completionPercent = Math.round((filled / 6) * 100);
  let status: FiveLookProgress['status'] = 'not_started';
  if (filled > 0 && filled < 5) status = 'in_progress';
  else if (filled === 6) status = 'completed';

  const missingRequirements: string[] = [];
  if (!hasTarget) missingRequirements.push('缺少「目标用户」');
  if (!hasScenario) missingRequirements.push('缺少「使用场景」');
  if (!hasJtbd) missingRequirements.push('缺少「用户任务 / JTBD」');
  if (!hasSatisfied) missingRequirements.push('缺少「已满足需求」');
  if (!hasUnmet) missingRequirements.push('缺少「未满足需求候选」');
  if (!hasSelectedTaxonomy) missingRequirements.push('尚未选择用于看市场的需求分类');

  return { status, completionPercent, missingRequirements };
}
