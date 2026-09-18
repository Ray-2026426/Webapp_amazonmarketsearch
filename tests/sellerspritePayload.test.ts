import assert from 'node:assert/strict';

import { extractToolPayload, pickItems } from '../src/utils/sellerspriteApi';

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

console.log('sellersprite MCP payload parsing');

test('parses server-forwarded MCP content arrays instead of treating them as rows', () => {
  const payload = [
    {
      type: 'text',
      text: JSON.stringify({
        data: {
          records: [
            { keyword: 'bread bag', searches: 8600 },
            { keyword: 'bread storage bag', searches: 3200 },
          ],
        },
      }),
    },
  ];

  const extracted = extractToolPayload(payload) as Record<string, unknown>;
  assert.ok(extracted.data, 'content text should be parsed as JSON');
  const rows = pickItems(payload) as Array<{ keyword: string }>;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].keyword, 'bread bag');
});

test('finds keyword rows across common upstream result shapes', () => {
  const shapes = [
    { data: { items: [{ keyword: 'coffee tumbler' }] } },
    { data: { list: [{ keyword: 'coffee mug' }] } },
    { result: { records: [{ keyword: 'travel mug' }] } },
    { payload: { rows: [{ keywords: 'insulated cup' }] } },
    { data: { keywordList: [{ keyword: 'stainless cup' }] } },
    { data: { results: [{ searchTerm: 'bread bag' }] } },
  ];

  for (const shape of shapes) {
    assert.equal(pickItems(shape).length, 1, JSON.stringify(shape));
  }
});

test('keeps normal item arrays intact', () => {
  const rows = [{ keyword: 'desk mat' }, { keyword: 'large desk mat' }];
  assert.deepEqual(pickItems(rows), rows);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
