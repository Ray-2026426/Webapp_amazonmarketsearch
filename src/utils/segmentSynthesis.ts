// M2 · 细分三方合成（PRD §6.2 步骤 3）。
//
// 用户原话：「市场细分的逻辑没有跟上一步挂钩，需要结合竞对标题和用户板块的理解，来做市场细分」。
// 所以这里不再从"类目字段"直接读细分，而是**同时**用三个来源各自切一版：
//   ① 需求域（看用户的需求分类树，带确定性证据分）  —— 与上一步强挂钩
//   ② 商品属性（价格段 × 标题里的关键属性词）
//   ③ 竞品标题聚类（标题词频，数据自己说话）
// 产出 2-3 个可比较的"方案"，由用户做选择题（AI 只解释差异，不改分、不选方案）。
//
// 一切判定都是确定性规则（词表匹配 / 词频 / 价格分位），因此可测试、可复现。

import type { Product, HistoryRecord } from './parser';
import { computeNeedEvidenceStrength, type EvidenceStrength, type UnmetNeedCandidate } from './userLook';
import { scoreSegment, type SegmentScoreResult } from './segmentScore';

export type SchemeBasis = 'demand' | 'attribute' | 'title';

export interface NeedHit {
  needStatement: string;
  category: string;
  /** 确定性证据分 0-100（见 userLook.computeNeedEvidenceStrength） */
  evidenceScore: number;
  evidenceStrength: EvidenceStrength;
}

export interface SynthSegment {
  id: string;
  /** 人话细分名（可直接作为细分市场名使用） */
  name: string;
  /** 确定性切分规则（人话解释"凭什么这么切"） */
  rule: string;
  basis: SchemeBasis;
  asins: string[];
  productCount: number;
  /** 该细分月收入占全部样本的比例 0-1 */
  revenueShare: number;
  /** 命中的需求域（来自看用户） */
  demandCategories: string[];
  /** 命中的具体未满足需求（含证据分）——"细分有没有被需求解释"的硬证据 */
  demandHits: NeedHit[];
  /** 标题聚类关键词（③ 方案才有） */
  titleKeywords: string[];
  /** 复用 segmentScore 的确定性评分（趋势 × 体量 × 竞争 → 机会分） */
  score: SegmentScoreResult;
}

export interface SegmentScheme {
  id: string;
  name: string;
  basis: SchemeBasis;
  /** 一句话：这个方案怎么切、什么时候选它 */
  description: string;
  segments: SynthSegment[];
  /** 未被任何细分覆盖的商品数（显式暴露，不藏起来） */
  unassigned: number;
  /** 覆盖率 0-1：有多少商品被切进细分 */
  coverage: number;
  /** 需求挂钩度 0-1：有多少细分能被看用户的需求解释 */
  grounding: number;
  /** 收入加权平均机会分 0-100 */
  avgOpportunity: number;
}

export interface SegmentSynthesisInput {
  products: Product[];
  history?: HistoryRecord[];
  /** 看用户产出的未满足需求候选（含 category/subCategory/evidence） */
  needs?: UnmetNeedCandidate[];
  /** 最多保留多少个细分（默认 6，避免长尾把选择题变成阅读题） */
  maxSegmentsPerScheme?: number;
}

/** 标题里没有信息量的词（避免"for/with/pillow"这类词变成细分名） */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'our', 'are', 'was', 'were', 'has', 'have',
  'not', 'but', 'all', 'any', 'can', 'will', 'one', 'two', 'set', 'pack', 'pcs', 'piece', 'pieces', 'inch', 'inches',
  'size', 'sizes', 'new', 'best', 'premium', 'quality', 'great', 'perfect', 'ideal', 'soft', 'comfortable', 'comfy',
  'pillow', 'pillows', 'sleep', 'sleeping', 'sleeper', 'sleepers', 'bed', 'bedding', 'home', 'amazon', 'free',
  'shipping', 'warranty', 'guarantee', 'use', 'used', 'using', 'makes', 'make', 'made', 'more', 'most', 'than',
  'into', 'out', 'over', 'under', 'about', 'also', 'only', 'just', 'like', 'well', 'very', 'when', 'while', 'which',
]);

