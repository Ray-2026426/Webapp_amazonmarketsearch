// M3② · 全量 Listing 三列对比的字段注册表（PRD §6.3）。
//
// 用户要求："listing 所有内容：产品、listing、流量，对三列对比"。
// 这张表是"所有内容"的唯一权威清单：每个字段都必须**标明来源**
// （🖥前台 / 🔮卖家精灵 / 📊推算），抓不到就显式标"未抓取"（绝不静默留空 —— 空值和"没抓"是两件事）。
//
// 同时给出"字段覆盖率"，用来量化 M3 的验收指标：
//   3 个竞对全字段抓取成功率 ≥90%（缓存命中不计）。

import type { Product, HistoryRecord } from './parser';
import { LISTING_IMAGE_MAX, describeListingImageScope } from './listingImages';

export type FieldSource = 'frontend' | 'sellersprite' | 'derived';
export type FieldGroup = 'product' | 'listing' | 'traffic';

export const SOURCE_LABELS: Record<FieldSource, string> = {
  frontend: '🖥前台',
  sellersprite: '🔮卖家精灵',
  derived: '📊推算',
};

export const SOURCE_HINTS: Record<FieldSource, string> = {
  frontend: '买家前台可见（抓取商品页即可）',
  sellersprite: '卖家精灵/MCP 数据（需要接口或导出表）',
  derived: '由已有字段确定性推算（口径写在字段说明里）',
};

export const GROUP_LABELS: Record<FieldGroup, string> = {
  product: '产品',
  listing: 'Listing',
  traffic: '流量',
};

export const GROUP_ORDER: FieldGroup[] = ['product', 'listing', 'traffic'];

export interface ListingFieldDef {
  key: string;
  group: FieldGroup;
  label: string;
  source: FieldSource;
  /** 该字段怎么取值（人话，用于"未抓取"时告诉用户去哪补） */
  how: string;
}

/** 字段清单（顺序即展示顺序） */
export const LISTING_FIELDS: ListingFieldDef[] = [
  // ── 产品 · 前台 ──
  // 口径（PRD §15.25，用户指示）：默认抓**整套图** = Listing 图库第 1-N 张（主图 + 附图），**默认不含 A+ 模块图**。
  // 字段 key 仍是 `mainImages`（既有导出/报告的渲染与断言都按这个 key 取值，改名会破坏兼容），
  // 但含义已明确为"整套图"，上限与 A+ 口径见 listingImages.ts。
  {
    key: 'mainImages',
    group: 'product',
    label: `Listing 图库（主图 + 附图，第 1-${LISTING_IMAGE_MAX} 张）`,
    source: 'frontend',
    how: describeListingImageScope(),
  },
  { key: 'video', group: 'product', label: '视频', source: 'frontend', how: '抓商品页视频位' },
  { key: 'price', group: 'product', label: '价格', source: 'frontend', how: '商品页售价（含促销价）' },
  { key: 'listPrice', group: 'product', label: '划线价 / 优惠券', source: 'frontend', how: '抓划线价与 Coupon' },
  { key: 'rating', group: 'product', label: '评分', source: 'frontend', how: '商品页星级' },
  { key: 'ratingBreakdown', group: 'product', label: '评分分布（1-5 星）', source: 'frontend', how: '商品页星级占比' },
  { key: 'reviewCount', group: 'product', label: '评论数', source: 'frontend', how: '商品页评论总数' },
  { key: 'variants', group: 'product', label: '变体矩阵（父子/颜色/尺寸）', source: 'frontend', how: '抓变体下拉（尺寸/颜色/数量）' },
  { key: 'attributes', group: 'product', label: '参数表（材质/尺寸/重量/产地）', source: 'frontend', how: '抓 Product information 表' },
  { key: 'qa', group: 'product', label: 'Q&A 数量与代表问题', source: 'frontend', how: '抓问答区（数量 + Top 3 问题）' },
  { key: 'launchDate', group: 'product', label: '上架时间', source: 'frontend', how: '商品页 Date First Available' },
  { key: 'brandMaker', group: 'product', label: '品牌 / 制造商', source: 'frontend', how: '商品页品牌与制造商字段' },
  // ── 产品 · 卖家精灵 ──
  { key: 'monthlySales', group: 'product', label: '月销量', source: 'sellersprite', how: '卖家精灵销量估算' },
  { key: 'monthlyRevenue', group: 'product', label: '月销售额', source: 'sellersprite', how: '卖家精灵销售额估算' },
  { key: 'bsr', group: 'product', label: 'BSR 及类目', source: 'sellersprite', how: 'BSR 排名 + 类目路径' },
  { key: 'reviewGrowthCurve', group: 'product', label: '评论增长曲线', source: 'sellersprite', how: '历史评论数（至少 3 个时间点）' },
  { key: 'fbaFee', group: 'product', label: 'FBA 费估算', source: 'sellersprite', how: '按尺寸重量估算 FBA 费' },
  { key: 'sellerType', group: 'product', label: '卖家类型 / 发货方式', source: 'sellersprite', how: 'FBA/FBM、卖家地区' },
  // ── Listing ──
  { key: 'title', group: 'listing', label: '标题', source: 'frontend', how: '商品页标题全文' },
  { key: 'bullets', group: 'listing', label: '五点描述（×5）', source: 'frontend', how: '抓 About this item 五点全文' },
  { key: 'aplus', group: 'listing', label: 'A+ / 品牌故事', source: 'frontend', how: '抓 A+ 模块与品牌故事文本' },
  { key: 'imageStrategy', group: 'listing', label: '图文策略（图片文案覆盖）', source: 'frontend', how: '按 A+ 与主图文字推断' },
  { key: 'titleKeywords', group: 'listing', label: '标题词频与关键词覆盖', source: 'sellersprite', how: '标题分词 + 关键词覆盖分析' },
  // ── 流量 ──
  { key: 'trafficKeywords', group: 'traffic', label: '流量词（自然/广告）与关键词数量', source: 'sellersprite', how: '卖家精灵流量词表（自然词 + 广告词）' },
  { key: 'abaRank', group: 'traffic', label: 'ABA 排名', source: 'sellersprite', how: 'ABA 搜索排名（品牌分析）' },
  { key: 'adDependency', group: 'traffic', label: '广告依赖度', source: 'sellersprite', how: '广告流量占比的估算' },
  { key: 'naturalAdRatio', group: 'traffic', label: '自然/广告流量比', source: 'sellersprite', how: '自然流量词数 / 广告流量词数' },
  { key: 'priceRankHistory', group: 'traffic', label: '历史价格与排名趋势', source: 'sellersprite', how: '历史价格与 BSR 序列（至少 3 个时间点）' },
  // ── 推算 ──
  { key: 'avgReviewGrowth', group: 'product', label: '月均新增评论', source: 'derived', how: '评论数 ÷ 上架月数（口径固定，用于横向比较）' },
  { key: 'priceGapToAvg', group: 'product', label: '价格相对竞对均价', source: 'derived', how: '（本品价格 − 三列均价）÷ 均价' },
];

