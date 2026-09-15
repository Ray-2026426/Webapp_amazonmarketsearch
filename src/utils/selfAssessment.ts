// 看自己（FR-06）：结构化自评，供「看自己」视角与「看/找机会」机会卡自身适配度使用。
//
// V3（用户诉求："有了背景信息，还要我确认 42 项，很奇怪"）：
// - 42 项四态确认**已删除**。现在只有 **3 个拍板问题**（最低毛利率 / 止损条件 / 必须满足的进入条件），
//   它们是"背景信息答不了、但决定能不能拍板"的那三件（理由写在 categoryQuiz.buildDecisionQuestions 注释里）；
// - `items` 变成**由这 3 个问题的答案推导出来的决策边界项**（categoryQuiz.boundaryItemsFromQuiz），
//   仍然保留四态形状，所以下游（硬约束判定 / 赢的路径 / 决策草稿）读取路径**完全不变**；
// - 旧版 42 项里"决策边界/约束"类答过"不具备/部分具备"的记录，迁移时保留在 `legacyBoundaryNotes`，
//   **继续参与硬约束判定**（不能因为改版就静默放行）。

import { get, set } from 'idb-keyval';
import type { FiveLookProgress } from '../types/researchProject';
import type { QuizData } from './categoryQuiz';
import type { HardConstraintVerdict } from './ourCapability';

export type SelfStatus = 'have' | 'partial' | 'lack' | 'unknown';
export type SelfCategory =
  | 'objective'
  | 'capability'
  | 'resource'
  | 'constraint'
  | 'experience'
  | 'boundary';

export interface SelfAssessmentItem {
  id: string;
  category: SelfCategory;
  label: string;
  status: SelfStatus;
  note?: string;
}

/**
 * M1：AI 起草的自身适配结论。
 * 只做「起草」，不修改 items 里的人工自评；为空时才回填（见 lookAiMerge 的非破坏性规则）。
 */
export interface SelfAiDraft {
  conclusion?: string;
  strengths?: string[];
  gaps?: string[];
  hardConstraints?: string[];
  fitAssessment?: string;
  updatedAt?: string;
}

export interface SelfAssessment {
  projectId: string;
  /** 由 3 个拍板问题推导出的决策边界项（不再手工逐条点） */
  items: SelfAssessmentItem[];
  /** AI 起草结论（可选） */
  aiDraft?: SelfAiDraft;
  /** 项目内拍板问题（3 个确定性题 + AI 可选增补；答案存这里） */
  quiz?: QuizData;
  /** 硬约束结论（供机会卡红条与"不可直接进入"判定读取） */
  hardConstraintVerdict?: HardConstraintVerdict;
  /** 旧版 42 项里决策边界/约束类"不具备/部分具备"的记录（迁移保留，继续参与硬约束判定） */
  legacyBoundaryNotes?: string[];
  updatedAt: string;
}

export const SELF_STATUS_LABELS: Record<SelfStatus, string> = {
  have: '已具备',
  partial: '部分具备',
  lack: '不具备',
  unknown: '待确认',
};

export const SELF_CATEGORY_ORDER: SelfCategory[] = [
  'objective',
  'capability',
  'resource',
  'constraint',
  'experience',
  'boundary',
];

export const SELF_CATEGORY_LABELS: Record<SelfCategory, string> = {
  objective: '目标',
  capability: '能力',
  resource: '资源',
  constraint: '约束',
  experience: '经验',
  boundary: '决策边界',
};

/** 「看自己」的拍板问题数量：**恰好 3 个**（改动这个常量要同时改测试与 PRD §15.19） */
export const SELF_DECISION_QUESTION_COUNT = 3;

/** 决策边界项的 id 词表（由 categoryQuiz 生成 items 时使用） */
export const SELF_BOUNDARY_ITEM_IDS = [
  'boundary:margin_floor',
  'boundary:stop_loss',
  'boundary:entry_conditions',
] as const;

export type SelfBoundaryItemId = (typeof SELF_BOUNDARY_ITEM_IDS)[number];

export function boundaryItemId(decisionKey: string): string {
  return `boundary:${decisionKey}`;
}

