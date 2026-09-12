// M3 · 看竞对 V2 的确定性分析引擎（PRD §6.3）。
//
// 用户要求原话：「≥3 竞对（头部/跟随者/新人），listing 所有内容：产品、listing、流量，对三列对比」，
// 「每个竞对下面要做：用户画像（人群、场景、需求）、痛点未满足矩阵、需求满足矩阵」，
// 「做完这些对比才做结论…人无我有，人有我优，人优我廉」。
//
// 本模块负责"做完对比之后那部分"的**确定性**计算：
//   1) 痛点未满足矩阵：差评 → 痛点分类（单归属）× 需求域，带原文引用
//   2) 需求满足矩阵：看用户的需求 × 每个竞对 → ●满足 / ◐部分 / ○未满足 / —未提及，每格挂证据
//   3) 用户画像：从评论原文反推人群/场景/核心诉求（每条都是逐字引用，抽不到就明说缺什么）
//   4) 赢的路径：严格按 人无我有 → 人有我优 → 人优我廉 → 无赢面 的顺序判定（三条都不成立必须落到"无赢面"）
//
// 硬规则：
// - AI 不参与这里的任何判定；这里算出来的状态/结论不允许被 AI 覆盖（AI 只能解释）。
// - 一切结论挂证据（评论原文/标题/listing 文本 + ASIN + 星级）；证据不足时给"未提及/缺数据"，不猜。

import type { Product, Review } from './parser';
import { computeNeedEvidenceStrength, type EvidenceStrength, type UnmetNeedCandidate } from './userLook';
import { needTokens } from './segmentSynthesis';
import type { SelfStatus } from './selfAssessment';

/** 竞对在本次分析里的角色（与 competitorPicker 保持一致） */
export type CompetitorRole = 'head' | 'follower' | 'newcomer';

export interface QuoteRef {
  /** 评论原文（逐字，不裁剪语义） */
  quote: string;
  asin: string;
  rating: number;
  date?: string;
}

export type PainCategory =
  | 'quality'
  | 'design'
  | 'size_fit'
  | 'durability'
  | 'smell'
  | 'logistics'
  | 'false_claim'
  | 'price'
  | 'service'
  | 'other';

export const PAIN_CATEGORY_ORDER: PainCategory[] = [
  'quality',
  'design',
  'size_fit',
  'durability',
  'smell',
  'logistics',
  'false_claim',
  'price',
  'service',
  'other',
];

export const PAIN_CATEGORY_LABELS: Record<PainCategory, string> = {
  quality: '质量/做工',
  design: '设计/结构',
  size_fit: '尺寸/适配',
  durability: '耐用性',
  smell: '气味/异味',
  logistics: '物流/包装',
  false_claim: '描述不符/虚假宣传',
  price: '价格/性价比',
  service: '客服/售后',
  other: '其他',
};

/**
 * 痛点关键词表（确定性，可复核）。命中越多越优先；平局按表内顺序，保证同一批评论永远给出同一分类。
 * 中英文都覆盖：抓取来源可能是中文评论或英文评论。
 */
export const PAIN_KEYWORDS: { category: PainCategory; words: string[] }[] = [
  { category: 'quality', words: ['poor quality', 'cheap', 'flimsy', 'defect', 'broken', 'torn', 'stitching', 'frayed', 'lumpy', '质量', '做工', '劣质', '瑕疵', '破', '开线'] },
  { category: 'design', words: ['design', 'shape', 'awkward', 'uncomfortable', 'too firm', 'too soft', 'hard as', 'not support', '设计', '形状', '太硬', '太软', '不舒服', '支撑不足'] },
  { category: 'size_fit', words: ['too small', 'too big', 'too thick', 'too thin', 'size', 'does not fit', "doesn't fit", 'height', '尺寸', '太小', '太大', '太高', '太薄', '不合适'] },
  { category: 'durability', words: ['fell apart', 'after a few weeks', 'after a month', 'lasted', 'flattened', 'lost shape', 'durab', '不耐用', '变形', '塌', '几个月就'] },
  { category: 'smell', words: ['smell', 'odor', 'chemical', 'stink', '气味', '异味', '味道'] },
  { category: 'logistics', words: ['shipping', 'arrived', 'packaging', 'vacuum', 'delivery', 'damaged in', '物流', '包装', '运输', '压扁'] },
  { category: 'false_claim', words: ['not as described', 'misleading', 'false', 'advertis', 'photo', 'looks nothing like', '描述不符', '虚假', '与图片', '夸大'] },
  { category: 'price', words: ['overpriced', 'not worth', 'expensive', 'waste of money', 'price', '不值', '太贵', '性价比'] },
  { category: 'service', words: ['customer service', 'return', 'refund', 'seller', 'no response', '客服', '退货', '退款', '卖家'] },
];