export interface ListingDetail {
  /** 整套图（主图 + 附图）：Listing 图库第 1-N 张；默认不含 A+ 模块图（见 listingImages.ts） */
  images?: string[];
  /** 被整套图上限截掉的张数（如实记数，方便判断"接口是不是把一堆杂图混进来了"） */
  imagesTruncatedByCap?: number;
  /** A+ 模块图：**默认不抓**，只有显式开启 includeAplusImages 时才有值 */
  aplusImages?: string[];
  videoCount?: number;
  listPrice?: number;
  coupon?: string;
  ratingBreakdown?: { star: number; share: number }[];
  variants?: string[];
  attributes?: Record<string, string>;
  qaCount?: number;
  qaTop?: string[];
  brandMaker?: string;
  bullets?: string[];
  aplus?: string;
  imageStrategy?: string;
  titleKeywords?: string[];
}

export interface TrafficDetail {
  keywords?: { word: string; volume?: number; type?: 'natural' | 'ad' }[];
  abaRank?: number;
  adDependency?: number;
  naturalAdRatio?: number;
  priceRankHistory?: { date: string; price: number; bsr?: number }[];
}

export interface ComparisonInput {
  asins: string[];
  products: Product[];
  listing?: Record<string, ListingDetail | undefined>;
  traffic?: Record<string, TrafficDetail | undefined>;
  history?: HistoryRecord[];
}

export interface ComparisonCell {
  asin: string;
  /** 展示值（已格式化） */
  value: string;
  source: FieldSource;
  /** true = 没抓到（不是"值为空"） */
  missing: boolean;
  /** 没抓到时告诉用户怎么补 */
  hint?: string;
}

export interface ComparisonRow {
  field: ListingFieldDef;
  cells: ComparisonCell[];
  /** 三个竞对里抓到了几个 */
  captured: number;
}

export interface CoverageReport {
  overall: number;
  byGroup: Record<FieldGroup, number>;
  captured: number;
  total: number;
  /** 未抓到的字段（用于"还差什么"清单） */
  missingFields: { key: string; label: string; group: FieldGroup; source: FieldSource; asins: string[] }[];
}

const EMPTY = '未抓取';

