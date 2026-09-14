// M4 · 看机会 V2 的确定性评分（PRD §8.1）。
//
// 为什么重写而不是沿用 opportunityStore.scoreOpportunity：
// 旧实现把「页面完成度」当成了「质量」——市场分 = market.completionPercent × 20、
// 竞对分 = competitor.completionPercent × 20、自身分 = self.completionPercent × 15。
// 结果是"填得越多分越高"，与数据是否真的支持机会无关（断链 #6）。
// V2 把输入全部换血（§8.1 表），只认可追溯的证据与确定性指标，并且：
//   ① AI 只解释不改分；② 覆盖度独立展示、不进 100 分；③ 违反硬约束不是扣分，而是禁止"直接进入"。
//
// 缺项规则（PRD 原文"缺项从分母移除并降覆盖度"）：某一维没有输入时，它**不参与分母**，
// 同时覆盖度下降 —— 这样不会因为"没数据"而虚高，也不会因为"没数据"而虚低。

import type { UnmetNeedCandidate } from './userLook';
import { computeNeedEvidenceStrength } from './userLook';
import type { Evidence } from './evidence';
import type { PainMatrix, SatisfactionMatrix } from './competitorAnalysis';

/** 五维权重（沿用实现版 25/25/25/15/10，输入换血） */
export const SCORE_WEIGHTS = {
  demandStrength: 25,
  marketOpportunity: 25,
  competitorGap: 25,
  selfFit: 15,
  evidenceConfidence: 10,
} as const;

export type ScoreDimension = keyof typeof SCORE_WEIGHTS;

export const SCORE_DIMENSION_LABELS: Record<ScoreDimension, string> = {
  demandStrength: '需求强度',
  marketOpportunity: '市场机会',
  competitorGap: '竞品缺口',
  selfFit: '自身适配',
  evidenceConfidence: '证据可信度',
};

export interface OpportunityScoreInput {
  /** 需求卡（来自看用户），含结构化证据 */
  need?: UnmetNeedCandidate | null;
  /** 目标细分机会分 0-100（看市场 segmentScore）；未选目标细分时传 undefined → 按全市场分 ×0.6 */
  segmentOpportunity?: number;
  /** 是否已选目标细分（决定是否打 0.6 折） */
  hasTargetSegment?: boolean;
  /** 竞对满足矩阵（看竞对 M3） */
  satisfaction?: SatisfactionMatrix[] | null;
  /** 竞对痛点矩阵（看竞对 M3） */
  pain?: PainMatrix[] | null;
  /** 适配度 0-100（看自己 §6.4 computeFitScore） */
  fitScore?: number;
  /** 适配度里计入的相关题数（0 = 没答 → 该维缺项） */
  fitAnswered?: number;
  /** 项目 Evidence 列表（证据可信度与覆盖度用） */
  evidence?: Evidence[] | null;
  /** 时间基准（测试可注入） */
  now?: string;
}

export interface OpportunityScoreV2 {
  /** 综合分 0-100（按可用维度的权重归一化） */
  total: number;
  /** 每维达成率 0-1 */
  ratios: Record<ScoreDimension, number>;
  /** 每维加权得分（未加权前的分数，便于展示"需求强度 ████░"） */
  dimensionScores: Record<ScoreDimension, number>;
  /** 数据覆盖度 0-1（独立展示，不纳入 100 分） */
  coverage: number;
  /** 缺哪些输入（这些维度已从分母移除） */
  missing: ScoreDimension[];
  /** 口径说明（每条都能复核） */
  notes: string[];
  /** 证据条数与来源数（帮助判断可信度维度） */
  evidenceCount: number;
  evidenceSources: number;
}

const RECENT_DAYS = 30;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** 证据可信度：条数 60% + 来源多样性 25% + 时效 15%（确定性口径） */
function evidenceConfidenceRatio(evidence: Evidence[], now: string): { ratio: number; note: string } {
  if (evidence.length === 0) return { ratio: 0, note: '没有任何 Evidence：证据可信度为 0' };
  const countScore = clamp01(evidence.length / 10); // 10 条封顶
  const sources = new Set(evidence.map((e) => e.sourceRef || e.look));
  const sourceScore = clamp01(sources.size / 4); // 4 类来源封顶
  const nowMs = new Date(now).getTime();
  const fresh = evidence.filter((e) => {
    const t = new Date(e.createdAt || '').getTime();
    if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return false;
    return (nowMs - t) / 86_400_000 <= RECENT_DAYS;
  }).length;
  const freshScore = clamp01(fresh / evidence.length);
  const ratio = countScore * 0.6 + sourceScore * 0.25 + freshScore * 0.15;
  return {
    ratio,
    note: `证据可信度：${evidence.length} 条 / ${sources.size} 类来源 / 近 ${RECENT_DAYS} 天 ${fresh} 条 → ${(ratio * 100).toFixed(0)}%`,
  };
}

/** 竞品缺口：未满足占比 60% + 部分满足占比 25% + 缝隙证据数 15% */
function competitorGapRatio(
  satisfaction: SatisfactionMatrix[] | null | undefined,
  pain: PainMatrix[] | null | undefined
): { ratio: number; note: string } | null {
  const mats = Array.isArray(satisfaction) ? satisfaction : [];
  const cells = mats.flatMap((m) => m.cells);
  if (cells.length === 0) return null;
  const unmet = cells.filter((c) => c.status === 'unmet').length;
  const partial = cells.filter((c) => c.status === 'partial').length;
  const gapEvidence = cells.filter((c) => c.evidence.length > 0).length;
  const unmetRatio = unmet / cells.length;
  const partialRatio = partial / cells.length;
  const evidenceRatio = clamp01(gapEvidence / Math.max(1, cells.length / 2));
  const painBonus = (Array.isArray(pain) ? pain : []).reduce((s, m) => s + m.hits.length, 0) > 0 ? 0.05 : 0;
  const ratio = clamp01(unmetRatio * 0.6 + partialRatio * 0.25 + evidenceRatio * 0.15 + painBonus);
  return {
    ratio,
    note: `竞品缺口：${cells.length} 个需求×竞对格子里 ○未满足 ${unmet} / ◐部分 ${partial}（未满足占比 ${(unmetRatio * 100).toFixed(0)}%）`,
  };
}