/** 人群词（用户画像 · 谁在买） */
export const AUDIENCE_KEYWORDS = [
  'side sleeper', 'stomach sleeper', 'back sleeper', 'combination sleeper', 'mom', 'mother', 'dad', 'kids', 'child',
  'toddler', 'baby', 'senior', 'elderly', 'adult', 'women', 'men', 'nurse', 'pregnant', 'pregnancy', 'athlete',
  'student', 'office worker', 'truck driver', 'side-sleeper', '顾客', '老人', '孩子', '孕妇', '上班族', '司机',
];

/** 场景词（用户画像 · 什么场景用） */
export const SCENARIO_KEYWORDS = [
  'travel', 'hotel', 'camping', 'road trip', 'guest room', 'summer', 'winter', 'office', 'nap', 'recovery',
  'surgery', 'whiplash', 'neck pain', 'shoulder pain', 'acid reflux', 'snoring', 'postpartum', 'airplane',
  '旅行', '出差', '酒店', '露营', '夏天', '冬天', '午睡', '康复', '颈椎', '打鼾', '孕期',
];

/** 差评判定线：1-3 星视为负面（与亚马逊"差评"常用口径一致，口径写死便于复核） */
export const NEGATIVE_MAX_RATING = 3;

function isNegative(r: Review): boolean {
  return Number(r.rating) > 0 && Number(r.rating) <= NEGATIVE_MAX_RATING;
}

function reviewText(r: Review): string {
  return `${r.title || ''} ${r.content || ''}`.trim();
}

function countKeywordHits(text: string, words: string[]): number {
  const hay = ` ${text.toLowerCase()} `;
  let hits = 0;
  for (const w of words) if (hay.includes(w.toLowerCase())) hits += 1;
  return hits;
}

/** 单条评论的痛点归类（单归属：命中最多者；全不命中 → other） */
export function classifyPainCategory(review: Review): PainCategory {
  const text = reviewText(review);
  let best: PainCategory = 'other';
  let bestHits = 0;
  for (const { category, words } of PAIN_KEYWORDS) {
    const hits = countKeywordHits(text, words);
    if (hits > bestHits) {
      bestHits = hits;
      best = category;
    }
  }
  return best;
}

export interface PainHit {
  category: PainCategory;
  label: string;
  count: number;
  /** 占该 ASIN 全部差评的比例 0-1 */
  share: number;
  /** 命中的需求域（来自看用户的需求分类；不命中就是空数组，不编造） */
  demandCategories: string[];
  /** 逐字原文（最多 3 条，按有用票降序） */
  quotes: QuoteRef[];
}

export interface PainMatrix {
  asin: string;
  negativeCount: number;
  reviewCount: number;
  /** 负面评论占比 0-1（无评论时为 0，并由 note 说明） */
  negativeRate: number;
  hits: PainHit[];
  /** 差评没有触达的需求域：说明这些需求在这家身上"没有暴露问题"（不等于满足） */
  untouchedDemandCategories: string[];
  note?: string;
}

/** 该 ASIN 的评论（按 asin 匹配；支持父子 ASIN 变体） */
export function reviewsForAsin(reviews: Review[], asin: string): Review[] {
  return (Array.isArray(reviews) ? reviews : []).filter(
    (r) => r.asin === asin || r.parentAsin === asin || r.childAsin === asin
  );
}

function quoteRef(r: Review): QuoteRef {
  return {
    quote: reviewText(r).slice(0, 400),
    asin: r.asin,
    rating: Number(r.rating) || 0,
    date: r.date || undefined,
  };
}

/** 某条需求在文本里命中多少词（确定性匹配） */
function needHitCount(text: string, need: UnmetNeedCandidate): number {
  const tokens = needTokens(need);
  if (tokens.length === 0) return 0;
  const hay = ` ${text.toLowerCase()} `;
  let hits = 0;
  for (const t of tokens) if (hay.includes(t)) hits += 1;
  return hits;
}

/**
 * 痛点未满足矩阵（PRD §6.3 三块分析之 2）。
 * 差评 → 痛点分类 × 需求域；痛点占比 = 该分类差评数 / 该 ASIN 差评总数。
 */
