// M3① · 竞对挑选（PRD §6.3）：头部 / 跟随者 / 新人 = 表现最好的代表性新人（不是上架最新）。
import assert from 'node:assert/strict';

import {
  pickCompetitors,
  pickCompetitorsDetailed,
  newcomerPerformanceScore,
  listReplacementCandidates,
  NEWCOMER_MAX_DAYS,
  NEWCOMER_FALLBACK_DAYS,
} from '../src/utils/competitorPicker';
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
    brand: 'B',
    title: '',
    image: '',
    monthlySales: 100,
    monthlyRevenue: 10000,
    price: 30,
    rating: 4.2,
    reviewCount: 100,
    reviewGrowth: 0,
    sellerCount: 1,
    weight: 0,
    volume: 0,
    launchDate: '',
    daysSinceLaunch: 400,
    buyBoxType: '',
    sellerLocation: '',
    fbaFee: 0,
    subBsr: 0,
    subCategory: '',
    ...over,
  };
}

console.log('competitor picker (M3)');

test('新人 = 表现最好的代表性新人，而不是上架最新的那个', () => {
  const products = [
    product({ asin: 'HEAD', monthlyRevenue: 900000, price: 45, daysSinceLaunch: 800 }),
    product({ asin: 'FOLLOW', monthlyRevenue: 600000, price: 46, daysSinceLaunch: 700 }),
    // 上架最新但表现差
    product({ asin: 'NEWEST', monthlyRevenue: 2000, price: 39, daysSinceLaunch: 10, rating: 3.2, reviewGrowth: 0 }),
    // 上架稍早但表现最好（收入高、增长快、评分高）
    product({ asin: 'BESTNEW', monthlyRevenue: 80000, price: 42, daysSinceLaunch: 150, rating: 4.7, reviewGrowth: 0.35 }),
    product({ asin: 'OLD', monthlyRevenue: 150000, price: 90, daysSinceLaunch: 2000 }),
  ];
  const { picked } = pickCompetitorsDetailed(products);
  const newcomer = picked.find((p) => p.role === 'newcomer')!;
  assert.equal(newcomer.asin, 'BESTNEW', '应是 ≤180 天里表现最好的，而不是 NEWEST');
  assert.ok(newcomer.reason.includes('表现最好的代表性新人'));
  assert.ok(newcomer.reason.includes('不是上架最新的'), '理由必须写清口径');
  assert.equal(newcomer.note, undefined, '标准窗口内命中，不应有回退说明');
});

test('表现分是确定性的：收入位置 0.5 + 评论增长 0.3 + 评分 0.2', () => {
  const all = [
    product({ asin: 'A', monthlyRevenue: 1000, rating: 5, reviewGrowth: 1 }),
    product({ asin: 'B', monthlyRevenue: 100, rating: 0, reviewGrowth: 0 }),
  ];
  const a = newcomerPerformanceScore(all[0], all);
  const b = newcomerPerformanceScore(all[1], all);
  assert.ok(a > b, '收入/增长/评分都更高者分更高');
  assert.equal(a, newcomerPerformanceScore(all[0], all), '同样输入结果一致');
  assert.ok(a <= 1 && b >= 0);
});

test('没有 ≤180 天新人 → 回退到次新窗口并显式说明（不静默）', () => {
  const products = [
    product({ asin: 'HEAD', monthlyRevenue: 900000, daysSinceLaunch: 900 }),
    product({ asin: 'FOLLOW', monthlyRevenue: 600000, daysSinceLaunch: 800 }),
    product({ asin: 'MIDNEW', monthlyRevenue: 40000, daysSinceLaunch: 400, rating: 4.6, reviewGrowth: 0.2 }),
    product({ asin: 'VERYOLD', monthlyRevenue: 20000, daysSinceLaunch: 2500 }),
  ];
  const { picked, notes } = pickCompetitorsDetailed(products);
  const newcomer = picked.find((p) => p.role === 'newcomer')!;
  assert.equal(newcomer.asin, 'MIDNEW');
  assert.ok(newcomer.note?.includes('回退'), '回退必须写在选项上');
  assert.ok(notes.some((n) => n.includes(`≤${NEWCOMER_MAX_DAYS} 天`)), `notes 要说明回退窗口：${notes.join('|')}`);
});

