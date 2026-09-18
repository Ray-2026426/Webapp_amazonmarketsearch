import assert from 'node:assert/strict';
import fs from 'node:fs';

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

console.log('keyword MCP fallback and render safety');

test('keyword fetch can fall back from sellersprite quota errors to xydc', () => {
  const src = fs.readFileSync('src/utils/sellerspriteApi.ts', 'utf8');
  assert.ok(src.includes("callMcpToolBrowser('sellersprite'"), 'must try sellersprite first');
  assert.ok(src.includes("callMcpToolBrowser('xydc'"), 'must have xydc fallback path');
  assert.ok(src.includes('isQuotaError'), 'fallback must be guarded by quota-like errors');
  assert.ok(src.includes('providers?.xydc?.configured'), 'fallback must require xydc configuration');
  assert.ok(src.includes('卖家精灵额度不足'), 'progress should explain automatic fallback');
});

test('keyword UI guards optional aiTags fields before rendering and exporting', () => {
  const src = fs.readFileSync('src/components/KeywordAnalysis.tsx', 'utf8');
  assert.ok(src.includes('normalizeFetchedKeyword'), 'fetched keywords must be normalized before entering state');
  assert.ok(src.includes('Array.isArray(k.aiTags) ? k.aiTags : []'), 'aiTags must be treated as optional');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