export function buildPainMatrix(
  asin: string,
  reviews: Review[],
  needs: UnmetNeedCandidate[]
): PainMatrix {
  const list = reviewsForAsin(reviews, asin);
  const negatives = list.filter(isNegative);
  const buckets = new Map<PainCategory, Review[]>();
  for (const r of negatives) {
    const c = classifyPainCategory(r);
    const arr = buckets.get(c) ?? [];
    arr.push(r);
    buckets.set(c, arr);
  }

  const hits: PainHit[] = PAIN_CATEGORY_ORDER.filter((c) => buckets.has(c)).map((category) => {
    const rows = buckets.get(category)!;
    const text = rows.map(reviewText).join('\n');
    const demandCategories = [
      ...new Set(
        needs
          .filter((n) => needHitCount(text, n) > 0 || (n.category || '').trim() === PAIN_CATEGORY_LABELS[category])
          .map((n) => (n.category || '').trim() || '未分类需求')
      ),
    ];
    return {
      category,
      label: PAIN_CATEGORY_LABELS[category],
      count: rows.length,
      share: negatives.length > 0 ? Math.round((rows.length / negatives.length) * 1000) / 1000 : 0,
      demandCategories,
      quotes: [...rows].sort((a, b) => (b.helpful || 0) - (a.helpful || 0)).slice(0, 3).map(quoteRef),
    };
  });
  // 占比降序；同占比按痛点表顺序（确定性）
  hits.sort((a, b) => b.count - a.count || PAIN_CATEGORY_ORDER.indexOf(a.category) - PAIN_CATEGORY_ORDER.indexOf(b.category));

  const touched = new Set(hits.flatMap((h) => h.demandCategories));
  const untouchedDemandCategories = [
    ...new Set(needs.map((n) => (n.category || '').trim() || '未分类需求')),
  ].filter((c) => !touched.has(c));

  return {
    asin,
    negativeCount: negatives.length,
    reviewCount: list.length,
    negativeRate: list.length > 0 ? Math.round((negatives.length / list.length) * 1000) / 1000 : 0,
    hits,
    untouchedDemandCategories,
    note:
      list.length === 0
        ? '该 ASIN 没有评论样本：痛点矩阵为空（不是"没有痛点"，是没证据）'
        : negatives.length === 0
          ? `抽到的 ${list.length} 条评论里没有 1-${NEGATIVE_MAX_RATING} 星差评，痛点矩阵为空`
          : undefined,
  };
}

export type SatisfactionStatus = 'met' | 'partial' | 'unmet' | 'unmentioned';

export const SATISFACTION_LABELS: Record<SatisfactionStatus, string> = {
  met: '满足',
  partial: '部分满足',
  unmet: '未满足',
  unmentioned: '未提及',
};

export const SATISFACTION_MARKS: Record<SatisfactionStatus, string> = {
  met: '●',
  partial: '◐',
  unmet: '○',
  unmentioned: '—',
};

export interface SatisfactionEvidence {
  where: 'title' | 'listing' | 'review_positive' | 'review_negative';
  quote: string;
  asin: string;
  rating?: number;
}

export interface SatisfactionCell {
  needId: string;
  needStatement: string;
  category: string;
  subCategory?: string;
  evidenceStrength: EvidenceStrength;
  status: SatisfactionStatus;
  evidence: SatisfactionEvidence[];
}

export interface SatisfactionMatrix {
  asin: string;
  cells: SatisfactionCell[];
  met: number;
  partial: number;
  unmet: number;
  unmentioned: number;
  note?: string;
}

/** 可选：listing 全文（五点/A+/参数表）。没有就只按标题 + 评论判，并标注出来 */
export interface ListingText {
  bullets?: string[];
  description?: string;
  aplus?: string;
}

/**
 * 需求满足矩阵（PRD §6.3 三块分析之 3）：需求分类（看用户）× 该竞对。
 * 判定顺序（确定性）：
 *   1. 差评命中该需求 → ○ 未满足（用户在抱怨这件事，最硬的证据）
 *   2. 好评命中该需求 → ● 满足
 *   3. 标题/五点命中但无人提及 → ◐ 部分满足（只自称，没有用户证据）
 *   4. 全不命中 → — 未提及（诚实：不知道，不是没需求）
 */
