// M5 · 竞品 Listing 全字段抓取编排（PRD §11.2「竞品 Listing 抓取编排（前台全字段 + 卖家精灵后台数据一次编排）」）。
//
// 为什么单独一个规划器：三列对比要 33 个字段（§6.3），散落在一堆接口上，
// 字段 → 接口 → 参数的映射如果写在组件里，就会出现"有的字段永远抓不到、有的接口被重复调用"。
// 这里把映射写成**确定性计划**（可测试）：
//   planListingFetch() → FetchStep[]（带 fills 字段清单、优先级、TTL、用量分类）
// 执行器只负责按计划调用；抓完用 assembleListingDetails() 落成 listingFields 的形状，
// 再用 evaluateFetchPlan() 算出字段抓取率（对齐 M3 验收线 ≥90%）。
//
// 采样口径来自 §15.4（用户确认）：评论快速 60 条 = 锚点 20 + 头部 2×20 = 3 次调用；
// 深度 200 条 = 锚点 80(4 次) + 头部 2×60(各 3 次) = 10 次调用。

import { LISTING_FIELDS, type FieldGroup, type ListingDetail, type TrafficDetail } from './listingFields';
import { DEFAULT_TTL_SECONDS, type PoolDataType } from './poolCache';
import type { UsageTool } from './usageAccounting';
import { LISTING_IMAGE_MAX, extractListingImages, listingImageFetchArgs } from './listingImages';

export type FetchDepth = 'fast' | 'deep';

/** 计划里的一步：一次外部调用（或一组同参调用） */
export interface FetchStep {
  id: string;
  /** 数据池动作类型（决定 TTL 与缓存键） */
  type: PoolDataType;
  /** 用量分类（记账用） */
  usageTool: UsageTool;
  provider: 'sellersprite' | 'xydc';
  /** 工具名（MCP tool） */
  tool: string;
  args: Record<string, unknown>;
  /** 这一步能填哪些字段（listingFields 的 key） */
  fills: string[];
  /** 该 ASIN（大盘类步骤为空 = 整批共用） */
  asin?: string;
  /** 优先级：1 = 最该先抓（便宜且信息量大） */
  priority: number;
  /** 预计外部调用次数（用于成本预估与 §15.4 口径核对） */
  calls: number;
  ttlSeconds: number;
  /** 人话说明（UI 上显示"正在抓什么"） */
  label: string;
}

export interface FetchPlanInput {
  asins: string[];
  marketplace: string;
  depth?: FetchDepth;
  /** 头部 ASIN（用于评论采样：锚点 + 头部；默认取第一个） */
  anchorAsin?: string;
  /** 已抓到的字段（按 ASIN）：这些字段对应的步骤会被跳过，避免重复花钱 */
  alreadyHave?: Record<string, string[]>;
  /** 只要这些字段组（默认全部） */
  groups?: FieldGroup[];
  /**
   * 是否连 A+ **模块图**一起抓（PRD §15.25）。
   * 默认 false —— 用户指示："默认抓整套图（除了 A+）"。
   * 注意：A+ 的**文案**（`aplus` 字段）一直是抓的，这里说的是 A+ 的图片模块。
   */
  includeAplusImages?: boolean;
}

/** 评论采样：按 §15.4 的口径算"锚点 + 头部"的次数 */
export function reviewSamplePlan(depth: FetchDepth): { target: number; anchorLimit: number; headLimit: number; calls: number; label: string } {
  if (depth === 'deep') {
    // 锚点 80（4 次，每次 20）+ 头部 2×60（各 3 次）
    return { target: 200, anchorLimit: 80, headLimit: 60, calls: 4 + 3 + 3, label: '深度采样 200 条（锚点 80 + 头部 2×60）' };
  }
  // 锚点 20（1 次）+ 头部 2×20（各 1 次）
  return { target: 60, anchorLimit: 20, headLimit: 20, calls: 1 + 1 + 1, label: '快速采样 60 条（锚点 20 + 头部 2×20）' };
}

