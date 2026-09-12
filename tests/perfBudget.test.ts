// M5 · 性能预算测试（把"项目中心 ≤2s"这条验收线变成可判定、可复核的代码）。
import assert from 'node:assert/strict';

import {
  PERF_BUDGETS,
  budgetFor,
  checkBudget,
  summarizePerf,
  type PerfSample,
} from '../src/utils/perfBudget';

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

console.log('perf budget');

test('预算表里有项目中心 2000ms（PRD §12 M5 的验收线），且每条都写了出处', () => {
  const pc = budgetFor('project_center_load')!;
  assert.equal(pc.budgetMs, 2000);
  assert.ok(pc.source.includes('§12'));
  for (const b of PERF_BUDGETS) {
    assert.ok(b.source.length > 5, `${b.key} 必须写明预算出处（否则数字会被人随手改）`);
    assert.ok(b.budgetMs > 0);
  }
});

test('达标判定：等于预算是达标，超出要给出超出比例', () => {
  const at = '2026-09-12T00:00:00.000Z';
  const exact = checkBudget({ key: 'project_center_load', durationMs: 2000, at });
  assert.equal(exact.ok, true, '恰好等于预算算达标（否则边界会被误报）');
  assert.equal(exact.overBy, 0);
  assert.ok(exact.verdict.includes('达标'));

  const over = checkBudget({ key: 'project_center_load', durationMs: 3000, at });
  assert.equal(over.ok, false);
  assert.equal(over.overBy, 0.5);
  assert.ok(over.verdict.includes('超 50%'));
  assert.ok(over.verdict.includes('未达标'));
});

test('没有预算的打点不误判为失败（只如实报数字）', () => {
  const v = checkBudget({ key: 'not_a_budgeted_key', durationMs: 12_345, at: '2026-09-12T00:00:00.000Z' });
  assert.equal(v.ok, true);
  assert.ok(v.verdict.includes('没有为它设预算'));
});

test('汇总用中位数：偶发慢样本不会把结论带偏，但持续慢会被判失败', () => {
  const at = '2026-09-12T00:00:00.000Z';
  const mostlyFast: PerfSample[] = [
    { key: 'project_center_load', durationMs: 800, at },
    { key: 'project_center_load', durationMs: 900, at },
    { key: 'project_center_load', durationMs: 6000, at }, // 一次偶发慢
  ];
  const s1 = summarizePerf(mostlyFast);
  assert.equal(s1.failures.length, 0, '中位数 900ms → 达标');
  assert.ok(s1.summary.includes('全部达标'));

  const consistentlySlow: PerfSample[] = [
    { key: 'project_center_load', durationMs: 3500, at },
    { key: 'project_center_load', durationMs: 3000, at },
    { key: 'project_center_load', durationMs: 2500, at },
  ];
  const s2 = summarizePerf(consistentlySlow);
  assert.equal(s2.failures.length, 1, '中位数 3000ms → 超预算');
  assert.ok(s2.summary.includes('项目中心加载'));
});

test('空数据不崩，并告诉用户怎么产生数据', () => {
  const s = summarizePerf([]);
  assert.equal(s.verdicts.length, 0);
  assert.ok(s.summary.includes('跑一次项目中心'));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