/**
 * 属性词表：把标题里的英文卖点词映射成「中文属性维度」。
 * 这是确定性的（词表固定），也是可解释的（用户能看懂为什么这个词被归到这一维）。
 */
export const ATTRIBUTE_DIMENSIONS: { id: string; label: string; tokens: string[] }[] = [
  { id: 'thin', label: '超薄/低枕', tokens: ['thin', 'flat', 'slim', 'low', 'profile', 'ultra', 'flat'] },
  { id: 'cooling', label: '降温透气', tokens: ['cooling', 'cool', 'gel', 'breathable', 'ventilated', 'bamboo'] },
  { id: 'foam', label: '记忆棉/乳胶', tokens: ['memory', 'foam', 'latex', 'certipur', 'density'] },
  { id: 'adjust', label: '可调高度', tokens: ['adjustable', 'adjust', 'loft', 'heights', 'height', 'customizable'] },
  { id: 'washable', label: '可水洗外套', tokens: ['washable', 'machine', 'removable', 'cover', 'wash'] },
  { id: 'cervical', label: '颈椎护理', tokens: ['cervical', 'neck', 'pain', 'orthopedic', 'contour', 'support'] },
  { id: 'position', label: '睡姿专向', tokens: ['stomach', 'side', 'back', 'posture', 'position'] },
];

const ATTRIBUTE_LABEL = new Map(ATTRIBUTE_DIMENSIONS.map((d) => [d.label, d]));

/** 把标题切成有信息量的词（小写、去停用词、去纯数字/单位） */
export function tokenizeTitle(title: string): string[] {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\- ]+/g, ' ')
    .split(/[\s\-]+/)
    .map((t) => t.replace(/^[.]+|[.]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+(\.\d+)?$/.test(t));
}

/** 标题命中的属性维度（确定性词表匹配） */
export function detectAttributeDimensions(title: string): string[] {
  const tokens = new Set(tokenizeTitle(title));
  return ATTRIBUTE_DIMENSIONS.filter((d) => d.tokens.some((t) => tokens.has(t))).map((d) => d.label);
}

/** 取某条需求用于匹配商品的词（AI 给的关键词优先，其次从需求原文抽英文词） */
export function needTokens(need: UnmetNeedCandidate): string[] {
  const fromEvidence = (need.evidence?.keywords ?? []).map((k) => String(k.word || '').toLowerCase().trim());
  const fromText = tokenizeTitle(`${need.needStatement || ''} ${need.subCategory || ''}`);
  const set = new Set<string>();
  for (const t of [...fromEvidence, ...fromText]) {
    const clean = t.replace(/[^a-z0-9 \-]/g, '').trim();
    if (clean.length >= 3 && !STOPWORDS.has(clean)) set.add(clean);
  }
  return [...set];
}

function totalRevenue(products: Product[]): number {
  return products.reduce((s, p) => s + (p.monthlyRevenue || 0), 0) || 1;
}

/** 价格分位切三段（用排序后的分位点，空/单商品时退化为一段） */
export function priceBands(products: Product[]): { label: string; min: number; max: number }[] {
  const prices = products.map((p) => p.price || 0).filter((v) => v > 0).sort((a, b) => a - b);
  if (prices.length === 0) return [{ label: '全部价格段', min: 0, max: Infinity }];
  const q = (f: number) => prices[Math.min(prices.length - 1, Math.floor(prices.length * f))];
  const p33 = q(0.33);
  const p66 = q(0.66);
  const fmt = (v: number) => `$${Math.round(v)}`;
  const bands = [
    { label: `低价段 ($0–${fmt(p33)})`, min: 0, max: p33 + 0.001 },
    { label: `中价段 (${fmt(p33)}–${fmt(p66)})`, min: p33 + 0.001, max: p66 + 0.001 },
    { label: `高价段 (>${fmt(p66)})`, min: p66 + 0.001, max: Infinity },
  ];
  return bands.filter((b, i) => i === 0 || b.max > b.min);
}

