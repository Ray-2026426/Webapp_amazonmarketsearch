// M3 · 把「看自己」的自评 / 品类选择题答案，翻译成赢的路径判定所需的「我们的能力」（PRD §6.3 ∩ §6.4）。
//
// 为什么要单独一层：
// - 看竞对的赢的路径需要"我们能不能接住这条需求"和"有没有硬约束否决"；
// - 这两个信息分别来自 看自己的自评（决策边界类=硬约束）与 品类选择题（按需求的适配答案）；
// - AI 不参与：全部是确定性映射，缺的就说 unknown（不当作"能"）。

import { SELF_CATEGORY_LABELS, type SelfAssessmentItem, type SelfStatus } from './selfAssessment';
import type { OurCapability } from './competitorAnalysis';

export interface OurCapabilityDraft extends OurCapability {
  /** 派生说明（告诉用户这个结论是怎么来的，可复核） */
  notes: string[];
  /** 相关自评项里有多少还是"待确认"（影响可信度） */
  unknownCount: number;
}

/**
 * 硬约束（否决项）：来自自评的「决策边界」类 + 「约束」类里明确"不具备"的项。
 * 任何一条不具备 → 不能推荐"直接进入"（最高"验证后进入"，PRD §6.4）。
 */
export function hardConstraintsFromSelfAssessment(items: SelfAssessmentItem[] | undefined): {
  blocked: boolean;
  notes: string[];
} {
  const list = Array.isArray(items) ? items : [];
  const boundary = list.filter(
    (i) => (i.category === 'boundary' || i.category === 'constraint') && (i.status === 'lack' || i.status === 'partial')
  );
  const lack = boundary.filter((i) => i.status === 'lack');
  const notes = [
    ...lack.map((i) => `${SELF_CATEGORY_LABELS[i.category]}「${i.label}」不具备${i.note ? `（${i.note}）` : ''}`),
    ...boundary
      .filter((i) => i.status === 'partial')
      .map((i) => `${SELF_CATEGORY_LABELS[i.category]}「${i.label}」仅部分具备${i.note ? `（${i.note}）` : ''}`),
  ];
  return { blocked: lack.length > 0, notes };
}

export interface BuildOurCapabilityInput {
  /** 看自己的结构化自评项 */
  items?: SelfAssessmentItem[];
  /** 品类选择题/人工指定的"每条需求我们行不行"（覆盖自评的域级结论） */
  byNeedId?: Record<string, SelfStatus>;
  /** 域级能力（人工指定时优先于自评推导） */
  byDemandCategory?: Record<string, SelfStatus>;
  /** 财务口径（人优我廉判定用；来自利润计算器或人工填写） */
  financials?: { targetPrice?: number; marginFloor?: number; estimatedMarginAtPrice?: number };
  /** 目标售价下的预估毛利率（由利润计算器算出后传入） */
  estimatedMarginAtTargetPrice?: number;
}

/** 从看自己推导出赢的路径判定所需的自身能力 */
export function buildOurCapability(input: BuildOurCapabilityInput): OurCapabilityDraft {
  const items = Array.isArray(input.items) ? input.items : [];
  const { blocked, notes: hardNotes } = hardConstraintsFromSelfAssessment(items);
  const notes: string[] = [];

  // 域级能力：来自自评里的"能力/资源/经验"类（有明确状态才计入，待确认不计）
  const byDemandCategory: Record<string, SelfStatus> = { ...(input.byDemandCategory ?? {}) };
  const derived: Record<string, number> = {};
  for (const i of items) {
    if (!['capability', 'resource', 'experience'].includes(i.category)) continue;
    if (i.status === 'unknown') continue;
    derived[i.status] = (derived[i.status] || 0) + 1;
  }
  const total = Object.values(derived).reduce((s, v) => s + v, 0);
  if (total > 0) {
    notes.push(
      `自身能力概况（自评）：已具备 ${derived.have || 0} 项 / 部分具备 ${derived.partial || 0} 项 / 不具备 ${derived.lack || 0} 项（共 ${total} 项有明确状态）`
    );
  } else {
    notes.push('看自己里还没有"能力/资源/经验"的明确自评：按需求的自身能力只能靠品类选择题或人工指定');
  }

  const unknownCount = items.filter((i) => i.status === 'unknown').length;
  if (unknownCount > 0) notes.push(`有 ${unknownCount} 项自评还是"待确认"，会降低适配度可信度`);
  if (blocked) notes.push(`硬约束否决已触发：${hardNotes.join('；')}`);
  else if (hardNotes.length > 0) notes.push(`警戒：${hardNotes.join('；')}`);

  const targetPrice = input.financials?.targetPrice;
  const marginFloor = input.financials?.marginFloor;
  const estimatedMarginAtTargetPrice = input.estimatedMarginAtTargetPrice ?? input.financials?.estimatedMarginAtPrice;
  if (typeof targetPrice !== 'number') notes.push('没填目标售价：无法判定"人优我廉"');
  if (typeof marginFloor !== 'number') notes.push('没填毛利红线：无法判定"人优我廉"');

  return {
    byNeedId: input.byNeedId ?? {},
    byDemandCategory,
    hardConstraintBlocked: blocked,
    hardConstraintNotes: hardNotes,
    targetPrice,
    marginFloor,
    estimatedMarginAtTargetPrice,
    notes,
    unknownCount,
  };
}

