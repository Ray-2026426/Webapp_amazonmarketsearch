// M3 · 看竞对三块分析 + 赢的路径（确定性判定）测试。
// 锁住的核心行为：差评分类单归属、满足矩阵四态判定顺序、画像只认原文、赢的路径严格三选一或"无赢面"。
import assert from 'node:assert/strict';

import {
  classifyPainCategory,
  buildPainMatrix,
  buildSatisfactionMatrix,
  buildCompetitorPersona,
  decideWinningPath,
  reviewsForAsin,
  describeCompetitorAnalysisForPrompt,
  PAIN_CATEGORY_LABELS,
} from '../src/utils/competitorAnalysis';
import type { Product, Review } from '../src/utils/parser';
import type { UnmetNeedCandidate } from '../src/utils/userLook';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log('  OK ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL ' + name);
    console.error('    ' + (e instanceof Error ? e.message : String(e)));
  }
}

let seq = 0;
function mkReview(over: Partial<Review>): Review {
  seq += 1;
  return {
    id: `r${seq}`,
    asin: 'B0AAA',
    title: '',
    content: '',
    rating: 5,
    date: '2025-01-01',
    helpful: 0,
    ...over,
  };
}

function mkNeed(over: Partial<UnmetNeedCandidate>): UnmetNeedCandidate {
  seq += 1;
  return {
    id: `n${seq}`,
    targetUser: '',
    scenario: '',
    jobToBeDone: '',
    needStatement: '',
    currentAlternative: '',
    evidenceStrength: 'medium',
    ...over,
  };
}

function mkProduct(over: Partial<Product>): Product {
  seq += 1;
  return {
    asin: `B0PROD${seq}`,
    sku: '',
    brand: 'B',
    title: '',
    image: '',
    monthlySales: 0,
    monthlyRevenue: 0,
    price: 30,
    rating: 4,
    reviewCount: 0,
    reviewGrowth: 0,
    sellerCount: 1,
    weight: 0,
    volume: 0,
    launchDate: '',
    daysSinceLaunch: 100,
    buyBoxType: '',
    sellerLocation: '',
    fbaFee: 0,
    subBsr: 0,
    subCategory: '',
    ...over,
  };
}

const NEED_ADJ = mkNeed({
  id: 'need-adj',
  category: '功能需求',
  subCategory: '高度可调',
  needStatement: 'adjustable pillow',
  evidence: { keywords: [{ word: 'adjustable' }], reviewQuotes: [{ quote: 'q' }], asins: ['B0AAA'] },
});
const NEED_THIN = mkNeed({
  id: 'need-thin',
  category: '体感需求',
  needStatement: 'thin flat pillow',
  evidence: { keywords: [{ word: 'thin' }] },
});

console.log('competitor analysis');

test('差评分类：命中最多者胜出，单归属；全不命中 → 其他', () => {
  assert.equal(classifyPainCategory(mkReview({ content: 'poor quality and stitching came apart, flimsy' })), 'quality');
  assert.equal(classifyPainCategory(mkReview({ content: 'way too thick, does not fit my pillowcase' })), 'size_fit');
  assert.equal(classifyPainCategory(mkReview({ content: 'chemical smell for days' })), 'smell');
  // 无任何痛点词（注意：arrived/packaging 等属于物流类，专门放在下面单独断言）
  assert.equal(classifyPainCategory(mkReview({ content: 'love it, perfect gift for my sister' })), 'other');
  assert.equal(classifyPainCategory(mkReview({ content: 'box arrived crushed, bad packaging' })), 'logistics');
  assert.equal(PAIN_CATEGORY_LABELS.size_fit, '尺寸/适配');
});

test('reviewsForAsin：父/子 ASIN 变体评论都算这个 ASIN 的', () => {
  const reviews = [
    mkReview({ asin: 'B0AAA' }),
    mkReview({ asin: 'B0CHILD', parentAsin: 'B0AAA' }),
    mkReview({ asin: 'B0OTHER' }),
  ];
  assert.equal(reviewsForAsin(reviews, 'B0AAA').length, 2);
});

test('痛点矩阵：只有 1-3 星算差评，占比按差评总数算', () => {
  const reviews = [
    mkReview({ asin: 'B0AAA', rating: 2, content: 'poor quality, flimsy' }),
    mkReview({ asin: 'B0AAA', rating: 1, content: 'cheap material, defect' }),
    mkReview({ asin: 'B0AAA', rating: 3, content: 'too thin, wrong size for my pillowcase' }),
    mkReview({ asin: 'B0AAA', rating: 5, content: 'great pillow' }),
    mkReview({ asin: 'B0AAA', rating: 4, content: 'good' }),
  ];
  const m = buildPainMatrix('B0AAA', reviews, [NEED_THIN]);
  assert.equal(m.reviewCount, 5);
  assert.equal(m.negativeCount, 3);
  assert.equal(m.negativeRate, 0.6);
  const quality = m.hits.find((h) => h.category === 'quality')!;
  assert.equal(quality.count, 2);
  assert.equal(quality.share, 0.667, '2/3 差评');
  const sizeFit = m.hits.find((h) => h.category === 'size_fit')!;
  assert.equal(sizeFit.count, 1);
  assert.ok(sizeFit.demandCategories.includes('体感需求'), 'thin/flat 命中 thin 需求域');
  assert.ok(quality.quotes[0].quote.includes('quality'), '必须挂逐字原文');
  // 排序：占比降序
  assert.equal(m.hits[0].category, 'quality');
});

