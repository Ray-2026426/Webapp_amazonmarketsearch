// 五看「AI 起草」非破坏性合并规则的纯逻辑测试（M1：激活 lookAi 引擎）。
// 关键断言：AI 永远不会覆盖人工已填内容。
import assert from 'node:assert/strict';

import {
  makeMergeAcc,
  mergeText,
  mergeList,
  mergeUnmetNeedCandidates,
  describeMerge,
} from '../src/utils/lookAiMerge';
import type { UnmetNeedCandidate } from '../src/utils/userLook';

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

function candidate(over: Partial<UnmetNeedCandidate> = {}): UnmetNeedCandidate {
  return {
    id: 'n_existing',
    targetUser: '侧睡者',
    scenario: '夜间睡眠',
    jobToBeDone: '保持颈椎支撑',
    needStatement: '人工写过的需求',
    currentAlternative: '多买几个枕头',
    evidenceStrength: 'high',
    ...over,
  };
}

let idSeq = 0;
const makeId = () => `n_ai_${++idSeq}`;

console.log('lookAiMerge');

test('空文本 + AI 有内容 -> 填入并记录为新增', () => {
  const acc = makeMergeAcc();
  const v = mergeText('', '市场还在增长', '市场吸引力', acc);
  assert.equal(v, '市场还在增长');
  assert.deepEqual(acc.filled, ['市场吸引力']);
  assert.deepEqual(acc.skipped, []);
});

test('已有文本 + AI 有内容 -> 保留人工内容，不覆盖', () => {
  const acc = makeMergeAcc();
  const v = mergeText('我自己写的判断', 'AI 想覆盖这一段', '市场吸引力', acc);
  assert.equal(v, '我自己写的判断');
  assert.deepEqual(acc.filled, []);
  assert.deepEqual(acc.skipped, ['市场吸引力']);
});

test('空白文本（仅空格）视为空 -> 可被 AI 填入', () => {
  const acc = makeMergeAcc();
  const v = mergeText('   ', 'AI 内容', '目标用户', acc);
  assert.equal(v, 'AI 内容');
  assert.deepEqual(acc.filled, ['目标用户']);
});

test('空文本 + AI 也没内容 -> 保持为空并记为跳过', () => {
  const acc = makeMergeAcc();
  const v = mergeText('', undefined, '使用场景', acc);
  assert.equal(v, '');
  assert.deepEqual(acc.filled, []);
  assert.deepEqual(acc.skipped, ['使用场景']);
});

test('空数组 + AI 列表 -> 整体采用', () => {
  const acc = makeMergeAcc();
  const v = mergeList([], ['证据一', '证据二'], '关键证据', acc);
  assert.deepEqual(v, ['证据一', '证据二']);
  assert.deepEqual(acc.filled, ['关键证据（2 条）']);
});

test('非空数组 -> 完全不覆盖，即便 AI 给了更多条目', () => {
  const acc = makeMergeAcc();
  const v = mergeList(['人工证据'], ['AI1', 'AI2', 'AI3'], '关键证据', acc);
  assert.deepEqual(v, ['人工证据']);
  assert.deepEqual(acc.skipped, ['关键证据']);
});

test('AI 列表里混有空串/空白 -> 过滤后为空则视为跳过', () => {
  const acc = makeMergeAcc();
  const v = mergeList([], ['  ', ''], '市场风险', acc);
  assert.deepEqual(v, []);
  assert.deepEqual(acc.skipped, ['市场风险']);
});

test('未满足需求候选：现有为空 -> 采用 AI 候选并补 id / 归一化强度', () => {
  const acc = makeMergeAcc();
  const v = mergeUnmetNeedCandidates(
    [],
    [
      {
        targetUser: '侧睡者',
        scenario: '夜间',
        jobToBeDone: '支撑颈椎',
        needStatement: '枕头高度不可调',
        currentAlternative: '垫毛巾',
        evidenceStrength: 'HIGH',
      },
      { needStatement: '凉感不足', evidenceStrength: '什么鬼' },
      { needStatement: '   ' },
    ],
    makeId,
    '未满足需求候选',
    acc
  );
  assert.equal(v.length, 2, '没有 needStatement 的那条应被丢弃');
  assert.ok(v[0].id.startsWith('n_ai_'), '应补上 AI 候选 id');
  assert.equal(v[0].evidenceStrength, 'high', '强度应大小写归一化');
  assert.equal(v[1].evidenceStrength, 'medium', '非法强度应回落 medium');
  assert.equal(acc.filled.length, 1);
});

test('未满足需求候选：已有人工候选 -> 一条都不动', () => {
  const acc = makeMergeAcc();
  const existing = [candidate()];
  const v = mergeUnmetNeedCandidates(
    existing,
    [{ needStatement: 'AI 的新需求' }],
    makeId,
    '未满足需求候选',
    acc
  );
  assert.deepEqual(v, existing);
  assert.deepEqual(acc.skipped, ['未满足需求候选']);
});

test('describeMerge 同时说明新增与保留', () => {
  const acc = makeMergeAcc();
  mergeText('', 'X', '市场吸引力', acc);
  mergeText('已有', 'Y', '关键风险', acc);
  const text = describeMerge(acc);
  assert.ok(text.includes('新增：市场吸引力'));
  assert.ok(text.includes('保留原内容：关键风险'));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
