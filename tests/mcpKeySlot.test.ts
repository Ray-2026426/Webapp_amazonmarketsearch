import assert from 'node:assert/strict';

import {
  customKeySlot,
  customSlotEndpoint,
  isKeySlot,
  keySlotFor,
  normalizeMcpEndpoint,
} from '../src/utils/mcpKeySlot';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  OK ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log('MCP 密钥槽位（§15.32：自定义端点各自独立）');

test('内置数据源保持历史槽位', () => {
  assert.equal(keySlotFor('sellersprite'), 'sellersprite');
  assert.equal(keySlotFor('xydc'), 'xydc');
  assert.equal(keySlotFor('unknown'), '');
});

test('同一自定义端点的大小写、fragment 和末尾斜杠归一到同一槽位', () => {
  const a = customKeySlot(' HTTPS://MCP.Example.COM/path/#debug ');
  const b = customKeySlot('https://mcp.example.com/path');
  assert.equal(a, 'custom:https://mcp.example.com/path');
  assert.equal(a, b);
});

test('路径与 query 是端点身份的一部分，不得串 Key', () => {
  assert.notEqual(customKeySlot('https://mcp.example.com/a'), customKeySlot('https://mcp.example.com/b'));
  assert.notEqual(customKeySlot('https://mcp.example.com/a?team=1'), customKeySlot('https://mcp.example.com/a?team=2'));
});

test('自定义槽位可安全往返解析', () => {
  const endpoint = normalizeMcpEndpoint('https://mcp.example.com/mcp/');
  const slot = keySlotFor('custom', endpoint);
  assert.equal(slot, 'custom:https://mcp.example.com/mcp');
  assert.equal(customSlotEndpoint(slot), endpoint);
  assert.equal(isKeySlot(slot), true);
});

test('服务端拒绝非规范、非 HTTP(S) 或含控制字符的槽位', () => {
  assert.equal(isKeySlot('custom:HTTPS://MCP.Example.com/path/'), false);
  assert.equal(isKeySlot('custom:ftp://mcp.example.com/path'), false);
  assert.equal(isKeySlot('custom:https://mcp.example.com/with space'), false);
  assert.equal(isKeySlot('custom:https://mcp.example.com/a\n'), false);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