test('痛点矩阵：没有差评 / 没有评论时不假装"无痛点"', () => {
  const noNeg = buildPainMatrix('B0AAA', [mkReview({ asin: 'B0AAA', rating: 5, content: 'love' })], []);
  assert.equal(noNeg.hits.length, 0);
  assert.ok(noNeg.note?.includes('没有 1-3 星差评'));
  const none = buildPainMatrix('B0AAA', [], []);
  assert.equal(none.hits.length, 0);
  assert.ok(none.note?.includes('没有评论样本'));
  assert.ok(none.note?.includes('不是"没有痛点"'));
});

test('满足矩阵：差评命中 → ○未满足（最硬证据优先于一切）', () => {
  const reviews = [
    mkReview({ asin: 'B0AAA', rating: 2, content: 'not adjustable at all, waste' }),
    mkReview({ asin: 'B0AAA', rating: 5, content: 'adjustable height is great' }),
  ];
  const m = buildSatisfactionMatrix('B0AAA', mkProduct({ title: 'Adjustable Memory Foam Pillow' }), reviews, [NEED_ADJ]);
  assert.equal(m.cells[0].status, 'unmet');
  assert.ok(m.cells[0].evidence.some((e) => e.where === 'review_negative'));
  assert.equal(m.unmet, 1);
});

test('满足矩阵：好评命中 → ●满足；只靠标题自称 → ◐部分；全无 → —未提及', () => {
  const reviews = [mkReview({ asin: 'B0AAA', rating: 5, content: 'the adjustable height finally fixed my neck' })];
  const met = buildSatisfactionMatrix('B0AAA', undefined, reviews, [NEED_ADJ]);
  assert.equal(met.cells[0].status, 'met');

  const claimed = buildSatisfactionMatrix('B0AAA', mkProduct({ title: 'Adjustable Pillow' }), [], [NEED_ADJ]);
  assert.equal(claimed.cells[0].status, 'partial', '没有评论证据只能算部分满足');
  assert.ok(claimed.cells[0].evidence.some((e) => e.where === 'title'));
  assert.ok(claimed.note?.includes('不能判「满足」'));

  const unknown = buildSatisfactionMatrix('B0AAA', mkProduct({ title: 'Memory Foam Pillow' }), [mkReview({ asin: 'B0AAA', content: 'ok' })], [NEED_ADJ]);
  assert.equal(unknown.cells[0].status, 'unmentioned');
  assert.equal(unknown.cells[0].evidence.length, 0);
});

test('满足矩阵：listing 五点命中算部分满足，并标出证据来源', () => {
  const m = buildSatisfactionMatrix('B0AAA', undefined, [], [NEED_ADJ], {
    bullets: ['ADJUSTABLE HEIGHT: 5 lofts to choose'],
  });
  assert.equal(m.cells[0].status, 'partial');
  assert.ok(m.cells[0].evidence.some((e) => e.where === 'listing'));
});

test('用户画像：人群/场景/诉求都挂原文，抽不到就写缺什么', () => {
  const reviews = [
    mkReview({ asin: 'B0AAA', rating: 5, content: 'I am a side sleeper and use it when camping, the adjustable loft helps' }),
    mkReview({ asin: 'B0AAA', rating: 2, content: 'not adjustable at all, terrible' }),
  ];
  const p = buildCompetitorPersona('B0AAA', reviews, [NEED_ADJ, NEED_THIN]);
  assert.ok(p.audience.some((a) => a.keyword === 'side sleeper'));
  assert.ok(p.scenarios.some((s) => s.keyword === 'camping'));
  assert.ok(p.audience[0].evidence.quote.includes('side sleeper'), '画像必须挂逐字原文');
  const adj = p.demands.find((d) => d.needStatement.includes('adjustable'))!;
  assert.equal(adj.polarity, 'negative', '差评提到该需求 → 负向诉求排前');
  assert.ok(p.gaps.some((g) => g.includes('thin flat pillow')), '没被评论覆盖的需求要说明挂不上钩');

  const empty = buildCompetitorPersona('B0XXX', [], [NEED_ADJ]);
  assert.deepEqual(empty.audience, []);
  assert.ok(empty.gaps[0].includes('没有评论样本'));
});

