// 五看「AI 起草」的每看回填适配层（M1）。
//
// 为什么单独抽出来：四个看原本各自在组件里写回填逻辑，一键向导（LookWizardPanel）也需要同一套合并，
// 因此把「AI 输出 → 各看数据结构」的映射收敛到这里，组件与向导共用，避免两份逻辑漂移。
//
// 所有合并都走 lookAiMerge 的非破坏性规则：**只填空字段，绝不覆盖人工已填内容**。

import { makeMergeAcc, mergeText, mergeList, mergeUnmetNeedCandidates, type MergeAcc } from './lookAiMerge';
import { createUnmetNeedId, type UserLookData, type SearchPath, type SearchPreference, type SearchPathLayerId } from './userLook';
import type { MarketLookData } from './marketLook';
import type { CompetitorLookData } from './competitorLook';
import type { SelfAssessment, SelfAiDraft } from './selfAssessment';
import { mergeCategoryQuestions, normalizeAiQuestions } from './categoryQuiz';

/** 搜索路径的固定四层顺序（M2 · 看用户 V2） */
const SEARCH_PATH_LAYER_IDS: SearchPathLayerId[] = ['awareness', 'consideration', 'decision', 'scenario'];

/**
 * 归一化 AI 返回的搜索路径（AI 输出不可信，必须逐字段校验）：
 * - 固定按 awareness → consideration → decision → scenario 四层输出
 * - 词必须非空；share 夹到 0-1；每层最多 12 个词
 * - 一层都没有 → 视为无效，返回 null（不污染已有数据）
 */
export function normalizeSearchPath(raw: unknown): SearchPath | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { summary?: unknown; layers?: unknown };
  const layersRaw = Array.isArray(r.layers) ? (r.layers as Record<string, unknown>[]) : [];

  const layers: SearchPath['layers'] = [];
  for (const id of SEARCH_PATH_LAYER_IDS) {
    const found = layersRaw.find((l) => l && String(l.layer ?? '').toLowerCase().trim() === id);
    const wordsRaw = found && Array.isArray(found.words) ? (found.words as Record<string, unknown>[]) : [];
    const words = wordsRaw
      .map((w) => {
        const vol = Number(w?.volume);
        const share = Number(w?.share);
        return {
          word: String(w?.word ?? '').trim(),
          volume: Number.isFinite(vol) && vol > 0 ? Math.round(vol) : undefined,
          share: Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : undefined,
        };
      })
      .filter((w) => w.word.length > 0)
      .slice(0, 12);
    if (words.length > 0) {
      layers.push({
        layer: id,
        words,
        note: found && typeof found.note === 'string' && found.note.trim() ? found.note.trim() : undefined,
      });
    }
  }
  if (layers.length === 0) return null;
  return {
    summary: typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim() : undefined,
    layers,
    updatedAt: new Date().toISOString(),
  };
}

/** 归一化 AI 返回的搜索偏好卡；全部字段无效则返回 null */
export function normalizeSearchPreference(raw: unknown): SearchPreference | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ps = String(r.priceSensitivity ?? '').toLowerCase().trim();
  const priceSensitivity = ps === 'low' || ps === 'medium' || ps === 'high' ? (ps as 'low' | 'medium' | 'high') : undefined;
  const noteRaw = typeof r.priceSensitivityNote === 'string' ? r.priceSensitivityNote.trim() : '';
  const attrRaw = typeof r.attributeMix === 'string' ? r.attributeMix.trim() : '';
  const lts = Number(r.longTailShare);
  const longTailShare = Number.isFinite(lts) ? Math.min(1, Math.max(0, lts)) : undefined;
  const decisionFocus = Array.isArray(r.decisionFocus)
    ? r.decisionFocus.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 6)
    : undefined;

  if (!priceSensitivity && !noteRaw && !attrRaw && longTailShare === undefined && !decisionFocus?.length) {
    return null;
  }
  return {
    priceSensitivity,
    priceSensitivityNote: noteRaw || undefined,
    attributeMix: attrRaw || undefined,
    longTailShare,
    decisionFocus: decisionFocus?.length ? decisionFocus : undefined,
    updatedAt: new Date().toISOString(),
  };
}

export interface MergeResult<T> {
  next: T;
  filled: string[];
  skipped: string[];
}

