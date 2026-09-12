// M3⑤ · 项目内「品类选择题」（PRD §6.4-2 / §6.4 适配度计算）。
//
// 为什么要"确定性出题 + AI 增补"，而不是纯让 AI 出题：
// - 题目必须**与本项目的数据挂钩**（竞对专利、MOQ、毛利红线、认证……），否则用户答完也不知道影响什么；
// - 每题要能映射成"我们行不行"（have/partial/lack/unknown）→ 直接喂给适配度与赢的路径；
// - 纯 AI 出题无法复现、也无法测试，所以：**种子题由数据确定性生成**，AI 只能增补（见 mergeCategoryQuestions），
//   且用户答案永远优先（非破坏性）。
//
// 硬约束规则（§6.4）：任何"决策边界"类问题答"不具备" → 关联机会不能推荐"直接进入"。

import type { UnmetNeedCandidate } from './userLook';
import type { SelfStatus } from './selfAssessment';
import type { WinningPathDecision } from './competitorAnalysis';
import { capabilityHardConstraints, type CapabilityLibrary } from './capabilityLibrary';

export type QuizCategory = 'capability' | 'boundary' | 'supply' | 'compliance' | 'finance' | 'risk';

export const QUIZ_CATEGORY_LABELS: Record<QuizCategory, string> = {
  capability: '能力',
  boundary: '决策边界',
  supply: '供应链',
  compliance: '合规',
  finance: '财务',
  risk: '风险',
};

export interface QuizOption {
  /** 选项文案（用户读的那一句） */
  label: string;
  /** 该选项映射的自身状态（适配度用） */
  status: SelfStatus;
  /** 为什么不选/选它的含义（PRD 要求每个选项旁给"为什么不"） */
  why: string;
}

export interface QuizQuestion {
  id: string;
  category: QuizCategory;
  question: string;
  /** 这题为什么问（依据来自哪条数据） */
  basis: string;
  options: QuizOption[];
  /** 关联的需求（这些题直接决定该需求我们能不能接住） */
  needIds?: string[];
  /** 是否"决策边界"：答不具备 → 硬约束否决（不可直接进入） */
  isBoundary?: boolean;
  /** 来源：确定性种子题 / AI 增补 */
  origin: 'seed' | 'ai';
}

export interface QuizAnswer {
  questionId: string;
  /** 选中的选项下标；undefined = 未答 */
  optionIndex?: number;
  note?: string;
}

export interface QuizData {
  questions: QuizQuestion[];
  answers: QuizAnswer[];
  updatedAt: string;
}

export function defaultQuizData(): QuizData {
  return { questions: [], answers: [], updatedAt: new Date().toISOString() };
}

const YES_NO_UNCLEAR = (yesWhy: string, noWhy: string, unsureWhy: string): QuizOption[] => [
  { label: 'A. 能（已具备）', status: 'have', why: yesWhy },
  { label: 'B. 能，但要付出额外代价（部分具备）', status: 'partial', why: '能落地但会拖周期或抬成本，属于"可以但要想清楚"的选项。' },
  { label: 'C. 不能（不具备）', status: 'lack', why: noWhy },
  { label: 'D. 不确定（待确认）', status: 'unknown', why: unsureWhy },
];

/**
 * 确定性种子题：只在本项目真的存在对应证据时才出（宁可少问，也不问空题）。
 * 出题依据全部来自：竞对满足矩阵/赢的路径、需求证据、背景库硬约束。
 */
