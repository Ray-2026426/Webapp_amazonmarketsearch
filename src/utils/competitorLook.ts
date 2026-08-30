// 看竞品（FR-05）：竞品样本池、标杆 ASIN、产品与经营壁垒、需求满足矩阵与产品缺口。
import { get, set } from 'idb-keyval';
import type { FiveLookProgress } from '../types/researchProject';

export interface CompetitorContext {
  loaded: boolean;
  asinCount: number;
  marketplace: string;
  isDemo: boolean;
}

export interface CompetitorEvidence {
  capturedAt: string;
  asinCount: number;
  marketplace: string;
  isDemo: boolean;
}

export interface CompetitorLookData {
  projectId: string;
  samplePool: string[];
  benchmarkAsins: string[];
  /** 产品力拆解：功能、材质、设计、体验、差评痛点 */
  productPowerFindings: string[];
  /** 运营力拆解：Listing、主图、流量结构、价格、评价壁垒 */
  operationPowerFindings: string[];
  barriers: string;
  needMatrix: string;
  gaps: string[];
  /** 需求维度 × 竞对的满足矩阵。 */
  needSatisfactionRows?: {
    needId: string;
    needLabel: string;
    scores: Record<string, number>;
    notes: Record<string, string>;
  }[];
  winningStrategy?: string;
  targetUsers?: Record<string, string>;
  evidence: CompetitorEvidence | null;
  updatedAt: string;
}

const KEY_PREFIX = 'amzdev_competitor:';
function storageKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

export function defaultCompetitorLook(projectId: string): CompetitorLookData {
  return {
    projectId,
    samplePool: [],
    benchmarkAsins: [],
    productPowerFindings: [],
    operationPowerFindings: [],
    barriers: '',
    needMatrix: '',
    gaps: [],
    needSatisfactionRows: [],
    winningStrategy: '',
    targetUsers: {},
    evidence: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadCompetitorLook(userId: string, projectId: string): Promise<CompetitorLookData> {
  try {
    const raw = await get<CompetitorLookData>(storageKey(userId, projectId));
    if (raw && typeof raw === 'object') {
      return {
        ...defaultCompetitorLook(projectId),
        ...raw,
        samplePool: Array.isArray(raw.samplePool) ? raw.samplePool : [],
        benchmarkAsins: Array.isArray(raw.benchmarkAsins) ? raw.benchmarkAsins : [],
        productPowerFindings: Array.isArray(raw.productPowerFindings) ? raw.productPowerFindings : [],
        operationPowerFindings: Array.isArray(raw.operationPowerFindings) ? raw.operationPowerFindings : [],
        gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
        needSatisfactionRows: Array.isArray(raw.needSatisfactionRows) ? raw.needSatisfactionRows.map((row) => ({
          needId: row.needId || '',
          needLabel: row.needLabel || '未命名需求',
          scores: row.scores && typeof row.scores === 'object' ? row.scores : {},
          notes: row.notes && typeof row.notes === 'object' ? row.notes : {},
        })) : [],
        winningStrategy: raw.winningStrategy ?? '',
        targetUsers: raw.targetUsers && typeof raw.targetUsers === 'object' ? raw.targetUsers : {},
      };
    }
  } catch {
    /* ignore */
  }
  return defaultCompetitorLook(projectId);
}

export async function saveCompetitorLook(
  userId: string,
  projectId: string,
  data: CompetitorLookData
): Promise<void> {
  await set(storageKey(userId, projectId), { ...data, updatedAt: new Date().toISOString() });
}

export function makeCompetitorEvidence(ctx: CompetitorContext): CompetitorEvidence {
  return {
    capturedAt: new Date().toISOString(),
    asinCount: ctx.asinCount,
    marketplace: ctx.marketplace,
    isDemo: ctx.isDemo,
  };
}

export function computeCompetitorProgress(
  data: CompetitorLookData
): Pick<FiveLookProgress, 'status' | 'completionPercent' | 'missingRequirements'> {
  const hasPool = data.samplePool.some((s) => s.trim().length > 0);
  const hasBenchmark = data.benchmarkAsins.some((s) => s.trim().length > 0);
  const hasBarriers = data.barriers.trim().length > 0
    || data.productPowerFindings.some((s) => s.trim().length > 0)
    || data.operationPowerFindings.some((s) => s.trim().length > 0);
  const hasGaps = data.gaps.some((s) => s.trim().length > 0);
  const hasNeedMatrix = (data.needSatisfactionRows ?? []).some((row) => Object.values(row.scores).some((score) => score > 0));
  const hasWinningStrategy = Boolean(data.winningStrategy?.trim());

  const filled = (hasPool ? 1 : 0) + (hasBenchmark ? 1 : 0) + (hasBarriers ? 1 : 0) + (hasGaps ? 1 : 0) + (hasNeedMatrix ? 1 : 0) + (hasWinningStrategy ? 1 : 0);
  const completionPercent = Math.round((filled / 6) * 100);
  let status: FiveLookProgress['status'] = 'not_started';
  if (filled > 0 && filled < 4) status = 'in_progress';
  else if (filled === 6) status = 'completed';

  const missingRequirements: string[] = [];
  if (!hasPool) missingRequirements.push('缺少「竞品样本池」');
  if (!hasBenchmark) missingRequirements.push('缺少「标杆 ASIN」');
  if (!hasBarriers) missingRequirements.push('缺少「产品与经营壁垒」');
  if (!hasGaps) missingRequirements.push('缺少「未充分满足的产品缺口」');
  if (!hasNeedMatrix) missingRequirements.push('缺少「需求满足矩阵」');
  if (!hasWinningStrategy) missingRequirements.push('缺少「我们如何赢」结论');

  return { status, completionPercent, missingRequirements };
}
