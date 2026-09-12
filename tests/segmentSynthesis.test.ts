// M2 · 细分三方合成测试（PRD §6.2 步骤 3）。
// 锁住的核心行为：细分必须与「看用户」的需求挂钩，且切分规则完全确定性、可复现。
import assert from 'node:assert/strict';

import {
  synthesizeSegmentSchemes,
  recommendScheme,
  tokenizeTitle,
  detectAttributeDimensions,
  priceBands,
  needTokens,
  describeSchemesForPrompt,
} from '../src/utils/segmentSynthesis';
import type { Product } from '../src/utils/parser';
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
function mkProduct(over: Partial<Product>): Product {
  seq += 1;
  return {
    asin: `B0TEST${String(seq).padStart(4, '0')}`,
    sku: `SKU${seq}`,
    brand: 'Brand',
    title: 'Memory Foam Pillow',
    image: '',
    monthlySales: 100,
    monthlyRevenue: 1000,
    price: 30,
    rating: 4.3,
    reviewCount: 100,
    reviewGrowth: 0,
    sellerCount: 1,
    weight: 1,
    volume: 1,
    launchDate: '202501',
    daysSinceLaunch: 200,
    buyBoxType: 'FBA',
    sellerLocation: 'US',
    fbaFee: 5,
    subBsr: 10,
    subCategory: 'Bed Pillows',
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

console.log('segment synthesis');

test('tokenizeTitle：去停用词/纯数字，保留卖点词', () => {
  const t = tokenizeTitle('Ultra Thin Cooling Gel Pillow for Stomach Sleepers, 2.25 inch');
  assert.ok(t.includes('ultra') && t.includes('thin') && t.includes('cooling') && t.includes('gel'));
  assert.ok(!t.includes('for'), 'for 是停用词');
  assert.ok(!t.includes('2.25'), '纯数字被丢弃');
  assert.ok(!t.includes('pillow'), 'pillow 是无信息量词');
});

test('detectAttributeDimensions：词表命中，确定性且可解释', () => {
  const d = detectAttributeDimensions('Ultra Thin Memory Foam Pillow, Adjustable Height, Washable Cover');
  assert.ok(d.includes('超薄/低枕'));
  assert.ok(d.includes('记忆棉/乳胶'));
  assert.ok(d.includes('可调高度'));
  assert.ok(d.includes('可水洗外套'));
});

test('needTokens：优先用证据关键词，且过滤停用词', () => {
  const tokens = needTokens(
    mkNeed({
      needStatement: '可调高度',
      evidence: { keywords: [{ word: 'adjustable pillow' }, { word: 'the' }] },
    })
  );
  assert.ok(tokens.includes('adjustable pillow'), '证据关键词整体保留');
  assert.ok(!tokens.includes('the'), '停用词被过滤');
});

test('priceBands：按分位切三段，含价格跨度标签', () => {
  const products = [10, 20, 30, 40, 50, 60].map((price) => mkProduct({ price }));
  const bands = priceBands(products);
  assert.equal(bands.length, 3);
  assert.ok(bands[0].label.startsWith('低价段'));
  assert.ok(bands[2].label.startsWith('高价段'));
  // 三段必须无重叠且覆盖所有价格
  for (const p of products) {
    assert.equal(bands.filter((b) => p.price >= b.min && p.price < b.max).length, 1, `价格 ${p.price} 必须只落一段`);
  }
});

test('空输入 → 不产出方案（不造假）', () => {
  assert.deepEqual(synthesizeSegmentSchemes({ products: [] }), []);
});

test('三方各出一版方案：需求域 / 商品属性 / 标题聚类，顺序固定', () => {
  const products = [
    mkProduct({ title: 'Ultra Thin Flat Pillow for Stomach Sleepers', price: 20 }),
    mkProduct({ title: 'Thin Low Profile Pillow Stomach Sleeper', price: 25 }),
    mkProduct({ title: 'Cooling Gel Memory Foam Pillow', price: 40 }),
    mkProduct({ title: 'Adjustable Height Memory Foam Pillow Side Sleeper', price: 55 }),
  ];
  const needs = [
    mkNeed({
      category: '功能需求',
      subCategory: '高度可调',
      needStatement: 'adjustable height 需求',
      evidence: { keywords: [{ word: 'adjustable' }], reviewQuotes: [{ quote: '太厚了' }], asins: ['B0TEST0004'] },
    }),
    mkNeed({
      category: '体感需求',
      subCategory: '更薄更低',
      needStatement: 'thin flat 需求',
      evidence: { keywords: [{ word: 'thin' }], reviewQuotes: [{ quote: '太高' }] },
    }),
  ];
  const schemes = synthesizeSegmentSchemes({ products, history: [], needs });
  assert.equal(schemes.length, 3);
  assert.deepEqual(schemes.map((s) => s.id), ['demand', 'attribute', 'title']);
  assert.equal(schemes[0].basis, 'demand');
  assert.equal(schemes[1].basis, 'attribute');
  assert.equal(schemes[2].basis, 'title');
});

test('① 需求域方案：细分名就是需求域，且每个细分挂上命中的需求与证据分', () => {
  const products = [
    mkProduct({ title: 'Adjustable Height Memory Foam Pillow', price: 50 }),
    mkProduct({ title: 'Thin Flat Low Profile Pillow', price: 20 }),
  ];
  const needs = [
    mkNeed({
      category: '功能需求',
      needStatement: 'adjustable 需求',
      evidence: { keywords: [{ word: 'adjustable' }], reviewQuotes: [{ quote: 'q1' }, { quote: 'q2' }], asins: ['B0A1', 'B0A2'] },
    }),
    mkNeed({ category: '体感需求', needStatement: 'thin 需求', evidence: { keywords: [{ word: 'thin' }] } }),
  ];
  const demand = synthesizeSegmentSchemes({ products, needs })[0];
  const names = demand.segments.map((s) => s.name);
  assert.ok(names.includes('功能需求') && names.includes('体感需求'), `实际细分：${names.join(',')}`);

  const funcSeg = demand.segments.find((s) => s.name === '功能需求')!;
  assert.equal(funcSeg.productCount, 1);
  assert.equal(funcSeg.demandHits.length, 1, '该细分必须挂上对应需求');
  assert.ok(funcSeg.demandHits[0].evidenceScore > 0, '证据分来自确定性折算');
  assert.ok(funcSeg.score.opportunity >= 0, '复用 segmentScore 的机会分');

  const bodySeg = demand.segments.find((s) => s.name === '体感需求')!;
  assert.equal(bodySeg.asins.length, 1);
  assert.equal(bodySeg.demandHits[0].evidenceStrength, 'low', '只有关键词才 +12 → 低强度（不虚高）');
});

test('① 需求域方案：没有任何商品命中时该细分不出现（不造空细分）', () => {
  const products = [mkProduct({ title: 'Cooling Gel Pillow', price: 40 })];
  const needs = [mkNeed({ category: '维护需求', needStatement: 'washable cover 需求', evidence: { keywords: [{ word: 'washable' }] } })];
  const demand = synthesizeSegmentSchemes({ products, needs })[0];
  assert.equal(demand.segments.length, 0);
  assert.equal(demand.grounding, 0);
  assert.equal(demand.unassigned, 1, '未归属商品要显式计数');
});

test('② 商品属性方案：价格段 × 最强属性维度，明细可核对', () => {
  const products = [
    mkProduct({ title: 'Ultra Thin Flat Pillow', price: 18 }),
    mkProduct({ title: 'Thin Low Profile Pillow', price: 22 }),
    mkProduct({ title: 'Cooling Gel Memory Foam Pillow', price: 45 }),
    mkProduct({ title: 'Memory Foam Pillow King', price: 60 }),
  ];
  const attr = synthesizeSegmentSchemes({ products })[1];
  assert.ok(attr.segments.length >= 3);
  assert.ok(attr.segments.every((s) => s.rule.includes('价格在')), '每个细分都要写明价格规则');
  assert.ok(
    attr.segments.some((s) => s.name.includes('超薄/低枕')),
    `样本里「超薄/低枕」最普遍，应出现组合细分：${attr.segments.map((s) => s.name).join(',')}`
  );
  // 每个细分的商品数必须与其 asins 一致
  for (const s of attr.segments) assert.equal(s.productCount, s.asins.length);
});

test('③ 标题聚类方案：用标题词频切，段名带词典释义，且单归属', () => {
  const products = [
    mkProduct({ title: 'Ultra Thin Flat Pillow', price: 20 }),
    mkProduct({ title: 'Thin Low Profile Pillow', price: 22 }),
    mkProduct({ title: 'Cooling Gel Pillow', price: 40 }),
  ];
  const title = synthesizeSegmentSchemes({ products })[2];
  const thinSeg = title.segments.find((s) => s.titleKeywords.includes('thin'));
  assert.ok(thinSeg, `thin 词频最高，必须成为词簇：${title.segments.map((s) => s.name).join(',')}`);
  assert.equal(thinSeg!.name, '标题词簇「thin」（超薄/低枕）', '命中词典要给中文释义');
  assert.equal(thinSeg!.productCount, 2, '两个标题都含 thin → 都归这一簇');
  assert.ok(title.segments.some((s) => s.titleKeywords.includes('cooling')), 'cooling 词簇应存在');
  // 单归属：任何一个商品只能出现在一个词簇里（词频最高的先认领）
  const all = title.segments.flatMap((s) => s.asins);
  assert.equal(new Set(all).size, all.length);
  assert.equal(title.unassigned, 0, '三个商品都能被某个词簇认领');
});

test('确定性：同样输入连算两次结果完全一致', () => {
  const products = [
    mkProduct({ title: 'Ultra Thin Flat Pillow', price: 20 }),
    mkProduct({ title: 'Cooling Gel Memory Foam Pillow', price: 45 }),
    mkProduct({ title: 'Adjustable Memory Foam Pillow', price: 60 }),
  ];
  const needs = [mkNeed({ category: '功能需求', needStatement: 'adjustable 需求', evidence: { keywords: [{ word: 'adjustable' }] } })];
  const a = synthesizeSegmentSchemes({ products, needs });
  const b = synthesizeSegmentSchemes({ products, needs });
  assert.deepEqual(
    a.map((s) => ({ id: s.id, segs: s.segments.map((x) => [x.name, x.asins.join(',')]) })),
    b.map((s) => ({ id: s.id, segs: s.segments.map((x) => [x.name, x.asins.join(',')]) }))
  );
});

test('覆盖率与未归属：细分合计 + 未归属 = 全部商品', () => {
  const products = [
    mkProduct({ title: 'Ultra Thin Flat Pillow', price: 20 }),
    mkProduct({ title: 'Cooling Gel Pillow', price: 45 }),
    mkProduct({ title: 'Zzzz Qqqq', price: 30 }),
  ];
  const title = synthesizeSegmentSchemes({ products })[2];
  const covered = title.segments.reduce((s, x) => s + x.productCount, 0);
  assert.equal(covered + title.unassigned, products.length, '不能有商品凭空消失');
});

test('不变式：三个方案都必须是真切分（不重叠、收入占比合计 ≤ 100%）', () => {
  const products = [
    mkProduct({ title: 'Ultra Thin Flat Pillow for Stomach Sleepers', price: 18 }),
    mkProduct({ title: 'Thin Low Profile Pillow Stomach Sleeper', price: 22 }),
    mkProduct({ title: 'Adjustable Height Memory Foam Pillow', price: 48 }),
    mkProduct({ title: 'Cooling Gel Memory Foam Pillow', price: 55 }),
    mkProduct({ title: 'Memory Foam Pillow King Size', price: 70 }),
    mkProduct({ title: 'Zzzz Qqqq', price: 33 }),
  ];
  const needs = [
    mkNeed({ category: '功能需求', needStatement: 'adjustable 需求', evidence: { keywords: [{ word: 'adjustable' }] } }),
    mkNeed({ category: '体感需求', needStatement: 'thin 需求', evidence: { keywords: [{ word: 'thin' }] } }),
  ];
  const schemes = synthesizeSegmentSchemes({ products, needs });
  assert.equal(schemes.length, 3);
  for (const scheme of schemes) {
    const asins = scheme.segments.flatMap((s) => s.asins);
    assert.equal(new Set(asins).size, asins.length, `${scheme.id} 方案出现商品重叠（同一商品进了多个细分）`);
    assert.equal(
      scheme.segments.reduce((s, x) => s + x.productCount, 0) + scheme.unassigned,
      products.length,
      `${scheme.id} 方案的细分 + 未归属必须等于全部商品`
    );
    const revSum = scheme.segments.reduce((s, x) => s + x.revenueShare, 0);
    assert.ok(revSum <= 1.0001, `${scheme.id} 方案收入占比合计 ${revSum} 超过 100%`);
    assert.ok(scheme.coverage > 0 && scheme.coverage <= 1, `${scheme.id} 覆盖率必须在 (0,1]`);
  }
  // 需求域方案：每个细分必须能挂上看用户的需求（这是"细分跟看用户挂钩"的核心断言）
  const demand = schemes.find((s) => s.id === 'demand')!;
  assert.ok(demand.segments.length >= 1);
  assert.ok(demand.grounding > 0, '需求域方案至少有细分被需求解释');
  assert.equal(demand.grounding, 1, '需求域方案下每个细分都应挂上对应需求');
});

test('recommendScheme：需求挂钩度高者胜出，且理由是确定性指标', () => {
  const products = [
    mkProduct({ title: 'Adjustable Height Memory Foam Pillow', price: 55 }),
    mkProduct({ title: 'Cooling Gel Pillow', price: 45 }),
  ];
  const needs = [mkNeed({ category: '功能需求', needStatement: 'adjustable 需求', evidence: { keywords: [{ word: 'adjustable' }] } })];
  const schemes = synthesizeSegmentSchemes({ products, needs });
  const rec = recommendScheme(schemes);
  assert.ok(rec);
  assert.equal(rec!.schemeId, 'demand', '需求域方案需求挂钩度最高，应被推荐');
  assert.ok(rec!.reason.includes('最终方案由你选'), '推荐必须声明"用户拍板"');
  assert.equal(rec!.ranking.length, 3);
  const scores = rec!.ranking.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), '排名必须按分数降序');
});

test('recommendScheme：无任何细分可行时返回 null（诚实）', () => {
  const schemes = synthesizeSegmentSchemes({ products: [mkProduct({ title: 'Qqqq Zzzz' })] });
  const rec = recommendScheme(schemes.filter((s) => s.segments.length === 0));
  assert.equal(rec, null);
});

test('describeSchemesForPrompt：给 AI 的文本含规则/机会分/需求证据，AI 无从改分', () => {
  const products = [mkProduct({ title: 'Adjustable Memory Foam Pillow', price: 50 })];
  const needs = [mkNeed({ category: '功能需求', needStatement: 'adjustable 需求', evidence: { keywords: [{ word: 'adjustable' }] } })];
  const text = describeSchemesForPrompt(synthesizeSegmentSchemes({ products, needs }));
  assert.ok(text.includes('方案'));
  assert.ok(text.includes('机会分'));
  assert.ok(text.includes('证据分'));
  assert.ok(describeSchemesForPrompt([]).includes('数据不足'));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
