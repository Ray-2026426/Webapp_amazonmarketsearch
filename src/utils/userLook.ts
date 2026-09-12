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

/** 搜索路径的四层（M2 · 看用户 V2）：认知 → 考虑 → 决策 → 场景 */
export type SearchPathLayerId = 'awareness' | 'consideration' | 'decision' | 'scenario';

export const SEARCH_PATH_LAYER_LABELS: Record<SearchPathLayerId, string> = {
  awareness: '认知层',
  consideration: '考虑层',
  decision: '决策层',
  scenario: '场景层',
};

export const SEARCH_PATH_LAYER_HINTS: Record<SearchPathLayerId, string> = {
  awareness: '用户第一次想到这个品类时会搜的大词',
  consideration: '开始比较、加限定词（人群/材质/功能）',
  decision: '临门一脚的决策词（差异化卖点/规格）',
  scenario: '场景与复购词（季节/人群/使用场合）',
};

export interface SearchPathWord {
  word: string;
  /** 月搜索量（如有） */
  volume?: number;
  /** 在该层的占比 0-1 */
  share?: number;
}

export interface SearchPathLayer {
  layer: SearchPathLayerId;
  words: SearchPathWord[];
  note?: string;
}

export interface SearchPath {
  /** 一句话结论：用户是怎么一步步搜到这里的 */
  summary?: string;
  layers: SearchPathLayer[];
  updatedAt?: string;
}

/** 搜索偏好卡（M2）：价格敏感度 / 词性倾向 / 长尾结构 / 购买决策焦点 */
export interface SearchPreference {
  priceSensitivity?: 'low' | 'medium' | 'high';
  priceSensitivityNote?: string;
  /** 功能/材质/品牌词的占比描述，如「功能与材质词占 62%」 */
  attributeMix?: string;
  /** 长尾词占比 0-1 */
  longTailShare?: number;
  /** 买家在下单前主要对比什么维度 */
  decisionFocus?: string[];
  updatedAt?: string;
}

export const PRICE_SENSITIVITY_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: '低',
  medium: '中',
  high: '高',
};

export interface UserLookData {
  projectId: string;
  targetUser: string;
  scenario: string;
  jobToBeDone: string;
  satisfiedNeeds: string[];
  unmetNeedCandidates: UnmetNeedCandidate[];
  /** M2：搜索路径图（四层漏斗） */
  searchPath?: SearchPath;
  /** M2：搜索偏好卡 */
  searchPreference?: SearchPreference;
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