export function buildSatisfactionMatrix(
  asin: string,
  product: Product | undefined,
  reviews: Review[],
  needs: UnmetNeedCandidate[],
  listing?: ListingText
): SatisfactionMatrix {
  const list = reviewsForAsin(reviews, asin);
  const positives = list.filter((r) => Number(r.rating) >= 4);
  const negatives = list.filter(isNegative);
  const title = product?.title || '';
  const listingText = [listing?.bullets?.join(' '), listing?.description, listing?.aplus].filter(Boolean).join(' ');

  const cells: SatisfactionCell[] = needs.map((n) => {
    const ev: SatisfactionEvidence[] = [];
    let status: SatisfactionStatus = 'unmentioned';

    const negHit = negatives.filter((r) => needHitCount(reviewText(r), n) > 0);
    const posHit = positives.filter((r) => needHitCount(reviewText(r), n) > 0);
    const titleHit = needHitCount(title, n) > 0;
    const listingHit = listingText ? needHitCount(listingText, n) > 0 : false;

    if (negHit.length > 0) {
      status = 'unmet';
      ev.push(...negHit.slice(0, 2).map((r) => ({ where: 'review_negative' as const, quote: reviewText(r).slice(0, 300), asin: r.asin, rating: Number(r.rating) || 0 })));
    } else if (posHit.length > 0) {
      status = 'met';
      ev.push(...posHit.slice(0, 2).map((r) => ({ where: 'review_positive' as const, quote: reviewText(r).slice(0, 300), asin: r.asin, rating: Number(r.rating) || 0 })));
    } else if (titleHit || listingHit) {
      status = 'partial';
      if (titleHit) ev.push({ where: 'title', quote: title.slice(0, 300), asin });
      if (listingHit) ev.push({ where: 'listing', quote: listingText.slice(0, 300), asin });
    }

    const strength = computeNeedEvidenceStrength(n.evidence).level;
    return {
      needId: n.id,
      needStatement: (n.needStatement || '').trim() || '(未填写需求描述)',
      category: (n.category || '').trim() || '未分类需求',
      subCategory: (n.subCategory || '').trim() || undefined,
      evidenceStrength: strength,
      status,
      evidence: ev,
    };
  });

  return {
    asin,
    cells,
    met: cells.filter((c) => c.status === 'met').length,
    partial: cells.filter((c) => c.status === 'partial').length,
    unmet: cells.filter((c) => c.status === 'unmet').length,
    unmentioned: cells.filter((c) => c.status === 'unmentioned').length,
    note:
      list.length === 0
        ? '该 ASIN 没有评论样本：满足状态只能靠标题/listing 判为「部分满足」，不能判「满足」'
        : undefined,
  };
}

export interface PersonaDemandRef {
  needStatement: string;
  category: string;
  polarity: 'positive' | 'negative';
  evidence: QuoteRef;
}

export interface CompetitorPersona {
  asin: string;
  /** 谁在买（每条挂原文） */
  audience: { keyword: string; evidence: QuoteRef }[];
  /** 什么场景用（每条挂原文） */
  scenarios: { keyword: string; evidence: QuoteRef }[];
  /** 核心诉求排序（按该需求的评论命中数降序） */
  demands: PersonaDemandRef[];
  /** 数据不足时明确说缺什么，而不是编一个人群 */
  gaps: string[];
}

/**
 * 用户画像（PRD §6.3 三块分析之 1）：从该竞对的评论反推谁在买、什么场景、诉求排序。
 * 只做"词表命中 + 原文引用"，不做推理式编造；抽不到就写进 gaps。
 */