test('连次新窗口都没有：新人位空缺，绝不用老品冒充新人', () => {
  const products = [
    product({ asin: 'HEAD', monthlyRevenue: 900000, daysSinceLaunch: 900 }),
    product({ asin: 'FOLLOW', monthlyRevenue: 600000, daysSinceLaunch: 800 }),
    product({ asin: 'ANCIENT', monthlyRevenue: 10000, daysSinceLaunch: NEWCOMER_FALLBACK_DAYS + 500 }),
  ];
  const { picked, notes } = pickCompetitorsDetailed(products);
  assert.ok(!picked.some((p) => p.role === 'newcomer'), '上架 1000+ 天的老品不能被标成新人');
  assert.equal(picked.length, 2, '只给头部 + 跟随者');
  assert.ok(notes.some((n) => n.includes('新人位空缺') && n.includes('不用老品冒充新人')));
});

test('只有 1-2 个商品：新人位空缺并提示扩大样本（不硬凑）', () => {
  const products = [
    product({ asin: 'H', monthlyRevenue: 900000, daysSinceLaunch: 100 }),
    product({ asin: 'F', monthlyRevenue: 600000, daysSinceLaunch: 200 }),
  ];
  const { picked, notes } = pickCompetitorsDetailed(products);
  assert.equal(picked.length, 2, '头部 + 跟随者');
  assert.ok(!picked.some((p) => p.role === 'newcomer'));
  assert.ok(notes.some((n) => n.includes('新人位空缺')));
});

test('每个选中项都带"为什么选它"且含具体数字', () => {
  const products = [
    product({ asin: 'HEAD', brand: 'Alpha', monthlyRevenue: 900000, price: 45, daysSinceLaunch: 800, rating: 4.5 }),
    product({ asin: 'FOLLOW', brand: 'Alpha', monthlyRevenue: 600000, price: 46, daysSinceLaunch: 700, reviewGrowth: 0.1 }),
    product({ asin: 'NEW', monthlyRevenue: 40000, price: 41, daysSinceLaunch: 120, rating: 4.6 }),
  ];
  const picked = pickCompetitors(products);
  assert.equal(picked.length, 3);
  for (const p of picked) {
    assert.ok(p.reason.length > 10, `${p.role} 必须有理由`);
    assert.ok(/\d/.test(p.reason), `${p.role} 理由里要有数字`);
  }
  assert.ok(picked[1].reason.includes('45') || picked[1].reason.includes('价格差'), '跟随者要说明与头部的价格关系');
  assert.ok(picked[0].metrics.revenueRank === 1, '头部收入位置应为 1');
});

test('换人候选：排除已选、按角色规则排序、带"为什么它也行"', () => {
  const products = [
    product({ asin: 'HEAD', monthlyRevenue: 900000, price: 45, daysSinceLaunch: 900 }),
    product({ asin: 'F1', monthlyRevenue: 500000, price: 46, daysSinceLaunch: 800 }),
    product({ asin: 'N1', monthlyRevenue: 90000, price: 42, daysSinceLaunch: 100, rating: 4.7, reviewGrowth: 0.3 }),
    product({ asin: 'N2', monthlyRevenue: 30000, price: 41, daysSinceLaunch: 160, rating: 4.1 }),
  ];
  const newcomerAlts = listReplacementCandidates(products, 'newcomer', ['HEAD', 'F1', 'N1']);
  assert.deepEqual(newcomerAlts.map((c) => c.asin), ['N2'], '已选的不能出现在候选里');
  assert.ok(newcomerAlts[0].why.includes('表现分'));

  const followerAlts = listReplacementCandidates(products, 'follower', ['HEAD']);
  assert.equal(followerAlts[0].asin, 'F1', '跟随者候选按收入降序');
  assert.ok(followerAlts[0].why.includes('与头部'));

  const headAlts = listReplacementCandidates(products, 'head', ['HEAD']);
  assert.ok(headAlts[0].why.includes('全池第'));
  assert.ok(headAlts.length <= 8, '候选最多 8 个，避免变成阅读题');
});

test('空输入不抛错', () => {
  const r = pickCompetitorsDetailed([]);
  assert.deepEqual(r.picked, []);
  assert.deepEqual(listReplacementCandidates([], 'newcomer', []), []);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