/** 需求 → 商品匹配：商品标题命中该需求的词即算命中 */
function productMatchesNeed(p: Product, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const title = ` ${String(p.title || '').toLowerCase()} `;
  let hits = 0;
  for (const t of tokens) if (title.includes(t)) hits += 1;
  return hits;
}

/** 给一个细分算出"命中哪些需求"（用于需求挂钩度，不做任何编造：匹配不到就是空数组） */
function computeDemandHits(segProducts: Product[], needs: UnmetNeedCandidate[], forcedCategory?: string): NeedHit[] {
  const hits: NeedHit[] = [];
  for (const need of needs) {
    const category = (need.category || '').trim() || '未分类需求';
    if (forcedCategory && category !== forcedCategory) continue;
    const tokens = needTokens(need);
    const matched = tokens.length > 0 && segProducts.some((p) => productMatchesNeed(p, tokens) > 0);
    // 需求域方案下，该域内的需求天然属于本细分；此时即使标题不命中也不算编造
    if (!matched && !(forcedCategory && tokens.length === 0)) continue;
    const ev = computeNeedEvidenceStrength(need.evidence);
    hits.push({
      needStatement: (need.needStatement || '').trim() || '(未填写需求描述)',
      category,
      evidenceScore: ev.score,
      evidenceStrength: ev.level,
    });
  }
  return hits;
}

function makeSegment(
  basis: SchemeBasis,
  id: string,
  name: string,
  rule: string,
  segProducts: Product[],
  history: HistoryRecord[],
  needs: UnmetNeedCandidate[],
  allRevenue: number,
  extra?: { forcedCategory?: string; titleKeywords?: string[] }
): SynthSegment {
  return {
    id,
    name,
    rule,
    basis,
    asins: segProducts.map((p) => p.asin),
    productCount: segProducts.length,
    revenueShare: Math.round((segProducts.reduce((s, p) => s + (p.monthlyRevenue || 0), 0) / allRevenue) * 1000) / 1000,
    demandCategories: [
      ...new Set(
        computeDemandHits(segProducts, needs, extra?.forcedCategory).map((h) => h.category)
      ),
    ],
    demandHits: computeDemandHits(segProducts, needs, extra?.forcedCategory),
    titleKeywords: extra?.titleKeywords ?? [],
    score: scoreSegment(name, segProducts, history),
  };
}

function finalizeScheme(
  id: string,
  name: string,
  basis: SchemeBasis,
  description: string,
  segments: SynthSegment[],
  products: Product[],
  maxSegments: number
): SegmentScheme {
  // 按收入降序保留前 N 个细分（长尾合并计数进 unassigned，不做"其他"细分以免掩盖长尾）
  const sorted = [...segments].sort((a, b) => b.revenueShare - a.revenueShare || a.name.localeCompare(b.name));
  const kept = sorted.slice(0, maxSegments);
  const keptAsins = new Set(kept.flatMap((s) => s.asins));
  const unassigned = products.filter((p) => !keptAsins.has(p.asin)).length;
  const covered = products.length - unassigned;
  const withDemand = kept.filter((s) => s.demandHits.length > 0).length;
  const revWeight = kept.reduce((s, x) => s + (x.revenueShare || 0), 0);
  const avgOpportunity =
    revWeight > 0
      ? Math.round(kept.reduce((s, x) => s + x.score.opportunity * (x.revenueShare || 0), 0) / revWeight)
      : 0;
  return {
    id,
    name,
    basis,
    description,
    segments: kept,
    unassigned,
    coverage: products.length > 0 ? Math.round((covered / products.length) * 1000) / 1000 : 0,
    grounding: kept.length > 0 ? Math.round((withDemand / kept.length) * 1000) / 1000 : 0,
    avgOpportunity,
  };
}

