// M3⑤ · 背景库（六维度四态）+ 品类选择题（确定性种子题 + AI 增补）测试。
import assert from 'node:assert/strict';

import {
  CAPABILITY_ITEMS,
  CAPABILITY_DIMENSION_ORDER,
  computeCompleteness,
  describeCompleteness,
  weakestDimension,
  capabilityHardConstraints,
  setCapabilityEntry,
  defaultCapabilityLibrary,
  type CapabilityLibrary,
} from '../src/utils/capabilityLibrary';
import {
  buildSeedQuestions,
  computeQuizProgress,
  ensureSeedQuestions,
  mergeCategoryQuestions,
  normalizeAiQuestions,
  setAnswer,
  toOurCapabilityFromQuiz,
  toAnswersForFit,
  defaultQuizData,
  type QuizData,
} from '../src/utils/categoryQuiz';
import { decideWinningPath, buildSatisfactionMatrix } from '../src/utils/competitorAnalysis';
import type { UnmetNeedCandidate } from '../src/utils/userLook';
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
function need(over: Partial<UnmetNeedCandidate>): UnmetNeedCandidate {
  seq += 1;
  return {
    id: `n${seq}`,
    targetUser: '',
    scenario: '',
    jobToBeDone: '',
    needStatement: 'need',
    currentAlternative: '',
    evidenceStrength: 'medium',
    ...over,
  };
}

function product(asin: string): Product {
  seq += 1;
  return {
    asin,
    sku: '',
    brand: 'B',
    title: 'Plain Pillow',
    image: '',
    monthlySales: 10,
    monthlyRevenue: 1000,
    price: 30,
    rating: 4,
    reviewCount: 10,
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
  };
}

console.log('capability library');

test('六维度全量保留，条目 key 不重复', () => {
  const dims = new Set(CAPABILITY_ITEMS.map((i) => i.dimension));
  assert.deepEqual([...dims].sort(), [...CAPABILITY_DIMENSION_ORDER].sort());
  const keys = CAPABILITY_ITEMS.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(CAPABILITY_ITEMS.length >= 15, '六维度要有足够项目可填');
  for (const d of CAPABILITY_DIMENSION_ORDER) {
    assert.ok(CAPABILITY_ITEMS.some((i) => i.dimension === d), `${d} 维度必须有项目`);
  }
});

test('完整度：已明确才算填好；"待确认"与未填都算未完成，并列出待补清单', () => {
  let lib: CapabilityLibrary = defaultCapabilityLibrary();
  assert.equal(computeCompleteness(lib).completeness, 0);
  assert.equal(computeCompleteness(lib).emptyItems.length, CAPABILITY_ITEMS.length);

  lib = setCapabilityEntry(lib, 'startup_capital', 'have');
  lib = setCapabilityEntry(lib, 'moq', 'partial');
  lib = setCapabilityEntry(lib, 'certification', 'unknown');
  const r = computeCompleteness(lib);
  assert.equal(r.filled, 2, '待确认不算已明确');
  assert.equal(r.unknown, 1);
  assert.ok(r.completeness > 0 && r.completeness < 0.2);
  assert.ok(r.emptyItems.some((i) => i.key === 'certification'), '待确认要出现在待补清单里');
  assert.equal(r.byDimension.funding.filled, 1);
  assert.equal(r.byDimension.supply.filled, 1);
});

test('完整度：六维度里最拖后腿的要说出来；完整度高低对应不同话术', () => {
  let lib: CapabilityLibrary = defaultCapabilityLibrary();
  for (const i of CAPABILITY_ITEMS) {
    if (i.dimension === 'compliance') continue;
    lib = setCapabilityEntry(lib, i.key, 'have');
  }
  const r = computeCompleteness(lib);
  const complianceTotal = r.byDimension.compliance.total;
  const expected = Math.round(((CAPABILITY_ITEMS.length - complianceTotal) / CAPABILITY_ITEMS.length) * 1000) / 1000;
  assert.equal(r.completeness, expected);
  assert.ok(r.completeness < 1);
  const weak = weakestDimension(r)!;
  assert.equal(weak.dimension, 'compliance');
  assert.ok(describeCompleteness(r).includes('已足够可信'), `完整度 ${r.completeness} 应给"够用"话术`);

  // 只填一半时给"影响可信度"话术
  let half: CapabilityLibrary = defaultCapabilityLibrary();
  for (const i of CAPABILITY_ITEMS.slice(0, Math.floor(CAPABILITY_ITEMS.length / 2))) half = setCapabilityEntry(half, i.key, 'have');
  const hr = computeCompleteness(half);
  assert.ok(describeCompleteness(hr).includes('影响适配度可信度'), `完整度 ${hr.completeness} 应提示影响可信度`);
  assert.ok(describeCompleteness(computeCompleteness(defaultCapabilityLibrary())).includes('还没填'));
});

