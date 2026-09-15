// 「看自己」V3 · 拍板问题（PRD §6.4-2）。
//
// 为什么从"5-8 道品类选择题"砍成 **3 道**（用户诉求:"有了背景信息，再针对性回答3个问题就行了吗，不要问这么多了"）：
// 背景信息（设置 → 背景信息）已经把"能不能做"的大部分输入变成了选择题，而且这些结论现在是**确定性推导**出来的
// （见 capabilityDerivation.ts）。再问一遍"这条需求你能不能接住"就是重复劳动。
// 剩下的只有一类问题**背景信息答不了、但决定拍板**——决策边界：
//
//   ① 最低毛利率：赢的路径里"人优我廉"必须在毛利红线内成立（§6.3），红线是机会卡利润假设的分母；
//   ② 止损条件  ：控制点里的"止损控制点"要它，没有止损线就没有下行保护；
//   ③ 必须满足的进入条件：准入控制点要它，而且**只有它能把背景信息变成硬约束**
//      （例：你要求"认证齐备"，但背景信息=暂无 ⇒ 硬约束 ⇒ 机会最高只能"验证后进入"）。
//
// 三题都是 `isBoundary: true`：决策边界类答"不具备" ⇒ 关联机会不能"直接进入"（§6.4 硬约束否决）。
// 出题仍然确定性：选项的四态由**背景信息推导结果**算出（Q3 尤其明显），每个选项都带"为什么不"，
// 每题带"为什么问"（basis）。AI 只被允许**增补**题目（normalizeAiQuestions），永不自造结论。

import type { SelfAssessmentItem, SelfStatus } from './selfAssessment';
import { boundaryItemId } from './selfAssessment';
import { deriveCapabilities, type DerivedCapability } from './capabilityDerivation';
import type { UserBackgroundProfile } from './userBackground';

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
  /** 该选项映射的自身状态（适配度 / 硬约束用） */
  status: SelfStatus;
  /** 为什么不选/选它的含义（PRD 要求每个选项旁给"为什么不"） */
  why: string;
  /** 可选：这个选项携带的数值口径（如最低毛利率红线），供下游确定性使用 */
  floorPercent?: number;
  /** 可选：这个选项对应的"进入条件"键（Q3 多选用） */
  conditionKey?: string;
  /** 多选里与其它选项互斥（如"还没定"）：选中它就清掉其它 */
  exclusive?: boolean;
}

export interface QuizQuestion {
  id: string;
  category: QuizCategory;
  question: string;
  /** 这题为什么问（依据） */
  basis: string;
  options: QuizOption[];
  /** 关联的需求（AI 增补题可挂；这 3 道拍板题不挂） */
  needIds?: string[];
  /** 是否"决策边界"：答不具备 → 硬约束否决（不可直接进入） */
  isBoundary?: boolean;
  /** 是否多选（Q3 必须满足的进入条件） */
  multiple?: boolean;
  /** 来源：确定性拍板题 / AI 增补 */
  origin: 'seed' | 'ai';
}