function fmtMoney(v: number): string {
  return `$${Math.round(v).toLocaleString()}`;
}
function fmtNum(v: number): string {
  return Math.round(v).toLocaleString();
}

function cell(asin: string, value: string | undefined | null, field: ListingFieldDef): ComparisonCell {
  const ok = value !== undefined && value !== null && String(value).trim().length > 0;
  return {
    asin,
    value: ok ? String(value) : EMPTY,
    source: field.source,
    missing: !ok,
    hint: ok ? undefined : `${field.label}（${SOURCE_LABELS[field.source]}）：${field.how}`,
  };
}

/** 单个字段取值（确定性；抓不到返回 undefined，绝不拿 0 冒充） */
export function readFieldValue(
  fieldKey: string,
  asin: string,
  input: ComparisonInput
): string | undefined {
  const p = input.products.find((x) => x.asin === asin);
  const l = input.listing?.[asin];
  const t = input.traffic?.[asin];
  const avgPrice =
    input.products.length > 0 ? input.products.reduce((s, x) => s + (x.price || 0), 0) / input.products.length : 0;
  const months = Math.max(1, Math.round((p?.daysSinceLaunch || 0) / 30));

  switch (fieldKey) {
    case 'mainImages':
      // 展示口径不变（"N 张"），含义已是"整套图"；A+ 是否包含由抓取层决定，不在这里加戏。
      return l?.images && l.images.length > 0 ? `${l.images.length} 张` : undefined;
    case 'video':
      return typeof l?.videoCount === 'number' ? (l.videoCount > 0 ? `${l.videoCount} 个` : '无') : undefined;
    case 'price':
      return p && p.price > 0 ? fmtMoney(p.price) : undefined;
    case 'listPrice':
      return typeof l?.listPrice === 'number' || l?.coupon
        ? [typeof l?.listPrice === 'number' ? `划线 ${fmtMoney(l!.listPrice!)}` : '', l?.coupon ? `券 ${l.coupon}` : '']
            .filter(Boolean)
            .join(' / ')
        : undefined;
    case 'rating':
      return p && p.rating > 0 ? String(p.rating) : undefined;
    case 'ratingBreakdown':
      return l?.ratingBreakdown && l.ratingBreakdown.length > 0
        ? l.ratingBreakdown.map((b) => `${b.star}★ ${Math.round(b.share * 100)}%`).join(' / ')
        : undefined;
    case 'reviewCount':
      return p && p.reviewCount > 0 ? fmtNum(p.reviewCount) : undefined;
    case 'variants':
      return l?.variants && l.variants.length > 0 ? l.variants.join(' / ') : undefined;
    case 'attributes':
      return l?.attributes && Object.keys(l.attributes).length > 0
        ? Object.entries(l.attributes)
            .slice(0, 6)
            .map(([k, v]) => `${k}: ${v}`)
            .join('；')
        : undefined;
    case 'qa':
      return typeof l?.qaCount === 'number'
        ? `${l.qaCount} 条${l.qaTop && l.qaTop.length > 0 ? `（代表：${l.qaTop[0]}）` : ''}`
        : undefined;
    case 'launchDate':
      return p?.launchDate ? p.launchDate : undefined;
    case 'brandMaker':
      return l?.brandMaker || (p?.brand ? `${p.brand}${l?.brandMaker ? '' : '（仅品牌）'}` : undefined);
    case 'monthlySales':
      return p && p.monthlySales > 0 ? fmtNum(p.monthlySales) : undefined;
    case 'monthlyRevenue':
      return p && p.monthlyRevenue > 0 ? fmtMoney(p.monthlyRevenue) : undefined;
    case 'bsr':
      return p && p.subBsr > 0 ? `#${fmtNum(p.subBsr)}${p.subCategory ? ` · ${p.subCategory}` : ''}` : undefined;
    case 'reviewGrowthCurve': {
      const h = input.history?.find((x) => x.asin === asin);
      const points = h ? Object.keys(h.history || {}).length : 0;
      return points >= 3 ? `${points} 个时间点` : undefined;
    }
    case 'fbaFee':
      return p && p.fbaFee > 0 ? fmtMoney(p.fbaFee) : undefined;
    case 'sellerType':
      return [p?.buyBoxType, p?.sellerLocation].filter(Boolean).join(' / ') || undefined;
    case 'title':
      return p?.title || undefined;
    case 'bullets':
      return l?.bullets && l.bullets.length > 0 ? `${l.bullets.length} 条（${l.bullets[0].slice(0, 24)}…）` : undefined;
    case 'aplus':
      return l?.aplus || undefined;
    case 'imageStrategy':
      return l?.imageStrategy || undefined;
    case 'titleKeywords':
      return l?.titleKeywords && l.titleKeywords.length > 0 ? l.titleKeywords.slice(0, 6).join(' / ') : undefined;
    case 'trafficKeywords':
      return t?.keywords && t.keywords.length > 0
        ? `${t.keywords.length} 个（自然 ${t.keywords.filter((k) => k.type === 'natural').length} / 广告 ${t.keywords.filter((k) => k.type === 'ad').length}）`
        : undefined;
    case 'abaRank':
      return typeof t?.abaRank === 'number' ? `#${fmtNum(t.abaRank)}` : undefined;
    case 'adDependency':
      return typeof t?.adDependency === 'number' ? `${Math.round(t.adDependency * 100)}%` : undefined;
    case 'naturalAdRatio':
      return typeof t?.naturalAdRatio === 'number' ? t.naturalAdRatio.toFixed(2) : undefined;
    case 'priceRankHistory':
      return t?.priceRankHistory && t.priceRankHistory.length >= 3 ? `${t.priceRankHistory.length} 个时间点` : undefined;
    case 'avgReviewGrowth': {
      if (!p || !p.reviewCount || !p.daysSinceLaunch) return undefined;
      return `${(p.reviewCount / months).toFixed(1)} 条/月`;
    }
    case 'priceGapToAvg': {
      if (!p || !p.price || avgPrice <= 0) return undefined;
      const gap = (p.price - avgPrice) / avgPrice;
      return `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(0)}%`;
    }
    default:
      return undefined;
  }
}