export function buildSeedQuestions(input: {
  needs: UnmetNeedCandidate[];
  decision?: WinningPathDecision;
  /** 竞对数量（用于"3 个竞对都没有做到"这类题） */
  competitorCount?: number;
  library?: CapabilityLibrary;
}): QuizQuestion[] {
  const out: Omit<QuizQuestion, 'origin'>[] = [];
  const needs = (input.needs ?? []).filter((n) => (n.needStatement || '').trim().length > 0);
  const decision = input.decision;
  const competitorCount = input.competitorCount ?? 0;

  // 1) 每条"我们还没评过"的交叉需求问一题（这是适配度的主料）
  if (decision) {
    for (const row of decision.crossList.filter((r) => r.ourStatus === 'unknown').slice(0, 4)) {
      out.push({
        id: `seed:need:${row.needId}`,
        category: 'capability',
        question: `需求「${row.needStatement}」（${row.category}）你能满足吗？`,
        basis: `该需求在交叉清单里未被满足方：${row.unmetBy.join('、') || '无'}；需求证据分 ${row.evidenceScore}/100。系统目前不知道我们能不能接住它。`,
        needIds: [row.needId],
        options: YES_NO_UNCLEAR(
          '已具备对应的产品/工艺/供应链能力，可以直接按这条需求做产品定义。',
          '没有对应能力，需要先补（否则这条需求即使没人满足，我们也吃不到）。',
          '需要先做技术/打样验证才能确认，选它不会计入适配度分母，但会降低可信度。'
        ),
      });
    }
  }

  // 2) 差异化供给（"人无我有"的前提）
  if (needs.length > 0 && competitorCount > 0) {
    out.push({
      id: 'seed:differentiation',
      category: 'supply',
      question: `竞对（${competitorCount} 个对标）都没有做到的差异点，你的供应链能在 60 天内小批量交付吗？`,
      basis: `交叉清单里有需求方向是"三家都没满足"，差异化能不能落地取决于供应链交付速度与起订量。`,
      options: YES_NO_UNCLEAR(
        '能在 60 天内拿到小批量成品或样机。',
        '做不到 60 天：会错过窗口期，需要重新评估上市节奏。',
        '要先跟工厂确认产能与排期。'
      ),
    });
  }

  // 3) 合规（跨类目硬约束）
  out.push({
    id: 'seed:compliance',
    category: 'compliance',
    question: '目标站点要求的认证/资质，你能在上市前拿到吗？',
    basis: '合规缺失属于"硬约束"：答不能会直接把机会降级为"验证后进入"，并在机会卡顶部红条警示。',
    isBoundary: true,
    options: YES_NO_UNCLEAR(
      '认证已具备或已有明确获取路径。',
      '拿不到：这类机会不能直接进入（先解决资质）。',
      '不确定要多久，需要问工厂/认证机构。'
    ),
  });

  // 4) 财务红线（"人优我廉"的必要条件）
  out.push({
    id: 'seed:margin_floor',
    category: 'finance',
    question: '这个品类的目标售价下，毛利率能达到你的红线吗？',
    basis: '赢的路径里"人优我廉"必须在毛利红线内成立；达不到红线时该路径不成立（PRD §6.3）。',
    isBoundary: true,
    options: [
      { label: 'A. 能达到，且有余量', status: 'have', why: '有价格空间，可以支撑价格战或广告投入。' },
      { label: 'B. 刚好卡在红线附近', status: 'partial', why: '能进但几乎没有容错，任何涨价/广告超支都会击穿。' },
      { label: 'C. 达不到红线', status: 'lack', why: '这条路径直接不成立，应优先找成本更低的供应链或换细分。' },
      { label: 'D. 不确定（还没算清成本）', status: 'unknown', why: '先去利润计算器把成本算清楚再回答，否则适配度不可信。' },
    ],
  });

  // 5) 库存/风险承受
  out.push({
    id: 'seed:inventory',
    category: 'risk',
    question: '这个品类的首批库存风险，你能承受吗？',
    basis: '体积重量与季节性决定首批压货风险；风险承受度影响"先做哪一步"的路线图排布。',
    options: [
      { label: 'A. 能承受首批全压', status: 'have', why: '可以一次备足货抢排名。' },
      { label: 'B. 只能小批量试水', status: 'partial', why: '需要按小批量设计路线图（先测款再加单）。' },
      { label: 'C. 不能压货', status: 'lack', why: '只能走低库存模式（如预售/一件代发），需重新评估可行性。' },
      { label: 'D. 不确定', status: 'unknown', why: '结合资金与回本周期再判断。' },
    ],
  });

  // 6) 背景库里的硬约束：直接生成"补齐"题，让用户明确一次
  const hardConstraints = capabilityHardConstraints(input.library);
  if (hardConstraints.length > 0) {
    out.push({
      id: 'seed:library_boundary',
      category: 'boundary',
      question: `背景库里已有不满足的边界项：${hardConstraints[0]}。这一项在本次机会里能补上吗？`,
      basis: '背景库的财务/合规边界项为"不具备"时属于硬约束否决项。',
      isBoundary: true,
      options: YES_NO_UNCLEAR(
        '已解决（例如已找到新供应商/已完成认证）。',
        '仍未解决：本次机会不能直接进入。',
        '正在解决中，需要明确时间点。'
      ),
    });
  }

  // 7) 关键需求缺少评论证据时，提醒用户这是"待验证"而不是"已确认"
  const weak = needs.filter((n) => !(n.evidence?.reviewQuotes?.length));
  if (weak.length > 0) {
    out.push({
      id: 'seed:evidence_gap',
      category: 'risk',
      question: `有 ${weak.length} 条需求只有关键词证据、没有评论原文，是否愿意先花 2-3 天补样本再决定投入？`,
      basis: `缺评论原文的需求：${weak
        .slice(0, 2)
        .map((n) => (n.needStatement || '').trim())
        .join('；')}${weak.length > 2 ? '…' : ''}`,
      needIds: weak.slice(0, 4).map((n) => n.id),
      options: [
        { label: 'A. 愿意，先补证据', status: 'have', why: '证据补齐后结论可信度显著提高，也避免押错方向。' },
        { label: 'B. 只对最关键的 1-2 条补', status: 'partial', why: '折中方案：优先验证投入产出比最高的需求。' },
        { label: 'C. 不补，直接按现有证据推进', status: 'lack', why: '风险自担：结论会标注"证据不足"，机会卡可信度下降。' },
        { label: 'D. 不确定', status: 'unknown', why: '需要先看这条需求对应的市场空间再决定。' },
      ],
    });
  }

  return out.slice(0, 8).map((q) => ({ ...q, origin: 'seed' as const }));
}