/** ① 需求域方案：细分 = 看用户的需求域（与上一步强挂钩） */
function buildDemandScheme(
  products: Product[],
  history: HistoryRecord[],
  needs: UnmetNeedCandidate[],
  maxSegments: number
): SegmentScheme {
  const allRevenue = totalRevenue(products);
  const categories = [...new Set(needs.map((n) => (n.category || '').trim() || '未分类需求'))];
  const tokensByCategory = new Map<string, string[]>();
  for (const category of categories) {
    const catNeeds = needs.filter((n) => ((n.category || '').trim() || '未分类需求') === category);
    tokensByCategory.set(category, [...new Set(catNeeds.flatMap((n) => needTokens(n)))]);
  }

  // 单归属：一个商品只进"命中词最多"的那个需求域（平局按需求域出现顺序），保证是真正的切分
  const members = new Map<string, Product[]>(categories.map((c) => [c, []]));
  for (const p of products) {
    let bestCategory: string | null = null;
    let bestHits = 0;
    for (const category of categories) {
      const hits = productMatchesNeed(p, tokensByCategory.get(category) || []);
      if (hits > bestHits) {
        bestHits = hits;
        bestCategory = category;
      }
    }
    if (bestCategory) members.get(bestCategory)!.push(p);
  }

  const segments: SynthSegment[] = [];
  for (const category of categories) {
    const segProducts = members.get(category) || [];
    if (segProducts.length === 0) continue;
    const catNeeds = needs.filter((n) => ((n.category || '').trim() || '未分类需求') === category);
    const subs = [...new Set(catNeeds.map((n) => (n.subCategory || '').trim()).filter(Boolean))];
    const tokens = tokensByCategory.get(category) || [];
    segments.push(
      makeSegment(
        'demand',
        `demand:${category}`,
        category,
        tokens.length > 0
          ? `标题命中需求词 ${tokens.slice(0, 4).join(' / ')}${subs.length ? `；子需求：${subs.join('、')}` : ''}`
          : `需求域「${category}」下暂无标题可匹配的关键词`,
        segProducts,
        history,
        needs,
        allRevenue,
        { forcedCategory: category }
      )
    );
  }

  return finalizeScheme(
    'demand',
    '方案 A · 按需求域切（与看用户直接挂钩）',
    'demand',
    '细分名称就是看用户里的需求域，商品按"标题是否命中该需求的词"归属（一个商品只归一个需求域）。选它的理由：结论能直接回到用户需求与 VOC 证据，最适合判断"这个机会值不值得做"。',
    segments,
    products,
    maxSegments
  );
}

