/**
 * 线框图 Screen 5 / L3 页 ⑦⑧⑨⑩：看竞对卡片上的「下钻」入口。
 *
 * 设计意图（⏳4 修复）：下钻不只是「把 ASIN 带进竞品明细」，还要带上**看哪个视图**的意图：
 *   ⑦ 单竞对深度页  → Listing 详情页（单 ASIN 全量字段）
 *   ⑧ 主图逐张对比  → Listing 详情页（**整套图**：主图 + 附图，默认不含 A+）
 *   ⑨ 流量结构      → 流量（流量词 / 广告结构）
 *   ⑩ 评论与画像    → 走用户洞察（不在竞品明细内）
 * 之前 ⑦⑧⑨ 一律落在 Listing，点 ⑨ 流量结构也要手动再切一次，属于断链。
 */

export type CompetitorResultTab = 'listing' | 'traffic' | 'matrix';
export type CompetitorDrilldown = 'deep' | 'images' | 'traffic' | 'reviews';

export interface DrilldownEntry {
  id: CompetitorDrilldown;
  /** 按钮文案（与线框图编号一致） */
  label: string;
  /** 落到竞品明细的哪个内部视图 */
  tab: CompetitorResultTab;
  /** 一句话说明点了会发生什么（可直接做 title） */
  hint: string;
  /** true = 不走竞品明细，走「评论 VOC / 用户洞察」 */
  goesToUserInsights?: boolean;
}

export const DRILLDOWN_ENTRIES: readonly DrilldownEntry[] = [
  {
    id: 'deep',
    label: '⑦ 单竞对深度页',
    tab: 'listing',
    hint: '在竞品明细里打开该 ASIN 的 Listing 全字段详情',
  },
  {
    id: 'images',
    label: '⑧ 主图逐张对比',
    tab: 'listing',
    hint: '在竞品明细里逐张对比 Listing 图库（主图 + 附图，默认不含 A+）',
  },
  {
    id: 'traffic',
    label: '⑨ 流量结构',
    tab: 'traffic',
    hint: '在竞品明细里看流量词与广告结构',
  },
  {
    id: 'reviews',
    label: '⑩ 评论与画像',
    tab: 'listing',
    hint: '打开评论 VOC / 用户洞察，看该竞对的评论与画像证据',
    goesToUserInsights: true,
  },
];

export function drilldownEntry(id: CompetitorDrilldown): DrilldownEntry {
  const found = DRILLDOWN_ENTRIES.find((e) => e.id === id);
  if (!found) throw new Error(`未知的下钻入口：${id}`);
  return found;
}

/** 下钻入口 → 竞品明细内部视图 */
export function drilldownTabFor(id: CompetitorDrilldown): CompetitorResultTab {
  return drilldownEntry(id).tab;
}

export function drilldownLabel(tab: CompetitorResultTab): string {
  if (tab === 'traffic') return '流量结构';
  if (tab === 'matrix') return '语义矩阵';
  return 'Listing 详情页';
}

/**
 * 是否应该把「请求的视图」应用上去。
 * - 没有请求（undefined/null）→ 不动作，尊重用户手动切的 Tab
 * - 还没抓到结果 → 不动作（停留在向导，抓完再落视图）
 * - 同一个 nonce 只应用一次 → 之后用户手动切 Tab 不会被抢回去
 */
export function shouldApplyDrilldownTab(input: {
  requested?: CompetitorResultTab | null;
  hasResult: boolean;
  nonce: number;
  appliedNonce: number;
}): boolean {
  const { requested, hasResult, nonce, appliedNonce } = input;
  if (!requested) return false;
  if (!hasResult) return false;
  return nonce !== appliedNonce;
}