export function mergeUserLookAi(data: UserLookData, out: Record<string, unknown>): MergeResult<UserLookData> {
  const acc = makeMergeAcc();

  // M2：搜索路径图 / 搜索偏好卡 —— 只有当前为空时才采用 AI 结果（同样不覆盖人工内容）
  const aiPath = normalizeSearchPath(out.searchPath);
  const aiPref = normalizeSearchPreference(out.searchPreference);
  let searchPath = data.searchPath;
  if (Array.isArray(data.searchPath?.layers) && data.searchPath!.layers.length > 0) {
    acc.skipped.push('搜索路径图');
  } else if (aiPath) {
    searchPath = aiPath;
    acc.filled.push(`搜索路径图（${aiPath.layers.length} 层）`);
  } else {
    acc.skipped.push('搜索路径图');
  }

  let searchPreference = data.searchPreference;
  const prefFilled = data.searchPreference
    ? Object.keys(data.searchPreference).filter((k) => k !== 'updatedAt').length > 0
    : false;
  if (prefFilled) {
    acc.skipped.push('搜索偏好卡');
  } else if (aiPref) {
    searchPreference = aiPref;
    acc.filled.push('搜索偏好卡');
  } else {
    acc.skipped.push('搜索偏好卡');
  }

  const next: UserLookData = {
    ...data,
    targetUser: mergeText(data.targetUser, out.targetUser, '目标用户', acc),
    scenario: mergeText(data.scenario, out.scenario, '使用场景', acc),
    jobToBeDone: mergeText(data.jobToBeDone, out.jobToBeDone, '用户任务 / JTBD', acc),
    satisfiedNeeds: mergeList(data.satisfiedNeeds, out.satisfiedNeeds, '已满足需求', acc),
    unmetNeedCandidates: mergeUnmetNeedCandidates(
      data.unmetNeedCandidates,
      out.unmetNeedCandidates,
      createUnmetNeedId,
      '未满足需求候选',
      acc
    ),
    searchPath,
    searchPreference,
  };
  return { next, filled: acc.filled, skipped: acc.skipped };
}

export function mergeMarketLookAi(data: MarketLookData, out: Record<string, unknown>): MergeResult<MarketLookData> {
  const acc = makeMergeAcc();
  const next: MarketLookData = {
    ...data,
    attractiveness: mergeText(data.attractiveness, out.attractiveness, '市场吸引力判断', acc),
    keyEvidences: mergeList(data.keyEvidences, out.keyEvidences, '关键证据', acc),
    risks: mergeList(data.risks, out.risks, '主要风险', acc),
    openQuestions: mergeList(data.openQuestions, out.openQuestions, '待验证问题', acc),
    segmentAdvice: mergeText(data.segmentAdvice ?? '', out.segmentAdvice, '细分方案解释', acc),
  };
  return { next, filled: acc.filled, skipped: acc.skipped };
}

export function mergeCompetitorLookAi(
  data: CompetitorLookData,
  out: Record<string, unknown>
): MergeResult<CompetitorLookData> {
  const acc = makeMergeAcc();
  const next: CompetitorLookData = {
    ...data,
    samplePool: mergeList(data.samplePool, out.samplePool, '竞品样本池', acc),
    benchmarkAsins: mergeList(data.benchmarkAsins, out.benchmarkAsins, '标杆 ASIN', acc),
    barriers: mergeText(data.barriers, out.barriers, '竞争壁垒与经营能力', acc),
    needMatrix: mergeText(data.needMatrix, out.needMatrix, '需求满足矩阵', acc),
    gaps: mergeList(data.gaps, out.gaps, '未充分满足的产品缺口', acc),
    winningPathExplain: mergeText(data.winningPathExplain ?? '', out.winningPathExplain, '赢的路径解释', acc),
  };
  return { next, filled: acc.filled, skipped: acc.skipped };
}

/** 看自己：AI 只写 aiDraft，绝不改动 items 里的人工自评；M3⑤ 额外并入 AI 增补的品类选择题（不覆盖已有题与回答） */
export function mergeSelfAi(assessment: SelfAssessment, out: Record<string, unknown>): MergeResult<SelfAssessment> {
  const acc = makeMergeAcc();
  const cur: SelfAiDraft = assessment.aiDraft ?? {};
  const aiDraft: SelfAiDraft = {
    conclusion: mergeText(cur.conclusion ?? '', out.conclusion, '适配度总体判断', acc),
    strengths: mergeList(cur.strengths ?? [], out.strengths, '自身优势', acc),
    gaps: mergeList(cur.gaps ?? [], out.gaps, '能力缺口', acc),
    hardConstraints: mergeList(cur.hardConstraints ?? [], out.hardConstraints, '硬约束与止损边界', acc),
    fitAssessment: mergeText(cur.fitAssessment ?? '', out.fitAssessment, '对机会卡的适配度评价', acc),
    updatedAt: new Date().toISOString(),
  };
  // M3⑤：AI 增补品类选择题（结构校验后按 id 追加，用户已答的题与答案永不丢失）
  const aiQuiz = normalizeAiQuestions(out.quizQuestions ?? out.questions);
  let quiz = assessment.quiz ?? { questions: [], answers: [], updatedAt: new Date().toISOString() };
  if (aiQuiz.length > 0) {
    const r = mergeCategoryQuestions(quiz, aiQuiz);
    quiz = r.next;
    if (r.added > 0) acc.filled.push(`品类选择题（AI 增补 ${r.added} 题，请逐题核对依据）`);
    if (r.skipped > 0) acc.skipped.push('品类选择题（已有同题，保留原题）');
  }
  return { next: { ...assessment, aiDraft, quiz }, filled: acc.filled, skipped: acc.skipped };
}

/** 把「看自己」已作答项整理成 AI 可读的问答对（未作答项不传，避免 AI 凭空判断） */
export function buildSelfAnswers(
  assessment: SelfAssessment,
  categoryLabels: Record<string, string>,
  statusLabels: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const it of assessment.items) {
    if (it.status === 'unknown') continue;
    const label = `${categoryLabels[it.category] ?? it.category}·${it.label}`;
    out[label] = `${statusLabels[it.status] ?? it.status}${it.note?.trim() ? `；${it.note.trim()}` : ''}`;
  }
  return out;
}
