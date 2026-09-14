// M5 · 审计事件归一化与聚合测试（§11.4 审计日志）。
import assert from 'node:assert/strict';

import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  describeAuditEvent,
  normalizeAuditEvent,
  summarizeAudit,
} from '../src/utils/auditEvents';

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

console.log('audit events');

test('动作白名单与中文标签一一对应（漏标签会让管理员看到英文 key）', () => {
  for (const a of AUDIT_ACTIONS) {
    assert.ok(AUDIT_ACTION_LABELS[a], `${a} 缺中文标签`);
    assert.ok(AUDIT_ACTION_LABELS[a].length > 0);
  }
  assert.ok(AUDIT_ACTION_LABELS.unknown.includes('未登记'));
});

test('归一化：白名单外的动作记为 unknown 但**不丢弃**（未知动作也要留痕）', () => {
  const e = normalizeAuditEvent({ actorUserId: 'u1', action: 'something_new', target: 'p1' });
  assert.equal(e.action, 'unknown');
  assert.equal(e.actorUserId, 'u1');
  assert.equal(e.target, 'p1');
  assert.ok(e.id.length > 0, '缺 id 要自动补（审计记录必须能唯一定位）');
  assert.ok(e.createdAt.length > 0);
});

test('归一化：缺操作人记为 anonymous，不静默丢事件', () => {
  const e = normalizeAuditEvent({ action: 'login' });
  assert.equal(e.actorUserId, 'anonymous');
  assert.equal(e.action, 'login');
});

test('归一化：明细里的密钥类字段被掩码（审计日志不能变成泄露渠道）', () => {
  const e = normalizeAuditEvent({
    actorUserId: 'u1',
    action: 'admin_config',
    target: 'key:sellersprite',
    detail: { apiKey: 'sk-abcdefghijklmn', projectId: 'p1', note: '已更新' },
  });
  assert.ok(!JSON.stringify(e.detail).includes('abcdefghijklmn'), '密钥明文不得进审计');
  assert.equal(e.detail?.projectId, 'p1', '普通字段不动');
});

test('聚合：按动作/操作人分组 + 最近事件倒序 + 未登记动作计数', () => {
  const events = [
    { actorUserId: 'u1', actorEmail: 'a@x.com', action: 'fetch', target: 'B0AAA', createdAt: '2026-09-01T10:00:00.000Z' },
    { actorUserId: 'u1', actorEmail: 'a@x.com', action: 'decision', target: 'o1', createdAt: '2026-09-02T10:00:00.000Z' },
    { actorUserId: 'u2', actorEmail: 'b@x.com', action: 'mystery', createdAt: '2026-09-03T10:00:00.000Z' },
  ];
  const s = summarizeAudit(events);
  assert.equal(s.total, 3);
  assert.equal(s.unknownActions, 1);
  assert.equal(s.byAction.find((r) => r.key === 'fetch')!.label, '取数');
  assert.equal(s.byAction.find((r) => r.key === 'fetch')!.events, 1);
  assert.equal(s.byActor[0].key, 'a@x.com', '按操作人聚合，出现次数多者在前');
  assert.equal(s.byActor[0].events, 2);
  assert.equal(s.recent[0].action, 'unknown', '最近事件在最前（2026-09-03）');
  assert.ok(s.summary.includes('3 条审计记录'));
  assert.ok(s.summary.includes('未登记动作'), '出现未知动作要在概览里点名');
});

test('聚合：空输入不崩，且给出人话', () => {
  const s = summarizeAudit([]);
  assert.equal(s.total, 0);
  assert.equal(s.byAction.length, 0);
  assert.ok(s.summary.includes('还没有审计记录'));
});

test('describeAuditEvent：一行能读（时间/谁/做了什么/对象）', () => {
  const e = normalizeAuditEvent({ actorUserId: 'u1', actorEmail: 'a@x.com', action: 'export', target: '报告' });
  const line = describeAuditEvent(e);
  assert.ok(line.includes('a@x.com'));
  assert.ok(line.includes('导出'));
  assert.ok(line.includes('报告'));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
