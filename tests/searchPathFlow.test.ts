// M2① · 搜索路径「流向」的确定性计算测试。
// 目标：四层按固定顺序对齐，保留/流失比例可复现，口径不混用、缺口径时诚实标注。
import assert from 'node:assert/strict';

import {
  computeSearchPathFlow,
  describeSearchPathFlow,
  SEARCH_PATH_LAYER_ORDER,
  type SearchPath,
} from '../src/utils/userLook';

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

function path(layers: SearchPath['layers']): SearchPath {
  return { layers };
}

console.log('search path flow');

test('空输入：四层都返回，但 retention 为 null（不编造比例）', () => {
  const flows = computeSearchPathFlow(undefined);
  assert.equal(flows.length, 4);
  assert.deepEqual(flows.map((f) => f.layer), SEARCH_PATH_LAYER_ORDER);
  assert.ok(flows.every((f) => f.retention === null && f.basis === null));
  assert.equal(flows[0].note, '本层没有词，无法计算流向');
});

test('搜索量口径：逐层保留比例 = 本层量 / 上层量', () => {
  const flows = computeSearchPathFlow(
    path([
      { layer: 'awareness', words: [{ word: 'pillow', volume: 10000 }] },
      { layer: 'consideration', words: [{ word: 'thin pillow', volume: 4000 }] },
      { layer: 'decision', words: [{ word: 'adjustable pillow', volume: 1000 }] },
      { layer: 'scenario', words: [{ word: 'stomach sleeper pillow', volume: 250 }] },
    ])
  );
  assert.deepEqual(flows.map((f) => f.retention), [1, 0.4, 0.25, 0.25]);
  assert.deepEqual(flows.map((f) => f.basis), ['volume', 'volume', 'volume', 'volume']);
  assert.equal(flows[1].dropOff, 0.6, '流失 = 1 - 保留');
  assert.equal(flows[0].dropOff, 0, '首层没有流失');
  assert.equal(flows[2].volume, 1000);
});

test('层序与 AI 返回顺序无关（固定按 认知→考虑→决策→场景 对齐）', () => {
  const flows = computeSearchPathFlow(
    path([
      { layer: 'decision', words: [{ word: 'd', volume: 100 }] },
      { layer: 'awareness', words: [{ word: 'a', volume: 1000 }] },
      { layer: 'scenario', words: [{ word: 's', volume: 10 }] },
      { layer: 'consideration', words: [{ word: 'c', volume: 500 }] },
    ])
  );
  assert.deepEqual(flows.map((f) => f.layer), SEARCH_PATH_LAYER_ORDER);
  assert.deepEqual(flows.map((f) => f.retention), [1, 0.5, 0.2, 0.1]);
});

test('缺搜索量时退化为词数口径，并明确标注口径（不混算）', () => {
  const flows = computeSearchPathFlow(
    path([
      { layer: 'awareness', words: [{ word: 'a1' }, { word: 'a2' }, { word: 'a3' }, { word: 'a4' }] },
      { layer: 'consideration', words: [{ word: 'c1' }, { word: 'c2' }] },
      { layer: 'decision', words: [{ word: 'd1' }] },
      { layer: 'scenario', words: [{ word: 's1' }] },
    ])
  );
  assert.deepEqual(flows.map((f) => f.basis), ['words', 'words', 'words', 'words']);
  assert.deepEqual(flows.map((f) => f.retention), [1, 0.5, 0.5, 1]);
  assert.ok(flows[1].note?.includes('词数口径'));
});

test('两层都有量时优先搜索量口径，并提示本层缺量的词未计入', () => {
  const flows = computeSearchPathFlow(
    path([
      { layer: 'awareness', words: [{ word: 'a', volume: 1000 }, { word: 'a2', volume: 1000 }] },
      { layer: 'consideration', words: [{ word: 'c', volume: 800 }, { word: 'c2' }] },
    ])
  );
  assert.equal(flows[1].basis, 'volume');
  assert.equal(flows[1].retention, 0.4, '只按有量的词算：800 / 2000');
  assert.equal(flows[1].volumeWordCount, 1);
  assert.equal(flows[1].wordCount, 2);
  assert.ok(flows[1].note?.includes('1 个词没有搜索量'));
});

test('非法/零搜索量被忽略，不产生负数或 NaN', () => {
  const flows = computeSearchPathFlow(
    path([{ layer: 'awareness', words: [{ word: 'a', volume: 0 }, { word: 'b', volume: Number.NaN }] }])
  );
  assert.equal(flows[0].volume, 0);
  assert.equal(flows[0].volumeWordCount, 0);
  assert.ok(Number.isFinite(flows[0].retention ?? 0));
});

test('空白词不计入层宽（避免用空词撑出假的流向）', () => {
  const flows = computeSearchPathFlow(
    path([
      { layer: 'awareness', words: [{ word: 'a' }, { word: '   ' }] },
      { layer: 'consideration', words: [{ word: 'c' }] },
    ])
  );
  assert.equal(flows[0].wordCount, 1);
  assert.equal(flows[1].retention, 1);
});

test('describeSearchPathFlow：人话链条 + 口径标注；无数据时诚实说明', () => {
  const flows = computeSearchPathFlow(
    path([
      { layer: 'awareness', words: [{ word: 'a', volume: 1000 }] },
      { layer: 'consideration', words: [{ word: 'c', volume: 400 }] },
      { layer: 'decision', words: [{ word: 'd', volume: 100 }] },
    ])
  );
  const text = describeSearchPathFlow(flows);
  assert.ok(text.includes('认知层 100% → 考虑层 40% → 决策层 25%'), text);
  assert.ok(text.includes('搜索量口径'));
  assert.ok(describeSearchPathFlow(computeSearchPathFlow(undefined)).includes('流向数据不足'));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