export function buildCompetitorPersona(
  asin: string,
  reviews: Review[],
  needs: UnmetNeedCandidate[]
): CompetitorPersona {
  const list = reviewsForAsin(reviews, asin);
  const gaps: string[] = [];
  if (list.length === 0) {
    return {
      asin,
      audience: [],
      scenarios: [],
      demands: [],
      gaps: ['该 ASIN 没有评论样本：画像无证据可反推（请先抓取评论）'],
    };
  }

  const audience: { keyword: string; evidence: QuoteRef }[] = [];
  const scenarios: { keyword: string; evidence: QuoteRef }[] = [];
  for (const r of list) {
    const text = reviewText(r);
    for (const kw of AUDIENCE_KEYWORDS) {
      if (audience.some((a) => a.keyword === kw)) continue;
      if (text.toLowerCase().includes(kw)) audience.push({ keyword: kw, evidence: quoteRef(r) });
    }
    for (const kw of SCENARIO_KEYWORDS) {
      if (scenarios.some((s) => s.keyword === kw)) continue;
      if (text.toLowerCase().includes(kw)) scenarios.push({ keyword: kw, evidence: quoteRef(r) });
    }
  }

  const demands: PersonaDemandRef[] = [];
  for (const n of needs) {
    const negHit = list.filter((r) => isNegative(r) && needHitCount(reviewText(r), n) > 0);
    const posHit = list.filter((r) => !isNegative(r) && needHitCount(reviewText(r), n) > 0);
    const polarity: 'positive' | 'negative' = negHit.length >= posHit.length && negHit.length > 0 ? 'negative' : 'positive';
    const picked = polarity === 'negative' ? negHit[0] : posHit[0];
    if (!picked) continue;
    demands.push({
      needStatement: (n.needStatement || '').trim() || '(未填写需求描述)',
      category: (n.category || '').trim() || '未分类需求',
      polarity,
      evidence: quoteRef(picked),
    });
  }
  // 按命中数排序（确定性）：先按 polarity=negative 优先，再按需求在 needs 中的顺序
  const order = new Map(needs.map((n, i) => [n.id, i]));
  demands.sort((a, b) => {
    if (a.polarity !== b.polarity) return a.polarity === 'negative' ? -1 : 1;
    const ai = needs.find((n) => (n.needStatement || '').trim() === a.needStatement)?.id ?? '';
    const bi = needs.find((n) => (n.needStatement || '').trim() === b.needStatement)?.id ?? '';
    return (order.get(ai) ?? 99) - (order.get(bi) ?? 99);
  });

  if (audience.length === 0) gaps.push('抽到的评论里没有出现人群词（无法反推"谁在买"，需要更多评论或人工补充）');
  if (scenarios.length === 0) gaps.push('抽到的评论里没有出现使用场景词（无法反推"什么场景用"）');
  if (demands.length === 0) gaps.push('评论没有覆盖到「看用户」里的任何需求（画像与需求暂时挂不上钩）');
  else {
    // 诚实报告：哪些需求在这家竞对的评论里"完全没被提到"（不等于满足，是没证据）
    const covered = new Set(demands.map((d) => d.needStatement));
    const uncovered = needs.filter((n) => !covered.has((n.needStatement || '').trim() || '(未填写需求描述)'));
    if (uncovered.length > 0) {
      gaps.push(
        `评论没有覆盖到 ${uncovered.length} 条需求：${uncovered
          .slice(0, 2)
          .map((n) => (n.needStatement || '').trim() || '(未填写需求描述)')
          .join('；')}${uncovered.length > 2 ? '…' : ''}（这些需求的画像证据只能靠人工补充）`
      );
    }
  }
  return { asin, audience, scenarios, demands, gaps };
}

/* ────────────────────────── 赢的路径 ────────────────────────── */

export type WinningPath = 'unique' | 'better' | 'cheaper' | 'none';

export const WINNING_PATH_LABELS: Record<WinningPath, string> = {
  unique: '人无我有',
  better: '人有我优',
  cheaper: '人优我廉',
  none: '无赢面',
};

/** 看自己（自身能力）里与本判定相关的部分 */
export interface OurCapability {
  /** 按需求 id 的自身能力（来自看自己的自评；缺项视为未知，不当作"能"） */
  byNeedId?: Record<string, SelfStatus>;
  /** 按需求域的能力（需求 id 缺失时的兜底口径） */
  byDemandCategory?: Record<string, SelfStatus>;
  /** 硬约束是否触发否决（毛利红线/MOQ/认证等），由看自己给出 */
  hardConstraintBlocked?: boolean;
  hardConstraintNotes?: string[];
  /** 目标售价与毛利（人优我廉的必要输入） */
  targetPrice?: number;
  /** 毛利红线，如 0.25 表示 25% */
  marginFloor?: number;
  /** 在目标售价下的预估毛利率；没给就不能判"人优我廉" */
  estimatedMarginAtTargetPrice?: number;
}

export interface UnmetNeedCrossItem {
  needId: string;
  needStatement: string;
  category: string;
  /** 需求证据强度（来自看用户的结构化证据，确定性） */
  evidenceStrength: EvidenceStrength;
  evidenceScore: number;
  /** 哪些竞对没满足（○ 未满足 / — 未提及） */
  unmetBy: string[];
  /** 哪些竞对声称满足但无用户证据（◐） */
  claimedBy: string[];
  /** 我们能不能接住 */
  ourStatus: SelfStatus | 'unknown';
}

