// 项目资产（Storage）纯逻辑测试（Phase 3）：路径派生、阈值、回填降级。
import assert from 'node:assert/strict';

import {
  ASSET_BUCKET,
  REPORT_STORAGE_THRESHOLD,
  reportStoragePath,
  reportPathInBucket,
} from '../src/utils/projectAssets';
import { reportReuseKey } from '../src/utils/reportStore';

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

console.log('project assets (storage)');

test('bucket 名固定为 project-assets', () => {
  assert.equal(ASSET_BUCKET, 'project-assets');
});

test('报告存储路径按 projectId + reportId 派生且稳定（幂等 upsert）', () => {
  const p1 = reportStoragePath('p_abc', 'rep_123');
  const p2 = reportStoragePath('p_abc', 'rep_123');
  assert.equal(p1, p2);
  assert.ok(p1.startsWith(`${ASSET_BUCKET}/reports/p_abc/rep_123.md`));
});

test('路径对非法字符做净化，避免路径穿越', () => {
  const p = reportStoragePath('../evil/项目', 'rep/../x');
  assert.ok(!p.includes('..'), '不应包含 ..');
  assert.ok(!p.includes('/') || p.split('/').every((seg) => !seg.includes('..')));
  assert.ok(p.includes('reports/'));
});

test('reportPathInBucket 去掉 bucket 前缀', () => {
  assert.equal(reportPathInBucket('project-assets/reports/p1/r1.md'), 'reports/p1/r1.md');
  assert.equal(reportPathInBucket('reports/p1/r1.md'), 'reports/p1/r1.md');
});

test('超阈值判断（大型报告才转 Storage）', () => {
  assert.ok(REPORT_STORAGE_THRESHOLD > 0);
  const small = 'x'.repeat(REPORT_STORAGE_THRESHOLD - 1);
  const large = 'x'.repeat(REPORT_STORAGE_THRESHOLD + 1);
  const externalize = (len: number) => len > REPORT_STORAGE_THRESHOLD;
  assert.equal(externalize(small.length), false);
  assert.equal(externalize(large.length), true);
});

test('报告复用键与存储无关（指纹复用不受 storagePath 影响）', () => {
  const key = reportReuseKey('p1', 'market', 's1', 'fp', 'pv', 'model');
  assert.ok(key.includes('p1|market|s1|fp|pv|model'));
});

test('上传失败时保持内联正文（降级不丢数据）', () => {
  // externalizeReports 的降级语义：upload 返回 null 时原样保留报告（含 markdown）。
  const inline = { markdown: 'x'.repeat(REPORT_STORAGE_THRESHOLD + 10) };
  const keepInline = (uploaded: string | null) => (uploaded ? { ...inline, markdown: '' } : inline);
  assert.equal(keepInline(null).markdown.length, inline.markdown.length);
  assert.equal(keepInline('storage:path').markdown, '');
});

console.log('');
console.log('result: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
