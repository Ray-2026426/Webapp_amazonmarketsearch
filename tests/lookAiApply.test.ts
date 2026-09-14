// M2 · 看用户 V2：搜索路径图 / 搜索偏好卡的归一化与非破坏性合并测试。
import assert from 'node:assert/strict';

import {
  normalizeSearchPath,
  normalizeSearchPreference,
  mergeUserLookAi,
} from '../src/utils/lookAiApply';
import { defaultUserLook } from '../src/utils/userLook';

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

const VALID_PATH = {
  summary: '先搜大词，再按睡姿分化，最后比高度调节',
  layers: [
    { layer: 'decision', words: [{ word: 'adjustable pillow', volume: 900, share: 0.5 }] },
    { layer: 'awareness', words: [{ word: 'bed pillow', volume: 12000, share: 0.6 }] },
    { layer: 'consideration', words: [{ word: 'pillow for side sleeper', volume: 4800, share: 0.3 }] },
    { layer: 'scenario', words: [{ word: 'cooling pillow', volume: 300, share: 0.1 }] },
  ],
};

console.log('lookAiApply');

test('normalizeSearchPath：固定四层顺序（与 AI 返回顺序无关）', () => {
  const p = normalizeSearchPath(VALID_PATH);
  assert.ok(p, '应解析成功');
  assert.deepEqual(
    p!.layers.map((l) => l.layer),
    ['awareness', 'consideration', 'decision', 'scenario']
  );
  assert.equal(p!.summary, '先搜大词，再按睡姿分化，最后比高度调节');
});

test('normalizeSearchPath：缺少的层被丢弃，只剩有词的层', () => {
  const p = normalizeSearchPath({ layers: [{ layer: 'awareness', words: [{ word: 'a' }] }] });
  assert.ok(p);
  assert.equal(p!.layers.length, 1);
  assert.equal(p!.layers[0].layer, 'awareness');
});

test('normalizeSearchPath：share 夹到 0-1、volume 非法则丢弃、空词被过滤', () => {
  const p = normalizeSearchPath({
    layers: [
      {
        layer: 'awareness',
        words: [
          { word: 'ok', share: 1.8, volume: -5 },
          { word: '   ' },
          { word: 'neg', share: -0.4, volume: 100 },
        ],
      },
    ],
  });
  assert.ok(p);
  const words = p!.layers[0].words;
  assert.equal(words.length, 2, '空白词应被过滤');
  assert.equal(words[0].share, 1, 'share 上限夹到 1');
  assert.equal(words[0].volume, undefined, '负数搜索量应丢弃');
  assert.equal(words[1].share, 0, 'share 下限夹到 0');
  assert.equal(words[1].volume, 100);
});

test('normalizeSearchPath：垃圾输入返回 null（不污染已有数据）', () => {
  assert.equal(normalizeSearchPath(null), null);
  assert.equal(normalizeSearchPath('abc'), null);
  assert.equal(normalizeSearchPath({ layers: [] }), null);
  assert.equal(normalizeSearchPath({ layers: [{ layer: 'awareness', words: [] }] }), null);
});

test('normalizeSearchPreference：非法枚举丢弃、长尾夹到 0-1', () => {
  const pref = normalizeSearchPreference({
    priceSensitivity: 'VERY_HIGH',
    priceSensitivityNote: '低价词占比 18%',
    attributeMix: '功能与材质词占 62%',
    longTailShare: 1.4,
    decisionFocus: ['高度调节', ' ', '支撑'],
  });
  assert.ok(pref);
  assert.equal(pref!.priceSensitivity, undefined, '非法枚举应丢弃');
  assert.equal(pref!.longTailShare, 1, '长尾比例上限夹到 1');
  assert.deepEqual(pref!.decisionFocus, ['高度调节', '支撑'], '空白项应过滤');
  assert.equal(pref!.attributeMix, '功能与材质词占 62%');
});

test('normalizeSearchPreference：全空返回 null', () => {
  assert.equal(normalizeSearchPreference({}), null);
  assert.equal(normalizeSearchPreference(undefined), null);
});

test('mergeUserLookAi：空数据时填入搜索路径与偏好卡，并在 filled 里说明', () => {
  const data = defaultUserLook('p1');
  const { next, filled } = mergeUserLookAi(data, {
    targetUser: '侧睡者',
    searchPath: VALID_PATH,
    searchPreference: { priceSensitivity: 'medium', longTailShare: 0.42 },
  });
  assert.equal(next.targetUser, '侧睡者');
  assert.equal(next.searchPath?.layers.length, 4);
  assert.equal(next.searchPreference?.priceSensitivity, 'medium');
  assert.ok(filled.some((f) => f.includes('搜索路径图')));
  assert.ok(filled.some((f) => f.includes('搜索偏好卡')));
});

test('mergeUserLookAi：已有搜索路径/偏好时完全不覆盖', () => {
  const data = {
    ...defaultUserLook('p1'),
    searchPath: { layers: [{ layer: 'awareness' as const, words: [{ word: '人工写的词' }] }] },
    searchPreference: { priceSensitivity: 'high' as const },
  };
  const { next, skipped } = mergeUserLookAi(data, {
    searchPath: VALID_PATH,
    searchPreference: { priceSensitivity: 'low' },
  });
  assert.equal(next.searchPath?.layers.length, 1);
  assert.equal(next.searchPath?.layers[0].words[0].word, '人工写的词', '人工内容必须保留');
  assert.equal(next.searchPreference?.priceSensitivity, 'high', '人工偏好必须保留');
  assert.ok(skipped.includes('搜索路径图'));
  assert.ok(skipped.includes('搜索偏好卡'));
});

test('mergeUserLookAi：AI 没给搜索路径时不写坏数据', () => {
  const data = defaultUserLook('p1');
  const { next, skipped } = mergeUserLookAi(data, { targetUser: 'X' });
  assert.equal(next.searchPath, undefined);
  assert.equal(next.searchPreference, undefined);
  assert.ok(skipped.includes('搜索路径图'));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
