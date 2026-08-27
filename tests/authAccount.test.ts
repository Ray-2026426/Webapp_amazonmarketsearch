import assert from 'node:assert/strict';

import { normalizeAccount } from '../api/auth/account';

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

console.log('auth account');

test('邮箱账号保持原邮箱登录', () => {
  const account = normalizeAccount('User@Example.com');
  assert.equal(account?.account, 'user@example.com');
  assert.equal(account?.authEmail, 'user@example.com');
  assert.equal(account?.isEmail, true);
});

test('纯数字账号映射为内部邮箱', () => {
  const account = normalizeAccount('123456');
  assert.equal(account?.account, '123456');
  assert.match(account?.authEmail ?? '', /^acct-[0-9a-f]{32}@users\.amzdev\.dev$/);
  assert.equal(account?.isEmail, false);
});

test('非法账号会被拒绝', () => {
  assert.equal(normalizeAccount('a'), null);
  assert.equal(normalizeAccount('abc def'), null);
  assert.equal(normalizeAccount('-abc'), null);
});

console.log('');
console.log('result: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
