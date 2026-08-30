// 乐观并发纯逻辑测试（Phase 3）：push 冲突回灌 + 冲突副本保留。
import assert from 'node:assert/strict';

import { mergeProjectSets, reconcilePushConflicts, dropPendingDeletions } from '../src/utils/cloudSync';
import { emptyFiveLookProgress } from '../src/utils/projectStore';
import { migrateProject } from '../src/utils/projectStore';
import type { ResearchProject } from '../src/types/researchProject';

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

console.log('optimistic concurrency (push conflicts)');

test('服务端冲突回灌：云端版本胜出，本地保留冲突副本', () => {
  // 真实场景：两端都基于旧 revision 编辑，data.version 相同但服务端 revision 不同，
  // 推送被拒后回灌云端版本 → 同版本分叉 → 云端胜出 + 本地冲突副本。
  const merged = [
    project({ name: '本地编辑', version: 2, updatedAt: '2026-02-01T10:00:00.000Z', cloudRevision: 1 }),
  ];
  const cloudWinner = project({
    name: '云端新版本',
    version: 2,
    updatedAt: '2026-02-01T11:00:00.000Z',
    cloudRevision: 2,
  });
  const result = reconcilePushConflicts(merged, [cloudWinner]);
  assert.equal(result.conflicts, 1);
  const main = result.projects.find((p) => p.id === 'p1');
  assert.equal(main?.name, '云端新版本');
  assert.ok(
    result.projects.some((p) => p.id.includes('_conflict_local_') && p.name.includes('冲突副本')),
    '应保留本地冲突副本'
  );
});

test('冲突回灌后再推送的集合包含云端胜者与冲突副本', () => {
  const merged = [project({ name: '本地', version: 2, updatedAt: '2026-02-01T10:00:00.000Z' })];
  const cloudWinner = project({ name: '云端', version: 2, updatedAt: '2026-02-01T11:00:00.000Z' });
  const result = reconcilePushConflicts(merged, [cloudWinner]);
  const ids = result.projects.map((p) => p.id);
  assert.ok(ids.includes('p1'));
  assert.ok(ids.some((id) => id.includes('_conflict_local_')));
});

test('云端版本号更高时直接取高者，不产生冲突副本', () => {
  const merged = [project({ name: '本地', version: 2, updatedAt: '2026-02-01T10:00:00.000Z' })];
  const cloudWinner = project({ name: '云端', version: 3, updatedAt: '2026-02-01T11:00:00.000Z' });
  const result = reconcilePushConflicts(merged, [cloudWinner]);
  assert.equal(result.conflicts, 0);
  assert.equal(result.projects.find((p) => p.id === 'p1')?.name, '云端');
});

test('无冲突时原样返回', () => {
  const merged = [project({ name: 'A' })];
  const result = reconcilePushConflicts(merged, []);
  assert.equal(result.projects.length, 1);
  assert.equal(result.conflicts, 0);
});

test('pull 返回的 cloudRevision 会被 migrateProject 保留', () => {
  const raw = { ...project({ name: 'X' }), cloudRevision: 7 } as unknown;
  const migrated = migrateProject(raw);
  assert.equal(migrated?.cloudRevision, 7);
});

test('云端冲突副本 id 不会再次分叉（幂等回灌）', () => {
  const copyId = 'p1_conflict_local_20260201T100000000Z';
  const merged = [
    project({ id: copyId, name: '本地冲突副本', version: 1, updatedAt: '2026-02-01T10:00:00.000Z' }),
  ];
  const cloud = [
    project({ name: '云端版本', version: 3, updatedAt: '2026-02-01T11:00:00.000Z' }),
  ];
  const once = reconcilePushConflicts(merged, cloud);
  const twice = reconcilePushConflicts(once.projects, cloud);
  assert.equal(twice.conflicts, 0);
  assert.ok(!twice.projects.some((p) => p.id.includes(copyId + '_conflict_')));
});

test('mergeProjectSets 保持 cloudRevision 由云端版本携带', () => {
  const local = project({ version: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
  const remote = project({ version: 2, updatedAt: '2026-02-01T00:00:00.000Z', cloudRevision: 2 });
  const result = mergeProjectSets([local], [remote]);
  assert.equal(result.projects.find((p) => p.id === 'p1')?.cloudRevision, 2);
});

test('内容相同仅 cloudRevision 不同不视为分叉', () => {
  const local = project({ name: 'Same', version: 3, updatedAt: '2026-01-01T00:00:00.000Z', cloudRevision: 1 });
  const remote = project({ name: 'Same', version: 3, updatedAt: '2026-01-01T00:00:00.000Z', cloudRevision: 2 });
  const result = mergeProjectSets([local], [remote]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.conflicts, 0);
  assert.ok(!result.projects.some((p) => p.id.includes('_conflict_')));
});

test('删除后硬剔除：待删 id 与其冲突副本都被移除（删了不复活）', () => {
  const projects = [
    project({ id: 'p1', name: 'A' }),
    project({ id: 'p1_conflict_local_20260101000000000Z', name: 'A（冲突副本）' }),
    project({ id: 'p2', name: 'B' }),
  ];
  const result = dropPendingDeletions(projects, ['p1']);
  const ids = result.map((p) => p.id);
  assert.ok(!ids.includes('p1'), '原始项目应被删除');
  assert.ok(!ids.some((id) => id.includes('_conflict_' ) && id.startsWith('p1_conflict_')), 'p1 的冲突副本应被删除');
  assert.ok(ids.includes('p2'), '其他项目应保留');
});

test('dropPendingDeletions：空待删列表不删除任何项目', () => {
  const projects = [project({ id: 'p1', name: 'A' })];
  const result = dropPendingDeletions(projects, []);
  assert.equal(result.length, 1);
});

test('dropPendingDeletions：非冲突 id 不影响删除多个目标', () => {
  const projects = [
    project({ id: 'pA', name: 'A' }),
    project({ id: 'pA_conflict_cloud_20260201T000000000Z', name: 'A副' }),
    project({ id: 'pB', name: 'B' }),
  ];
  const result = dropPendingDeletions(projects, ['pA', 'pB']);
  assert.equal(result.length, 0);
});

console.log('');
console.log('result: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