export interface QuizAnswer {
  questionId: string;
  /** 单选：选中的选项下标；undefined = 未答 */
  optionIndex?: number;
  /** 多选：选中的选项下标集合 */
  optionIndexes?: number[];
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

/* ────────────────────────── 3 个拍板问题（确定性） ────────────────────────── */

export type DecisionQuestionKey = 'margin_floor' | 'stop_loss' | 'entry_conditions';

export interface DecisionQuestionSpec {
  key: DecisionQuestionKey;
  id: string;
  category: QuizCategory;
  /** 决策边界项的 label（进 SelfAssessmentItem.label，硬约束文案里会用到） */
  label: string;
  question: string;
  basis: string;
  multiple?: boolean;
}

export const DECISION_QUESTIONS: DecisionQuestionSpec[] = [
  {
    key: 'margin_floor',
    id: 'decision:margin_floor',
    category: 'finance',
    label: '最低毛利率',
    question: '这个品类的目标售价下，你必须达到的最低毛利率是多少？',
    basis:
      '赢的路径里「人优我廉」必须在毛利红线内成立（PRD §6.3）；红线同时是机会卡利润假设与止损控制点的分母。背景信息只能给出预算规模，给不出你的红线。',
  },
  {
    key: 'stop_loss',
    id: 'decision:stop_loss',
    category: 'risk',
    label: '止损条件',
    question: '这个项目你打算用什么条件止损？',
    basis:
      '机会卡的「止损控制点」必须由你拍板（AI 只起草）。没有止损线时，亏损没有上限，硬约束按"决策边界不具备"处理。',
  },
  {
    key: 'entry_conditions',
    id: 'decision:entry_conditions',
    category: 'boundary',
    label: '必须满足的进入条件',
    question: '必须先满足哪些条件，这个机会才允许「直接进入」？（可多选）',
    basis:
      '这些条件就是机会卡的「准入控制点」。选项的满足情况**由你的背景信息确定性推导**（例：背景里认证=暂无，「认证齐备」这一条现在就不满足）→ 选中不满足的条件会触发硬约束：最高只能"验证后进入"。',
    multiple: true,
  },
];

/** 进入条件的口径（Q3 选项 = 条件 × 由背景信息推出的满足情况） */
const ENTRY_CONDITIONS: { conditionKey: string; label: string; capabilityKey: string; why: string }[] = [
  { conditionKey: 'cert_ready', label: '认证齐备', capabilityKey: 'certification', why: '认证是跨类目硬约束：缺它连上架都过不去。' },
  { conditionKey: 'margin_ge_floor', label: '毛利达到我定的红线', capabilityKey: 'gross_margin', why: '达不到红线的路径直接不成立（§6.3 人优我廉）。' },
  { conditionKey: 'moq_in_budget', label: 'MOQ 在预算内', capabilityKey: 'moq', why: 'MOQ 超标会一次性吃掉全部预算，属于硬约束。' },
  { conditionKey: 'deliver_60d', label: '60 天内能交付', capabilityKey: 'lead_time', why: '交付超过 60 天通常错过窗口期。' },
  { conditionKey: 'differentiated_supply', label: '有差异化供给', capabilityKey: 'factory', why: '「人无我有」的前提是供给端真能做出来。' },
  { conditionKey: 'no_patent_risk', label: '没有专利风险', capabilityKey: 'patent', why: '踩专利会让整个 Listing 下架，属于否决项。' },
];

/**
 * 确定性生成 3 个拍板问题。
 * Q3 的每个选项都带**由背景信息推出的满足状态**（unknown 表示背景信息判断不了，不是"不具备"）。
 */
export function buildDecisionQuestions(input?: {
  background?: UserBackgroundProfile | null;
  /** 已经算好的推导结果（避免重复计算）；不传则按 background 现算 */
  capabilityEntries?: DerivedCapability[];
}): QuizQuestion[] {
  const derived = input?.capabilityEntries ?? deriveCapabilities(input?.background);
  const statusOf = (capabilityKey: string): DerivedCapability | undefined =>
    derived.find((d) => d.key === capabilityKey);

  return DECISION_QUESTIONS.map((spec) => {
    if (spec.key === 'margin_floor') {
      return {
        id: spec.id,
        category: spec.category,
        question: spec.question,
        basis: spec.basis,
        isBoundary: true,
        origin: 'seed' as const,
        options: [
          { label: 'A. ≥40%（留足广告与退货容错）', status: 'have' as SelfStatus, floorPercent: 0.4, why: '广告、退货、仓储都会吃掉毛利，40% 以上才有容错空间。' },
          { label: 'B. 30%-40%', status: 'have' as SelfStatus, floorPercent: 0.3, why: '行业常见区间，能支撑正常广告与促销节奏。' },
          { label: 'C. 20%-30%', status: 'partial' as SelfStatus, floorPercent: 0.2, why: '偏薄：任何一次涨价、退货率上升或广告超支都会击穿。' },
          { label: 'D. 20% 以下', status: 'partial' as SelfStatus, floorPercent: 0.15, why: '红线过低，要么供应链有绝对成本优势，要么在赌；"人优我廉"会变得极脆弱。' },
          { label: 'E. 还没定', status: 'lack' as SelfStatus, why: '没有毛利红线就无法判定"人优我廉"、也无法设止损控制点 → 只能"验证后进入"。' },
        ],
      };
    }
    if (spec.key === 'stop_loss') {
      return {
        id: spec.id,
        category: spec.category,
        question: spec.question,
        basis: spec.basis,
        isBoundary: true,
        origin: 'seed' as const,
        options: [
          { label: 'A. 时间 + 亏损都写清了（双条件）', status: 'have' as SelfStatus, why: '最常见也最有效：时间到或亏损到，任一触发即撤。' },
          { label: 'B. 只看亏损额（或只看时间）', status: 'partial' as SelfStatus, why: '单条件会失效：还没亏完但已经耗太久，或还没到时间但已经亏穿。' },
          { label: 'C. 还没定', status: 'lack' as SelfStatus, why: '没有止损线就没有下行保护；按 §6.4 属于决策边界不具备 → 不能"直接进入"。' },
        ],
      };
    }

    // Q3：多选；每个选项的满足状态由背景信息推导
    const options: QuizOption[] = ENTRY_CONDITIONS.map((c) => {
      const d = statusOf(c.capabilityKey);
      const status: SelfStatus = d?.status ?? 'unknown';
      const basisText =
        status === 'unknown'
          ? `背景信息判断不了（${d?.reason ?? '缺少对应字段'}）`
          : `${d?.reason ?? ''}`;
      return {
        label: c.label,
        status,
        conditionKey: c.conditionKey,
        why: `${c.why} 依据你的背景信息：${basisText}`,
      };
    });
    options.push({
      label: 'D. 还没定（先不设进入条件）',
      status: 'lack',
      exclusive: true,
      why: '进入条件还没定就无法判断"能不能直接进入"；按 §6.4 视为决策边界不具备（最高只能"验证后进入"）。',
    });
    return {
      id: spec.id,
      category: spec.category,
      question: spec.question,
      basis: spec.basis,
      isBoundary: true,
      multiple: true,
      origin: 'seed' as const,
      options,
    };
  });
}

/* ────────────────────────── 读取答案（确定性） ────────────────────────── */

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

/** 最保守的状态（lack < partial < have < unknown，unknown 不覆盖已知结论） */
export function mostConservative(statuses: SelfStatus[]): SelfStatus {
  if (statuses.length === 0) return 'unknown';
  return statuses.reduce((acc, s) => (rank(s) < rank(acc) ? s : acc), statuses[0]);
}

/** 选中了哪些选项（单选 / 多选统一口径；多选也容忍只有 optionIndex 的旧写法） */
export function selectedOptions(q: QuizQuestion, a: QuizAnswer | undefined): QuizOption[] {
  if (!a) return [];
  if (q.multiple) {
    const idx = Array.isArray(a.optionIndexes)
      ? a.optionIndexes
      : a.optionIndex !== undefined
        ? [a.optionIndex]
        : [];
    return idx.map((i) => q.options[i]).filter((o): o is QuizOption => Boolean(o));
  }
  const opt = a.optionIndex !== undefined ? q.options[a.optionIndex] : undefined;
  return opt ? [opt] : [];
}

/** 某道题当前的结论状态（未答 = unknown） */
export function questionStatus(q: QuizQuestion, a: QuizAnswer | undefined): SelfStatus {
  const opts = selectedOptions(q, a);
  if (opts.length === 0) return 'unknown';
  return mostConservative(opts.map((o) => o.status));
}

/** Q1 的答案带来多少毛利红线（没答 / 选"还没定" → undefined，绝不猜） */
export function marginFloorFromQuiz(quiz: QuizData | undefined): number | undefined {
  const data = quiz ?? defaultQuizData();
  const q = data.questions.find((x) => x.id === 'decision:margin_floor');
  if (!q) return undefined;
  const a = data.answers.find((x) => x.questionId === q.id);
  const opt = selectedOptions(q, a)[0];
  return opt?.floorPercent;
}

/** Q2 的答案文本（进机会卡止损控制点的起草） */
export function stopLossAnswerText(quiz: QuizData | undefined): string | undefined {
  const data = quiz ?? defaultQuizData();
  const q = data.questions.find((x) => x.id === 'decision:stop_loss');
  if (!q) return undefined;
  const a = data.answers.find((x) => x.questionId === q.id);
  const opt = selectedOptions(q, a)[0];
  if (!opt) return undefined;
  const note = (a?.note ?? '').trim();
  return note ? `${opt.label}；补充：${note}` : opt.label;
}

/** Q3 选中的进入条件条件键 */
export function entryConditionsFromQuiz(quiz: QuizData | undefined): string[] {
  const data = quiz ?? defaultQuizData();
  const q = data.questions.find((x) => x.id === 'decision:entry_conditions');
  if (!q) return [];
  const a = data.answers.find((x) => x.questionId === q.id);
  return selectedOptions(q, a)
    .map((o) => o.conditionKey)
    .filter((k): k is string => Boolean(k));
}

export function answerNote(quiz: QuizData | undefined): string | undefined {
  const data = quiz ?? defaultQuizData();
  const notes = data.answers.map((a) => (a.note ?? '').trim()).filter(Boolean);
  return notes.length > 0 ? notes.join('；') : undefined;
}

/* ────────────────────────── 答案 → 决策边界项 ────────────────────────── */

/**
 * 3 个拍板问题的答案 → 决策边界项（`SelfAssessmentItem[]`）。
 * 这是**唯一的**自评项来源：42 项四态确认被这 3 项替代，下游（硬约束 / 赢的路径 / 决策草稿）读取路径不变。
 */
export function boundaryItemsFromQuiz(quiz: QuizData | undefined): SelfAssessmentItem[] {
  const data = quiz ?? defaultQuizData();
  return DECISION_QUESTIONS.map((spec) => {
    const q = data.questions.find((x) => x.id === spec.id);
    if (!q) {
      return {
        id: boundaryItemId(spec.key),
        category: 'boundary' as const,
        label: spec.label,
        status: 'unknown' as SelfStatus,
        note: '',
      };
    }
    const a = data.answers.find((x) => x.questionId === q.id);
    const opts = selectedOptions(q, a);
    if (opts.length === 0) {
      return {
        id: boundaryItemId(spec.key),
        category: 'boundary' as const,
        label: spec.label,
        status: 'unknown' as SelfStatus,
        note: '',
      };
    }
    const status = mostConservative(opts.map((o) => o.status));
    const detail = opts.map((o) => o.label).join(' + ');
    const note = (a?.note ?? '').trim();
    return {
      id: boundaryItemId(spec.key),
      category: 'boundary' as const,
      label: spec.label,
      status,
      note: note ? `${detail}（${note}）` : detail,
    };
  });
}

/* ────────────────────────── AI 增补（可选逃生通道） ────────────────────────── */

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
 * 合并题目（非破坏性）：同 id 不覆盖，AI 题按 id 追加；**已有回答永远保留**
 * （AI 重跑不会清掉用户答过的题）。规则：种子题为准，AI 永远不能覆盖种子题或用户回答。
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

/** 确保题目存在（数据变化时补题，不删除已有题与回答）——AI 增补路径用 */
export function ensureSeedQuestions(current: QuizData, seeds: QuizQuestion[]): QuizData {
  return mergeCategoryQuestions(current, seeds).next;
}

/**
 * 刷新 3 个拍板题：**选项里的"满足情况"随背景信息变化而更新**（例：后来补了 CE 认证，
 * "认证齐备"这一条就从"不具备"变成"已具备"），同时保留用户的答案与 AI 增补题。
 *
 * 为什么必须刷新：选项的四态是背景信息推导出来的，背景一变就必须跟着变——否则用户会看到过期的硬约束结论。
 * 为什么安全：选项顺序由 DECISION_QUESTIONS 固定（测试守卫），所以下标语义不变，答案不会被错位。
 */
export function refreshDecisionQuestions(current: QuizData, fresh: QuizQuestion[]): QuizData {
  const freshById = new Map(fresh.map((q) => [q.id, q]));
  const questions: QuizQuestion[] = current.questions.map((q) => {
    const f = freshById.get(q.id);
    // 只刷新种子题；AI 题与用户自己确认过的题一律不动
    if (!f || q.origin !== 'seed') return q;
    return { ...f, origin: 'seed' as const };
  });
  for (const f of fresh) {
    if (!questions.some((q) => q.id === f.id)) questions.push(f);
  }
  const answers = current.answers.filter((a) => {
    const q = questions.find((x) => x.id === a.questionId);
    if (!q) return false;
    if (q.multiple) {
      const idx = Array.isArray(a.optionIndexes) ? a.optionIndexes : [];
      return idx.length > 0 && idx.every((i) => i >= 0 && i < q.options.length);
    }
    return a.optionIndex === undefined || (a.optionIndex >= 0 && a.optionIndex < q.options.length);
  });
  return { questions, answers, updatedAt: new Date().toISOString() };
}

/* ────────────────────────── 答题 / 统计 ────────────────────────── */

export function setAnswer(data: QuizData, questionId: string, optionIndex: number | undefined, note?: string): QuizData {
  const others = data.answers.filter((a) => a.questionId !== questionId);
  const next: QuizAnswer[] =
    optionIndex === undefined ? others : [...others, { questionId, optionIndex, note }];
  return { ...data, answers: next, updatedAt: new Date().toISOString() };
}

/**
 * 只改某题的回答备注（"止损条件可补充"用）。
 * 还没有回答时也会建一条"有备注、没选项"的回答（备注不丢），它不算已答（selectedOptions 为空）。
 */
export function setAnswerNote(data: QuizData, questionId: string, note: string): QuizData {
  const existing = data.answers.find((a) => a.questionId === questionId);
  const others = data.answers.filter((a) => a.questionId !== questionId);
  const next: QuizAnswer[] = [
    ...others,
    { questionId, optionIndex: existing?.optionIndex, optionIndexes: existing?.optionIndexes, note },
  ];
  return { ...data, answers: next, updatedAt: new Date().toISOString() };
}

/** 多选：整组替换（空数组 = 取消回答） */
export function setAnswerMulti(data: QuizData, questionId: string, optionIndexes: number[], note?: string): QuizData {
  const others = data.answers.filter((a) => a.questionId !== questionId);
  const clean = [...new Set(optionIndexes)].filter((i) => i >= 0).sort((a, b) => a - b);
  const next: QuizAnswer[] =
    clean.length === 0 ? others : [...others, { questionId, optionIndexes: clean, note }];
  return { ...data, answers: next, updatedAt: new Date().toISOString() };
}

/** 切换多选里的某一个选项（互斥规则：选"还没定"时清掉其它条件） */
export function toggleMultiAnswer(data: QuizData, questionId: string, optionIndex: number): QuizData {
  const q = data.questions.find((x) => x.id === questionId);
  if (!q) return data;
  const a = data.answers.find((x) => x.questionId === questionId);
  const current = Array.isArray(a?.optionIndexes) ? a!.optionIndexes! : [];
  const exclusiveIdx = q.options.findIndex((o) => o.exclusive === true);
  let nextIdx: number[];
  if (current.includes(optionIndex)) {
    nextIdx = current.filter((i) => i !== optionIndex);
  } else if (exclusiveIdx === optionIndex) {
    nextIdx = [optionIndex];
  } else {
    nextIdx = [...current.filter((i) => i !== exclusiveIdx), optionIndex];
  }
  return setAnswerMulti(data, questionId, nextIdx, a?.note);
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
    const opts = selectedOptions(q, a);
    if (opts.length === 0) {
      unanswered.push({ id: q.id, question: q.question });
      continue;
    }
    answered += 1;
    statuses[mostConservative(opts.map((o) => o.status))] += 1;
    if (q.isBoundary) {
      const lacking = opts.find((o) => o.status === 'lack');
      if (lacking) hardBlocks.push({ id: q.id, question: q.question, why: lacking.why });
    }
  }
  return { total: data.questions.length, answered, correctStatuses: statuses, unanswered, hardBlocks };
}