function fieldKeysOf(keys: string[]): string[] {
  const known = new Set(LISTING_FIELDS.map((f) => f.key));
  return keys.filter((k) => known.has(k));
}

/**
 * 生成抓取计划（确定性：同样的输入永远得到同样的步骤与顺序）。
 * 顺序原则：先抓"便宜且能填最多字段"的（Listing 文本、ASIN 详情），再抓贵且慢的（流量、评论深度取样、历史趋势）。
 */
export function planListingFetch(input: FetchPlanInput): FetchStep[] {
  const asins = [...new Set((input.asins ?? []).map((a) => String(a || '').trim().toUpperCase()).filter(Boolean))];
  if (asins.length === 0) return [];
  const depth: FetchDepth = input.depth ?? 'fast';
  const marketplace = input.marketplace || 'US';
  const groups = new Set<FieldGroup>(input.groups ?? ['product', 'listing', 'traffic']);
  const anchor = (input.anchorAsin || asins[0] || '').toUpperCase();
  /** A+ 模块图：默认不抓（用户口径）；只有调用方显式开启才带上 */
  const includeAplusImages = input.includeAplusImages === true;
  const sampling = reviewSamplePlan(depth);
  const have = (asin: string, keys: string[]): boolean => {
    const got = new Set(input.alreadyHave?.[asin] ?? []);
    // 只要该步骤要填的字段已经全有了，就跳过这一步（不为已有数据花钱）
    return keys.length > 0 && keys.every((k) => got.has(k));
  };

  const steps: FetchStep[] = [];
  const push = (step: Omit<FetchStep, 'calls' | 'ttlSeconds'> & { calls?: number; ttlSeconds?: number }) => {
    if (have(step.asin ?? '', step.fills)) return;
    steps.push({
      ...step,
      calls: step.calls ?? 1,
      ttlSeconds: step.ttlSeconds ?? DEFAULT_TTL_SECONDS[step.type],
    });
  };

  for (const asin of asins) {
    // ① Listing 文本（标题/五点/整套图/A+/变体）——最便宜且信息量最大
    //    抓图口径（PRD §15.25）：默认**整套图**（Listing 图库第 1-N 张 = 主图 + 附图），默认**不含 A+ 模块图**。
    //    成本口径不变：整套图仍是 asin_listing 这一次调用的返回内容，不是"每张图一次调用"。
    if (groups.has('listing')) {
      push({
        id: `listing:${asin}`,
        type: 'listing',
        usageTool: 'competitor_listing',
        provider: 'sellersprite',
        tool: 'asin_listing',
        args: { asin, marketplace, ...listingImageFetchArgs({ includeAplus: includeAplusImages }) },
        fills: fieldKeysOf(['title', 'bullets', 'aplus', 'imageStrategy', 'mainImages', 'video', 'variants', 'attributes', 'qa', 'brandMaker', 'listPrice', 'ratingBreakdown']),
        asin,
        priority: 1,
        label: `${asin} 的 Listing 全字段（标题/五点/整套图 1-${LISTING_IMAGE_MAX} 张/变体/参数表/Q&A）`,
      });
    }

    // ② ASIN 详情（价格/评分/BSR/月销/月收/上架时间/卖家类型）
    if (groups.has('product')) {
      push({
        id: `detail:${asin}`,
        type: 'asin_detail',
        usageTool: 'market',
        provider: 'sellersprite',
        tool: 'asin_detail',
        args: { asin, marketplace },
        fills: fieldKeysOf(['price', 'rating', 'reviewCount', 'monthlySales', 'monthlyRevenue', 'bsr', 'launchDate', 'sellerType', 'fbaFee', 'brandMaker']),
        asin,
        priority: 2,
        label: `${asin} 的 ASIN 详情（价格/评分/BSR/月销/上架时间/卖家）`,
      });
    }

    // ③ 评论（采样口径见 §15.4；锚点单独一步，便于"先拿锚点再决定要不要深挖"）
    if (groups.has('product')) {
      push({
        id: `reviews:${asin}:anchor`,
        type: 'reviews',
        usageTool: 'reviews',
        provider: 'sellersprite',
        tool: 'review',
        args: { asin, marketplace, limit: sampling.anchorLimit },
        fills: fieldKeysOf(['reviewCount']),
        asin,
        priority: 3,
        calls: Math.ceil(sampling.anchorLimit / 20),
        label: `${asin} 评论锚点取样 ${sampling.anchorLimit} 条（${sampling.label}）`,
      });
      if (depth === 'deep' && asin !== anchor) {
        push({
          id: `reviews:${asin}:head`,
          type: 'reviews',
          usageTool: 'reviews',
          provider: 'sellersprite',
          tool: 'review',
          args: { asin, marketplace, limit: sampling.headLimit },
          fills: fieldKeysOf(['reviewCount']),
          asin,
          priority: 6,
          calls: Math.ceil(sampling.headLimit / 20),
          label: `${asin} 评论深度取样 ${sampling.headLimit} 条`,
        });
      }
    }

    // ④ 流量词与广告结构（贵、慢，但对"竞对靠什么赢"最关键）
    if (groups.has('traffic')) {
      push({
        id: `traffic:${asin}`,
        type: 'traffic',
        usageTool: 'traffic',
        provider: 'sellersprite',
        tool: 'traffic_keyword',
        args: { asin, marketplace },
        fills: fieldKeysOf(['trafficKeywords', 'naturalAdRatio', 'adDependency', 'abaRank', 'titleKeywords']),
        asin,
        priority: 4,
        label: `${asin} 的流量词与广告结构`,
      });
      push({
        id: `history:${asin}`,
        type: 'traffic',
        usageTool: 'traffic',
        provider: 'sellersprite',
        tool: 'asin_history',
        args: { asin, marketplace, months: 12 },
        fills: fieldKeysOf(['priceRankHistory', 'reviewGrowthCurve']),
        asin,
        priority: 5,
        label: `${asin} 的历史价格与排名趋势（12 个月）`,
      });
    }
  }

  // 排序：优先级 → ASIN（稳定），保证同输入同顺序
  return steps.sort((a, b) => a.priority - b.priority || String(a.asin ?? '').localeCompare(String(b.asin ?? '')) || a.id.localeCompare(b.id));
}

