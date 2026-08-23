// 看市场（FR-03）：市场吸引力判断 + 关键证据 + 风险 + 待验证问题，并捕获当前市场工作区数据为证据。
// 数据按项目分区持久化（IndexedDB），进度由确定性规则计算。

import { get, set } from 'idb-keyval';
import type { FiveLookProgress } from '../types/researchProject';

/** 由 App 传入的当前全局市场工作区摘要（用于数据上下文与证据捕获） */
export interface MarketContext {
  loaded: boolean;
  marketplace: string;
  sampleSize: number;
  months: string[];
  sourceLabel: string;
  isDemo: boolean;
}

export interface MarketEvidence {
  capturedAt: string;
  marketplace: string;
  sampleSize: number;
  months: string[];
  sourceLabel: string;
  isDemo: boolean;
}

export interface MarketLookData {
  projectId: string;
  /** 市场吸引力判断 */
  attractiveness: string;
  /** 3–5 条关键证据 */
  keyEvidences: string[];
  /** 主要市场风险 */
  risks: string[];
  /** 对看用户 / 看竞品的待验证问题 */
  openQuestions: string[];
  evidence: MarketEvidence | null;
  updatedAt: string;
}

const KEY_PREFIX = 'amzdev_market:';
function storageKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

export function defaultMarketLook(projectId: string): MarketLookData {
  return {
    projectId,
    attractiveness: '',
    keyEvidences: [],
    risks: [],
    openQuestions: [],
    evidence: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadMarketLook(userId: string, projectId: string): Promise<MarketLookData> {
  try {
    const raw = await get<MarketLookData>(storageKey(userId, projectId));
    if (raw && typeof raw === 'object') {
      return {
        ...defaultMarketLook(projectId),
        ...raw,
        keyEvidences: Array.isArray(raw.keyEvidences) ? raw.keyEvidences : [],
        risks: Array.isArray(raw.risks) ? raw.risks : [],
        openQuestions: Array.isArray(raw.openQuestions) ? raw.openQuestions : [],
      };
    }
  } catch {
    /* ignore */
  }
  return defaultMarketLook(projectId);
}

export async function saveMarketLook(
  userId: string,
  projectId: string,
  data: MarketLookData
): Promise<void> {
  await set(storageKey(userId, projectId), { ...data, updatedAt: new Date().toISOString() });
}

export function makeMarketEvidence(ctx: MarketContext): MarketEvidence {
  return {
    capturedAt: new Date().toISOString(),
    marketplace: ctx.marketplace,
    sampleSize: ctx.sampleSize,
    months: [...ctx.months],
    sourceLabel: ctx.sourceLabel,
    isDemo: ctx.isDemo,
  };
}

/** 完成产物：吸引力判断(1) + 关键证据(≥3) + 主要风险(≥1)，共 5 个必要单元。 */
export function computeMarketProgress(
  data: MarketLookData
): Pick<FiveLookProgress, 'status' | 'completionPercent' | 'missingRequirements'> {
  const hasJudgment = data.attractiveness.trim().length > 0;
  const evCount = data.keyEvidences.filter((s) => s.trim().length > 0).length;
  const riskCount = data.risks.filter((s) => s.trim().length > 0).length;

  const filled = (hasJudgment ? 1 : 0) + Math.min(evCount, 3) + Math.min(riskCount, 1);
  const completionPercent = Math.round((filled / 5) * 100);
  let status: FiveLookProgress['status'] = 'not_started';
  if (filled > 0 && filled < 5) status = 'in_progress';
  else if (filled === 5) status = 'completed';

  const missingRequirements: string[] = [];
  if (!hasJudgment) missingRequirements.push('缺少「市场吸引力判断」');
  if (evCount < 3) missingRequirements.push(`关键证据 ${evCount}/3`);
  if (riskCount < 1) missingRequirements.push('缺少「主要市场风险」');

  return { status, completionPercent, missingRequirements };
}
