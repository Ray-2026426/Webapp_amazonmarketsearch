// M2⑤ · 修断链 #7（看市场 openQuestions 无下游消费者）的确定性助手测试。
import assert from 'node:assert/strict';

import {
  alignOpenQuestionAnswers,
  countAnswered,
  describeOpenQuestionProgress,
  openQuestionsForPrompt,
  buildAnswersForAi,
} from '../src/utils/openQuestions';

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

console.log('open questions');

test('align：问题为准，空白问题被忽略，回答默认空串', () => {
  const rows = alignOpenQuestionAnswers(['可调高度真的是需求吗？', '   ', '侧睡占比多少？'], undefined);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.answer), ['', '']);
});

test('align：已有回答按问题文本匹配保留（用户改了字不会误删旧回答，未匹配的旧答案保留在传入值里）', () => {
  const prev = [
    { question: '可调高度真的是需求吗？', answer: '12 个竞品只有 2 个可调', answeredAt: '2026-09-01T00:00:00.000Z' },
    { question: '已删除的问题', answer: '旧答案' },
  ];
  const rows = alignOpenQuestionAnswers(['可调高度真的是需求吗？', '侧睡占比多少？'], prev);
  assert.equal(rows[0].answer, '12 个竞品只有 2 个可调');
  assert.equal(rows[0].answeredAt, '2026-09-01T00:00:00.000Z');
  assert.equal(rows[1].answer, '', '新问题没有旧回答就是空');
  assert.equal(rows.length, 2, '问题列表里没有的旧问题不出现在编辑行里');
});

test('countAnswered：只数真正写了字的（空白不算）', () => {
  assert.equal(countAnswered([{ question: 'a', answer: 'ok' }, { question: 'b', answer: '   ' }]), 1);
  assert.equal(countAnswered(undefined), 0);
});

test('describeOpenQuestionProgress：诚实地报"已回答/总数"，没有问题时不假装有', () => {
  assert.equal(describeOpenQuestionProgress([], []), '看市场还没有留下待验证问题');
  const s = describeOpenQuestionProgress(['q1', 'q2'], [{ question: 'q1', answer: '答了' }]);
  assert.ok(s.includes('2 个待验证问题') && s.includes('已回答 1 个'));
});

test('openQuestionsForPrompt：把问题与已有回答一起给 AI；没有问题时不产生空段落', () => {
  assert.equal(openQuestionsForPrompt([], []), '');
  const text = openQuestionsForPrompt(
    ['可调高度真的是需求吗？', '侧睡占比多少？'],
    [{ question: '可调高度真的是需求吗？', answer: '初步：只有 2 个竞品标注可调' }]
  );
  assert.ok(text.includes('来自「看市场」的待验证问题'));
  assert.ok(text.includes('1. 可调高度真的是需求吗？'));
  assert.ok(text.includes('用户已有初步回答：初步：只有 2 个竞品标注可调'));
  assert.ok(text.includes('2. 侧睡占比多少？'));
  assert.ok(text.includes('不要编造数据'));
});

test('buildAnswersForAi：结构与数据一致，缺回答补空串（不编造）', () => {
  const rows = buildAnswersForAi([{ question: 'q', answer: '' }]);
  assert.deepEqual(rows, [{ question: 'q', answer: '' }]);
  assert.deepEqual(buildAnswersForAi(undefined), []);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
