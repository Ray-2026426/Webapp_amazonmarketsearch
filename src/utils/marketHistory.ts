import { get, set, del } from 'idb-keyval';
import type { Product, HistoryRecord, Review, Keyword } from './parser';
import { createUserId } from './auth';
import type { AnchorAnnotation } from './anchorAnnotations';
import type { CompetitorWorkspaceState } from './competitorHistory';
import type { UserInsightsWorkspaceState } from './userInsightsHistory';

/** 单账号最多保留条数，避免本机 IndexedDB 过大导致卡顿 */
export const MAX_MARKET_SNAPSHOTS_PER_USER = 12;

export interface MarketHistoryMeta {
  id: string;
  title: string;
  createdAt: string;
  marketplaceCode: string;
  productCount: number;
  segmentCount: number;
  /** 是否含竞品对比结果（总保存后） */
  hasCompetitor?: boolean;
  /** 是否含用户洞察 AI 结论（总保存后） */
  hasUserInsights?: boolean;
}

export interface MarketHistoryIndexFile {
  items: MarketHistoryMeta[];
}

export interface MarketHistorySnapshot {
  version: 1;
  meta: MarketHistoryMeta;
  marketplace: { code: string; domain: string };
  products: Product[];
  history: HistoryRecord[];
  months: string[];
  segments: string[];
  asinToSegment: Record<string, string>;
  segmentChildren?: Record<string, string[]>;
  asinToSubSegment?: Record<string, string>;
  segmentDescriptions: Record<string, { people: string; scenarios: string; needs: string }>;
  segmentSubDescriptions?: Record<string, { people: string; scenarios: string; needs: string }>;
  segmentDepth?: 1 | 2 | 3;
  segmentLevel3Children?: Record<string, string[]>;
  asinToLevel3Segment?: Record<string, string>;
  segmentLevel3Descriptions?: Record<string, { people: string; scenarios: string; needs: string }>;
  selectedSegment: string;
  selectedKpiMonths: string[];
  previousKpiMonths: string[];
  lastYearKpiMonths: string[];
  reviews: Review[];
  persona: { people: string; scenarios: string; needs: string } | null;
  keywords: Keyword[];
  marketReportCache: { fingerprint: string; body: string } | null;
  activeView: 'market' | 'competitors' | 'insights' | 'keywords' | 'profit';
  /** 上传「历史表现」文件时的文件名（无扩展名），用于默认命名 US-xxx */
  historySourceLabel?: string;
  /** 锚点批注（旧快照可能无此字段） */
  anchorAnnotations?: AnchorAnnotation[];
  /** 竞品分析工作区（总保存一并写入；旧快照可能无） */
  competitorWorkspace?: CompetitorWorkspaceState | null;
  /** 用户洞察工作区（深度洞察/旅程表，总保存一并写入；旧快照可能无） */
  userInsightsWorkspace?: UserInsightsWorkspaceState | null;
}

/**
 * 从历史表文件名解析市场名：「历史：薄枕-美国」→ 薄枕
 */
export function parseMarketNameFromHistoryFilename(fileName: string): string | null {
  const base = fileName.replace(/\.(xlsx|xls|csv)$/i, '').trim();
  const m = base.match(/历史\s*[：:]\s*([^-]+?)\s*-/);
  if (!m?.[1]) return null;
  const name = m[1].trim();
  return name.length > 0 ? name : null;
}

function indexKey(userId: string) {
  return `market_history_index__${userId}`;
}

function snapshotKey(userId: string, id: string) {
  return `market_history_snap__${userId}__${id}`;
}

async function readIndex(userId: string): Promise<MarketHistoryMeta[]> {
  const raw = await get(indexKey(userId));
  if (!raw || typeof raw !== 'object') return [];
  const items = (raw as MarketHistoryIndexFile).items;
  return Array.isArray(items) ? items : [];
}

async function writeIndex(userId: string, items: MarketHistoryMeta[]) {
  await set(indexKey(userId), { items } satisfies MarketHistoryIndexFile);
}