export interface WinningPathCheck {
  path: WinningPath;
  label: string;
  holds: boolean;
  /** 判定依据（人话，含具体数字/ASIN） */
  detail: string;
}

export interface WinningPathDecision {
  path: WinningPath;
  label: string;
  /** 结论一句话（可直接放主屏） */
  conclusion: string;
  checks: WinningPathCheck[];
  /** 交叉清单：未被满足的需求 ∩ 我们能满足的部分 */
  crossList: UnmetNeedCrossItem[];
  /** 三块分析/三列对比里发现的、支撑本结论的要点 */
  reasons: string[];
  /** 落到"无赢面"时的具体卡点 */
  blockers: string[];
  /** 是否可以"直接进入"（硬约束否决时为 false） */
  canEnterDirectly: boolean;
}

function ourStatusFor(
  need: UnmetNeedCandidate,
  ours: OurCapability
): SelfStatus | 'unknown' {
  const byId = ours.byNeedId?.[need.id];
  if (byId) return byId;
  const category = (need.category || '').trim();
  const byCat = category ? ours.byDemandCategory?.[category] : undefined;
  return byCat ?? 'unknown';
}

/**
 * 赢的路径（PRD §6.3 结论部分，严格顺序）：
 * ① 人无我有：存在"三家都没做到"的需求（≥1 家明确未满足 + 其余未满足/未提及），且我们接得住
 * ② 人有我优：存在"三家都自称有、但用户抱怨"的需求（存在 ◐/○ 混合），且我们接得住
 * ③ 人优我廉：竞对普遍满足（满足数 ≥ 未满足数），但我们的目标售价低于最低竞对价且毛利仍在红线内
 * ④ 三种都不成立 → 无赢面（列出卡在哪一条）
 */