/** AI 增补的题目归一化（AI 不可信：结构校验 + 选项状态白名单） */
export function normalizeAiQuestions(raw: unknown): QuizQuestion[] {
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const validCategories: QuizCategory[] = ['capability', 'boundary', 'supply', 'compliance', 'finance', 'risk'];
  const validStatuses: SelfStatus[] = ['have', 'partial', 'lack', 'unknown'];
  const out: QuizQuestion[] = [];
  rows.forEach((r, i) => {
    const question = String(r?.question ?? '').trim();
    if (!question) return;
    const optionsRaw = Array.isArray(r?.options) ? (r.options as Record<string, unknown>[]) : [];
    const options: QuizOption[] = optionsRaw
      .map((o) => ({
        label: String(o?.label ?? '').trim(),
        status: String(o?.status ?? '') as SelfStatus,
        why: String(o?.why ?? '').trim(),
      }))
      .filter((o) => o.label.length > 0 && validStatuses.includes(o.status))
      .slice(0, 5);
    if (options.length < 2) return;
    const category = validCategories.includes(String(r?.category) as QuizCategory)
      ? (String(r?.category) as QuizCategory)
      : 'capability';
    out.push({
      id: `ai:${i}:${question.slice(0, 12)}`,
      category,
      question,
      basis: String(r?.basis ?? '').trim() || 'AI 依据本项目数据提出，请核对依据是否成立',
      options,
      isBoundary: Boolean(r?.isBoundary) || category === 'boundary',
      origin: 'ai',
    });
  });
  return out.slice(0, 8);
}

/**
 * 合并题目（非破坏性）：种子题为准（同 id 不覆盖），AI 题按 id 追加；
 * **已有回答永远保留**（AI 重跑不会清掉用户答过的题）。
 */
export function mergeCategoryQuestions(
  current: QuizData,
  aiQuestions: QuizQuestion[]
): { next: QuizData; added: number; skipped: number } {
  const byId = new Map(current.questions.map((q) => [q.id, q]));
  let added = 0;
  let skipped = 0;
  for (const q of aiQuestions) {
    if (byId.has(q.id)) {
      skipped += 1;
      continue;
    }
    byId.set(q.id, q);
    added += 1;
  }
  return {
    next: {
      questions: [...byId.values()],
      answers: current.answers.filter((a) => byId.has(a.questionId)),
      updatedAt: new Date().toISOString(),
    },
    added,
    skipped,
  };
}