test('硬约束：财务红线/合规类"不具备" → 列出；能力类缺失不算硬约束', () => {
  let lib: CapabilityLibrary = defaultCapabilityLibrary();
  lib = setCapabilityEntry(lib, 'net_margin_floor', 'lack', '做不到 25%');
  lib = setCapabilityEntry(lib, 'certification', 'lack');
  lib = setCapabilityEntry(lib, 'ops', 'lack');
  lib = setCapabilityEntry(lib, 'gross_margin', 'partial');
  const hard = capabilityHardConstraints(lib);
  assert.equal(hard.length, 2, `只有红线与合规算硬约束，实际：${hard.join('|')}`);
  assert.ok(hard.some((h) => h.includes('净利率红线') && h.includes('做不到 25%')));
  assert.ok(hard.some((h) => h.includes('认证')));
  assert.ok(!hard.some((h) => h.includes('运营能力')), '能力类缺失是缺口，不是硬约束否决');
});

console.log('category quiz');

const NEED_A = need({ id: 'need-a', category: '功能需求', needStatement: 'adjustable height' });
const NEED_B = need({ id: 'need-b', category: '体感需求', needStatement: 'thin flat' });

test('种子题：只问本项目真的有据可依的题，且每题带依据与"为什么不"', () => {
  const matrices = ['B0A1', 'B0A2'].map((a) => buildSatisfactionMatrix(a, product(a), [], [NEED_A, NEED_B]));
  const decision = decideWinningPath({
    needs: [NEED_A, NEED_B],
    competitors: [{ asin: 'B0A1' }, { asin: 'B0A2' }],
    matrices,
    ours: {},
  });
  const seeds = buildSeedQuestions({ needs: [NEED_A, NEED_B], decision, competitorCount: 2 });
  assert.ok(seeds.length >= 4 && seeds.length <= 8, `题量应在 5-8 附近：${seeds.length}`);
  for (const q of seeds) {
    assert.ok(q.question.length > 5);
    assert.ok(q.basis.length > 5, `${q.id} 必须有出题依据`);
    assert.ok(q.options.length >= 2 && q.options.length <= 5);
    for (const o of q.options) assert.ok(o.why.length > 0, `${q.id} 每个选项都要有"为什么不"`);
  }
  // 交叉清单里 ourStatus=unknown 的需求应当出题
  assert.ok(seeds.some((q) => q.id === 'seed:need:need-a'));
  // 边界题必须标出来（硬约束来源）
  assert.ok(seeds.some((q) => q.isBoundary === true));
});

test('种子题：没有问题/没有竞对时不会编出空题', () => {
  const seeds = buildSeedQuestions({ needs: [], competitorCount: 0 });
  assert.ok(seeds.every((q) => q.basis.length > 0));
  assert.ok(!seeds.some((q) => q.id.startsWith('seed:need:')));
  assert.ok(!seeds.some((q) => q.id === 'seed:differentiation'));
});

test('种子题：背景库有硬约束时追加一题让用户明确', () => {
  let lib: CapabilityLibrary = defaultCapabilityLibrary();
  lib = setCapabilityEntry(lib, 'certification', 'lack');
  const seeds = buildSeedQuestions({ needs: [NEED_A], library: lib });
  assert.ok(seeds.some((q) => q.id === 'seed:library_boundary'));
});

test('AI 增补归一化：非法状态/选项不足的题被丢弃，id 带 ai 前缀', () => {
  const ai = normalizeAiQuestions([
    { question: 'Q1', category: 'supply', options: [{ label: 'A', status: 'have', why: 'w' }, { label: 'B', status: 'lack', why: 'w' }] },
    { question: 'Q2', options: [{ label: 'A', status: 'bogus', why: 'w' }, { label: 'B', status: 'have', why: 'w' }] },
    { question: '', options: [{ label: 'A', status: 'have', why: 'w' }] },
  ]);
  assert.equal(ai.length, 1);
  assert.equal(ai[0].id.startsWith('ai:'), true);
  assert.equal(ai[0].origin, 'ai');
});

