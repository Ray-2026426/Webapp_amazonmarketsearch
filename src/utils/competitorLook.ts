// 看竞品（FR-05）：竞品样本池、标杆 ASIN、产品与经营壁垒、需求满足矩阵与产品缺口。
import { get, set } from 'idb-keyval';
import type { FiveLookProgress } from '../types/researchProject';
import type { OpenQuestionAnswer } from './openQuestions';
import type { ListingDetail, TrafficDetail } from './listingFields';
import type { WinningPath } from './competitorAnalysis';
import type { SelfStatus } from './selfAssessment';

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
  barriers: string;
  needMatrix: string;
  gaps: string[];
  /** M2⑤：对「看市场」留下的待验证问题在本步给出的回答（修断链 #7） */
  openQuestionAnswers?: OpenQuestionAnswer[];
  /** M3②：抓到的 listing 全字段明细（三列对比用；缺的字段会显式标"未抓取"） */
  listingDetails?: Record<string, ListingDetail | undefined>;
  /** M3②：抓到的流量字段明细 */
  trafficDetails?: Record<string, TrafficDetail | undefined>;
  /** M3③：人工/品类选择题给出的"每条需求我们行不行"（覆盖自评推导） */
  ourCapabilityByNeedId?: Record<string, SelfStatus>;
  /** M3③：「人优我廉」判定所需的财务口径 */
  ourCapabilityFinancials?: { targetPrice?: number; marginFloor?: number; estimatedMarginAtPrice?: number };
  /** M3③：用户对"赢的路径"的覆盖（不填=采用系统确定性判定） */
  winningPathOverride?: WinningPath;
  /** M3③：AI 对确定性判定的解释（AI 不能改判定，只能解释前置条件与风险） */
  winningPathExplain?: string;
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
    barriers: '',
    needMatrix: '',
    gaps: [],
    openQuestionAnswers: [],
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
        gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
        openQuestionAnswers: Array.isArray(raw.openQuestionAnswers) ? raw.openQuestionAnswers : [],
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
  const hasBarriers = data.barriers.trim().length > 0;
  const hasGaps = data.gaps.some((s) => s.trim().length > 0);

  const filled = (hasPool ? 1 : 0) + (hasBenchmark ? 1 : 0) + (hasBarriers ? 1 : 0) + (hasGaps ? 1 : 0);
  const completionPercent = Math.round((filled / 4) * 100);
  let status: FiveLookProgress['status'] = 'not_started';
  if (filled > 0 && filled < 4) status = 'in_progress';
  else if (filled === 4) status = 'completed';

  const missingRequirements: string[] = [];
  if (!hasPool) missingRequirements.push('缺少「竞品样本池」');
  if (!hasBenchmark) missingRequirements.push('缺少「标杆 ASIN」');
  if (!hasBarriers) missingRequirements.push('缺少「产品与经营壁垒」');
  if (!hasGaps) missingRequirements.push('缺少「未充分满足的产品缺口」');

  return { status, completionPercent, missingRequirements };
}
