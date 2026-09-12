// M3 · 「我们的能力」推导 + 适配度公式测试（PRD §6.4：完成度与适配度分离、硬约束否决）。
import assert from 'node:assert/strict';

import {
  buildOurCapability,
  hardConstraintsFromSelfAssessment,
  computeFitScore,
} from '../src/utils/ourCapability';
import type { SelfAssessmentItem, SelfStatus } from '../src/utils/selfAssessment';

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
function item(over: Partial<SelfAssessmentItem>): SelfAssessmentItem {
  seq += 1;
  return { id: `i${seq}`, category: 'capability', label: '项', status: 'have', ...over };
}

console.log('our capability');

test('硬约束：决策边界/约束类里"不具备"→ 否决；"部分具备"只算警戒', () => {
  const r = hardConstraintsFromSelfAssessment([
    item({ category: 'boundary', label: '最低毛利', status: 'lack', note: '达不到 25%' }),
    item({ category: 'constraint', label: 'MOQ', status: 'partial' }),
    item({ category: 'capability', label: '供应链', status: 'lack' }),
  ]);
  assert.equal(r.blocked, true);
  assert.ok(r.notes.some((n) => n.includes('最低毛利') && n.includes('不具备')));
  assert.ok(r.notes.some((n) => n.includes('MOQ') && n.includes('部分具备')));
  assert.ok(!r.notes.some((n) => n.includes('供应链')), '能力类缺失不算硬约束（那是缺口不是否决）');
});

test('硬约束：只有"部分具备"时不否决（但不能说无约束）', () => {
  const r = hardConstraintsFromSelfAssessment([item({ category: 'boundary', label: '止损条件', status: 'partial' })]);
  assert.equal(r.blocked, false);
  assert.equal(r.notes.length, 1);
});

test('能力概况：只统计有明确状态的能力/资源/经验，待确认不计入并单独提示', () => {
  const c = buildOurCapability({
    items: [
      item({ category: 'capability', status: 'have' }),
      item({ category: 'resource', status: 'partial' }),
      item({ category: 'experience', status: 'lack' }),
      item({ category: 'capability', status: 'unknown' }),
    ],
  });
  assert.ok(c.notes.some((n) => n.includes('已具备 1 项') && n.includes('部分具备 1 项') && n.includes('不具备 1 项')));
  assert.equal(c.unknownCount, 1);
  assert.ok(c.notes.some((n) => n.includes('1 项自评还是"待确认"')));
});

test('没有任何能力自评时诚实说明（不假装能接住）', () => {
  const c = buildOurCapability({ items: [] });
  assert.deepEqual(c.byNeedId, {});
  assert.equal(c.hardConstraintBlocked, false);
  assert.ok(c.notes.some((n) => n.includes('只能靠品类选择题或人工指定')));
  assert.ok(c.notes.some((n) => n.includes('没填目标售价')));
  assert.ok(c.notes.some((n) => n.includes('没填毛利红线')));
});

test('人工/品类选择题指定优先，且财务口径下发到判定层', () => {
  const c = buildOurCapability({
    items: [item({ category: 'boundary', label: '认证', status: 'lack' })],
    byNeedId: { 'need-1': 'partial' },
    byDemandCategory: { 功能需求: 'have' },
    financials: { targetPrice: 32, marginFloor: 0.25 },
    estimatedMarginAtTargetPrice: 0.28,
  });
  assert.equal(c.byNeedId!['need-1'], 'partial');
  assert.equal(c.byDemandCategory!['功能需求'], 'have');
  assert.equal(c.targetPrice, 32);
  assert.equal(c.marginFloor, 0.25);
  assert.equal(c.estimatedMarginAtTargetPrice, 0.28);
  assert.equal(c.hardConstraintBlocked, true);
  assert.ok(c.notes.some((n) => n.includes('硬约束否决已触发')));
});

test('适配度：已具备=1 / 部分=0.5 / 不具备=0，待确认不纳入分母', () => {
  const r = computeFitScore({
    answers: { q1: 'have', q2: 'partial', q3: 'lack', q4: 'unknown' },
    backgroundCompleteness: 1,
  });
  assert.equal(r.answered, 3);
  assert.equal(r.excluded, 1);
  assert.equal(r.fitScore, 50, '(1 + 0.5 + 0) / 3 = 0.5');
  assert.ok(r.note.includes('排除待确认 1 道'));
});

test('适配度：背景库完整度做乘法修正，且完成度与适配度分离', () => {
  const answers: Record<string, SelfStatus> = { q1: 'have', q2: 'have' };
  const full = computeFitScore({ answers, backgroundCompleteness: 1 });
  const half = computeFitScore({ answers, backgroundCompleteness: 0.4 });
  assert.equal(full.fitScore, 100);
  assert.equal(half.fitScore, 40, '答得一样好，但背景库只填了 40% → 适配度打折（不是完成度）');
  // 完成度不影响：答得少但答得好 + 背景库完整 → 仍然 100
  const few = computeFitScore({ answers: { q1: 'have' }, backgroundCompleteness: 1 });
  assert.equal(few.fitScore, 100);
});

test('适配度：没有可计入的题时不编造分数（0 分 + 说明）', () => {
  const r = computeFitScore({ answers: { q1: 'unknown' }, backgroundCompleteness: 0.8 });
  assert.equal(r.fitScore, 0);
  assert.equal(r.answered, 0);
  assert.ok(r.note.includes('"待确认"不参与评分'));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