/**
 * 答题结果 → 自身能力映射（喂给适配度与赢的路径）。
 * - 需求题（AI 增补）：直接给出该需求的 have/partial/lack/unknown；
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
    const opts = selectedOptions(q, a);
    if (opts.length === 0) continue;
    const status = mostConservative(opts.map((o) => o.status));
    for (const needId of q.needIds ?? []) {
      const prev = byNeedId[needId];
      // 取更保守的结论：lack < partial < have；unknown 不覆盖已知结论
      if (!prev || rank(status) < rank(prev)) byNeedId[needId] = status;
    }
    if (q.isBoundary) {
      const lacking = opts.find((o) => o.status === 'lack');
      if (lacking) quizHardNotes.push(`${q.question} → ${lacking.why}`);
    }
  }
  return { byNeedId, quizHardBlocked: quizHardNotes.length > 0, quizHardNotes };
}

/** 适配度用的答案表（questionId → status），"待确认"保留但会被公式排除在分母外 */
export function toAnswersForFit(data: QuizData): Record<string, SelfStatus> {
  const out: Record<string, SelfStatus> = {};
  for (const q of data.questions) {
    const a = data.answers.find((x) => x.questionId === q.id);
    const opts = selectedOptions(q, a);
    if (opts.length > 0) out[q.id] = mostConservative(opts.map((o) => o.status));
  }
  return out;
}
