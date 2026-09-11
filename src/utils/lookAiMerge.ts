// 五看「AI 起草」的非破坏性合并规则。
//
// 原则（PRD §4 原则 4 / §6.x）：AI 只做起草，**绝不覆盖人工已填内容**。
// 因此所有回填一律遵守：字段已有内容 → 跳过并记录；字段为空且 AI 给了内容 → 填入并记录。
// 这样即使用户先手填、后点「AI 重跑这一步」，也不会丢掉自己的判断。

import type { UnmetNeedCandidate, EvidenceStrength } from './userLook';

export interface MergeAcc {
  filled: string[];
  skipped: string[];
}

export function makeMergeAcc(): MergeAcc {
  return { filled: [], skipped: [] };
}

/** 文本字段：仅当原值为空且 AI 给了非空内容时填入 */
export function mergeText(existing: string, ai: unknown, label: string, acc: MergeAcc): string {
  const cur = String(existing ?? '').trim();
  const incoming = typeof ai === 'string' ? ai.trim() : '';
  if (cur) {
    acc.skipped.push(label);
    return existing;
  }
  if (!incoming) {
    acc.skipped.push(label);
    return existing;
  }
  acc.filled.push(label);
  return incoming;
}

/** 字符串数组：仅当原数组为空时整体采用 AI 结果（不做逐条拼贴，避免半人工半 AI 的混乱） */
export function mergeList(existing: string[], ai: unknown, label: string, acc: MergeAcc): string[] {
  const cur = Array.isArray(existing) ? existing.map((s) => String(s ?? '').trim()).filter(Boolean) : [];
  const incoming = Array.isArray(ai)
    ? ai.map((s) => String(s ?? '').trim()).filter(Boolean)
    : [];
  if (cur.length > 0) {
    acc.skipped.push(label);
    return existing;
  }
  if (incoming.length === 0) {
    acc.skipped.push(label);
    return existing;
  }
  acc.filled.push(`${label}（${incoming.length} 条）`);
  return incoming;
}

function normalizeStrength(v: unknown): EvidenceStrength {
  const s = String(v ?? '').toLowerCase();
  return s === 'high' || s === 'medium' || s === 'low' ? (s as EvidenceStrength) : 'medium';
}

/**
 * 未满足需求候选：**仅当现有候选为空时**才采用 AI 的候选列表。
 * 只要用户已经写过任何一条候选，就完全不覆盖（避免把人工判断冲掉）。
 */
export function mergeUnmetNeedCandidates(
  existing: UnmetNeedCandidate[],
  ai: unknown,
  makeId: () => string,
  label: string,
  acc: MergeAcc
): UnmetNeedCandidate[] {
  const cur = Array.isArray(existing) ? existing : [];
  const rows = Array.isArray(ai) ? (ai as Record<string, unknown>[]) : [];
  const incoming: UnmetNeedCandidate[] = rows
    .map((r) => ({
      id: makeId(),
      targetUser: String(r?.targetUser ?? '').trim(),
      scenario: String(r?.scenario ?? '').trim(),
      jobToBeDone: String(r?.jobToBeDone ?? '').trim(),
      needStatement: String(r?.needStatement ?? '').trim(),
      currentAlternative: String(r?.currentAlternative ?? '').trim(),
      evidenceStrength: normalizeStrength(r?.evidenceStrength),
    }))
    .filter((c) => c.needStatement.length > 0);

  if (cur.length > 0) {
    acc.skipped.push(label);
    return existing;
  }
  if (incoming.length === 0) {
    acc.skipped.push(label);
    return existing;
  }
  acc.filled.push(`${label}（${incoming.length} 条，AI 候选，请逐条核对）`);
  return incoming;
}

/** 人类可读的合并结果说明（用于 toast） */
export function describeMerge(acc: MergeAcc): string {
  const f = acc.filled.length ? `新增：${acc.filled.join('、')}` : '没有可新增的字段';
  const s = acc.skipped.length ? `；保留原内容：${acc.skipped.join('、')}` : '';
  return f + s;
}