/**
 * 机会卡确定性评分（§8.1）。AI 不得修改返回的任何数字。
 */
export function scoreOpportunityV2(input: OpportunityScoreInput): OpportunityScoreV2 {
  const now = input.now ?? new Date().toISOString();
  const notes: string[] = [];
  const ratios = {} as Record<ScoreDimension, number>;
  const dimensionScores = {} as Record<ScoreDimension, number>;
  const missing: ScoreDimension[] = [];

  // ① 需求强度：需求卡的结构化证据分（关键词 + 评论原文 + 覆盖 ASIN）
  if (input.need) {
    const ev = computeNeedEvidenceStrength(input.need.evidence);
    ratios.demandStrength = clamp01(ev.score / 100);
    dimensionScores.demandStrength = ev.score;
    notes.push(`需求强度：${ev.reasons.join('；')} → ${ev.score}/100`);
  } else {
    missing.push('demandStrength');
    notes.push('需求强度：缺需求卡（这张机会没挂看用户的需求）');
  }

  // ② 市场机会：目标细分机会分；未选目标细分按 0.6 折（§8.1）
  if (typeof input.segmentOpportunity === 'number' && input.segmentOpportunity > 0) {
    const factor = input.hasTargetSegment === false ? 0.6 : 1;
    const v = clamp01((input.segmentOpportunity * factor) / 100);
    ratios.marketOpportunity = v;
    dimensionScores.marketOpportunity = Math.round(input.segmentOpportunity * factor);
    notes.push(
      `市场机会：细分机会分 ${input.segmentOpportunity}${factor < 1 ? ' × 0.6（未选目标细分，按全市场分折算）' : ''} → ${Math.round(input.segmentOpportunity * factor)}/100`
    );
  } else {
    missing.push('marketOpportunity');
    notes.push('市场机会：没有细分机会分（先在看市场选定目标细分）');
  }

  // ③ 竞品缺口：满足矩阵 + 痛点矩阵
  const gap = competitorGapRatio(input.satisfaction, input.pain);
  if (gap) {
    ratios.competitorGap = gap.ratio;
    dimensionScores.competitorGap = Math.round(gap.ratio * 100);
    notes.push(gap.note);
  } else {
    missing.push('competitorGap');
    notes.push('竞品缺口：没有满足矩阵（先在看竞对完成三块分析）');
  }

  // ④ 自身适配：§6.4 适配度（答案质量 × 背景完整度），与完成度无关
  if (typeof input.fitScore === 'number' && (input.fitAnswered ?? 0) > 0) {
    ratios.selfFit = clamp01(input.fitScore / 100);
    dimensionScores.selfFit = Math.round(input.fitScore);
    notes.push(`自身适配：适配度 ${input.fitScore}/100（来自 ${input.fitAnswered} 道相关题 × 背景库完整度）`);
  } else {
    missing.push('selfFit');
    notes.push('自身适配：还没有可计入的品类选择题答案（"待确认"不计分）');
  }

  // ⑤ 证据可信度：Evidence 覆盖
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const conf = evidenceConfidenceRatio(evidence, now);
  ratios.evidenceConfidence = conf.ratio;
  dimensionScores.evidenceConfidence = Math.round(conf.ratio * 100);
  notes.push(conf.note);

  // 综合分：只按可用维度归一化（缺项不进分母）
  const available = (Object.keys(SCORE_WEIGHTS) as ScoreDimension[]).filter((d) => !missing.includes(d));
  const availableWeight = available.reduce((s, d) => s + SCORE_WEIGHTS[d], 0);
  const total =
    availableWeight > 0
      ? Math.round(available.reduce((s, d) => s + ratios[d] * SCORE_WEIGHTS[d], 0) * (100 / availableWeight))
      : 0;

  const coverage = Math.round((availableWeight / 100) * 100) / 100;
  if (missing.length > 0) {
    notes.push(`覆盖度 ${(coverage * 100).toFixed(0)}%：缺 ${missing.map((m) => SCORE_DIMENSION_LABELS[m]).join('、')}（已从分母移除，不虚高也不虚低）`);
  } else {
    notes.push('覆盖度 100%：五个维度都有输入');
  }

  return {
    total: Math.max(0, Math.min(100, total)),
    ratios,
    dimensionScores,
    coverage,
    missing,
    notes,
    evidenceCount: evidence.length,
    evidenceSources: new Set(evidence.map((e) => e.sourceRef || e.look)).size,
  };
}

/** 把评分拆解压成一行展示文本（机会卡上那排 ████░ 用） */
export function describeScoreV2(score: OpportunityScoreV2): string {
  const dims = (Object.keys(SCORE_WEIGHTS) as ScoreDimension[])
    .map((d) => `${SCORE_DIMENSION_LABELS[d]} ${score.dimensionScores[d] ?? 0}`)
    .join(' · ');
  return `${dims}｜评分 ${score.total} / 覆盖度 ${(score.coverage * 100).toFixed(0)}%`;
}
