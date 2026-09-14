/**
 * 线框图 ⏳4 回归：看竞对卡片上的 ⑦⑧⑨⑩ 下钻入口必须「带 ASIN + 带视图」。
 * 之前的 bug：⑦⑧⑨ 只把 ASIN 送进竞品明细，用户点「⑨ 流量结构」还要手动再切一次 Tab。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DRILLDOWN_ENTRIES,
  drilldownEntry,
  drilldownLabel,
  drilldownTabFor,
  shouldApplyDrilldownTab,
} from '../src/utils/competitorDrilldown';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err as Error).message}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

console.log('competitorDrilldown：下钻入口 → 竞品明细视图');

test('四个下钻入口齐全，编号与线框图一致（⑦⑧⑨⑩）', () => {
  const ids = DRILLDOWN_ENTRIES.map((e) => e.id);
  assert(JSON.stringify(ids) === JSON.stringify(['deep', 'images', 'traffic', 'reviews']), `入口顺序/数量不对：${ids.join(',')}`);
  assert(DRILLDOWN_ENTRIES.length === 4, `应为 4 个入口，实际 ${DRILLDOWN_ENTRIES.length}`);
  const labels = DRILLDOWN_ENTRIES.map((e) => e.label).join('|');
  for (const num of ['⑦', '⑧', '⑨', '⑩']) {
    assert(labels.includes(num), `缺少编号 ${num}`);
  }
});

test('⑨ 流量结构落到 traffic，而不是 Listing', () => {
  assert(drilldownTabFor('traffic') === 'traffic', '⑨ 应落到 traffic');
  assert(drilldownTabFor('deep') === 'listing', '⑦ 应落到 listing');
  assert(drilldownTabFor('images') === 'listing', '⑧ 应落到 listing');
});

test('⑩ 评论与画像走用户洞察，不走竞品明细', () => {
  assert(drilldownEntry('reviews').goesToUserInsights === true, '⑩ 应标记 goesToUserInsights');
  assert(drilldownEntry('deep').goesToUserInsights !== true, '⑦ 不应走用户洞察');
});

test('每个入口都有可直接做 title 的说明，且不含空串', () => {
  for (const e of DRILLDOWN_ENTRIES) {
    assert(e.hint.trim().length >= 6, `${e.label} 的 hint 太短：${e.hint}`);
  }
});

test('未知入口直接抛错（避免静默落到错误视图）', () => {
  let threw = false;
  try {
    drilldownEntry('nope' as never);
  } catch {
    threw = true;
  }
  assert(threw, '未知入口应抛错');
});

test('一次性语义：同一次请求只应用一次，用户手动切 Tab 不被抢回', () => {
  const base = { requested: 'traffic' as const, hasResult: true, nonce: 7, appliedNonce: 6 };
  assert(shouldApplyDrilldownTab(base) === true, '新 nonce 应应用');
  assert(
    shouldApplyDrilldownTab({ ...base, appliedNonce: 7 }) === false,
    '同一 nonce 已应用过就不该再抢'
  );
});

test('没有请求 / 还没抓到结果时都不动作', () => {
  assert(
    shouldApplyDrilldownTab({ requested: null, hasResult: true, nonce: 1, appliedNonce: 0 }) === false,
    '没有请求时不应改 Tab'
  );
  assert(
    shouldApplyDrilldownTab({ requested: 'listing', hasResult: false, nonce: 1, appliedNonce: 0 }) === false,
    '还没结果时应停在向导'
  );
});

test('tab 文案单一来源', () => {
  assert(drilldownLabel('traffic') === '流量结构', 'traffic 文案不对');
  assert(drilldownLabel('matrix') === '语义矩阵', 'matrix 文案不对');
  assert(drilldownLabel('listing') === 'Listing 详情页', 'listing 文案不对');
});

test('组件确实把 tab 传下去（源码级守卫）', () => {
  const dive = read('src/components/CompetitorDeepDive.tsx');
  assert(dive.includes('DRILLDOWN_ENTRIES.map'), 'CompetitorDeepDive 应从共享表渲染下钻按钮');
  assert(
    dive.includes('onSendToComparison?.([asin], entry.tab)'),
    'CompetitorDeepDive 必须把 entry.tab 传给 onSendToComparison'
  );
  assert(!dive.includes('⑨ 流量结构\n                    </button>'), '旧的硬编码按钮应已移除');

  const app = read('src/App.tsx');
  assert(
    app.includes("setCompetitorResultTab(tab ?? 'listing')"),
    'App 必须记录下钻请求的视图'
  );
  assert(
    app.includes('setCompetitorResultTabNonce((n) => n + 1)'),
    'App 必须递增 nonce，否则二次点击 ⑧/⑨ 无效'
  );
  assert(
    app.includes('preselectedResultTab={competitorResultTab}') &&
      app.includes('resultTabRequestKey={competitorResultTabNonce}'),
    'App 必须把请求视图与 nonce 传给 CompetitorHub'
  );

  const hub = read('src/components/CompetitorHub.tsx');
  assert(
    hub.includes('shouldApplyDrilldownTab({'),
    'CompetitorHub 应使用共享的一次性应用判定'
  );
});

test('下钻入口的按钮文案与共享表一致（不允许两处各写一份）', () => {
  const dive = read('src/components/CompetitorDeepDive.tsx');
  assert(dive.includes('{entry.label}'), '按钮文案应来自共享表');
  for (const e of DRILLDOWN_ENTRIES) {
    assert(!dive.includes(`>\n                      ${e.label}\n`), `组件里仍有硬编码文案：${e.label}`);
  }
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