export function decideWinningPath(input: {
  needs: UnmetNeedCandidate[];
  competitors: { asin: string; price?: number }[];
  matrices: SatisfactionMatrix[];
  ours: OurCapability;
  /** 用于"人优我廉"比价：竞对最低价 */
  priceReference?: { lowestCompetitorPrice?: number; averageCompetitorPrice?: number };
}): WinningPathDecision {
  const { needs, matrices, ours } = input;
  const checks: WinningPathCheck[] = [];
  const blockers: string[] = [];
  const reasons: string[] = [];

  // 交叉清单：需求 × 各竞对状态
  const crossList: UnmetNeedCrossItem[] = needs.map((n) => {
    const cells = matrices
      .map((m) => ({ asin: m.asin, cell: m.cells.find((c) => c.needId === n.id) }))
      .filter((x) => !!x.cell);
    const unmetBy = cells.filter((x) => x.cell!.status === 'unmet' || x.cell!.status === 'unmentioned').map((x) => x.asin);
    const claimedBy = cells.filter((x) => x.cell!.status === 'partial').map((x) => x.asin);
    const ev = computeNeedEvidenceStrength(n.evidence);
    return {
      needId: n.id,
      needStatement: (n.needStatement || '').trim() || '(未填写需求描述)',
      category: (n.category || '').trim() || '未分类需求',
      evidenceStrength: ev.level,
      evidenceScore: ev.score,
      unmetBy,
      claimedBy,
      ourStatus: ourStatusFor(n, ours),
    };
  });

  const canBuild = (s: UnmetNeedCrossItem): boolean => s.ourStatus === 'have' || s.ourStatus === 'partial';

  // ① 人无我有
  const uniqueCandidates = crossList.filter(
    (s) => s.unmetBy.length === matrices.length && matrices.length > 0 && s.unmetBy.length > 0
  );
  const uniqueBuildable = uniqueCandidates.filter(canBuild);
  // 注意：硬约束**不抹掉赢面**，它只限制"进入方式"（PRD §6.4：最高只能"验证后进入"+红条警示）
  const uniqueHolds = uniqueBuildable.length > 0;
  const uniqueDetail = uniqueCandidates.length === 0
    ? (matrices.length === 0 ? '还没有任何竞对的满足矩阵，无法判断' : '没有任何需求是"三家都没做到"的')
    : `${uniqueCandidates.length} 条需求三家都没满足（${uniqueCandidates.map((s) => s.needStatement).slice(0, 2).join('；')}），其中我们能接住 ${uniqueBuildable.length} 条`;
  checks.push({
    path: 'unique',
    label: WINNING_PATH_LABELS.unique,
    holds: uniqueHolds,
    detail: uniqueHolds
      ? `${uniqueDetail}${ours.hardConstraintBlocked ? '；但存在硬约束否决（只能验证后进入）' : '；且无硬约束否决'}`
      : `${uniqueDetail}${uniqueBuildable.length === 0 ? '；我们的能力没有覆盖这些需求（或尚未自评）' : ''}`,
  });
  if (uniqueCandidates.length > 0 && uniqueBuildable.length === 0) {
    reasons.push(`存在 ${uniqueCandidates.length} 条"三家都没做到"的需求，但我们的自评没有覆盖它们（缺能力或未评）`);
  }

  // ② 人有我优：至少一家"自称满足"且至少一家"未满足/未提及"，我们接得住
  const betterCandidates = crossList.filter((s) => s.claimedBy.length > 0 && s.unmetBy.length > 0);
  const betterBuildable = betterCandidates.filter(canBuild);
  const betterHolds = !uniqueHolds && betterBuildable.length > 0;
  const painBacked = betterBuildable.filter((s) => s.evidenceScore > 0);
  const betterDetail = betterCandidates.length === 0
    ? '没有"竞对都自称有、用户却在抱怨"的需求'
    : `${betterCandidates.length} 条需求存在"自称满足但用户抱怨/未提及"（其中 ${painBacked.length} 条带确定性需求证据），我们能接住 ${betterBuildable.length} 条`;
  checks.push({
    path: 'better',
    label: WINNING_PATH_LABELS.better,
    holds: betterHolds,
    detail: betterHolds
      ? `${betterDetail}${ours.hardConstraintBlocked ? '；但存在硬约束否决（只能验证后进入）' : '；且无硬约束否决'}`
      : `${betterDetail}${betterBuildable.length === 0 ? '；我们的能力没有覆盖' : ''}`,
  });

  // ③ 人优我廉
  const avgMet = matrices.length > 0 ? matrices.reduce((s, m) => s + m.met, 0) / matrices.length : 0;
  const avgUnmet = matrices.length > 0 ? matrices.reduce((s, m) => s + m.unmet, 0) / matrices.length : 0;
  const lowest = input.priceReference?.lowestCompetitorPrice ?? (input.competitors.length > 0
    ? Math.min(...input.competitors.map((c) => Number(c.price) || Number.POSITIVE_INFINITY))
    : undefined);
  const marginOk =
    typeof ours.estimatedMarginAtTargetPrice === 'number' &&
    typeof ours.marginFloor === 'number' &&
    ours.estimatedMarginAtTargetPrice >= ours.marginFloor;
  const cheaperPrice = typeof ours.targetPrice === 'number' && typeof lowest === 'number' && Number.isFinite(lowest)
    ? ours.targetPrice < lowest
    : false;
  const competitorsSatisfy = matrices.length > 0 && avgMet >= avgUnmet && avgMet > 0;
  const cheaperHolds = !uniqueHolds && !betterHolds && competitorsSatisfy && cheaperPrice && marginOk;

  let cheaperDetail: string;
  if (matrices.length === 0) cheaperDetail = '还没有满足矩阵，无法判断竞对是否"普遍满足"';
  else if (!competitorsSatisfy) cheaperDetail = `竞对并不普遍满足（平均满足 ${avgMet.toFixed(1)} vs 未满足 ${avgUnmet.toFixed(1)} 条），低价不解决问题`;
  else if (typeof ours.targetPrice !== 'number') cheaperDetail = '没有填目标售价，无法与竞对最低价比较';
  else if (!cheaperPrice) cheaperDetail = `目标售价 $${ours.targetPrice} 不低于竞对最低价 $${typeof lowest === 'number' ? lowest : '未知'}，不构成价格优势`;
  else if (!marginOk) cheaperDetail = `价格有优势，但毛利红线不满足（预估 ${ours.estimatedMarginAtTargetPrice ?? '未填'} vs 红线 ${ours.marginFloor ?? '未填'}）`;
  else cheaperDetail = `目标售价 $${ours.targetPrice} 低于竞对最低价 $${lowest}，且毛利仍在红线内`;
  checks.push({ path: 'cheaper', label: WINNING_PATH_LABELS.cheaper, holds: cheaperHolds, detail: cheaperDetail });

  // ④ 结论
  let path: WinningPath = 'none';
  if (uniqueHolds) path = 'unique';
  else if (betterHolds) path = 'better';
  else if (cheaperHolds) path = 'cheaper';

  if (needs.length === 0) blockers.push('「看用户」里还没有需求，无法做交叉清单（先跑看用户）');
  if (matrices.length === 0) blockers.push('还没有任何竞对的满足矩阵（先在目标细分里挑 3 个竞对）');
  if (path === 'none') {
    if (!checks[0].holds) blockers.push(`人无我有不成立：${checks[0].detail}`);
    if (!checks[1].holds) blockers.push(`人有我优不成立：${checks[1].detail}`);
    if (!checks[2].holds) blockers.push(`人优我廉不成立：${checks[2].detail}`);
    if (ours.hardConstraintBlocked) blockers.push(`硬约束否决：${(ours.hardConstraintNotes ?? []).join('；') || '看自己里存在不满足的决策边界'}`);
  } else {
    if (ours.hardConstraintBlocked) {
      blockers.push(`硬约束否决：${(ours.hardConstraintNotes ?? []).join('；') || '看自己里存在不满足的决策边界'}（最高只能"验证后进入"）`);
    }
    const chosen = crossList.filter((s) => canBuild(s) && (path === 'unique' ? s.unmetBy.length === matrices.length : true));
    for (const s of chosen.slice(0, 3)) {
      reasons.push(`需求「${s.needStatement}」（${s.category}）未被 ${s.unmetBy.length} 家满足，我们能接住（自评 ${s.ourStatus === 'have' ? '已具备' : '部分具备'}）`);
    }
  }

  const label = WINNING_PATH_LABELS[path];
  const canEnterDirectly = path !== 'none' && !ours.hardConstraintBlocked;
  const conclusion =
    path === 'none'
      ? `无赢面：三条路径都不成立（${blockers.length} 个卡点，见下）`
      : `${label}：${path === 'unique' ? '存在三家都没做到、而我们能接住的需求' : path === 'better' ? '竞对自称满足但用户在抱怨，我们能做得更好' : '竞对普遍满足，但我们能在毛利红线内做到更低价'}${canEnterDirectly ? '' : '（硬约束未通过：最高只能"验证后进入"）'}`;

  return { path, label, conclusion, checks, crossList, reasons, blockers, canEnterDirectly };
}

