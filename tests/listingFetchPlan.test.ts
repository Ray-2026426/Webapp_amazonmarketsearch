// M5 · Listing 抓取编排测试（§11.2 编排 / §15.4 采样口径 / §6.3 字段覆盖）。
import assert from 'node:assert/strict';

import {
  planListingFetch,
  reviewSamplePlan,
  assembleListingDetails,
  evaluateFetchPlan,
  estimatePlanCost,
  type FetchStepResult,
} from '../src/utils/listingFetchPlan';
import { DEFAULT_COST_TABLE } from '../src/utils/usageAccounting';

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

console.log('listing fetch plan');

test('评论采样口径就是 §15.4 的三次/十次调用（用户确认过的数）', () => {
  const fast = reviewSamplePlan('fast');
  assert.equal(fast.target, 60);
  assert.equal(fast.anchorLimit, 20);
  assert.equal(fast.calls, 3, '锚点 20（1 次）+ 头部 2×20（各 1 次）= 3 次');
  const deep = reviewSamplePlan('deep');
  assert.equal(deep.target, 200);
  assert.equal(deep.anchorLimit, 80);
  assert.equal(deep.headLimit, 60);
  assert.equal(deep.calls, 10, '锚点 80（4 次）+ 头部 2×60（各 3 次）= 10 次');
});

test('计划是确定性的：同输入同顺序；ASIN 去重且大写归一化', () => {
  const a = planListingFetch({ asins: ['b0aaa', 'B0BBB', 'B0AAA'], marketplace: 'US' });
  const b = planListingFetch({ asins: ['B0BBB', 'B0AAA'], marketplace: 'us' });
  assert.deepEqual(
    a.map((s) => s.id),
    b.map((s) => s.id),
    '顺序必须稳定'
  );
  assert.equal(new Set(a.map((s) => s.asin).filter(Boolean)).size, 2, '3 个输入里只有 2 个唯一 ASIN');
  const ids = a.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, '步骤 id 唯一（同一 ASIN 的每类步骤各一次）');
  assert.equal(a.filter((s) => s.id === 'listing:B0AAA').length, 1, '同一 ASIN 的 Listing 只规划一次');
});

test('顺序原则：便宜的 Listing/详情在前，贵的流量与历史在后', () => {
  const plan = planListingFetch({ asins: ['B0AAA'], marketplace: 'US', depth: 'deep' });
  const listingIdx = plan.findIndex((s) => s.id === 'listing:B0AAA');
  const detailIdx = plan.findIndex((s) => s.id === 'detail:B0AAA');
  const trafficIdx = plan.findIndex((s) => s.id === 'traffic:B0AAA');
  const historyIdx = plan.findIndex((s) => s.id === 'history:B0AAA');
  assert.ok(listingIdx < detailIdx, 'Listing 文本先于 ASIN 详情');
  assert.ok(detailIdx < trafficIdx, '详情先于流量词');
  assert.ok(trafficIdx < historyIdx, '流量词先于历史趋势');
  assert.equal(plan[0].priority, 1);
});

test('已抓到的字段会跳过对应步骤（不为已有数据重复花钱）', () => {
  const full = planListingFetch({ asins: ['B0AAA'], marketplace: 'US' });
  const listingStep = full.find((s) => s.id === 'listing:B0AAA')!;
  const skipListing = planListingFetch({
    asins: ['B0AAA'],
    marketplace: 'US',
    alreadyHave: { B0AAA: listingStep.fills },
  });
  assert.ok(!skipListing.some((s) => s.id === 'listing:B0AAA'), 'Listing 已全有 → 不再抓');
  assert.ok(skipListing.some((s) => s.id === 'detail:B0AAA'), '其它字段仍要抓');
});

test('只抓指定组：只要 flow 就不抓产品与 Listing', () => {
  const plan = planListingFetch({ asins: ['B0AAA'], marketplace: 'US', groups: ['traffic'] });
  assert.ok(plan.every((s) => s.type === 'traffic'));
  assert.ok(!plan.some((s) => s.type === 'listing'));
});

test('每个步骤都标了用途、成本口径与 TTL', () => {
  const plan = planListingFetch({ asins: ['B0AAA', 'B0BBB'], marketplace: 'US', depth: 'deep' });
  for (const s of plan) {
    assert.ok(s.label.length > 5, `${s.id} 需要人话说明（UI 要显示"正在抓什么"）`);
    assert.ok(s.calls >= 1);
    assert.ok(s.ttlSeconds > 0);
    assert.ok(s.fills.length > 0, `${s.id} 必须说明能填哪些字段`);
    assert.ok(s.usageTool.length > 0, '记账分类不能为空');
  }
  // 深度模式：锚点不重复抓、头部 ASIN 额外抓一次
  const deepReviews = plan.filter((s) => s.type === 'reviews');
  assert.ok(deepReviews.length >= 3);
});

test('成本预估与用量记账同表同口径', () => {
  const plan = planListingFetch({ asins: ['B0AAA'], marketplace: 'US', depth: 'fast' });
  const calls = plan.reduce((s, x) => s + x.calls, 0);
  assert.equal(estimatePlanCost(plan, DEFAULT_COST_TABLE.mcpCallUsd), Math.round(calls * DEFAULT_COST_TABLE.mcpCallUsd * 1e6) / 1e6);
});

