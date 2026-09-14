// M3② · 三列对比字段注册表与覆盖率测试。
// 核心：字段来源必须标注、"没抓到"与"值为空"必须区分、覆盖率要能对上验收线（≥90%）。
import assert from 'node:assert/strict';

import {
  LISTING_FIELDS,
  GROUP_ORDER,
  SOURCE_LABELS,
  buildComparisonTable,
  readFieldValue,
  describeCoverage,
  FIELD_COVERAGE_TARGET,
  type ComparisonInput,
} from '../src/utils/listingFields';
import type { Product } from '../src/utils/parser';

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
function product(over: Partial<Product>): Product {
  seq += 1;
  return {
    asin: `B0${String(seq).padStart(6, '0')}`,
    sku: '',
    brand: 'Brand',
    title: 'Title',
    image: '',
    monthlySales: 100,
    monthlyRevenue: 5000,
    price: 30,
    rating: 4.3,
    reviewCount: 200,
    reviewGrowth: 0.1,
    sellerCount: 1,
    weight: 1,
    volume: 1,
    launchDate: '202401',
    daysSinceLaunch: 365,
    buyBoxType: 'FBA',
    sellerLocation: 'US',
    fbaFee: 6,
    subBsr: 1200,
    subCategory: 'Bed Pillows',
    ...over,
  };
}

console.log('listing fields');

test('字段清单覆盖三组（产品/Listing/流量），且每个字段都标了来源', () => {
  const groups = new Set(LISTING_FIELDS.map((f) => f.group));
  assert.deepEqual([...groups].sort(), [...GROUP_ORDER].sort());
  for (const f of LISTING_FIELDS) {
    assert.ok(['frontend', 'sellersprite', 'derived'].includes(f.source), `${f.key} 来源非法`);
    assert.ok(SOURCE_LABELS[f.source].length > 0);
    assert.ok(f.how.length > 0, `${f.key} 必须写清怎么取（未抓取时要能告知用户）`);
  }
  // PRD 明确点名的字段不能漏
  const keys = new Set(LISTING_FIELDS.map((f) => f.key));
  for (const must of ['mainImages', 'video', 'bullets', 'aplus', 'qa', 'variants', 'attributes', 'trafficKeywords', 'abaRank', 'naturalAdRatio', 'priceRankHistory', 'titleKeywords']) {
    assert.ok(keys.has(must), `PRD 要求字段缺失：${must}`);
  }
});

