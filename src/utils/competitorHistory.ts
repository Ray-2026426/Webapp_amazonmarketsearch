import { get, set, del } from 'idb-keyval';
import { createUserId } from './auth';
import type {
  AsinDetailSnapshot,
  TrafficStatSnapshot,
  ParentMatrixSnapshot,
  TrafficKeywordDetail,
} from './sellerspriteApi';

/** 单账号最多保留条数（流量词体积大） */
export const MAX_COMPETITOR_SNAPSHOTS_PER_USER = 10;

export interface CompetitorHistoryMeta {
  id: string;
  title: string;
  createdAt: string;
  marketplace: string;
  asinList: string[];
  hasAiReport: boolean;
  hasTraffic: boolean;
}

export interface CompetitorHistoryIndexFile {
  items: CompetitorHistoryMeta[];
}

/** 可持久化的图包预览（仅 https，不含 blob:） */
export interface CompetitorPackPersist {
  zipName: string;
  secondaryPreviewUrls: string[];
  aplusPreviewUrls: string[];
  bulletPoints: string;
}

/** 竞品工作区状态（可挂到「总保存」快照，也可独立历史） */
export interface CompetitorWorkspaceState {
  marketplace: string;
  selected: string[];
  details: AsinDetailSnapshot[];
  trafficStats: TrafficStatSnapshot[];
  topKeywords: Record<string, TrafficKeywordDetail[]>;
  matrices: ParentMatrixSnapshot[];
  aiReportHtml: string;
  packs: Record<string, CompetitorPackPersist>;
  hasResult: boolean;
}

export interface CompetitorHistorySnapshot {
  version: 1;
  meta: CompetitorHistoryMeta;
  marketplace: string;
  selected: string[];
  details: AsinDetailSnapshot[];
  trafficStats: TrafficStatSnapshot[];
  topKeywords: Record<string, TrafficKeywordDetail[]>;
  matrices: ParentMatrixSnapshot[];
  aiReportHtml: string;
  packs?: Record<string, CompetitorPackPersist>;
}

function indexKey(userId: string) {
  return `competitor_history_index__${userId}`;
}

function snapshotKey(userId: string, id: string) {
  return `competitor_history_snap__${userId}__${id}`;
}

async function readIndex(userId: string): Promise<CompetitorHistoryMeta[]> {
  const raw = await get(indexKey(userId));
  if (!raw || typeof raw !== 'object') return [];
  const items = (raw as CompetitorHistoryIndexFile).items;
  return Array.isArray(items) ? items : [];
}

async function writeIndex(userId: string, items: CompetitorHistoryMeta[]) {
  await set(indexKey(userId), { items } satisfies CompetitorHistoryIndexFile);
}

export async function listCompetitorHistoryMeta(userId: string): Promise<CompetitorHistoryMeta[]> {
  const items = await readIndex(userId);
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function suggestCompetitorSnapshotTitle(
  marketplace: string,
  selected: string[]
): string {
  const date = new Date().toISOString().slice(0, 10);
  const asins = selected.map((a) => a.toUpperCase());
  if (asins.length === 0) return `${marketplace} · 竞品 · ${date}`;
  if (asins.length === 1) return `${marketplace} · ${asins[0]} · ${date}`;
  return `${marketplace} · ${asins[0]} 等${asins.length}个 · ${date}`;
}

/** 过滤掉 blob: 预览，只保留可持久 URL */
export function sanitizePacksForPersist(
  packs: Record<
    string,
    {
      zipName: string;
      secondaryPreviewUrls: string[];
      aplusPreviewUrls: string[];
      bulletPoints: string;
    }
  >
): Record<string, CompetitorPackPersist> {
  const out: Record<string, CompetitorPackPersist> = {};
  for (const [asin, pack] of Object.entries(packs)) {
    const secondary = (pack.secondaryPreviewUrls || []).filter((u) => /^https?:\/\//i.test(u));
    const aplus = (pack.aplusPreviewUrls || []).filter((u) => /^https?:\/\//i.test(u));
    if (!secondary.length && !aplus.length && !pack.bulletPoints?.trim()) continue;
    out[asin.toUpperCase()] = {
      zipName: pack.zipName || '',
      secondaryPreviewUrls: secondary,
      aplusPreviewUrls: aplus,
      bulletPoints: pack.bulletPoints || '',
    };
  }
  return out;
}

export type SaveCompetitorSnapshotInput = {
  title?: string;
  marketplace: string;
  selected: string[];
  details: AsinDetailSnapshot[];
  trafficStats: TrafficStatSnapshot[];
  topKeywords: Record<string, TrafficKeywordDetail[]>;
  matrices: ParentMatrixSnapshot[];
  aiReportHtml: string;
  packs?: Record<
    string,
    {
      zipName: string;
      secondaryPreviewUrls: string[];
      aplusPreviewUrls: string[];
      bulletPoints: string;
    }
  >;
};

export async function saveCompetitorSnapshot(
  userId: string,
  input: SaveCompetitorSnapshotInput
): Promise<{ ok: true; meta: CompetitorHistoryMeta } | { ok: false; error: string }> {
  try {
    let items = await readIndex(userId);
    const id = createUserId();
    const createdAt = new Date().toISOString();
    const asinList = input.selected.map((a) => a.toUpperCase());
    const meta: CompetitorHistoryMeta = {
      id,
      title: input.title?.trim() || suggestCompetitorSnapshotTitle(input.marketplace, asinList),
      createdAt,
      marketplace: input.marketplace,
      asinList,
      hasAiReport: Boolean(input.aiReportHtml?.trim()),
      hasTraffic: (input.trafficStats?.length || 0) > 0,
    };

    while (items.length >= MAX_COMPETITOR_SNAPSHOTS_PER_USER) {
      const oldest = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!oldest) break;
      await del(snapshotKey(userId, oldest.id));
      items = items.filter((x) => x.id !== oldest.id);
    }

    const full: CompetitorHistorySnapshot = {
      version: 1,
      meta,
      marketplace: input.marketplace,
      selected: asinList,
      details: input.details,
      trafficStats: input.trafficStats || [],
      topKeywords: input.topKeywords || {},
      matrices: input.matrices || [],
      aiReportHtml: input.aiReportHtml || '',
      packs: input.packs ? sanitizePacksForPersist(input.packs) : {},
    };

    await set(snapshotKey(userId, id), full);
    items = [meta, ...items.filter((x) => x.id !== id)];
    await writeIndex(userId, items);
    return { ok: true, meta };
  } catch (e) {
    console.error('saveCompetitorSnapshot', e);
    return { ok: false, error: e instanceof Error ? e.message : '保存失败' };
  }
}

export async function loadCompetitorSnapshot(
  userId: string,
  id: string
): Promise<CompetitorHistorySnapshot | null> {
  const snap = await get(snapshotKey(userId, id));
  if (!snap || typeof snap !== 'object') return null;
  const s = snap as CompetitorHistorySnapshot;
  if (s.version !== 1 || !s.meta?.id) return null;
  return s;
}

export async function deleteCompetitorSnapshot(userId: string, id: string): Promise<void> {
  await del(snapshotKey(userId, id));
  const items = (await readIndex(userId)).filter((x) => x.id !== id);
  await writeIndex(userId, items);
}