export interface FetchStepResult {
  stepId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  /** 实际耗时（记账用） */
  durationMs?: number;
  cacheHit?: boolean;
}

export interface AssembledFetch {
  listing: Record<string, ListingDetail>;
  traffic: Record<string, TrafficDetail>;
  /** 每一步落了什么（供 UI 展示与排错） */
  applied: { stepId: string; asin?: string; fields: string[] }[];
  /** 失败的步骤（不阻断其它步骤：一个接口挂不该让整批失败） */
  failures: { stepId: string; error: string }[];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pickArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
}

/**
 * 把各步骤的返回装配成 listingFields 需要的形状。
 * 解析规则尽量宽（不同 provider 的字段名不完全一致），但**不猜语义**：认不出来就留空，
 * 让覆盖率如实反映"这个字段没抓到"，而不是塞一个看起来像数据的值。
 */
export function assembleListingDetails(plan: FetchStep[], results: FetchStepResult[]): AssembledFetch {
  const listing: Record<string, ListingDetail> = {};
  const traffic: Record<string, TrafficDetail> = {};
  const applied: AssembledFetch['applied'] = [];
  const failures: AssembledFetch['failures'] = [];

  const resultById = new Map(results.map((r) => [r.stepId, r]));
  for (const step of plan) {
    const r = resultById.get(step.id);
    if (!r) continue;
    if (!r.ok) {
      failures.push({ stepId: step.id, error: r.error || '未知错误' });
      continue;
    }
    const payload = asRecord(r.data);
    // MCP 常见包装：{ content: [{ text: "{...}" }] } 或直接对象
    const content = Array.isArray(payload.content) ? payload.content : null;
    let data: Record<string, unknown> = payload;
    if (content && content.length > 0) {
      const first = asRecord(content[0]);
      const text = typeof first.text === 'string' ? first.text : '';
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
          data = asRecord(JSON.parse(text));
        } catch {
          data = payload;
        }
      }
    }

    if (!step.asin) continue;
    const fields: string[] = [];

    if (step.type === 'listing') {
      const target = (listing[step.asin] ??= {});
      // 抓图口径（PRD §15.25）：整套图（主图 + 附图，第 1-N 张，上限 LISTING_IMAGE_MAX）；
      // A+ 模块图默认**不采信**，只记"有多少张被按默认口径排除"，需要时用 includeAplusImages 显式开启。
      const imgs = extractListingImages(data, { includeAplus: step.args?.includeAplusImages === true });
      if (imgs.images.length > 0) {
        target.images = imgs.images;
        if (imgs.truncated > 0) target.imagesTruncatedByCap = imgs.truncated;
        fields.push('mainImages');
      }
      if (imgs.aplusImages.length > 0) {
        target.aplusImages = imgs.aplusImages;
      }
      const videos = pickArray(data.videos ?? data.videoUrls);
      if (typeof data.videoCount === 'number' || videos.length > 0) {
        target.videoCount = typeof data.videoCount === 'number' ? data.videoCount : videos.length;
        fields.push('video');
      }
      const bullets = pickArray(data.bullets ?? data.features ?? data.aboutItem);
      if (bullets.length > 0) {
        target.bullets = bullets;
        fields.push('bullets');
      }
      if (typeof data.aplus === 'string' || typeof data.aPlus === 'string') {
        target.aplus = String(data.aplus ?? data.aPlus);
        fields.push('aplus');
      }
      if (typeof data.imageStrategy === 'string') target.imageStrategy = data.imageStrategy;
      const variants = pickArray(data.variants ?? data.variations ?? data.childAsins);
      if (variants.length > 0) {
        target.variants = variants;
        fields.push('variants');
      }
      const attrs = asRecord(data.attributes ?? data.productInformation);
      if (Object.keys(attrs).length > 0) {
        target.attributes = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
        fields.push('attributes');
      }
      if (typeof data.qaCount === 'number') {
        target.qaCount = data.qaCount;
        target.qaTop = pickArray(data.qaTop ?? data.questions);
        fields.push('qa');
      }
      if (typeof data.brand === 'string' || typeof data.manufacturer === 'string') {
        target.brandMaker = String(data.manufacturer || data.brand);
        fields.push('brandMaker');
      }
      if (typeof data.listPrice === 'number' || typeof data.coupon === 'string') {
        target.listPrice = typeof data.listPrice === 'number' ? data.listPrice : undefined;
        target.coupon = typeof data.coupon === 'string' ? data.coupon : undefined;
        fields.push('listPrice');
      }
      const breakdown = Array.isArray(data.ratingBreakdown) ? (data.ratingBreakdown as Record<string, unknown>[]) : [];
      if (breakdown.length > 0) {
        target.ratingBreakdown = breakdown
          .map((b) => ({ star: Number(b.star) || 0, share: Number(b.share) || 0 }))
          .filter((b) => b.star > 0);
        fields.push('ratingBreakdown');
      }
    }

    if (step.type === 'traffic') {
      const target = (traffic[step.asin] ??= {});
      const kws = Array.isArray(data.keywords) ? (data.keywords as Record<string, unknown>[]) : [];
      if (kws.length > 0) {
        target.keywords = kws
          .map((k) => ({
            word: String(k.word ?? k.keyword ?? '').trim(),
            volume: typeof k.volume === 'number' ? k.volume : undefined,
            type: (String(k.type ?? '') === 'ad' ? 'ad' : 'natural') as 'natural' | 'ad',
          }))
          .filter((k) => k.word.length > 0);
        fields.push('trafficKeywords');
      }
      if (typeof data.abaRank === 'number') {
        target.abaRank = data.abaRank;
        fields.push('abaRank');
      }
      if (typeof data.adDependency === 'number') {
        target.adDependency = data.adDependency;
        fields.push('adDependency');
      }
      if (typeof data.naturalAdRatio === 'number') {
        target.naturalAdRatio = data.naturalAdRatio;
        fields.push('naturalAdRatio');
      }
      const hist = Array.isArray(data.priceRankHistory)
        ? (data.priceRankHistory as Record<string, unknown>[])
        : Array.isArray(data.history)
          ? (data.history as Record<string, unknown>[])
          : [];
      if (hist.length > 0) {
        target.priceRankHistory = hist
          .map((h) => ({ date: String(h.date ?? ''), price: Number(h.price) || 0, bsr: typeof h.bsr === 'number' ? h.bsr : undefined }))
          .filter((h) => h.date);
        fields.push('priceRankHistory');
      }
    }

    applied.push({ stepId: step.id, asin: step.asin, fields });
  }

  return { listing, traffic, applied, failures };
}