/** 确保种子题存在（数据变化时补题，不删除已有题与回答） */
export function ensureSeedQuestions(current: QuizData, seeds: QuizQuestion[]): QuizData {
  return mergeCategoryQuestions(current, seeds).next;
}

export function setAnswer(data: QuizData, questionId: string, optionIndex: number | undefined, note?: string): QuizData {
  const others = data.answers.filter((a) => a.questionId !== questionId);
  const next: QuizAnswer[] = optionIndex === undefined ? others : [...others, { questionId, optionIndex, note }];
  return { ...data, answers: next, updatedAt: new Date().toISOString() };
}

export interface QuizProgress {
  total: number;
  answered: number;
  correctStatuses: Record<SelfStatus, number>;
  /** 未答的题（含明确"待确认"的） */
  unanswered: { id: string; question: string }[];
  /** 硬约束否决项（决策边界类答"不具备"） */
  hardBlocks: { id: string; question: string; why: string }[];
}

/** 答题进度 + 硬约束提取（确定性） */
export function computeQuizProgress(data: QuizData): QuizProgress {
  const statuses: Record<SelfStatus, number> = { have: 0, partial: 0, lack: 0, unknown: 0 };
  const unanswered: QuizProgress['unanswered'] = [];
  const hardBlocks: QuizProgress['hardBlocks'] = [];
  let answered = 0;

  for (const q of data.questions) {
    const a = data.answers.find((x) => x.questionId === q.id);
    const opt = a && a.optionIndex !== undefined ? q.options[a.optionIndex] : undefined;
    if (!opt) {
      unanswered.push({ id: q.id, question: q.question });
      continue;
    }
    answered += 1;
    statuses[opt.status] += 1;
    if (q.isBoundary && opt.status === 'lack') {
      hardBlocks.push({ id: q.id, question: q.question, why: opt.why });
    }
  }
  return { total: data.questions.length, answered, correctStatuses: statuses, unanswered, hardBlocks };
}

/**
 * 答题结果 → 自身能力映射（喂给适配度与赢的路径）。
 * - 需求题：直接给出该需求的 have/partial/lack/unknown；
 * - 边界题答"不具备"：置硬约束否决；
 * - "待确认"照实传给适配度（不纳入分母），不当作"能"。
 */
export function toOurCapabilityFromQuiz(data: QuizData): {
  byNeedId: Record<string, SelfStatus>;
  quizHardBlocked: boolean;
  quizHardNotes: string[];
} {
  const byNeedId: Record<string, SelfStatus> = {};
  const quizHardNotes: string[] = [];
  for (const q of data.questions) {
    const a = data.answers.find((x) => x.questionId === q.id);
    const opt = a && a.optionIndex !== undefined ? q.options[a.optionIndex] : undefined;
    if (!opt) continue;
    for (const needId of q.needIds ?? []) {
      const prev = byNeedId[needId];
      // 取更保守的结论：lack < partial < have；unknown 不覆盖已知结论
      if (!prev || rank(opt.status) < rank(prev)) byNeedId[needId] = opt.status;
    }
    if (q.isBoundary && opt.status === 'lack') quizHardNotes.push(`${q.question} → ${opt.why}`);
  }
  return { byNeedId, quizHardBlocked: quizHardNotes.length > 0, quizHardNotes };
}

function rank(s: SelfStatus): number {
  switch (s) {
    case 'lack':
      return 0;
    case 'partial':
      return 1;
    case 'have':
      return 2;
    default:
      return 3; // unknown 排最后：不覆盖已知结论
  }
}

/** 适配度用的答案表（questionId → status），"待确认"保留但会被公式排除在分母外 */
export function toAnswersForFit(data: QuizData): Record<string, SelfStatus> {
  const out: Record<string, SelfStatus> = {};
  for (const q of data.questions) {
    const a = data.answers.find((x) => x.questionId === q.id);
    const opt = a && a.optionIndex !== undefined ? q.options[a.optionIndex] : undefined;
    if (opt) out[q.id] = opt.status;
  }
  return out;
}
