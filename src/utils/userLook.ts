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
        unmetNeedCandidates: Array.isArray(raw.unmetNeedCandidates) ? raw.unmetNeedCandidates : [],
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
  const hasTarget = data.targetUser.trim().length > 0;
  const hasScenario = data.scenario.trim().length > 0;
  const hasJtbd = data.jobToBeDone.trim().length > 0;
  const hasSatisfied = data.satisfiedNeeds.some((s) => s.trim().length > 0);
  const hasUnmet = data.unmetNeedCandidates.length > 0;

  const filled = (hasTarget ? 1 : 0) + (hasScenario ? 1 : 0) + (hasJtbd ? 1 : 0) + (hasSatisfied ? 1 : 0) + (hasUnmet ? 1 : 0);
  const completionPercent = Math.round((filled / 5) * 100);
  let status: FiveLookProgress['status'] = 'not_started';
  if (filled > 0 && filled < 5) status = 'in_progress';
  else if (filled === 5) status = 'completed';

  const missingRequirements: string[] = [];
  if (!hasTarget) missingRequirements.push('缺少「目标用户」');
  if (!hasScenario) missingRequirements.push('缺少「使用场景」');
  if (!hasJtbd) missingRequirements.push('缺少「用户任务 / JTBD」');
  if (!hasSatisfied) missingRequirements.push('缺少「已满足需求」');
  if (!hasUnmet) missingRequirements.push('缺少「未满足需求候选」');

  return { status, completionPercent, missingRequirements };
}