export interface FetchPlanEvaluation {
  /** 计划要填的字段总数（按 ASIN 去重后 × ASIN 数） */
  planned: number;
  /** 实际落到的字段数 */
  filled: number;
  /** 字段抓取率 0-1（对齐 M3 验收线 ≥90%） */
  coverage: number;
  /** 外部调用次数（计划口径） */
  plannedCalls: number;
  /** 失败步骤数（不阻断，但要在 UI 上显示） */
  failures: number;
  /** 没抓到的字段（按 ASIN） */
  missingByAsin: Record<string, string[]>;
}

/**
 * 评估抓取结果（确定性）：算出字段抓取率与缺口。
 * 口径：只统计"计划里本来要抓的字段"，不把没计划的字段算成缺口（否则覆盖率永远是红的）。
 */
export function evaluateFetchPlan(plan: FetchStep[], assembled: AssembledFetch, asins: string[]): FetchPlanEvaluation {
  const wanted = new Map<string, Set<string>>();
  for (const a of asins) wanted.set(a.toUpperCase(), new Set());
  for (const step of plan) {
    if (!step.asin) continue;
    const set = wanted.get(step.asin);
    if (!set) continue;
    for (const f of step.fills) set.add(f);
  }
  const planned = [...wanted.values()].reduce((s, set) => s + set.size, 0);

  const filledByAsin = new Map<string, Set<string>>();
  for (const a of assembled.applied) {
    if (!a.asin) continue;
    const set = filledByAsin.get(a.asin) ?? new Set<string>();
    for (const f of a.fields) set.add(f);
    filledByAsin.set(a.asin, set);
  }

  let filled = 0;
  const missingByAsin: Record<string, string[]> = {};
  for (const [asin, set] of wanted) {
    const got = filledByAsin.get(asin) ?? new Set<string>();
    const missing = [...set].filter((f) => !got.has(f));
    if (missing.length > 0) missingByAsin[asin] = missing;
    filled += [...set].filter((f) => got.has(f)).length;
  }

  return {
    planned,
    filled,
    coverage: planned > 0 ? Math.round((filled / planned) * 1000) / 1000 : 0,
    plannedCalls: plan.reduce((s, step) => s + step.calls, 0),
    failures: assembled.failures.length,
    missingByAsin,
  };
}

/** 计划成本预估（走用量记账的同一张成本表，口径一致） */
export function estimatePlanCost(plan: FetchStep[], mcpCallUsd: number): number {
  const calls = plan.reduce((s, step) => s + step.calls, 0);
  return Math.round(calls * mcpCallUsd * 1e6) / 1e6;
}
