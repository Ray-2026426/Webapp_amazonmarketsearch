// 证据对象（M1 · PRD §7.3）。
//
// 解决的问题（断链 #5）：各看此前只捕获"元数据快照"（样本数/来源/时间），
// evidenceIds 全为空 —— 用户看到"证据 12 条"却点不回任何原始来源，机会卡也引用不到证据。
//
// 现在：每次「捕获为项目证据」都会生成一条**结构化 Evidence**，带
//   look（属于哪一看）+ type（关键词/评论/图表/ASIN/自评/报告）
//   + sourceRef（可定位到原始来源，如 kw:表#12 / review:B0XXX#34 / chart:价格带@细分）
//   + summary（一句话人话摘要）
// 机会卡将引用 Evidence id 列表；「证据可信度」只认 Evidence，不认页面完成度。

import { get, set } from 'idb-keyval';

export type EvidenceLook = 'user' | 'market' | 'competitor' | 'self' | 'opportunity';
export type EvidenceType = 'keyword' | 'review' | 'chart' | 'asin' | 'assessment' | 'report';

export interface Evidence {
  id: string;
  projectId: string;
  look: EvidenceLook;
  type: EvidenceType;
  /** 可定位到原始来源的引用串 */
  sourceRef: string;
  /** 一句话人话摘要 */
  summary: string;
  createdAt: string;
}

export const EVIDENCE_LOOK_LABELS: Record<EvidenceLook, string> = {
  user: '看用户',
  market: '看市场',
  competitor: '看竞对',
  self: '看自己',
  opportunity: '看机会',
};

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  keyword: '关键词',
  review: '评论',
  chart: '图表',
  asin: 'ASIN',
  assessment: '自评',
  report: '报告',
};

/** 单个项目最多保留的证据条数（防止无限增长） */
export const MAX_EVIDENCE = 200;

export function makeEvidenceId(now: Date = new Date()): string {
  return `ev_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface EvidenceInput {
  projectId: string;
  look: EvidenceLook;
  type: EvidenceType;
  sourceRef: string;
  summary: string;
}

export function buildEvidence(input: EvidenceInput, now: Date = new Date()): Evidence {
  return {
    id: makeEvidenceId(now),
    projectId: input.projectId,
    look: input.look,
    type: input.type,
    sourceRef: String(input.sourceRef || '').trim(),
    summary: String(input.summary || '').trim(),
    createdAt: now.toISOString(),
  };
}

/**
 * 合并证据列表（纯函数，便于测试）：
 * - 同 sourceRef 视为同一条证据 → 用新的一条替换旧的（更新摘要与时间，避免重复堆积）
 * - 最新的排在最前
 * - 超过 MAX_EVIDENCE 时截断
 */
export function mergeEvidenceList(existing: Evidence[], incoming: Evidence): Evidence[] {
  const rest = (Array.isArray(existing) ? existing : []).filter((e) => e.sourceRef !== incoming.sourceRef);
  return [incoming, ...rest].slice(0, MAX_EVIDENCE);
}

/** 统计：按看分组计数（用于 UI 概览） */
export function countEvidenceByLook(list: Evidence[]): Record<EvidenceLook, number> {
  const out: Record<EvidenceLook, number> = { user: 0, market: 0, competitor: 0, self: 0, opportunity: 0 };
  for (const e of Array.isArray(list) ? list : []) {
    if (e && out[e.look] !== undefined) out[e.look] += 1;
  }
  return out;
}

export function describeEvidence(e: Evidence): string {
  return `${EVIDENCE_LOOK_LABELS[e.look] ?? e.look} · ${EVIDENCE_TYPE_LABELS[e.type] ?? e.type} · ${e.summary}${
    e.sourceRef ? `（来源：${e.sourceRef}）` : ''
  }`;
}

const KEY_PREFIX = 'kairo_evidence:';

function storageKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

export async function loadEvidence(userId: string, projectId: string): Promise<Evidence[]> {
  try {
    const raw = await get<Evidence[]>(storageKey(userId, projectId));
    if (Array.isArray(raw)) return raw.filter((e) => e && typeof e.id === 'string');
  } catch {
    /* ignore */
  }
  return [];
}

export async function saveEvidence(userId: string, projectId: string, list: Evidence[]): Promise<void> {
  await set(storageKey(userId, projectId), list.slice(0, MAX_EVIDENCE));
}

/** 追加一条证据（按 sourceRef 去重），返回最新的完整列表 */
export async function addEvidence(
  userId: string,
  projectId: string,
  input: Omit<EvidenceInput, 'projectId'>,
  now: Date = new Date()
): Promise<Evidence[]> {
  const existing = await loadEvidence(userId, projectId);
  const next = mergeEvidenceList(existing, buildEvidence({ ...input, projectId }, now));
  await saveEvidence(userId, projectId, next);
  return next;
}

export async function removeEvidence(userId: string, projectId: string, id: string): Promise<Evidence[]> {
  const existing = await loadEvidence(userId, projectId);
  const next = existing.filter((e) => e.id !== id);
  await saveEvidence(userId, projectId, next);
  return next;
}

export async function clearEvidence(userId: string, projectId: string): Promise<void> {
  await saveEvidence(userId, projectId, []);
}
