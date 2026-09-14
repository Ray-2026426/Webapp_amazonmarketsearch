// M4 · 机会卡的「看市场上下文」（PRD §8.1 市场机会维度的取数口径）。
//
// 规则（与 §8.1 一致）：选了目标细分 → 用**该细分的机会分**；没选 → 用**全市场分 × 0.6**（打折，
// 因为没选定细分意味着"还没定位"，不能按满分算）。
// 放在单独模块里，是因为三处都要用：AI 生成候选、确定性评分、看机会主屏展示。

import { loadSnapshot } from './projectSnapshot';
import { loadMarketLook } from './marketLook';
import { synthesizeSegmentSchemes } from './segmentSynthesis';
import { scoreSegment } from './segmentScore';
import type { UnmetNeedCandidate } from './userLook';
import type { HistoryRecord, Product } from './parser';

export interface MarketSegmentSummary {
  id: string;
  name: string;
  opportunity: number;
  trend: number;
  volume: number;
  competition: number;
  productCount: number;
  revenueShare: number;
  demandHits: number;
}

export interface MarketSegmentContext {
  /** 用户选定的细分方案名（没选就是空串） */
  schemeName: string;
  /** 目标细分（没选目标细分时为空数组） */
  targets: MarketSegmentSummary[];
  /** 用于评分的机会分：选定细分 → 目标细分（收入加权），未选定 → 全市场分 */
  targetOpportunity?: number;
  /** 是否已选目标细分（决定是否 ×0.6） */
  hasTargetSegment: boolean;
  /** 数据说明（没数据时说清楚缺什么） */
  note: string;
}

/** 全市场分（未选目标细分时的兜底口径，明确标注） */
export async function loadMarketSegmentContext(
  userId: string,
  projectId: string,
  needs: UnmetNeedCandidate[]
): Promise<MarketSegmentContext> {
  const [snap, market] = await Promise.all([loadSnapshot(userId, projectId), loadMarketLook(userId, projectId)]);
  const products: Product[] = snap?.products ?? [];
  const history: HistoryRecord[] = snap?.history ?? [];

  if (products.length === 0) {
    return { schemeName: '', targets: [], hasTargetSegment: false, note: '项目快照里还没有商品：无法计算市场机会分' };
  }

  const schemes = synthesizeSegmentSchemes({ products, history, needs: needs ?? [] });
  const chosenSchemeId = market.segmentSchemeId;
  const chosenSegmentIds = market.chosenSegmentIds ?? [];
  const scheme = schemes.find((s) => s.id === chosenSchemeId);
  const chosen = scheme?.segments.filter((s) => chosenSegmentIds.includes(s.id)) ?? [];

  if (chosen.length > 0) {
    const targets: MarketSegmentSummary[] = chosen.map((s) => ({
      id: s.id,
      name: s.name,
      opportunity: s.score.opportunity,
      trend: s.score.trend,
      volume: s.score.volume,
      competition: s.score.competition,
      productCount: s.productCount,
      revenueShare: s.revenueShare,
      demandHits: s.demandHits.length,
    }));
    const weight = targets.reduce((sum, t) => sum + (t.revenueShare || 0), 0);
    const opportunity =
      weight > 0
        ? Math.round(targets.reduce((sum, t) => sum + t.opportunity * (t.revenueShare || 0), 0) / weight)
        : Math.round(targets.reduce((sum, t) => sum + t.opportunity, 0) / targets.length);
    return {
      schemeName: scheme?.name ?? '',
      targets,
      targetOpportunity: opportunity,
      hasTargetSegment: true,
      note: `目标细分 ${targets.map((t) => t.name).join(' + ')}（收入加权机会分 ${opportunity}）`,
    };
  }

  // 未选目标细分：全市场分 × 0.6（在评分模块里打折，这里给出全市场原分）
  const whole = scoreSegment('全市场', products, history);
  return {
    schemeName: scheme?.name ?? '',
    targets: [],
    targetOpportunity: whole.opportunity,
    hasTargetSegment: false,
    note: `还没有选定目标细分：按全市场机会分 ${whole.opportunity} × 0.6 折算（先去「看市场」选一个细分能显著提高评分可信度）`,
  };
}
