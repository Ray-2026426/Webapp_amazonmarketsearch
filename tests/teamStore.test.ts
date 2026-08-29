import assert from 'node:assert/strict';

import {
  createTeam,
  inviteTeamMember,
  loadTeams,
  removeTeamMember,
  updateTeamMemberRole,
  type TeamMemberRole,
} from '../src/utils/teamStore';
import type { SessionUser } from '../src/utils/auth';

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

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
    configurable: true,
  });
}

const user: SessionUser = {
  id: 'user_owner',
  username: 'ray',
  email: 'ray@example.com',
  nickname: 'Ray',
  role: 'admin',
};

console.log('team store');
installLocalStorageMock();

test('createTeam adds owner member', () => {
  const team = createTeam(user, 'OG&huhu');
  assert.equal(team.name, 'OG&huhu');
  assert.equal(team.members.length, 1);
  assert.equal(team.members[0].role, 'owner');
  assert.equal(loadTeams(user.id).length, 1);
});

test('inviteTeamMember records pending member and prevents duplicate email', () => {
  const team = loadTeams(user.id)[0];
  const updated = inviteTeamMember(user.id, team.id, 'Member@Example.com', 'member');
  assert.equal(updated?.members.length, 2);
  assert.equal(updated?.members[1].email, 'member@example.com');
  assert.equal(updated?.members[1].status, 'invited');
  assert.throws(() => inviteTeamMember(user.id, team.id, 'member@example.com', 'viewer'));
});

test('updateTeamMemberRole changes non-owner only', () => {
  const team = loadTeams(user.id)[0];
  const member = team.members.find((item) => item.role === 'member');
  assert.ok(member);
  const updated = updateTeamMemberRole(user.id, team.id, member.id, 'admin');
  assert.equal(updated?.members.find((item) => item.id === member.id)?.role, 'admin');

  const owner = updated?.members.find((item) => item.role === 'owner');
  assert.ok(owner);
  const afterOwnerChange = updateTeamMemberRole(user.id, team.id, owner.id, 'viewer' as Exclude<TeamMemberRole, 'owner'>);
  assert.equal(afterOwnerChange?.members.find((item) => item.id === owner.id)?.role, 'owner');
});

test('removeTeamMember keeps owner protected', () => {
  const team = loadTeams(user.id)[0];
  const owner = team.members.find((item) => item.role === 'owner');
  const admin = team.members.find((item) => item.role === 'admin');
  assert.ok(owner);
  assert.ok(admin);

  const afterOwnerRemove = removeTeamMember(user.id, team.id, owner.id);
  assert.equal(afterOwnerRemove?.members.some((item) => item.id === owner.id), true);

  const afterAdminRemove = removeTeamMember(user.id, team.id, admin.id);
  assert.equal(afterAdminRemove?.members.some((item) => item.id === admin.id), false);
});

console.log('');
console.log('result: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