/** 新项目的自评：items 为空（会在拿到 3 个问题的答案后由 categoryQuiz 推导出来） */
export function defaultSelfAssessment(projectId: string): SelfAssessment {
  return { projectId, items: [], updatedAt: new Date().toISOString() };
}

const KEY_PREFIX = 'amzdev_self:';
function storageKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

function isBoundaryItemShape(items: unknown): items is SelfAssessmentItem[] {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((i) => {
    const id = String((i as SelfAssessmentItem)?.id ?? '');
    return (SELF_BOUNDARY_ITEM_IDS as readonly string[]).includes(id);
  });
}

/**
 * 迁移旧记录：旧版 42 项里「决策边界 / 约束」类答过"不具备/部分具备"的，转成 legacyBoundaryNotes。
 * 这些记录**继续参与硬约束判定**（见 ourCapability.buildHardConstraintVerdict），不会因为改版而放行。
 */
export function legacyBoundaryNotesFromItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const raw of items as SelfAssessmentItem[]) {
    const category = raw?.category;
    const status = raw?.status;
    if (category !== 'boundary' && category !== 'constraint') continue;
    if (status !== 'lack' && status !== 'partial') continue;
    const label = String(raw.label ?? '').trim();
    if (!label) continue;
    out.push(
      `${SELF_CATEGORY_LABELS[category]}「${label}」${status === 'lack' ? '不具备' : '仅部分具备'}${
        raw.note ? `（${raw.note}）` : ''
      }（旧版 42 项记录）`
    );
  }
  return out;
}

export async function loadSelfAssessment(userId: string, projectId: string): Promise<SelfAssessment> {
  try {
    const raw = await get<SelfAssessment>(storageKey(userId, projectId));
    if (raw && typeof raw === 'object') {
      // 老记录没有 quiz 字段：补一个空结构，避免下游到处判空
      const quiz: QuizData =
        raw.quiz && Array.isArray(raw.quiz.questions)
          ? {
              questions: raw.quiz.questions,
              answers: Array.isArray(raw.quiz.answers) ? raw.quiz.answers : [],
              updatedAt: raw.quiz.updatedAt || new Date().toISOString(),
            }
          : { questions: [], answers: [], updatedAt: new Date().toISOString() };
      const items = isBoundaryItemShape(raw.items) ? raw.items : [];
      const legacyBoundaryNotes = [
        ...(Array.isArray(raw.legacyBoundaryNotes) ? raw.legacyBoundaryNotes.filter((n) => String(n || '').trim()) : []),
        // 旧版 42 项记录只迁移一次：迁移后 items 变成新的边界项形状，这里不会再命中
        ...(isBoundaryItemShape(raw.items) ? [] : legacyBoundaryNotesFromItems(raw.items)),
      ];
      return { ...raw, items, quiz, legacyBoundaryNotes };
    }
  } catch {
    /* ignore */
  }
  return defaultSelfAssessment(projectId);
}

export async function saveSelfAssessment(
  userId: string,
  projectId: string,
  assessment: SelfAssessment
): Promise<void> {
  await set(storageKey(userId, projectId), { ...assessment, updatedAt: new Date().toISOString() });
}

/**
 * 由确定性规则计算「看自己」进度：不拖动、不由 AI 判断。
 * 分母 = 3 个拍板问题（没答 = 待确认，不算完成）。
 */
export function computeSelfProgress(
  assessment: SelfAssessment
): Pick<FiveLookProgress, 'status' | 'completionPercent' | 'missingRequirements'> {
  const items = Array.isArray(assessment.items) ? assessment.items : [];
  const total = items.length > 0 ? items.length : SELF_DECISION_QUESTION_COUNT;
  const answered = items.filter((i) => i.status !== 'unknown').length;
  const completionPercent = total > 0 ? Math.round((answered / total) * 100) : 0;
  let status: FiveLookProgress['status'] = 'not_started';
  if (answered > 0 && answered < total) status = 'in_progress';
  else if (answered === total && total > 0) status = 'completed';
  const missingRequirements =
    items.length === 0
      ? [`缺少「${SELF_CATEGORY_LABELS.boundary}」的 3 个拍板问题（最低毛利率 / 止损条件 / 必须满足的进入条件）`]
      : items.filter((i) => i.status === 'unknown').map((i) => `缺少「${i.label}」`);
  return { status, completionPercent, missingRequirements };
}