console.log('winning path');

const REASONS_OK = { hardConstraintBlocked: false };

test('人无我有：三家都未满足且我们接得住 → unique', () => {
  const matrices = ['B0A1', 'B0A2', 'B0A3'].map((asin) =>
    buildSatisfactionMatrix(asin, mkProduct({ title: 'Memory Foam Pillow' }), [], [NEED_ADJ])
  );
  const d = decideWinningPath({
    needs: [NEED_ADJ],
    competitors: [{ asin: 'B0A1' }, { asin: 'B0A2' }, { asin: 'B0A3' }],
    matrices,
    ours: { ...REASONS_OK, byNeedId: { 'need-adj': 'have' } },
  });
  assert.equal(d.path, 'unique');
  assert.equal(d.label, '人无我有');
  assert.equal(d.crossList[0].unmetBy.length, 3);
  assert.equal(d.crossList[0].ourStatus, 'have');
  assert.equal(d.canEnterDirectly, true);
  assert.ok(d.conclusion.includes('人无我有'));
});

test('人有我优：竞对都自称有但用户在抱怨 → better（且优先于 cheaper）', () => {
  const cheapOurs = { ...REASONS_OK, byNeedId: { 'need-adj': 'partial' as const }, targetPrice: 10, marginFloor: 0.2, estimatedMarginAtTargetPrice: 0.3 };
  const withClaimAndPain = buildSatisfactionMatrix(
    'B0A1',
    mkProduct({ title: 'Adjustable Pillow' }),
    [mkReview({ asin: 'B0A1', rating: 2, content: 'not adjustable at all' })],
    [NEED_ADJ]
  );
  const claimed = buildSatisfactionMatrix('B0A2', mkProduct({ title: 'Adjustable Pillow' }), [], [NEED_ADJ]);
  const unknown = buildSatisfactionMatrix('B0A3', mkProduct({ title: 'Plain Pillow' }), [], [NEED_ADJ]);
  const d = decideWinningPath({
    needs: [NEED_ADJ],
    competitors: [{ asin: 'B0A1', price: 40 }, { asin: 'B0A2', price: 45 }, { asin: 'B0A3', price: 50 }],
    matrices: [withClaimAndPain, claimed, unknown],
    ours: cheapOurs,
  });
  assert.equal(d.path, 'better', '① 不成立（有 ◐/○ 混合但非三家全无）→ 走 ②');
  assert.ok(d.checks.find((c) => c.path === 'unique')!.holds === false);
  assert.ok(d.checks.find((c) => c.path === 'better')!.holds === true);
});

test('人优我廉：竞对普遍满足 + 我们更低且毛利在红线内 → cheaper', () => {
  const goodReviews = [mkReview({ rating: 5, content: 'the adjustable height is perfect for me' })];
  const matrices = ['B0A1', 'B0A2'].map((asin) =>
    buildSatisfactionMatrix(asin, mkProduct({ title: 'Adjustable Pillow' }), goodReviews.map((r) => ({ ...r, asin })), [NEED_ADJ])
  );
  const d = decideWinningPath({
    needs: [NEED_ADJ],
    competitors: [{ asin: 'B0A1', price: 40 }, { asin: 'B0A2', price: 45 }],
    matrices,
    ours: { ...REASONS_OK, targetPrice: 32, marginFloor: 0.2, estimatedMarginAtTargetPrice: 0.25 },
  });
  assert.equal(d.path, 'cheaper');
  assert.ok(d.checks.find((c) => c.path === 'cheaper')!.detail.includes('低于竞对最低价'));
});

test('人优我廉：毛利达不到红线 → 不成立（红线优先于低价）', () => {
  const goodReviews = [mkReview({ rating: 5, content: 'adjustable height perfect' })];
  const matrices = ['B0A1'].map((asin) =>
    buildSatisfactionMatrix(asin, mkProduct({ title: 'Adjustable Pillow' }), goodReviews.map((r) => ({ ...r, asin })), [NEED_ADJ])
  );
  const d = decideWinningPath({
    needs: [NEED_ADJ],
    competitors: [{ asin: 'B0A1', price: 40 }],
    matrices,
    ours: { ...REASONS_OK, targetPrice: 32, marginFloor: 0.3, estimatedMarginAtTargetPrice: 0.25 },
  });
  assert.equal(d.path, 'none');
  assert.ok(d.checks.find((c) => c.path === 'cheaper')!.detail.includes('毛利红线不满足'));
  assert.ok(d.blockers.some((b) => b.includes('人优我廉不成立')));
});

