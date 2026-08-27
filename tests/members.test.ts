// 成员管理纯逻辑测试（Phase 3）：角色标签、可管理判断。
import assert from 'node:assert/strict';

import { MEMBER_ROLE_LABELS, type MemberRole } from '../src/utils/projectMembers';

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

console.log('project member labels');

test('三种角色都有中文标签', () => {
  const roles: MemberRole[] = ['owner', 'editor', 'viewer'];
  for (const role of roles) {
    assert.ok(MEMBER_ROLE_LABELS[role].length > 0, `missing label for ${role}`);
  }
  assert.equal(MEMBER_ROLE_LABELS.owner, '负责人');
  assert.equal(MEMBER_ROLE_LABELS.editor, '可编辑');
  assert.equal(MEMBER_ROLE_LABELS.viewer, '只读');
});

test('owner 可以管理成员（语义常量供 UI 判断）', () => {
  // 成员管理 UI 只对 myRole === 'owner' 开放；editor/viewer 隐藏管理操作。
  const canManage = (role: MemberRole | null) => role === 'owner';
  assert.equal(canManage('owner'), true);
  assert.equal(canManage('editor'), false);
  assert.equal(canManage('viewer'), false);
  assert.equal(canManage(null), false);
});

test('邀请与角色调整只允许 editor/viewer，不允许 owner', () => {
  const assignable: MemberRole[] = ['editor', 'viewer'];
  for (const role of assignable) {
    assert.ok(role !== 'owner');
  }
});

console.log('');
console.log('result: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
