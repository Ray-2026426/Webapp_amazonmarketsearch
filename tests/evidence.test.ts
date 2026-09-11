// 证据对象纯逻辑测试（M1 · PRD §7.3 / 断链 #5）。
import assert from 'node:assert/strict';

import {
  buildEvidence,
  mergeEvidenceList,
  countEvidenceByLook,
  describeEvidence,
  MAX_EVIDENCE,
  type Evidence,
} from '../src/utils/evidence';

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

const NOW = new Date('2026-09-20T10:00:00.000Z');

function ev(over: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev_1',
    projectId: 'p1',
    look: 'user',
    type: 'review',
    sourceRef: 'review:B0AAA#1',
    summary: '样本证据',
    createdAt: NOW.toISOString(),
    ...over,
  };
}

console.log('evidence');

test('buildEvidence：生成带 look/type/sourceRef/summary 的完整对象', () => {
  const e = buildEvidence(
    { projectId: 'p1', look: 'market', type: 'chart', sourceRef: 'chart:price@seg1', summary: ' 价格带集中 20-35 美元 ' },
    NOW
  );
  assert.ok(e.id.startsWith('ev_'), 'id 应有 ev_ 前缀');
  assert.equal(e.projectId, 'p1');
  assert.equal(e.look, 'market');
  assert.equal(e.type, 'chart');
  assert.equal(e.sourceRef, 'chart:price@seg1');
  assert.equal(e.summary, '价格带集中 20-35 美元', '摘要应去掉首尾空格');
  assert.equal(e.createdAt, NOW.toISOString());
});

test('mergeEvidenceList：同 sourceRef 去重（新的替换旧的，不堆积）', () => {
  const old = ev({ id: 'ev_old', summary: '旧摘要' });
  const incoming = ev({ id: 'ev_new', summary: '新摘要' });
  const list = mergeEvidenceList([old], incoming);
  assert.equal(list.length, 1, '同来源应只保留一条');
  assert.equal(list[0].id, 'ev_new');
  assert.equal(list[0].summary, '新摘要');
});

test('mergeEvidenceList：不同 sourceRef 累积，且最新在最前', () => {
  const a = ev({ id: 'ev_a', sourceRef: 'kw:table#1' });
  const b = ev({ id: 'ev_b', sourceRef: 'kw:table#2' });
  const list = mergeEvidenceList([a], b);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'ev_b', '最新的应在最前');
  assert.equal(list[1].id, 'ev_a');
});

test('mergeEvidenceList：超过上限时截断（保留最新 MAX_EVIDENCE 条）', () => {
  let list: Evidence[] = [];
  for (let i = 0; i < MAX_EVIDENCE + 20; i++) {
    list = mergeEvidenceList(list, ev({ id: `ev_${i}`, sourceRef: `ref_${i}` }));
  }
  assert.equal(list.length, MAX_EVIDENCE);
  assert.equal(list[0].id, `ev_${MAX_EVIDENCE + 19}`, '应保留最新的');
});

test('mergeEvidenceList：脏输入（非数组）不崩', () => {
  const list = mergeEvidenceList(undefined as unknown as Evidence[], ev());
  assert.equal(list.length, 1);
});

test('countEvidenceByLook：按看分组计数', () => {
  const c = countEvidenceByLook([
    ev({ look: 'user' }),
    ev({ look: 'user', sourceRef: 'x2' }),
    ev({ look: 'market', sourceRef: 'x3' }),
    ev({ look: 'competitor', sourceRef: 'x4' }),
  ]);
  assert.deepEqual(c, { user: 2, market: 1, competitor: 1, self: 0, opportunity: 0 });
});

test('describeEvidence：输出可读的"哪一看 · 什么类型 · 摘要（来源）"', () => {
  const text = describeEvidence(ev({ look: 'competitor', type: 'asin', summary: '竞品 3 个', sourceRef: 'asin:B0A,B0B' }));
  assert.ok(text.includes('看竞对'));
  assert.ok(text.includes('ASIN'));
  assert.ok(text.includes('竞品 3 个'));
  assert.ok(text.includes('asin:B0A,B0B'));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
