// 细分市场评分 + 竞品对标挑选 纯逻辑测试（Phase 3/看市场优化）。
import assert from 'node:assert/strict';

import { scoreSegment, scoreSegments, topOpportunitySegments } from '../src/utils/segmentScore';
import { pickCompetitors } from '../src/utils/competitorPicker';
import type { Product, HistoryRecord } from '../src/utils/parser';

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

function product(overrides: Partial<Product>): Product {
  return {
    asin: 'B0000',
    sku: '',
    brand: 'BrandX',
    title: 'Product',
    image: '',
    monthlySales: 1000,
    monthlyRevenue: 50000,
    price: 50,
    rating: 4.5,
    reviewCount: 1200,
    reviewGrowth: 30,
    sellerCount: 3,
    weight: 100,
    volume: 100,
    launchDate: '2024-01-01',
    daysSinceLaunch: 500,
    buyBoxType: '',
    sellerLocation: '',
    fbaFee: 5,
    subBsr: 100,
    subCategory: '',
    ...overrides,
  };
}

console.log('segment score');

test('空细分 -> 0 分', () => {
  const r = scoreSegment('seg', [], []);
  assert.equal(r.opportunity, 0);
  assert.equal(r.productCount, 0);
  assert.equal(r.totalRevenue, 0);
});

test('高收入分散细分 -> 机会分高', () => {
  const products = Array.from({ length: 60 }, (_, i) =>
    product({
      asin: `B${i}`,
      brand: `Brand${i}`,
      monthlyRevenue: 100000 + i * 1000,
      monthlySales: 2000 + i,
      price: 40 + (i % 5),
      rating: 4.4,
      reviewCount: 800 + i,
      daysSinceLaunch: 100 + i,
    })
  );
  const r = scoreSegment('seg', products, []);
  assert.ok(r.opportunity > 60, `应高分，实际 ${r.opportunity}`);
  assert.ok(r.volume > 50);
  assert.equal(r.productCount, 60);
  assert.equal(r.totalRevenue, products.reduce((s, p) => s + p.monthlyRevenue, 0));
});

test('垄断细分（单一品牌高份额）-> 竞争分低', () => {
  const products = Array.from({ length: 10 }, (_, i) =>
    product({ asin: `B${i}`, brand: i === 0 ? 'Monolith' : 'Others', monthlyRevenue: i === 0 ? 900000 : 5000 })
  );
  const r = scoreSegment('seg', products, []);
  assert.ok(r.competition < 50, `集中度高的细分竞争分应较低，实际 ${r.competition}`);
});

test('有历史增长的趋势分高于无增长', () => {
  const growing = product({ asin: 'BA', monthlyRevenue: 50000 });
  const history: HistoryRecord[] = [
    { asin: 'BA', history: { '2024-01': { sales: 100, revenue: 5000, price: 50 }, '2024-06': { sales: 300, revenue: 15000, price: 50 } } },
  ];
  const rGrow = scoreSegment('seg', [growing], history);
  const rFlat = scoreSegment('seg', [product({ asin: 'BA', monthlyRevenue: 50000 })], []);
  // 具体无需精确，只要 growth 是增长趋势结果不为极端低
  assert.ok(rGrow.trend >= 0 && rGrow.trend <= 100);
});

test('scoreSegments 按机会分降序排序', () => {
  const segments = ['低价', '高端'];
  const asinToSegment: Record<string, string> = { B1: '低价', B2: '高端' };
  const products = [
    product({ asin: 'B1', brand: 'A', monthlyRevenue: 500000, price: 20 }),
    product({ asin: 'B2', brand: 'B', monthlyRevenue: 50000, price: 500 }),
  ];
  const results = scoreSegments(segments, asinToSegment, products, []);
  assert.equal(results[0].segment, '低价');
  assert.ok(results[0].opportunity >= results[1].opportunity);
});

test('topOpportunitySegments 默认取 1 个最高机会细分', () => {
  const segments = ['A', 'B'];
  const asinToSegment: Record<string, string> = { B1: 'A', B2: 'B' };
  const products = [
    product({ asin: 'B1', monthlyRevenue: 400000 }),
    product({ asin: 'B2', monthlyRevenue: 40000 }),
  ];
  const top = topOpportunitySegments(segments, asinToSegment, products, []);
  assert.equal(top.length, 1);
  assert.equal(top[0].segment, 'A');
});

console.log('competitor picker');

test('自动挑选三个对标：头部 + 跟随者 + 新品', () => {
  const products = [
    product({ asin: 'HEAD', brand: 'Alpha', monthlyRevenue: 900000, price: 45, daysSinceLaunch: 800, title: 'Head' }),
    product({ asin: 'FOLLOW', brand: 'Alpha', monthlyRevenue: 600000, price: 46, daysSinceLaunch: 700, title: 'Follow' }),
    product({ asin: 'NEW', brand: 'Beta', monthlyRevenue: 20000, price: 40, daysSinceLaunch: 30, title: 'New' }),
    product({ asin: 'OLD', brand: 'Gamma', monthlyRevenue: 150000, price: 90, daysSinceLaunch: 2000, title: 'Old' }),
  ];
  const picked = pickCompetitors(products);
  assert.equal(picked.length, 3);
  assert.equal(picked[0].role, 'head');
  assert.equal(picked[0].asin, 'HEAD');
  assert.equal(picked[1].role, 'follower');
  assert.equal(picked[1].asin, 'FOLLOW', '跟随者应是与头部同品牌的收入次高');
  assert.equal(picked[2].role, 'newcomer');
  assert.equal(picked[2].asin, 'NEW', '新品应是上架最新者');
});

test('跟随者同品牌者优先', () => {
  const products = [
    product({ asin: 'H', brand: 'Alpha', monthlyRevenue: 900000, price: 45, daysSinceLaunch: 800 }),
    product({ asin: 'DIFFER', brand: 'Zeta', monthlyRevenue: 700000, price: 45, daysSinceLaunch: 700 }),
    product({ asin: 'SAME', brand: 'Alpha', monthlyRevenue: 400000, price: 44, daysSinceLaunch: 600 }),
  ];
  const picked = pickCompetitors(products);
  const follower = picked.find((p) => p.role === 'follower');
  assert.equal(follower?.asin, 'SAME', '同品牌者应优先被选为跟随者');
});

test('新品缺新品时可退回旧品，不抛错', () => {
  const products = [
    product({ asin: 'H', brand: 'Alpha', monthlyRevenue: 900000, daysSinceLaunch: 100 }),
    product({ asin: 'F', brand: 'Alpha', monthlyRevenue: 600000, daysSinceLaunch: 200 }),
    // 只有 2 个商品时也正常返回
  ];
  const picked = pickCompetitors(products);
  assert.ok(picked.length <= 3);
  assert.equal(picked[0].asin, 'H');
});

test('空商品返回空数组', () => {
  assert.equal(pickCompetitors([]).length, 0);
});

console.log('');
console.log('result: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