test('无重复 key（注册表是权威清单，不能有歧义）', () => {
  const keys = LISTING_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('抓到的字段按来源取值：前台字段来自商品页，卖家精灵字段来自估算数据', () => {
  const p = product({ asin: 'B0AAA', price: 29.99, rating: 4.5, reviewCount: 1234, monthlySales: 800, monthlyRevenue: 24000, subBsr: 900, subCategory: 'Bed Pillows', launchDate: '202401' });
  const input: ComparisonInput = { asins: ['B0AAA'], products: [p], listing: { B0AAA: { images: ['a', 'b', 'c'], videoCount: 1 } } };
  assert.equal(readFieldValue('price', 'B0AAA', input), '$30');
  assert.equal(readFieldValue('rating', 'B0AAA', input), '4.5');
  assert.equal(readFieldValue('reviewCount', 'B0AAA', input), '1,234');
  assert.equal(readFieldValue('monthlyRevenue', 'B0AAA', input), '$24,000');
  assert.equal(readFieldValue('bsr', 'B0AAA', input), '#900 · Bed Pillows');
  assert.equal(readFieldValue('mainImages', 'B0AAA', input), '3 张');
  assert.equal(readFieldValue('video', 'B0AAA', input), '1 个');
});

test('"没抓到"与"值为空"分开：缺数据标未抓取，并给出补齐方式', () => {
  const p = product({ asin: 'B0AAA' });
  const input: ComparisonInput = { asins: ['B0AAA'], products: [p] };
  const { rows } = buildComparisonTable(input);
  const bullets = rows.find((r) => r.field.key === 'bullets')!;
  assert.equal(bullets.cells[0].missing, true);
  assert.equal(bullets.cells[0].value, '未抓取');
  assert.ok(bullets.cells[0].hint?.includes('五点描述'));
  assert.ok(bullets.cells[0].hint?.includes('🖥前台'));

  // 明确"无视频"是抓到了（值=无），不是未抓取
  const withVideo: ComparisonInput = { ...input, listing: { B0AAA: { videoCount: 0 } } };
  const vrow = buildComparisonTable(withVideo).rows.find((r) => r.field.key === 'video')!;
  assert.equal(vrow.cells[0].missing, false);
  assert.equal(vrow.cells[0].value, '无');
});

test('推算字段口径固定：月均新增评论、价格相对均价', () => {
  const rows = buildComparisonTable({
    asins: ['B0AAA', 'B0BBB'],
    products: [
      product({ asin: 'B0AAA', price: 20, reviewCount: 120, daysSinceLaunch: 360 }),
      product({ asin: 'B0BBB', price: 40, reviewCount: 60, daysSinceLaunch: 360 }),
    ],
  }).rows;
  const growth = rows.find((r) => r.field.key === 'avgReviewGrowth')!;
  assert.equal(growth.cells[0].value, '10.0 条/月', '120 条 ÷ 12 个月');
  const gap = rows.find((r) => r.field.key === 'priceGapToAvg')!;
  assert.equal(gap.cells[0].value, '-33%', '20 相对均价 30');
  assert.equal(gap.cells[1].value, '+33%');
});

test('历史曲线类字段：少于 3 个时间点算未抓到（避免用 1-2 点编趋势）', () => {
  const input: ComparisonInput = {
    asins: ['B0AAA'],
    products: [product({ asin: 'B0AAA' })],
    history: [{ asin: 'B0AAA', history: { '2024-01': { sales: 1, revenue: 2, price: 3 } } }],
  };
  assert.equal(readFieldValue('reviewGrowthCurve', 'B0AAA', input), undefined);
  const ok: ComparisonInput = {
    ...input,
    history: [
      { asin: 'B0AAA', history: { '2024-01': { sales: 1, revenue: 2, price: 3 }, '2024-02': { sales: 1, revenue: 2, price: 3 }, '2024-03': { sales: 1, revenue: 2, price: 3 } } },
    ],
  };
  assert.equal(readFieldValue('reviewGrowthCurve', 'B0AAA', ok), '3 个时间点');
});

test('覆盖率：三列全空时 0%，补全后 100%，并给出未达标原因', () => {
  const bare = buildComparisonTable({ asins: ['B0AAA', 'B0BBB', 'B0CCC'], products: [] });
  assert.equal(bare.coverage.captured, 0);
  assert.equal(bare.coverage.overall, 0);
  assert.ok(describeCoverage(bare.coverage).includes('未达标'));

  // 三列全量补齐（每列都给同一份完整字段）
  const full = { ...LISTING_FIELDS };
  void full;
  const asins = ['B0AAA', 'B0BBB', 'B0CCC'];
  const products = asins.map((asin) => product({ asin }));
  const listing = Object.fromEntries(
    asins.map((asin) => [
      asin,
      {
        images: ['1', '2', '3', '4', '5', '6', '7'],
        videoCount: 1,
        listPrice: 40,
        coupon: '5%',
        ratingBreakdown: [{ star: 5, share: 0.7 }],
        variants: ['Standard', 'King'],
        attributes: { Material: 'Foam' },
        qaCount: 12,
        qaTop: ['Is it washable?'],
        brandMaker: 'ACME Inc.',
        bullets: ['b1', 'b2', 'b3', 'b4', 'b5'],
        aplus: 'A+ content',
        imageStrategy: '首图强调厚度',
        titleKeywords: ['thin', 'cooling'],
      },
    ])
  );
  const traffic = Object.fromEntries(
    asins.map((asin) => [
      asin,
      {
        keywords: [
          { word: 'thin pillow', type: 'natural' as const },
          { word: 'flat pillow', type: 'ad' as const },
        ],
        abaRank: 5000,
        adDependency: 0.3,
        naturalAdRatio: 1.5,
        priceRankHistory: [
          { date: '2024-01', price: 30, bsr: 900 },
          { date: '2024-02', price: 31, bsr: 800 },
          { date: '2024-03', price: 29, bsr: 950 },
        ],
      },
    ])
  );
  const history = asins.map((asin) => ({
    asin,
    history: { '2024-01': { sales: 1, revenue: 2, price: 3 }, '2024-02': { sales: 1, revenue: 2, price: 3 }, '2024-03': { sales: 1, revenue: 2, price: 3 } },
  }));
  const fullTable = buildComparisonTable({ asins, products, listing, traffic, history });
  assert.equal(fullTable.coverage.overall, 1, `应 100%，实际 ${fullTable.coverage.overall}，缺：${fullTable.coverage.missingFields.map((m) => m.label).join(',')}`);
  assert.ok(describeCoverage(fullTable.coverage).includes('达标'));
  assert.equal(fullTable.coverage.byGroup.product, 1);
  assert.equal(fullTable.coverage.byGroup.listing, 1);
  assert.equal(fullTable.coverage.byGroup.traffic, 1);
  assert.equal(fullTable.coverage.missingFields.length, 0);
});

test('覆盖率缺口按来源归因（告诉用户该补前台还是卖家精灵）', () => {
  const asins = ['B0AAA', 'B0BBB', 'B0CCC'];
  const products = asins.map((asin) => product({ asin }));
  const table = buildComparisonTable({ asins, products });
  assert.ok(table.coverage.overall > 0 && table.coverage.overall < FIELD_COVERAGE_TARGET);
  const text = describeCoverage(table.coverage);
  assert.ok(text.includes('未达标'));
  assert.ok(text.includes('🖥前台') || text.includes('🔮卖家精灵'), text);
  assert.ok(table.coverage.missingFields.every((m) => m.asins.length > 0), '缺口要指出是哪些 ASIN 缺');
});

test('三列对齐：每行 cells 数量 = ASIN 数量，顺序一致', () => {
  const asins = ['B0AAA', 'B0BBB', 'B0CCC'];
  const { rows } = buildComparisonTable({ asins, products: asins.map((asin) => product({ asin })) });
  for (const r of rows) {
    assert.equal(r.cells.length, 3);
    assert.deepEqual(r.cells.map((c) => c.asin), asins);
    assert.equal(r.captured, r.cells.filter((c) => !c.missing).length);
  }
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