/**
 * M3⑤ · 硬约束结论（存到项目数据里，供 M4「看机会」的机会卡顶部红条与进入方式判定直接读取）。
 * 三个来源合并去重：看自己自评的决策边界 / 账号背景库（财务红线、合规、MOQ）/ 品类选择题。
 * 只要有任意一条为真 → blocked=true（最高"验证后进入"，不可"直接进入"）。
 */
export interface HardConstraintVerdict {
  blocked: boolean;
  notes: string[];
  updatedAt: string;
}

export function buildHardConstraintVerdict(input: {
  items?: SelfAssessmentItem[];
  /** 背景库推导出的硬约束（capabilityLibrary.capabilityHardConstraints） */
  libraryNotes?: string[];
  /** 品类选择题里决策边界答"不具备"的说明（categoryQuiz.toOurCapabilityFromQuiz 的 quizHardNotes） */
  quizNotes?: string[];
  now?: string;
}): HardConstraintVerdict {
  const fromSelf = hardConstraintsFromSelfAssessment(input.items).notes;
  const notes = [...new Set([...(input.quizNotes ?? []), ...fromSelf, ...(input.libraryNotes ?? [])].map((n) => String(n || '').trim()).filter(Boolean))];
  const blocked = hardConstraintsFromSelfAssessment(input.items).blocked || (input.libraryNotes ?? []).length > 0 || (input.quizNotes ?? []).length > 0;
  return { blocked, notes, updatedAt: input.now ?? new Date().toISOString() };
}

/**
 * 适配度（确定性，PRD §6.4）：只取相关题；已具备=1 / 部分=0.5 / 不具备=0 / 待确认不纳入；
 * 再乘背景库完整度修正。**完成度与适配度分离**（完成度只看填了多少，适配度只看答得多好）。
 */
export function computeFitScore(input: {
  /** 相关题的答案（id → 状态）。"待确认"会被排除在分母外 */
  answers: Record<string, SelfStatus>;
  /** 背景库完整度 0-1（六维度已明确的占比） */
  backgroundCompleteness: number;
}): { fitScore: number; answered: number; excluded: number; backgroundCompleteness: number; note: string } {
  const entries = Object.entries(input.answers ?? {});
  const scored = entries.filter(([, s]) => s !== 'unknown');
  const excluded = entries.length - scored.length;
  const sum = scored.reduce((s, [, status]) => s + (status === 'have' ? 1 : status === 'partial' ? 0.5 : 0), 0);
  const mean = scored.length > 0 ? sum / scored.length : 0;
  const completeness = Math.max(0, Math.min(1, input.backgroundCompleteness));
  const fitScore = Math.round(mean * completeness * 100);
  const note =
    scored.length === 0
      ? '还没有可计入的相关题（"待确认"不参与评分）'
      : `相关题 ${scored.length} 道（排除待确认 ${excluded} 道）均分 ${mean.toFixed(2)} × 背景库完整度 ${(completeness * 100).toFixed(0)}% = 适配度 ${fitScore}`;
  return { fitScore, answered: scored.length, excluded, backgroundCompleteness: completeness, note };
}
