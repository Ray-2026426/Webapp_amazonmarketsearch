// M6 · 团队角色 ↔ 项目角色映射测试（目标是"不引入权限提升漏洞"）。
import assert from 'node:assert/strict';

import {
  TEAM_ROLES,
  TEAM_TO_PROJECT_ROLE,
  PROJECT_TO_TEAM_ROLE,
  INVITABLE_TEAM_ROLES,
  canManageTeam,
  canModifyTeamOwner,
  defaultProjectRoleForTeamRole,
  describeRoleMapping,
  mappingIsNonEscalating,
  projectRoleRank,
  teamRoleRank,
} from '../src/utils/teamRoleMapping';
import type { TeamMemberRole } from '../src/utils/teamStore';
import type { MemberRole } from '../src/utils/projectMembers';

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

console.log('team ↔ project role mapping');

test('两套角色词表都有完整映射（不漏、不新增）', () => {
  for (const r of TEAM_ROLES) {
    assert.ok(TEAM_TO_PROJECT_ROLE[r], `团队角色 ${r} 缺映射`);
  }
  for (const r of ['owner', 'editor', 'viewer'] as MemberRole[]) {
    assert.ok(PROJECT_TO_TEAM_ROLE[r], `项目角色 ${r} 缺映射`);
  }
  assert.deepEqual(Object.keys(TEAM_TO_PROJECT_ROLE).sort(), [...TEAM_ROLES].sort());
});

test('绝不升级：团队 admin 不能映射成项目 owner（否则可接管别人项目）', () => {
  assert.equal(TEAM_TO_PROJECT_ROLE.admin, 'editor', '团队管理员只是"可编辑"，不是项目负责人');
  for (const r of TEAM_ROLES) {
    assert.equal(mappingIsNonEscalating(r), true, `${r} 的映射必须等价或降级`);
  }
  // 反例保护：假设有人把 admin 改成 owner，这条断言会失败
  assert.notEqual(TEAM_TO_PROJECT_ROLE.admin, 'owner');
});

test('团队管理能力：只有 owner/admin 能管理团队；负责人永不可被改/移除', () => {
  assert.equal(canManageTeam('owner'), true);
  assert.equal(canManageTeam('admin'), true);
  assert.equal(canManageTeam('member'), false);
  assert.equal(canManageTeam('viewer'), false);
  assert.equal(canModifyTeamOwner(), false, 'owner 只能转让，不能被降级或移除');
});

test('邀请列表不含 owner（不能直接邀请出一个负责人）', () => {
  assert.deepEqual(INVITABLE_TEAM_ROLES, ['admin', 'member', 'viewer']);
  assert.ok(!(INVITABLE_TEAM_ROLES as string[]).includes('owner'));
});

test('项目权限以项目成员角色为准：团队角色只给默认值', () => {
  assert.equal(defaultProjectRoleForTeamRole('owner'), 'owner');
  assert.equal(defaultProjectRoleForTeamRole('member'), 'editor');
  assert.equal(defaultProjectRoleForTeamRole('viewer'), 'viewer');
  const text = describeRoleMapping('admin');
  assert.ok(text.includes('项目内实际权限以该项目的成员角色为准'), text);
});

test('权限序：项目 viewer < editor < owner；团队 viewer < member < admin < owner', () => {
  assert.ok(projectRoleRank('viewer') < projectRoleRank('editor'));
  assert.ok(projectRoleRank('editor') < projectRoleRank('owner'));
  assert.ok(teamRoleRank('viewer') < teamRoleRank('member'));
  assert.ok(teamRoleRank('member') < teamRoleRank('admin'));
  assert.ok(teamRoleRank('admin') < teamRoleRank('owner'));
});

test('人话说明覆盖全部团队角色（面板里不会出现空白解释）', () => {
  for (const r of TEAM_ROLES as TeamMemberRole[]) {
    const text = describeRoleMapping(r);
    assert.ok(text.length > 10, `${r} 的说明太短`);
    assert.ok(text.includes('项目'), `${r} 的说明要点出项目侧关系`);
  }
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