test('空 ASIN 列表返回空计划（不产生无意义调用）', () => {
  assert.deepEqual(planListingFetch({ asins: [], marketplace: 'US' }), []);
  assert.deepEqual(planListingFetch({ asins: ['   '], marketplace: 'US' }), []);
});

console.log('assemble & evaluate');

test('装配：MCP content[0].text 包裹的 JSON 能正确解析成字段', () => {
  const plan = planListingFetch({ asins: ['B0AAA'], marketplace: 'US' });
  const listingPayload = {
    content: [
      {
        text: JSON.stringify({
          images: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg'],
          videoCount: 1,
          bullets: ['b1', 'b2', 'b3', 'b4', 'b5'],
          aplus: 'A+ content',
          variants: ['Standard', 'King'],
          attributes: { Material: 'Memory Foam' },
          qaCount: 12,
          qaTop: ['Is it washable?'],
          manufacturer: 'ACME Inc.',
          listPrice: 39.99,
          coupon: '5%',
          ratingBreakdown: [{ star: 5, share: 0.7 }, { star: 4, share: 0.2 }],
        }),
      },
    ],
  };
  const results: FetchStepResult[] = plan.map((s) => ({ stepId: s.id, ok: true, data: s.id === 'listing:B0AAA' ? listingPayload : {} }));
  const assembled = assembleListingDetails(plan, results);
  const l = assembled.listing.B0AAA;
  assert.equal(l.images?.length, 7);
  assert.equal(l.videoCount, 1);
  assert.equal(l.bullets?.length, 5);
  assert.equal(l.aplus, 'A+ content');
  assert.equal(l.attributes?.Material, 'Memory Foam');
  assert.equal(l.qaCount, 12);
  assert.equal(l.brandMaker, 'ACME Inc.');
  assert.equal(l.ratingBreakdown?.length, 2);
  const applied = assembled.applied.find((a) => a.stepId === 'listing:B0AAA')!;
  for (const f of ['mainImages', 'video', 'bullets', 'aplus', 'variants', 'attributes', 'qa', 'brandMaker', 'listPrice', 'ratingBreakdown']) {
    assert.ok(applied.fields.includes(f), `应记录填了 ${f}`);
  }
});

test('装配：流量词区分自然/广告，历史序列过滤无日期的脏数据', () => {
  const plan = planListingFetch({ asins: ['B0AAA'], marketplace: 'US' });
  const trafficPayload = {
    keywords: [
      { keyword: 'thin pillow', volume: 12000, type: 'natural' },
      { word: 'flat pillow', type: 'ad' },
      { word: '' },
    ],
    abaRank: 5000,
    adDependency: 0.3,
    naturalAdRatio: 1.5,
    priceRankHistory: [
      { date: '2026-01', price: 30, bsr: 900 },
      { price: 31 },
    ],
  };
  const results: FetchStepResult[] = plan.map((s) => ({ stepId: s.id, ok: true, data: s.type === 'traffic' && s.tool === 'traffic_keyword' ? trafficPayload : {} }));
  const assembled = assembleListingDetails(plan, results);
  const t = assembled.traffic.B0AAA;
  assert.equal(t.keywords?.length, 2, '空词被过滤');
  assert.equal(t.keywords?.[1].type, 'ad');
  assert.equal(t.abaRank, 5000);
  assert.equal(t.priceRankHistory?.length, 1, '没有日期的记录丢弃（不编时间）');
});

test('失败隔离：一步失败不影响其它步骤，且失败被记录', () => {
  const plan = planListingFetch({ asins: ['B0AAA'], marketplace: 'US' });
  const results: FetchStepResult[] = plan.map((s) =>
    s.type === 'traffic'
      ? { stepId: s.id, ok: false, error: 'MCP HTTP 502' }
      : { stepId: s.id, ok: true, data: { bullets: ['b1'] } }
  );
  const assembled = assembleListingDetails(plan, results);
  assert.ok(assembled.failures.length >= 1);
  assert.ok(assembled.failures[0].error.includes('502'));
  assert.equal(assembled.listing.B0AAA.bullets?.length, 1, '别的步骤照常落地');
});

test('覆盖率：只统计计划内的字段；补全为 100% 时达标（对齐 M3 验收线 ≥90%）', () => {
  const plan = planListingFetch({ asins: ['B0AAA'], marketplace: 'US' });
  const partial = assembleListingDetails(
    plan,
    plan.map((s) => ({ stepId: s.id, ok: true, data: s.type === 'listing' ? { images: ['1'], bullets: ['b1'] } : {} }))
  );
  const evPartial = evaluateFetchPlan(plan, partial, ['B0AAA']);
  assert.ok(evPartial.planned > 0);
  assert.ok(evPartial.coverage > 0 && evPartial.coverage < 1);
  assert.ok((evPartial.missingByAsin.B0AAA ?? []).length > 0, '缺口要能列出具体字段');

  const evNone = evaluateFetchPlan(plan, { listing: {}, traffic: {}, applied: [], failures: [] }, ['B0AAA']);
  assert.equal(evNone.coverage, 0);
  assert.equal(evNone.plannedCalls, plan.reduce((s, x) => s + x.calls, 0));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
