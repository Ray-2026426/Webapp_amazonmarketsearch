// M6 · 竞品明细的抓图口径（PRD §15.25）：**默认抓整套图**（Listing 图库第 1-N 张 = 主图 + 附图），
// **默认排除 A+ 模块图**。
//
// 用户原话：「现在卖家精灵不止可以抓首图，可以抓整套图，我需要默认抓整套图（除了 A+）。」
//
// 改之前的口径（如实记录，别把"计划里写的"当成"实际在做"）：
//   · 竞品明细的「主图对比」用的是 asin_detail 快照里的**单张图**（`zoomImageUrl || imageUrl`），也就是只有首图；
//   · Listing 全字段抓取步骤虽然会把接口返回的 `images[]` 落进 listingDetails（对比表里显示成"N 张"），
//     但既没有"整套图"的默认口径，也没有上限，A+ 与图库混不混全靠接口自觉；
//   · A+ 模块图在工程里走的是另一条路（本地 zip 图包 → aplusPreviewUrls），跟这次抓取无关。
//
// 本模块把口径做成**唯一权威常量 + 纯函数**，抓取层（listingFetchPlan / sellerspriteApi）共用，
// 这样"默认抓整套图、默认不含 A+"是可测的，而不是躺在注释里的一句愿望。
//
// 上限的依据（LISTING_IMAGE_MAX）：Amazon 商品详情页图库是"1 张主图 + 若干附图"，图位数上限为 9
// （超过 7-9 张的产品很少见，A+ 模块图不占图位）；接口一次返回整套图，所以上限是**硬闸**而不是成本闸 ——
// 它的作用是防止"整套图"变成"无上限抓取"（有些接口会把变体图、A+ 图、甚至关联推荐图混在一个数组里），
// 超过上限的部分**截断并如实记数**（truncated），不静默丢弃。

/** 抓图范围：Listing 图库（主图 + 附图），不是"只要首图" */
export const LISTING_IMAGE_SCOPE = 'gallery' as const;

/** 整套图上限（含首图）：Amazon 详情页图库图位上限 9 张；A+ 模块图不计入 */
export const LISTING_IMAGE_MAX = 9;

/** A+ 模块图是否默认抓：**否**（用户明确要求"除了 A+"） */
export const LISTING_IMAGE_INCLUDE_APLUS_DEFAULT = false;

export const LISTING_IMAGE_POLICY = {
  scope: LISTING_IMAGE_SCOPE,
  includeAplus: LISTING_IMAGE_INCLUDE_APLUS_DEFAULT,
  maxImages: LISTING_IMAGE_MAX,
} as const;

/** 接口可能用来放"整套图"的字段名（按优先级；不同 provider 命名不一致） */
export const LISTING_IMAGE_FIELDS = ['images', 'imageUrls', 'galleryImages', 'listingImages', 'mainImages'] as const;

/** 单图字段（只有首图时的兜底；asin_detail 这类接口就只回这两三个字段） */
export const LISTING_COVER_FIELDS = ['zoomImageUrl', 'imageUrl', 'mainImage'] as const;

/** 接口可能用来放"A+ 模块图"的字段名（**只认这些**：不从图库数组里猜哪张是 A+） */
export const APLUS_IMAGE_FIELDS = ['aplusImages', 'aPlusImages', 'ebcImages', 'aplusImageUrls', 'aPlusImageUrls'] as const;

export interface ListingImages {
  /** 整套图（主图 + 附图），已去重、已按上限截断 */
  images: string[];
  /** A+ 模块图（默认返回空数组；只有显式 includeAplus 时才填） */
  aplusImages: string[];
  /** 被上限截掉的张数（如实记数，不静默丢） */
  truncated: number;
  /** 接口其实回了 A+ 图，但按默认口径没采信（用于提示"需要时可单独开启"） */
  aplusSuppressed: number;
}

function cleanList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const url = typeof item === 'string' ? item.trim() : '';
    // 只做"非空 + 去重"，不按协议过滤：测试与演示数据里存在非 http 的占位值，
    // 过滤规则越复杂，越容易把真图片当脏数据丢掉。
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function pickFirstArray(source: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const k of keys) {
    const list = cleanList(source[k]);
    if (list.length > 0) return list;
  }
  return [];
}

function pickScalar(source: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const k of keys) {
    const v = source[k];
    if (typeof v === 'string' && v.trim()) return [v.trim()];
  }
  return [];
}

/**
 * 从接口返回里提取整套图（主图 + 附图），默认不带 A+。
 *
 * 两条口径写死在这里：
 * 1. **整套图**：优先取数组字段（images/imageUrls/galleryImages/...），只有单图字段时退回 `[首图]`（不是丢数据，是接口只有一张）；
 * 2. **A+ 默认排除**：A+ 只认接口单独返回的字段；`includeAplus !== true` 时**整段不采信**，
 *    只回一个计数（aplusSuppressed），让界面能说清"有多少张 A+ 没抓、需要时怎么开"。
 *    —— 不从图库数组里猜 A+：猜错会把正常附图删掉，那比多留一张更难发现。
 */
export function extractListingImages(
  source: Record<string, unknown> | null | undefined,
  opts?: { includeAplus?: boolean }
): ListingImages {
  const src = (source ?? {}) as Record<string, unknown>;
  const includeAplus = opts?.includeAplus === true;

  const gallery = pickFirstArray(src, LISTING_IMAGE_FIELDS);
  const all = gallery.length > 0 ? gallery : pickScalar(src, LISTING_COVER_FIELDS);
  const images = all.slice(0, LISTING_IMAGE_MAX);

  const aplusAll = pickFirstArray(src, APLUS_IMAGE_FIELDS);
  const aplusImages = includeAplus ? aplusAll.slice(0, LISTING_IMAGE_MAX) : [];

  return {
    images,
    aplusImages,
    truncated: Math.max(0, all.length - images.length),
    aplusSuppressed: includeAplus ? 0 : aplusAll.length,
  };
}

/** 口径的人话说明（界面、AI 提示词、报告共用同一句，避免各处说法不一致） */
export function describeListingImageScope(): string {
  return `默认抓整套图（Listing 图库第 1-${LISTING_IMAGE_MAX} 张：主图 + 附图）；A+ 模块图默认不抓，需要时单独开启。`;
}

/** 抓取参数（放进 MCP 调用 args，口径跟着请求一起进缓存键：口径变了缓存自然失效） */
export function listingImageFetchArgs(opts?: { includeAplus?: boolean }): {
  imageScope: typeof LISTING_IMAGE_SCOPE;
  maxImages: number;
  includeAplusImages: boolean;
} {
  return {
    imageScope: LISTING_IMAGE_SCOPE,
    maxImages: LISTING_IMAGE_MAX,
    includeAplusImages: opts?.includeAplus === true,
  };
}
