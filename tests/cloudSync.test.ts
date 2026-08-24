import assert from 'node:assert/strict';

import { mergeProjectSets } from '../src/utils/cloudSync';
import { validateSupabaseConfig } from '../src/utils/supabaseConfig';
import { emptyFiveLookProgress } from '../src/utils/projectStore';
import type { ResearchProject } from '../src/types/researchProject';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log('  OK ' + name);
  } catch (error) {
    failed += 1;
    console.error('  FAIL ' + name);
    console.error('    ' + (error instanceof Error ? error.message : String(error)));
  }
}

function project(overrides: Partial<ResearchProject> = {}): ResearchProject {
  return {
    id: 'p1',
    workspaceId: 'default',
    name: 'Project',
    marketplace: 'US',
    objective: 'new_product',
    ownerId: 'u1',
    memberIds: [],
    status: 'draft',
    activeLook: 'market',
    fiveLookProgress: emptyFiveLookProgress(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

console.log('cloud sync merge');

test('云端独有项目会进入合并结果', () => {
  const remote = project({ id: 'remote' });
  const result = mergeProjectSets([], [remote]);
  assert.deepEqual(result.projects.map((p) => p.id), ['remote']);
  assert.equal(result.conflicts, 0);
});

test('版本号高者优先，避免设备时钟偏差覆盖新版本', () => {
  const local = project({ name: 'local-v3', version: 3, updatedAt: '2026-01-01T00:00:00.000Z' });
  const remote = project({ name: 'cloud-v2', version: 2, updatedAt: '2026-02-01T00:00:00.000Z' });
  const result = mergeProjectSets([local], [remote]);
  assert.equal(result.projects.find((p) => p.id === 'p1')?.name, 'local-v3');
  assert.equal(result.conflicts, 0);
});

test('同版本双端分叉时保留冲突副本', () => {
  const local = project({ name: 'local edit', version: 2, updatedAt: '2026-02-01T10:00:00.000Z' });
  const remote = project({ name: 'cloud edit', version: 2, updatedAt: '2026-02-01T11:00:00.000Z' });
  const result = mergeProjectSets([local], [remote]);
  assert.equal(result.conflicts, 1);
  assert.equal(result.projects.find((p) => p.id === 'p1')?.name, 'cloud edit');
  assert.ok(result.projects.some((p) => p.id.includes('_conflict_local_') && p.name.includes('冲突副本')));
});

test('相同快照不会产生冲突副本', () => {
  const same = project({ version: 4 });
  const reordered = { version: same.version, name: same.name, ...same } as ResearchProject;
  const result = mergeProjectSets([same], [reordered]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.conflicts, 0);
});

console.log('cloud config validation');

test('允许 HTTPS Publishable Key', () => {
  assert.equal(validateSupabaseConfig({ url: 'https://demo.supabase.co', key: 'sb_publishable_example' }), null);
});

test('拒绝非本机 HTTP URL', () => {
  assert.match(validateSupabaseConfig({ url: 'http://demo.supabase.co', key: 'sb_publishable_example' }) ?? '', /HTTPS/);
});

test('拒绝 Secret Key', () => {
  assert.match(validateSupabaseConfig({ url: 'https://demo.supabase.co', key: 'sb_secret_example' }) ?? '', /禁止/);
});

test('拒绝 JWT Service Role Key', () => {
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const jwt = `x.${payload}.x`;
  assert.match(validateSupabaseConfig({ url: 'https://demo.supabase.co', key: jwt }) ?? '', /Service Role/);
});

console.log('');
console.log('result: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
