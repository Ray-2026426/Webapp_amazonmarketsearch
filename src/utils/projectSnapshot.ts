// 项目级数据快照（M1 · PRD §7.2）。
//
// 解决的问题（断链 #2）：细分评分、竞对挑选、AI 分析此前都直接读**全局工作区**的 IndexedDB
// （segments / asinToSegment / products / reviews / keywords ...），于是打开项目 B 会看到
// 工作区 A 的细分数据 —— 跨项目污染。
//
// 现在：把"当前工作区数据"冻结成**属于某个项目**的快照，AI 与评分优先读快照；
// 没有快照时明确标记为"回退到全局工作区"，绝不假装是项目自己的数据。

import { get, set } from 'idb-keyval';
import type { Product, HistoryRecord, Review, Keyword } from './parser';

export interface ProjectSnapshot {
  projectId: string;
  capturedAt: string;
  marketplace: string;
  sourceLabel: string;
  isDemo: boolean;
  months: string[];
  products: Product[];
  history: HistoryRecord[];
  segments: string[];
  asinToSegment: Record<string, string>;
  segmentDescriptions: Record<string, { people: string; scenarios: string; needs: string }>;
  competitorAsins: string[];
  keywords: Keyword[];
  reviews: Review[];
}

const KEY_PREFIX = 'kairo_snapshot:';

function snapshotKey(userId: string, projectId: string): string {
  return `${KEY_PREFIX}${userId}:${projectId}`;
}

/** 从全局工作区读取当前数据并冻结为本项目快照 */
export async function captureSnapshot(userId: string, projectId: string): Promise<ProjectSnapshot> {
  const [
    products,
    history,
    months,
    marketplace,
    sourceLabel,
    isDemoFlag,
    segments,
    asinToSegment,
    segmentDescriptions,
    compWorkspace,
    keywords,
    reviews,
  ] = await Promise.all([
    get('products'),
    get('history'),
    get('months'),
    get('marketplace'),
    get('historySourceLabel'),
    get('isDemoData'),
    get('segments'),
    get('asinToSegment'),
    get('segmentDescriptions'),
    get('competitorWorkspace'),
    get('keywords'),
    get('reviews'),
  ] as const);

  const mkt = marketplace as { code?: string } | string | undefined;
  const code = typeof mkt === 'string' ? mkt : (mkt?.code ?? '');
  const comp = compWorkspace as { selected?: string[] } | null | undefined;
  const segMap = asinToSegment && typeof asinToSegment === 'object' ? (asinToSegment as Record<string, string>) : {};
  const segDesc =
    segmentDescriptions && typeof segmentDescriptions === 'object'
      ? (segmentDescriptions as Record<string, { people: string; scenarios: string; needs: string }>)
      : {};

  return {
    projectId,
    capturedAt: new Date().toISOString(),
    marketplace: code,
    sourceLabel: typeof sourceLabel === 'string' ? sourceLabel : '',
    isDemo: Boolean(isDemoFlag),
    months: Array.isArray(months) ? (months as string[]) : [],
    products: Array.isArray(products) ? (products as Product[]) : [],
    history: Array.isArray(history) ? (history as HistoryRecord[]) : [],
    segments: Array.isArray(segments) ? (segments as string[]) : [],
    asinToSegment: segMap,
    segmentDescriptions: segDesc,
    competitorAsins: Array.isArray(comp?.selected) ? comp.selected : [],
    keywords: Array.isArray(keywords) ? (keywords as Keyword[]) : [],
    reviews: Array.isArray(reviews) ? (reviews as Review[]) : [],
  };
}

export async function saveSnapshot(userId: string, projectId: string, snap: ProjectSnapshot): Promise<void> {
  await set(snapshotKey(userId, projectId), snap);
}

/** 捕获并立即保存，返回快照 */
export async function captureAndSaveSnapshot(userId: string, projectId: string): Promise<ProjectSnapshot> {
  const snap = await captureSnapshot(userId, projectId);
  await saveSnapshot(userId, projectId, snap);
  return snap;
}

export async function loadSnapshot(userId: string, projectId: string): Promise<ProjectSnapshot | null> {
  try {
    const raw = await get<ProjectSnapshot>(snapshotKey(userId, projectId));
    if (raw && typeof raw === 'object' && raw.projectId === projectId) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export async function clearSnapshot(userId: string, projectId: string): Promise<void> {
  await set(snapshotKey(userId, projectId), null);
}

export interface SnapshotSummary {
  capturedAt: string;
  marketplace: string;
  sourceLabel: string;
  isDemo: boolean;
  products: number;
  months: number;
  keywords: number;
  reviews: number;
  competitorAsins: number;
  segments: number;
}

export function snapshotSummary(snap: ProjectSnapshot): SnapshotSummary {
  return {
    capturedAt: snap.capturedAt,
    marketplace: snap.marketplace,
    sourceLabel: snap.sourceLabel,
    isDemo: snap.isDemo,
    products: snap.products.length,
    months: snap.months.length,
    keywords: snap.keywords.length,
    reviews: snap.reviews.length,
    competitorAsins: snap.competitorAsins.length,
    segments: snap.segments.length,
  };
}

/** 人类可读的一句话摘要（用于 UI 与 AI 提示） */
export function describeSnapshot(snap: ProjectSnapshot): string {
  const s = snapshotSummary(snap);
  const parts = [
    `${s.products} 个商品`,
    `${s.months} 个月历史`,
    `${s.keywords} 个关键词`,
    `${s.reviews} 条评论`,
    `${s.competitorAsins} 个竞品 ASIN`,
    `${s.segments} 个细分`,
  ];
  return `${s.marketplace || '未设站点'} · ${parts.join(' · ')}${s.isDemo ? '（示例数据）' : ''}`;
}