/** 三列对比表（行 = 字段，列 = 竞对 ASIN） */
export function buildComparisonTable(input: ComparisonInput): { rows: ComparisonRow[]; coverage: CoverageReport } {
  const asins = Array.isArray(input.asins) ? input.asins : [];
  const rows: ComparisonRow[] = LISTING_FIELDS.map((field) => {
    const cells = asins.map((asin) => cell(asin, readFieldValue(field.key, asin, input), field));
    return { field, cells, captured: cells.filter((c) => !c.missing).length };
  });

  const total = rows.length * asins.length;
  const captured = rows.reduce((s, r) => s + r.captured, 0);
  const byGroup = { product: 0, listing: 0, traffic: 0 } as Record<FieldGroup, number>;
  const groupTotals = { product: 0, listing: 0, traffic: 0 } as Record<FieldGroup, number>;
  for (const r of rows) {
    groupTotals[r.field.group] += asins.length;
    byGroup[r.field.group] += r.captured;
  }
  const missingFields = rows
    .filter((r) => r.captured < asins.length)
    .map((r) => ({
      key: r.field.key,
      label: r.field.label,
      group: r.field.group,
      source: r.field.source,
      asins: r.cells.filter((c) => c.missing).map((c) => c.asin),
    }));

  return {
    rows,
    coverage: {
      overall: total > 0 ? Math.round((captured / total) * 1000) / 1000 : 0,
      byGroup: {
        product: groupTotals.product > 0 ? Math.round((byGroup.product / groupTotals.product) * 1000) / 1000 : 0,
        listing: groupTotals.listing > 0 ? Math.round((byGroup.listing / groupTotals.listing) * 1000) / 1000 : 0,
        traffic: groupTotals.traffic > 0 ? Math.round((byGroup.traffic / groupTotals.traffic) * 1000) / 1000 : 0,
      },
      captured,
      total,
      missingFields,
    },
  };
}

/** M3 验收指标：全字段抓取成功率 ≥90%（缓存命中不计） */
export const FIELD_COVERAGE_TARGET = 0.9;

/** 覆盖率人话说明（主屏/卡片头部用；达标与否说清楚） */
export function describeCoverage(coverage: CoverageReport): string {
  const pct = Math.round(coverage.overall * 100);
  const target = Math.round(FIELD_COVERAGE_TARGET * 100);
  const head = `字段抓取率 ${pct}%（${coverage.captured}/${coverage.total}），验收线 ${target}%`;
  if (coverage.total === 0) return '还没有竞对样本，无法统计字段抓取率';
  if (coverage.overall >= FIELD_COVERAGE_TARGET) return `${head}：达标`;
  const bySource = { frontend: 0, sellersprite: 0, derived: 0 } as Record<FieldSource, number>;
  for (const m of coverage.missingFields) bySource[m.source] += m.asins.length;
  const worst = (Object.entries(bySource) as [FieldSource, number][]).sort((a, b) => b[1] - a[1])[0];
  return `${head}：未达标，缺口主要来自 ${SOURCE_LABELS[worst[0]]}（${SOURCE_HINTS[worst[0]]}）`;
}
