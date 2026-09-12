// M2 · 需求分类树带证据：证据强度确定性折算 + AI 证据归一化测试。
import assert from 'node:assert/strict';

import { computeNeedEvidenceStrength } from '../src/utils/userLook';
import { normalizeNeedEvidence, mergeUnmetNeedCandidates, makeMergeAcc } from '../src/utils/lookAiMerge';

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
const makeId = () => `n_${++seq}`;

console.log('need evidence');

test('空证据 → 0 分、低强度', () => {
  const r = computeNeedEvidenceStrength(undefined);
  assert.equal(r.score, 0);
  assert.equal(r.level, 'low');
});

test('只有关键词证据 → 低/中强度，且不虚高', () => {
  const r = computeNeedEvidenceStrength({ keywords: [{ word: 'a' }, { word: 'b' }] });
  assert.equal(r.score, 24, '2 条关键词 = 24 分');
  assert.equal(r.level, 'low');
});

test('关键词 + 评论 + ASIN 三类齐全 → 含跨来源一致加分', () => {
  const r = computeNeedEvidenceStrength({
    keywords: [{ word: 'a' }, { word: 'b' }],
    reviewQuotes: [{ quote: '太薄了' }, { quote: '睡醒脖子疼' }],
    asins: ['B0AAA', 'B0BBB', 'B0CCC'],
  });
  // 24 + 36 + 15 + 10 = 85
  assert.equal(r.score, 85);
  assert.equal(r.level, 'high');
  assert.ok(r.reasons.some((x) => x.includes('跨来源一致')));
});

test('单项上限生效：10 条关键词也只算 36 分', () => {
  const r = computeNeedEvidenceStrength({ keywords: Array.from({ length: 10 }, (_, i) => ({ word: `w${i}` })) });
  assert.equal(r.score, 36);
});

test('证据分不超过 100', () => {
  const r = computeNeedEvidenceStrength({
    keywords: Array.from({ length: 10 }, (_, i) => ({ word: `w${i}` })),
    reviewQuotes: Array.from({ length: 8 }, (_, i) => ({ quote: `q${i}` })),
    asins: Array.from({ length: 20 }, (_, i) => `B0${i}AAAA`),
  });
  assert.equal(r.score, 100);
  assert.equal(r.level, 'high');
});

test('normalizeNeedEvidence：空白词/空引用被过滤，ASIN 做格式清洗并大写', () => {
  const ev = normalizeNeedEvidence({
    keywords: [{ word: '  ' }, { word: 'ok', volume: 100 }, { word: 'neg', volume: -3 }],
    reviewQuotes: [{ quote: '   ' }, { quote: '真实引用', asin: 'b0abcde' }],
    asins: ['b0aaaaaa', 'x', '   ', 'B0BBBBBB'],
  });
  assert.ok(ev);
  assert.equal(ev!.keywords!.length, 2, '空白词过滤');
  assert.equal(ev!.keywords![1].volume, undefined, '负数搜索量丢弃');
  assert.equal(ev!.reviewQuotes!.length, 1);
  assert.equal(ev!.reviewQuotes![0].asin, 'b0abcde', '引用里的 ASIN 原样保留（不改写引文）');
  assert.deepEqual(ev!.asins, ['B0AAAAAA', 'B0BBBBBB'], 'ASIN 大写并过滤非法值');
});

test('normalizeNeedEvidence：全空返回 undefined', () => {
  assert.equal(normalizeNeedEvidence({ keywords: [], reviewQuotes: [], asins: [] }), undefined);
  assert.equal(normalizeNeedEvidence(null), undefined);
});

test('normalizeNeedEvidence：过短/非法 ASIN 被丢弃（防止把 5 位残缺 ASIN 当覆盖证据）', () => {
  const ev = normalizeNeedEvidence({ asins: ['B0AAA', 'B0BBB', 'B0AAAAAA'] });
  assert.deepEqual(ev!.asins, ['B0AAAAAA']);
});

test('mergeUnmetNeedCandidates：带证据的候选使用确定性强度（覆盖 AI 主观档位）', () => {
  const acc = makeMergeAcc();
  const list = mergeUnmetNeedCandidates(
    [],
    [
      {
        category: '功能需求',
        subCategory: '高度可调',
        needStatement: '枕头高度不可调',
        evidenceStrength: 'low',
        evidence: {
          keywords: [{ word: 'adjustable pillow', volume: 900 }, { word: 'cervical pillow' }],
          reviewQuotes: [{ quote: '睡醒脖子疼，不能调', asin: 'B0AAA' }, { quote: '太薄' }],
          asins: ['B0AAA1111', 'B0BBB2222', 'B0CCC3333'],
        },
      },
    ],
    makeId,
    '未满足需求候选',
    acc
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].category, '功能需求');
  assert.equal(list[0].subCategory, '高度可调');
  assert.equal(list[0].evidenceStrength, 'high', '应按确定性公式升为 high（AI 说的是 low）');
  assert.equal(list[0].evidence!.asins!.length, 3);
});

test('mergeUnmetNeedCandidates：没有证据时沿用 AI 的主观档位', () => {
  const acc = makeMergeAcc();
  const list = mergeUnmetNeedCandidates(
    [],
    [{ needStatement: '无证据需求', evidenceStrength: 'medium' }],
    makeId,
    '未满足需求候选',
    acc
  );
  assert.equal(list[0].evidenceStrength, 'medium');
  assert.equal(list[0].evidence, undefined);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
