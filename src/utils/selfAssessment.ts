// 看自己（FR-06）：结构化自评，供「看自己」视角与「看/找机会」机会卡自身适配度使用。
// 每项支持：已具备 / 部分具备 / 不具备 / 待确认，并可添加备注。

import { get, set } from 'idb-keyval';
import type { FiveLookProgress } from '../types/researchProject';

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

export interface SelfAssessment {
  projectId: string;
  items: SelfAssessmentItem[];
  aiSummary?: string;
  accountBackgroundSnapshot?: string;
  guidingQuestions?: SelfGuidingQuestion[];
  updatedAt: string;
}

export interface SelfGuidingQuestion {
  id: string;
  question: string;
  type: 'choice' | 'number' | 'text';
  options?: string[];
  reason: string;
  impactDimension: 'strength' | 'gap' | 'boundary' | 'fit';
  answer: string;
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

const TEMPLATE: { category: SelfCategory; labels: string[] }[] = [
  { category: 'objective', labels: ['项目目的', '目标用户', '销量/收入/利润目标', '上市时间', '战略意义'] },
  { category: 'capability', labels: ['产品定义', '研发设计', '供应链', '质量', '合规', '品牌', '内容', '广告', '运营', '售后'] },
  { category: 'resource', labels: ['预算', '人员', '供应商', '模具/专利', '渠道', '流量', '素材', '数据', '合作关系'] },
  { category: 'constraint', labels: ['最高投入', 'MOQ', '交期', '体积重量', '认证', '现金流', '类目限制', '风险偏好'] },
  { category: 'experience', labels: ['类目经验', '成功/失败项目', '现有 ASIN', '品牌资产', '客户反馈'] },
  { category: 'boundary', labels: ['最低毛利', '最高 CPC', '最大验证成本', '止损条件', '必须满足的进入条件'] },
];

export function defaultSelfAssessment(projectId: string): SelfAssessment {
  const items: SelfAssessmentItem[] = [];
  for (const g of TEMPLATE) {
    for (const label of g.labels) {
      items.push({ id: `${g.category}:${label}`, category: g.category, label, status: 'unknown', note: '' });
    }
  }
  return { projectId, items, aiSummary: '', accountBackgroundSnapshot: '', guidingQuestions: [], updatedAt: new Date().toISOString() };
}

const KEY_PREFIX = 'amzdev_self:';
function storageKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

export async function loadSelfAssessment(userId: string, projectId: string): Promise<SelfAssessment> {
  try {
    const raw = await get<SelfAssessment>(storageKey(userId, projectId));
    if (raw && Array.isArray(raw.items) && raw.items.length > 0) return {
      ...raw,
      aiSummary: raw.aiSummary ?? '',
      accountBackgroundSnapshot: raw.accountBackgroundSnapshot ?? '',
      guidingQuestions: Array.isArray(raw.guidingQuestions) ? raw.guidingQuestions : [],
    };
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

/** 由确定性规则计算「看自己」进度：不拖动、不由 AI 判断。 */
export function computeSelfProgress(
  assessment: SelfAssessment
): Pick<FiveLookProgress, 'status' | 'completionPercent' | 'missingRequirements'> {
  if ((assessment.guidingQuestions?.length ?? 0) > 0) {
    const questions = assessment.guidingQuestions ?? [];
    const answered = questions.filter((question) => question.answer.trim()).length;
    const hasBackground = Boolean(assessment.accountBackgroundSnapshot?.trim());
    const completionPercent = Math.round(((answered + (hasBackground ? 1 : 0)) / (questions.length + 1)) * 100);
    const status: FiveLookProgress['status'] = answered === 0
      ? 'in_progress'
      : answered === questions.length && hasBackground
        ? 'completed'
        : 'in_progress';
    const missingRequirements: string[] = [];
    if (!hasBackground) missingRequirements.push('账号背景尚未同步');
    if (answered < questions.length) missingRequirements.push(`还有 ${questions.length - answered} 个品类引导问题未回答`);
    return { status, completionPercent, missingRequirements };
  }
  const total = assessment.items.length;
  const answered = assessment.items.filter((i) => i.status !== 'unknown').length;
  const completionPercent = total > 0 ? Math.round((answered / total) * 100) : 0;
  let status: FiveLookProgress['status'] = 'not_started';
  if (answered > 0 && answered < total) status = 'in_progress';
  else if (answered === total && total > 0) status = 'completed';
  const missingRequirements = TEMPLATE.filter(
    (g) => !assessment.items.some((i) => i.category === g.category && i.status !== 'unknown')
  ).map((g) => `缺少「${SELF_CATEGORY_LABELS[g.category]}」自评`);
  return { status, completionPercent, missingRequirements };
}
