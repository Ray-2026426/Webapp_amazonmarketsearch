import { del } from 'idb-keyval';

/** 与工作区当前市场相关的键；勿用 clear() 全库清空，否则会删掉「我的市场历史」等按账号保留的快照 */
export const WORKSPACE_IDB_KEYS = [
  'marketplace',
  'activeView',
  'isDataLoaded',
  'products',
  'history',
  'months',
  'segments',
  'asinToSegment',
  'segmentDescriptions',
  'selectedSegment',
  'reviews',
  'persona',
  'keywords',
  'marketReportCache',
  'historySourceLabel',
  'anchorAnnotations',
  'segmentationPrompt',
] as const;

export async function clearWorkspaceIndexedDb(): Promise<void> {
  await Promise.all(WORKSPACE_IDB_KEYS.map((k) => del(k)));
}