/** 把三块分析 + 赢的路径压成给 AI 的文本（AI 只解释，不改判定） */
export function describeCompetitorAnalysisForPrompt(input: {
  roles: { asin: string; role: CompetitorRole; reason: string }[];
  painMatrices: PainMatrix[];
  satisfactionMatrices: SatisfactionMatrix[];
  personas: CompetitorPersona[];
  decision: WinningPathDecision;
}): string {
  const lines: string[] = [];
  lines.push('【竞对角色（系统按规则挑选，不可更改）】');
  for (const r of input.roles) lines.push(`- ${r.asin}｜${r.role}｜${r.reason}`);

  lines.push('【痛点未满足矩阵（差评分类，确定性）】');
  for (const m of input.painMatrices) {
    lines.push(`- ${m.asin}：评论 ${m.reviewCount} 条，差评 ${m.negativeCount} 条（${(m.negativeRate * 100).toFixed(0)}%）${m.note ? `｜${m.note}` : ''}`);
    for (const h of m.hits) {
      lines.push(`    · ${h.label} ${h.count} 条（${(h.share * 100).toFixed(0)}%）命中需求域：${h.demandCategories.join('、') || '无'}`);
    }
  }

  lines.push('【需求满足矩阵（●满足 ◐部分 ○未满足 —未提及，确定性）】');
  for (const m of input.satisfactionMatrices) {
    lines.push(`- ${m.asin}：●${m.met} ◐${m.partial} ○${m.unmet} —${m.unmentioned}`);
    for (const c of m.cells) {
      lines.push(`    · ${SATISFACTION_MARKS[c.status]} ${c.needStatement}（${c.category}）`);
    }
  }

  lines.push('【用户画像（从评论逐字反推）】');
  for (const p of input.personas) {
    lines.push(`- ${p.asin}：人群 ${p.audience.map((a) => a.keyword).join('、') || '无'}；场景 ${p.scenarios.map((s) => s.keyword).join('、') || '无'}；诉求 ${p.demands.length} 条${p.gaps.length ? `｜缺：${p.gaps.join('；')}` : ''}`);
  }

  lines.push('【赢的路径（系统确定性判定，不可更改）】');
  lines.push(`结论：${input.decision.label} — ${input.decision.conclusion}`);
  for (const c of input.decision.checks) lines.push(`- ${c.label}：${c.holds ? '成立' : '不成立'}｜${c.detail}`);
  return lines.join('\n');
}
