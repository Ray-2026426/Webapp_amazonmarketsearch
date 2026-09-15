// M3⑤ V3 · 能力库（推导 + 人工覆盖）+ 「看自己」3 个拍板问题测试。
//
// 本轮（V3）把"20 项四态手填 + 5-8 道品类题"换成"背景信息推导 + 3 个拍板问题"，
// 本套件守住的是**没有降低强度的部分**：能力项词表、覆盖标记、硬约束候选、
// 3 个问题的确定性与选项口径、多选语义、答案→决策边界项映射、AI 增补的非破坏性、答题进度与硬约束。
import assert from 'node:assert/strict';

import {
  CAPABILITY_ITEMS,
  CAPABILITY_ITEM_KEYS,
  CAPABILITY_DIMENSION_ORDER,
  capabilityHardConstraints,
  clearCapabilityOverride,
  defaultCapabilityLibrary,
  loadCapabilityLibrary,
  manualOverrideCount,
  setCapabilityEntry,
  type CapabilityLibrary,
} from '../src/utils/capabilityLibrary';
import {
  DECISION_QUESTIONS,
  boundaryItemsFromQuiz,
  buildDecisionQuestions,
  computeQuizProgress,
  defaultQuizData,
  ensureSeedQuestions,
  entryConditionsFromQuiz,
  marginFloorFromQuiz,
  mergeCategoryQuestions,
  normalizeAiQuestions,
  mostConservative,
  refreshDecisionQuestions,
  setAnswer,
  setAnswerMulti,
  setAnswerNote,
  stopLossAnswerText,
  toOurCapabilityFromQuiz,
  toAnswersForFit,
  toggleMultiAnswer,
  type QuizData,
  type QuizQuestion,
} from '../src/utils/categoryQuiz';
import { SELF_DECISION_QUESTION_COUNT } from '../src/utils/selfAssessment';
import type { UserBackgroundProfile } from '../src/utils/userBackground';

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

/** 最小背景信息：只给推导需要的字段（测试里显式写清"哪条输入推出哪条结论"） */
function background(over: Partial<UserBackgroundProfile['fields']> = {}): UserBackgroundProfile {
  return { fields: { ...over }, notes: {}, legacyNotes: '', updatedAt: '' };
}

console.log('capability library');

test('能力项词表：六维度齐全，key 不重复，条目覆盖推导所需的全部维度', () => {
  const dims = new Set(CAPABILITY_ITEMS.map((i) => i.dimension));
  assert.deepEqual([...dims].sort(), [...CAPABILITY_DIMENSION_ORDER].sort());
  const keys = CAPABILITY_ITEMS.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(CAPABILITY_ITEMS.length >= 20, '能力项要足够覆盖背景信息里的能力输入');
  for (const d of CAPABILITY_DIMENSION_ORDER) {
    assert.ok(CAPABILITY_ITEMS.some((i) => i.dimension === d), `${d} 维度必须有项目`);
  }
  for (const key of ['product_def', 'rnd', 'ads', 'after_sales']) {
    assert.ok(CAPABILITY_ITEM_KEYS.includes(key), `V3 应有能力项 ${key}`);
  }
});

test('逐条覆盖：显式标记 manual；取消覆盖即回到推导；"待确认"不算覆盖', () => {
  let lib: CapabilityLibrary = defaultCapabilityLibrary();
  assert.equal(manualOverrideCount(lib), 0);
  lib = setCapabilityEntry(lib, 'ads', 'lack', '团队没人投广告');
  assert.equal(lib.entries.ads.status, 'lack');
  assert.equal(lib.entries.ads.source, 'manual', '覆盖必须显式标记 source=manual');
  assert.equal(manualOverrideCount(lib), 1);
  lib = setCapabilityEntry(lib, 'ads', 'unknown');
  assert.equal(lib.entries.ads, undefined, '覆盖成"待确认"等于取消覆盖');
  lib = setCapabilityEntry(lib, 'ads', 'have');
  lib = clearCapabilityOverride(lib, 'ads');
  assert.equal(lib.entries.ads, undefined, '取消覆盖后回到"由背景信息推导"');
});