test('合并非破坏性：种子题不覆盖同名题，新增 AI 题，用户回答永不丢失', () => {
  const base: QuizData = { questions: [{ id: 'seed:x', category: 'capability', question: 'Q', basis: 'b', options: [{ label: 'A', status: 'have', why: 'w' }, { label: 'B', status: 'lack', why: 'w' }], origin: 'seed' }], answers: [{ questionId: 'seed:x', optionIndex: 0 }], updatedAt: '' };
  const merged = mergeCategoryQuestions(base, [
    { id: 'seed:x', category: 'capability', question: '重复题', basis: 'b', options: [], origin: 'seed' },
    { id: 'ai:1', category: 'supply', question: '新题', basis: 'b', options: [{ label: 'A', status: 'have', why: 'w' }, { label: 'B', status: 'lack', why: 'w' }], origin: 'ai' },
  ]);
  assert.equal(merged.added, 1);
  assert.equal(merged.skipped, 1);
  assert.equal(merged.next.questions.find((q) => q.id === 'seed:x')!.question, 'Q', '已有题不被覆盖');
  assert.deepEqual(merged.next.answers, [{ questionId: 'seed:x', optionIndex: 0 }], '回答保留');
});

test('ensureSeedQuestions：重复调用不会重复添加（幂等）', () => {
  const seeds = buildSeedQuestions({ needs: [NEED_A], competitorCount: 1 });
  const once = ensureSeedQuestions(defaultQuizData(), seeds);
  const twice = ensureSeedQuestions(once, buildSeedQuestions({ needs: [NEED_A], competitorCount: 1 }));
  assert.equal(twice.questions.length, once.questions.length);
});

test('答题进度 + 硬约束：边界题答"不具备"→ hardBlocks；未答列出', () => {
  const seeds = buildSeedQuestions({ needs: [NEED_A], competitorCount: 2 });
  let data = ensureSeedQuestions(defaultQuizData(), seeds);
  const boundary = data.questions.find((q) => q.isBoundary)!;
  const lackIdx = boundary.options.findIndex((o) => o.status === 'lack');
  data = setAnswer(data, boundary.id, lackIdx);
  const p = computeQuizProgress(data);
  assert.equal(p.total, data.questions.length);
  assert.equal(p.answered, 1);
  assert.equal(p.hardBlocks.length, 1);
  assert.equal(p.hardBlocks[0].id, boundary.id);
  assert.equal(p.unanswered.length, p.total - 1);
});

test('答题 → 自身能力：需求题映射到 byNeedId，取更保守结论；待确认不覆盖已知', () => {
  const seeds = buildSeedQuestions({ needs: [NEED_A, NEED_B], competitorCount: 2 });
  let data = ensureSeedQuestions(defaultQuizData(), seeds);
  const needQ = data.questions.find((q) => (q.needIds ?? []).includes('need-a'))!;
  const haveIdx = needQ.options.findIndex((o) => o.status === 'have');
  data = setAnswer(data, needQ.id, haveIdx);
  const cap = toOurCapabilityFromQuiz(data);
  assert.equal(cap.byNeedId['need-a'], 'have');

  // 同一需求再有一道"部分具备"的题 → 取更保守（partial）
  const extra = {
    id: 'ai:need-a-2',
    category: 'capability' as const,
    question: 'x',
    basis: 'b',
    needIds: ['need-a'],
    options: [{ label: 'A', status: 'partial' as const, why: 'w' }, { label: 'B', status: 'have' as const, why: 'w' }],
    origin: 'ai' as const,
  };
  data = ensureSeedQuestions(data, [extra]);
  data = setAnswer(data, extra.id, 0);
  assert.equal(toOurCapabilityFromQuiz(data).byNeedId['need-a'], 'partial');
});

test('答题 → 适配度答案表：只含已答的题', () => {
  const seeds = buildSeedQuestions({ needs: [NEED_A], competitorCount: 1 });
  let data = ensureSeedQuestions(defaultQuizData(), seeds);
  const q = data.questions[0];
  data = setAnswer(data, q.id, 0);
  const answers = toAnswersForFit(data);
  assert.equal(Object.keys(answers).length, 1);
  assert.ok(answers[q.id]);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