/** ② 商品属性方案：价格段 × 最强属性维度（两两互斥，必须切满） */
function buildAttributeScheme(
  products: Product[],
  history: HistoryRecord[],
  needs: UnmetNeedCandidate[],
  maxSegments: number
): SegmentScheme {
  const allRevenue = totalRevenue(products);
  const bands = priceBands(products);
  // 选出样本里最普遍的两个属性维度（词表命中数排序，平局按词表顺序，保证确定性）
  const dimCount = ATTRIBUTE_DIMENSIONS.map((d) => ({
    d,
    count: products.filter((p) => detectAttributeDimensions(p.title).includes(d.label)).length,
  }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || ATTRIBUTE_DIMENSIONS.indexOf(a.d) - ATTRIBUTE_DIMENSIONS.indexOf(b.d));
  const primary = dimCount[0]?.d;

  const segments: SynthSegment[] = [];
  for (const band of bands) {
    const inBand = products.filter((p) => (p.price || 0) >= band.min && (p.price || 0) < band.max);
    if (inBand.length === 0) continue;
    if (!primary) {
      // 没有可用属性维度时退化为纯价格段（仍然是一个完整切分）
      segments.push(
        makeSegment('attribute', `attr:${band.label}`, band.label, `价格落在 ${band.label}`, inBand, history, needs, allRevenue)
      );
      continue;
    }
    // 有属性维度时：band × 打/不打该属性 = 两两互斥，合起来正好等于整个价格段
    const withAttr = inBand.filter((p) => detectAttributeDimensions(p.title).includes(primary.label));
    const withoutAttr = inBand.filter((p) => !detectAttributeDimensions(p.title).includes(primary.label));
    if (withAttr.length > 0) {
      segments.push(
        makeSegment(
          'attribute',
          `attr:${band.label}:${primary.id}`,
          `${band.label} · 主打${primary.label}`,
          `价格在 ${band.label} 且标题含「${primary.label}」词`,
          withAttr,
          history,
          needs,
          allRevenue
        )
      );
    }
    if (withoutAttr.length > 0) {
      segments.push(
        makeSegment(
          'attribute',
          `attr:${band.label}:no-${primary.id}`,
          `${band.label} · 不打${primary.label}`,
          `价格在 ${band.label} 但标题不含「${primary.label}」词`,
          withoutAttr,
          history,
          needs,
          allRevenue
        )
      );
    }
  }

  return finalizeScheme(
    'attribute',
    '方案 B · 按价格段 × 商品属性切',
    'attribute',
    primary
      ? `先按价格分三段，段内再按样本里最普遍的商品属性「${primary.label}」对半分（互斥）。选它的理由：直接对应"我能定什么价、我卖什么卖点"，便于算利润与定价。`
      : '按价格分三段。选它的理由：直接对应"我能定什么价"，便于算利润与定价。',
    segments,
    products,
    maxSegments
  );
}

/** ③ 竞品标题聚类方案：标题词频说话（单归属） */
function buildTitleScheme(
  products: Product[],
  history: HistoryRecord[],
  needs: UnmetNeedCandidate[],
  maxSegments: number
): SegmentScheme {
  const allRevenue = totalRevenue(products);
  // 词频 = 出现在多少个标题里（document frequency），平局按字母序，保证可复现
  const df = new Map<string, number>();
  const tokensByAsin = new Map<string, string[]>();
  for (const p of products) {
    const tokens = [...new Set(tokenizeTitle(p.title))];
    tokensByAsin.set(p.asin, tokens);
    for (const t of tokens) df.set(t, (df.get(t) || 0) + 1);
  }
  const seeds = [...df.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, Math.min(4, maxSegments))) // 最多 4 个词簇，保持选择题可读
    .map(([t]) => t);

  // 单归属：命中多个种子时归给"词频更高"的那个（seeds 已按词频降序，取第一个命中即可）
  const members = new Map<string, Product[]>(seeds.map((s) => [s, []]));
  for (const p of products) {
    const tokens = tokensByAsin.get(p.asin) || [];
    const seed = seeds.find((s) => tokens.includes(s));
    if (seed) members.get(seed)!.push(p);
  }

  const segments: SynthSegment[] = [];
  for (const seed of seeds) {
    const segProducts = members.get(seed) || [];
    if (segProducts.length === 0) continue;
    const label = ATTRIBUTE_DIMENSIONS.find((d) => d.tokens.includes(seed))?.label ?? null;
    segments.push(
      makeSegment(
        'title',
        `title:${seed}`,
        label ? `标题词簇「${seed}」（${label}）` : `标题词簇「${seed}」`,
        `标题里出现「${seed}」的商品（共 ${segProducts.length} 个，一个商品只归一个词簇）`,
        segProducts,
        history,
        needs,
        allRevenue,
        { titleKeywords: [seed] }
      )
    );
  }

  return finalizeScheme(
    'title',
    '方案 C · 按竞品标题聚类切',
    'title',
    '让数据自己说话：按标题里出现频率最高的几个词切，一个商品只归一个词簇。选它的理由：这是"竞对实际在打什么卖点"的客观切法，适合找被反复强调、却仍被差评的点。',
    segments,
    products,
    maxSegments
  );
}