export async function listMarketHistoryMeta(userId: string): Promise<MarketHistoryMeta[]> {
  const items = await readIndex(userId);
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 默认快照名：站点简称-市场名，如 US-薄枕（市场名取自「历史：xxx-站点」中的 xxx） */
export function suggestMarketSnapshotTitle(
  marketplaceCode: string,
  historyFileName: string | undefined,
  products: Product[]
): string {
  const parsed = historyFileName ? parseMarketNameFromHistoryFilename(historyFileName) : null;
  const label =
    parsed ||
    (products[0]?.title?.trim() ? products[0].title.trim().slice(0, 24) : null) ||
    '市场';
  return `${marketplaceCode}-${label}`;
}

export type SaveMarketSnapshotInput = Omit<MarketHistorySnapshot, 'version' | 'meta'> & {
  title?: string;
};

/** 写入一条完整市场快照；超过上限时删除最旧的一条 */
export async function saveMarketSnapshot(
  userId: string,
  input: SaveMarketSnapshotInput
): Promise<{ ok: true; meta: MarketHistoryMeta } | { ok: false; error: string }> {
  try {
    let items = await readIndex(userId);
    const id = createUserId();
    const createdAt = new Date().toISOString();
    const meta: MarketHistoryMeta = {
      id,
      title:
        input.title?.trim() ||
        suggestMarketSnapshotTitle(
          input.marketplace.code,
          input.historySourceLabel,
          input.products
        ),
      createdAt,
      marketplaceCode: input.marketplace.code,
      productCount: input.products.length,
      segmentCount: input.segments.length,
      hasCompetitor: Boolean(input.competitorWorkspace?.hasResult),
      hasUserInsights: Boolean(input.userInsightsWorkspace?.hasResult),
    };

    while (items.length >= MAX_MARKET_SNAPSHOTS_PER_USER) {
      const oldest = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!oldest) break;
      await del(snapshotKey(userId, oldest.id));
      items = items.filter((x) => x.id !== oldest.id);
    }

    const full: MarketHistorySnapshot = {
      version: 1,
      meta,
      marketplace: input.marketplace,
      products: input.products,
      history: input.history,
      months: input.months,
      segments: input.segments,
      asinToSegment: input.asinToSegment,
      segmentChildren: input.segmentChildren ?? {},
      asinToSubSegment: input.asinToSubSegment ?? {},
      segmentDescriptions: input.segmentDescriptions,
      segmentSubDescriptions: input.segmentSubDescriptions ?? {},
      segmentDepth: input.segmentDepth ?? 1,
      segmentLevel3Children: input.segmentLevel3Children ?? {},
      asinToLevel3Segment: input.asinToLevel3Segment ?? {},
      segmentLevel3Descriptions: input.segmentLevel3Descriptions ?? {},
      selectedSegment: input.selectedSegment,
      selectedKpiMonths: input.selectedKpiMonths,
      previousKpiMonths: input.previousKpiMonths,
      lastYearKpiMonths: input.lastYearKpiMonths,
      reviews: input.reviews,
      persona: input.persona,
      keywords: input.keywords,
      marketReportCache: input.marketReportCache,
      activeView: input.activeView,
      historySourceLabel: input.historySourceLabel,
      anchorAnnotations: input.anchorAnnotations ?? [],
      competitorWorkspace: input.competitorWorkspace ?? null,
      userInsightsWorkspace: input.userInsightsWorkspace ?? null,
    };

    await set(snapshotKey(userId, id), full);
    items = [meta, ...items.filter((x) => x.id !== id)];
    await writeIndex(userId, items);
    return { ok: true, meta };
  } catch (e) {
    console.error('saveMarketSnapshot', e);
    return { ok: false, error: e instanceof Error ? e.message : '保存失败' };
  }
}

export async function loadMarketSnapshot(
  userId: string,
  id: string
): Promise<MarketHistorySnapshot | null> {
  const snap = await get(snapshotKey(userId, id));
  if (!snap || typeof snap !== 'object') return null;
  const s = snap as MarketHistorySnapshot;
  if (s.version !== 1 || !s.meta?.id) return null;
  return s;
}

export async function deleteMarketSnapshot(userId: string, id: string): Promise<void> {
  await del(snapshotKey(userId, id));
  const items = (await readIndex(userId)).filter((x) => x.id !== id);
  await writeIndex(userId, items);
}