test('无赢面：三条都不成立时必须显式落到 none，并列出每个卡点', () => {
  const goodReviews = [mkReview({ rating: 5, content: 'adjustable height perfect' })];
  const matrices = ['B0A1', 'B0A2', 'B0A3'].map((asin) =>
    buildSatisfactionMatrix(asin, mkProduct({ title: 'Adjustable Pillow' }), goodReviews.map((r) => ({ ...r, asin })), [NEED_ADJ])
  );
  const d = decideWinningPath({
    needs: [NEED_ADJ],
    competitors: [{ asin: 'B0A1', price: 40 }, { asin: 'B0A2', price: 41 }, { asin: 'B0A3', price: 42 }],
    matrices,
    ours: { ...REASONS_OK }, // 没填目标售价、没评能力
  });
  assert.equal(d.path, 'none');
  assert.equal(d.label, '无赢面');
  assert.equal(d.canEnterDirectly, false);
  assert.equal(d.blockers.filter((b) => b.includes('不成立')).length, 3, '三条路径都要写清为什么不成立');
  assert.ok(d.conclusion.startsWith('无赢面'));
});

test('硬约束否决：即使有人无我有，也不能"直接进入"', () => {
  const matrices = ['B0A1', 'B0A2'].map((asin) =>
    buildSatisfactionMatrix(asin, mkProduct({ title: 'Plain' }), [], [NEED_ADJ])
  );
  const d = decideWinningPath({
    needs: [NEED_ADJ],
    competitors: [{ asin: 'B0A1' }, { asin: 'B0A2' }],
    matrices,
    ours: { hardConstraintBlocked: true, hardConstraintNotes: ['毛利红线达不到'], byNeedId: { 'need-adj': 'have' } },
  });
  assert.equal(d.canEnterDirectly, false);
  assert.ok(d.conclusion.includes('验证后进入'));
  assert.ok(d.blockers.some((b) => b.includes('硬约束否决') && b.includes('毛利红线')));
});

test('缺数据不造假：没有需求/没有矩阵时给 none 并说明缺什么', () => {
  const d = decideWinningPath({ needs: [], competitors: [], matrices: [], ours: {} });
  assert.equal(d.path, 'none');
  assert.ok(d.blockers.some((b) => b.includes('还没有需求')));
  assert.ok(d.blockers.some((b) => b.includes('满足矩阵')));
  assert.deepEqual(d.crossList, []);
});

test('交叉清单：按需求域汇总"谁没满足"，并带上我们自己的状态', () => {
  const unmet = buildSatisfactionMatrix('B0A1', mkProduct({ title: 'Plain' }), [], [NEED_ADJ, NEED_THIN]);
  const met = buildSatisfactionMatrix(
    'B0A2',
    mkProduct({ title: 'Adjustable Pillow' }),
    [mkReview({ asin: 'B0A2', rating: 5, content: 'adjustable height is great' })],
    [NEED_ADJ, NEED_THIN]
  );
  const d = decideWinningPath({
    needs: [NEED_ADJ, NEED_THIN],
    competitors: [{ asin: 'B0A1' }, { asin: 'B0A2' }],
    matrices: [unmet, met],
    ours: { byDemandCategory: { 功能需求: 'partial' } },
  });
  const adjRow = d.crossList.find((c) => c.needId === 'need-adj')!;
  assert.deepEqual(adjRow.unmetBy, ['B0A1']);
  assert.equal(adjRow.ourStatus, 'partial', '按需求域兜底匹配自身能力');
  const thinRow = d.crossList.find((c) => c.needId === 'need-thin')!;
  assert.equal(thinRow.ourStatus, 'unknown', '没评过就是 unknown，不当作"能"');
});

test('describeCompetitorAnalysisForPrompt：把判定与证据一起给 AI，明确不可更改', () => {
  const matrices = ['B0A1', 'B0A2'].map((asin) =>
    buildSatisfactionMatrix(asin, mkProduct({ title: 'Plain' }), [], [NEED_ADJ])
  );
  const decision = decideWinningPath({
    needs: [NEED_ADJ],
    competitors: [{ asin: 'B0A1' }, { asin: 'B0A2' }],
    matrices,
    ours: { byNeedId: { 'need-adj': 'have' } },
  });
  const text = describeCompetitorAnalysisForPrompt({
    roles: [{ asin: 'B0A1', role: 'head', reason: '月收入最高' }],
    painMatrices: [buildPainMatrix('B0A1', [], [NEED_ADJ])],
    satisfactionMatrices: matrices,
    personas: [buildCompetitorPersona('B0A1', [], [NEED_ADJ])],
    decision,
  });
  assert.ok(text.includes('竞对角色'));
  assert.ok(text.includes('痛点未满足矩阵'));
  assert.ok(text.includes('需求满足矩阵'));
  assert.ok(text.includes('用户画像'));
  assert.ok(text.includes('赢的路径'));
  assert.ok(text.includes(decision.label));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