/** 三方合成：产出 2-3 个可比较的方案（确定性，顺序固定 A/B/C） */
export function synthesizeSegmentSchemes(input: SegmentSynthesisInput): SegmentScheme[] {
  const products = Array.isArray(input.products) ? input.products : [];
  const history = Array.isArray(input.history) ? input.history : [];
  const needs = Array.isArray(input.needs) ? input.needs : [];
  const maxSegments = Math.max(1, input.maxSegmentsPerScheme ?? 6);
  if (products.length === 0) return [];

  return [
    buildDemandScheme(products, history, needs, maxSegments),
    buildAttributeScheme(products, history, needs, maxSegments),
    buildTitleScheme(products, history, needs, maxSegments),
  ];
}

export interface SchemeRecommendation {
  schemeId: string;
  /** 排序后的比较结果（第一名即推荐） */
  ranking: { schemeId: string; name: string; score: number; reasons: string[] }[];
  /** 一句话推荐理由（人话，可放进主屏结论） */
  reason: string;
}

/**
 * 确定性推荐方案（AI 不做这个决定）：
 * 需求挂钩度 50% + 覆盖率 30% + 收入加权机会分 20%；
 * 分数相同则优先"需求域"方案（因为它直接接上看用户，PRD 原则：看用户是需求分类的枢纽）。
 */
export function recommendScheme(schemes: SegmentScheme[]): SchemeRecommendation | null {
  const usable = schemes.filter((s) => s.segments.length > 0);
  if (usable.length === 0) return null;
  const basisRank: Record<SchemeBasis, number> = { demand: 0, attribute: 1, title: 2 };
  const scored = usable.map((s) => {
    const score = Math.round((s.grounding * 0.5 + s.coverage * 0.3 + (s.avgOpportunity / 100) * 0.2) * 100) / 100;
    const reasons = [
      `需求挂钩度 ${(s.grounding * 100).toFixed(0)}%（${s.segments.filter((x) => x.demandHits.length > 0).length}/${s.segments.length} 个细分能被看用户的需求解释）`,
      `覆盖率 ${(s.coverage * 100).toFixed(0)}%（${s.unassigned} 个商品未归属）`,
      `收入加权机会分 ${s.avgOpportunity}/100`,
    ];
    return { schemeId: s.id, name: s.name, score, reasons };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      basisRank[usable.find((s) => s.id === a.schemeId)!.basis] - basisRank[usable.find((s) => s.id === b.schemeId)!.basis]
  );
  const top = scored[0];
  const best = usable.find((s) => s.id === top.schemeId)!;
  return {
    schemeId: top.schemeId,
    ranking: scored,
    reason: `建议先用「${best.name}」：${top.reasons[0]}，${top.reasons[1]}。这只是建议，最终方案由你选。`,
  };
}

/** 把方案压缩成给 AI 的文本（AI 只解释差异与风险，不改分、不换方案） */
export function describeSchemesForPrompt(schemes: SegmentScheme[]): string {
  if (schemes.length === 0) return '（没有可用细分方案：数据不足）';
  const lines: string[] = [];
  for (const s of schemes) {
    lines.push(`【${s.name}】覆盖率 ${(s.coverage * 100).toFixed(0)}%，需求挂钩度 ${(s.grounding * 100).toFixed(0)}%，收入加权机会分 ${s.avgOpportunity}`);
    for (const seg of s.segments) {
      lines.push(
        `  - ${seg.name}｜规则：${seg.rule}｜商品 ${seg.productCount} 个｜收入占比 ${(seg.revenueShare * 100).toFixed(1)}%｜` +
          `机会分 ${seg.score.opportunity}（趋势 ${seg.score.trend}/体量 ${seg.score.volume}/竞争 ${seg.score.competition}）｜` +
          `匹配到的未满足需求：${seg.demandHits.length ? seg.demandHits.map((h) => `${h.needStatement}(证据分 ${h.evidenceScore})`).join('；') : '无'}`
      );
    }
  }
  return lines.join('\n');
}

/** 属性维度标签查询（UI 用） */
export function attributeLabelForToken(token: string): string | null {
  return ATTRIBUTE_DIMENSIONS.find((d) => d.tokens.includes(token))?.label ?? null;
}

export function attributeDimensionExists(label: string): boolean {
  return ATTRIBUTE_LABEL.has(label);
}