test('读取持久化：非法状态丢弃；unknown 视为没覆盖（不猜用户意图）', () => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  store.set(
    'kairo_capability_library:u1',
    JSON.stringify({
      entries: {
        ads: { status: 'lack', note: 'n' },
        moq: { status: 'bogus' },
        ops: { status: 'unknown' },
      },
      updatedAt: '',
    })
  );
  const lib = loadCapabilityLibrary('u1');
  assert.deepEqual(Object.keys(lib.entries), ['ads']);
  assert.equal(lib.entries.ads.source, 'manual');
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

console.log('decision questions（3 个拍板问题）');

test('恰好 3 个问题，全部是决策边界题，id/标签稳定（改动即打红）', () => {
  assert.equal(DECISION_QUESTIONS.length, SELF_DECISION_QUESTION_COUNT);
  assert.equal(SELF_DECISION_QUESTION_COUNT, 3);
  assert.deepEqual(
    DECISION_QUESTIONS.map((q) => q.id),
    ['decision:margin_floor', 'decision:stop_loss', 'decision:entry_conditions']
  );
  assert.deepEqual(
    DECISION_QUESTIONS.map((q) => q.label),
    ['最低毛利率', '止损条件', '必须满足的进入条件']
  );
  const qs = buildDecisionQuestions({ background: background() });
  assert.equal(qs.length, 3);
  for (const q of qs) {
    assert.equal(q.isBoundary, true, `${q.id} 必须是决策边界题（答不具备 → 不可直接进入）`);
    assert.equal(q.origin, 'seed');
    assert.ok(q.question.length > 5);
    assert.ok(q.basis.length > 20, `${q.id} 必须有"为什么问"的依据`);
    // 单选 3-6 项；多选（进入条件）最多 8 项（6 个条件 + 互斥的"还没定"）
    assert.ok(q.options.length >= 3 && q.options.length <= 8, `${q.id} 选项数 ${q.options.length} 不合理`);
    for (const o of q.options) assert.ok(o.why.length > 10, `${q.id} 每个选项都要有"为什么不"`);
  }
  assert.equal(qs.find((q) => q.id === 'decision:entry_conditions')!.multiple, true, 'Q3 必须可多选');
});

test('Q1：最低毛利率选项带数值口径；"还没定" → 不具备（触发硬约束）', () => {
  const q = buildDecisionQuestions({ background: background() }).find((x) => x.id === 'decision:margin_floor')!;
  const floors = q.options.map((o) => o.floorPercent).filter((n) => typeof n === 'number');
  assert.deepEqual(floors, [0.4, 0.3, 0.2, 0.15]);
  const notSet = q.options.find((o) => o.status === 'lack')!;
  assert.ok(notSet.label.includes('还没定'));

  const quiz = setAnswer(ensureSeedQuestions(defaultQuizData(), [q]), q.id, q.options.indexOf(notSet));
  assert.equal(marginFloorFromQuiz(quiz), undefined, '选"还没定"时不能猜一个红线出来');
  assert.equal(computeQuizProgress(quiz).hardBlocks.length, 1);

  const ok = setAnswer(ensureSeedQuestions(defaultQuizData(), [q]), q.id, 0);
  assert.equal(marginFloorFromQuiz(ok), 0.4, '选了 ≥40% 就把红线确定性带下去（喂给"人优我廉"）');
  assert.equal(computeQuizProgress(ok).hardBlocks.length, 0);
});

test('Q3：每个"进入条件"选项的满足情况由背景信息推导（不是 AI，也不是猜）', () => {
  const q = buildDecisionQuestions({
    background: background({ certifications: ['NONE'], moqRange: 'gt3000', leadTimeRange: 'd15_30' }),
  }).find((x) => x.id === 'decision:entry_conditions')!;
  const byKey = (k: string) => q.options.find((o) => o.conditionKey === k)!;
  assert.equal(byKey('cert_ready').status, 'lack', '背景里认证=暂无 → 认证齐备这一条不具备');
  assert.ok(byKey('cert_ready').why.includes('依据你的背景信息'));
  assert.equal(byKey('moq_in_budget').status, 'lack', 'MOQ >3000 → 预算内不成立');
  assert.equal(byKey('deliver_60d').status, 'have', '交期 15-30 天 → 60 天内可交付');
  assert.equal(byKey('no_patent_risk').status, 'unknown', '专利风险背景信息判断不了 → unknown（不是 lack）');
  assert.equal(q.options.find((o) => o.exclusive)!.status, 'lack');
});

test('Q3 多选：最保守结论；选"还没定"清掉其它条件；未答不算已答', () => {
  const q = buildDecisionQuestions({ background: background({ certifications: ['NONE'] }) }).find(
    (x) => x.id === 'decision:entry_conditions'
  )!;
  let quiz = ensureSeedQuestions(defaultQuizData(), [q]);
  assert.equal(computeQuizProgress(quiz).answered, 0);
  const certIdx = q.options.findIndex((o) => o.conditionKey === 'cert_ready');
  const deliverIdx = q.options.findIndex((o) => o.conditionKey === 'deliver_60d');
  quiz = setAnswerMulti(quiz, q.id, [deliverIdx, certIdx]);
  assert.equal(mostConservative(['have', 'lack']), 'lack', '取最保守');
  assert.equal(computeQuizProgress(quiz).hardBlocks.length, 1, '选中"不具备"的进入条件 ⇒ 硬约束');
  const exclusiveIdx = q.options.findIndex((o) => o.exclusive);
  quiz = toggleMultiAnswer(quiz, q.id, exclusiveIdx);
  assert.deepEqual(quiz.answers.find((a) => a.questionId === q.id)!.optionIndexes, [exclusiveIdx]);
  quiz = toggleMultiAnswer(quiz, q.id, deliverIdx);
  assert.deepEqual(
    quiz.answers.find((a) => a.questionId === q.id)!.optionIndexes,
    [deliverIdx],
    '选普通条件时清掉互斥的"还没定"'
  );
});

test('答案 → 决策边界项：3 项、都在 boundary 类、未答=待确认、备注带选项原文', () => {
  const qs = buildDecisionQuestions({ background: background() });
  let quiz = ensureSeedQuestions(defaultQuizData(), qs);
  const items0 = boundaryItemsFromQuiz(quiz);
  assert.equal(items0.length, 3);
  assert.deepEqual(
    items0.map((i) => i.id),
    ['boundary:margin_floor', 'boundary:stop_loss', 'boundary:entry_conditions']
  );
  for (const i of items0) {
    assert.equal(i.category, 'boundary');
    assert.equal(i.status, 'unknown');
  }
  const stop = qs.find((q) => q.id === 'decision:stop_loss')!;
  quiz = setAnswer(quiz, stop.id, 0);
  quiz = setAnswerNote(quiz, stop.id, '亏损 $5,000 或 60 天');
  const stopItem = boundaryItemsFromQuiz(quiz).find((i) => i.id === 'boundary:stop_loss')!;
  assert.equal(stopItem.status, 'have');
  assert.ok(stopItem.note!.includes('双条件'));
  assert.ok(stopItem.note!.includes('亏损 $5,000 或 60 天'));
  assert.equal(stopLossAnswerText(quiz)!.includes('60 天'), true);
});

test('刷新题目：背景信息变了 → 选项满足情况跟着变，但用户的答案不会丢', () => {
  const before = buildDecisionQuestions({ background: background({ certifications: ['NONE'] }) });
  let quiz = ensureSeedQuestions(defaultQuizData(), before);
  const q3 = before.find((q) => q.id === 'decision:entry_conditions')!;
  const certIdx = q3.options.findIndex((o) => o.conditionKey === 'cert_ready');
  quiz = setAnswerMulti(quiz, q3.id, [certIdx]);
  assert.equal(computeQuizProgress(quiz).hardBlocks.length, 1);

  // 背景信息补上了 CE/FCC → 同一个选项应变成"已具备"，硬约束随之解除
  const after = buildDecisionQuestions({
    background: background({ certifications: ['CE', 'FCC'], marketplaces: ['US'] }),
  });
  quiz = refreshDecisionQuestions(quiz, after);
  const refreshed = quiz.questions.find((q) => q.id === 'decision:entry_conditions')!;
  assert.equal(refreshed.options.find((o) => o.conditionKey === 'cert_ready')!.status, 'have');
  assert.deepEqual(
    quiz.answers.find((a) => a.questionId === q3.id)!.optionIndexes,
    [certIdx],
    '答案（按下标）必须保留'
  );
  assert.equal(computeQuizProgress(quiz).hardBlocks.length, 0);
  assert.equal(entryConditionsFromQuiz(quiz).includes('cert_ready'), true);
});

test('AI 增补归一化：非法状态/选项不足的题被丢弃，id 带 ai 前缀（逃生通道仍在）', () => {
  const ai = normalizeAiQuestions([
    { question: 'Q1', category: 'supply', options: [{ label: 'A', status: 'have', why: 'w' }, { label: 'B', status: 'lack', why: 'w' }] },
    { question: 'Q2', options: [{ label: 'A', status: 'bogus', why: 'w' }, { label: 'B', status: 'have', why: 'w' }] },
    { question: '', options: [{ label: 'A', status: 'have', why: 'w' }] },
  ]);
  assert.equal(ai.length, 1);
  assert.equal(ai[0].id.startsWith('ai:'), true);
  assert.equal(ai[0].origin, 'ai');
});

test('AI 增补的非破坏性：不覆盖同名题、不覆盖拍板题，用户回答永不丢失', () => {
  const base: QuizData = {
    questions: [
      { id: 'ai:1', category: 'capability', question: 'Q', basis: 'b', options: [{ label: 'A', status: 'have', why: 'w' }, { label: 'B', status: 'lack', why: 'w' }], origin: 'ai' },
      { id: 'decision:margin_floor', category: 'finance', question: '红线', basis: 'b', options: [{ label: 'A', status: 'have', why: 'w' }, { label: 'B', status: 'lack', why: 'w' }], origin: 'seed', isBoundary: true },
    ],
    answers: [{ questionId: 'ai:1', optionIndex: 0 }],
    updatedAt: '',
  };
  const merged = mergeCategoryQuestions(base, [
    { id: 'ai:1', category: 'capability', question: '重复题', basis: 'b', options: [], origin: 'ai' },
    { id: 'ai:2', category: 'supply', question: '新题', basis: 'b', options: [{ label: 'A', status: 'have', why: 'w' }, { label: 'B', status: 'lack', why: 'w' }], origin: 'ai' },
  ]);
  assert.equal(merged.added, 1);
  assert.equal(merged.skipped, 1);
  assert.equal(merged.next.questions.find((q) => q.id === 'ai:1')!.question, 'Q', '已有题不被覆盖');
  assert.deepEqual(merged.next.answers, [{ questionId: 'ai:1', optionIndex: 0 }], '回答保留');
  const refreshed = refreshDecisionQuestions(merged.next, buildDecisionQuestions({ background: background() }));
  assert.equal(refreshed.questions.some((q) => q.id === 'ai:2'), true);
  assert.equal(refreshed.answers.length, 1);
});

test('ensureSeedQuestions：重复调用不会重复添加（幂等）', () => {
  const seeds = buildDecisionQuestions({ background: background() });
  const once = ensureSeedQuestions(defaultQuizData(), seeds);
  const twice = ensureSeedQuestions(once, buildDecisionQuestions({ background: background() }));
  assert.equal(twice.questions.length, once.questions.length);
});

test('答题进度 + 硬约束：3 道边界题答"不具备"→ hardBlocks；未答列出', () => {
  const qs = buildDecisionQuestions({ background: background() });
  let data = ensureSeedQuestions(defaultQuizData(), qs);
  const margin = qs.find((q) => q.id === 'decision:margin_floor')!;
  const lackIdx = margin.options.findIndex((o) => o.status === 'lack');
  data = setAnswer(data, margin.id, lackIdx);
  const p = computeQuizProgress(data);
  assert.equal(p.total, 3);
  assert.equal(p.answered, 1);
  assert.equal(p.hardBlocks.length, 1);
  assert.equal(p.hardBlocks[0].id, margin.id);
  assert.equal(p.unanswered.length, 2);
});

test('AI 增补题 → 自身能力：需求题映射到 byNeedId，取更保守结论', () => {
  const first: QuizQuestion = {
    id: 'ai:need-a',
    category: 'capability',
    question: 'x',
    basis: 'b',
    needIds: ['need-a'],
    options: [{ label: 'A', status: 'have', why: 'w' }, { label: 'B', status: 'partial', why: 'w' }],
    origin: 'ai',
  };
  let data = ensureSeedQuestions(defaultQuizData(), [first]);
  data = setAnswer(data, 'ai:need-a', 0);
  assert.equal(toOurCapabilityFromQuiz(data).byNeedId['need-a'], 'have');

  const second: QuizQuestion = {
    id: 'ai:need-a-2',
    category: 'capability',
    question: 'x2',
    basis: 'b',
    needIds: ['need-a'],
    options: [{ label: 'A', status: 'partial', why: 'w' }, { label: 'B', status: 'have', why: 'w' }],
    origin: 'ai',
  };
  data = ensureSeedQuestions(data, [second]);
  data = setAnswer(data, second.id, 0);
  assert.equal(toOurCapabilityFromQuiz(data).byNeedId['need-a'], 'partial', '同一需求取更保守结论');
});

test('答题 → 适配度答案表：只含已答的题；多选取最保守', () => {
  const qs = buildDecisionQuestions({ background: background({ certifications: ['NONE'] }) });
  let data = ensureSeedQuestions(defaultQuizData(), qs);
  const q1 = qs[0];
  data = setAnswer(data, q1.id, 0);
  const answers = toAnswersForFit(data);
  assert.equal(Object.keys(answers).length, 1);
  assert.equal(answers[q1.id], 'have');

  const q3 = qs.find((q) => q.id === 'decision:entry_conditions')!;
  const certIdx = q3.options.findIndex((o) => o.conditionKey === 'cert_ready');
  data = setAnswerMulti(data, q3.id, [certIdx, q3.options.findIndex((o) => o.conditionKey === 'deliver_60d')]);
  assert.equal(toAnswersForFit(data)[q3.id], 'lack', '多选取最保守');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
