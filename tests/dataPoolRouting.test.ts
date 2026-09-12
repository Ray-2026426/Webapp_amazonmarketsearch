// M5 · 出网路由决策测试（安全相关：决定浏览器里是否需要密钥）。
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { decideOutboundRoute, isBuiltinProxyPath, poolTypeForTool, usageToolForTool } from '../src/utils/dataPoolRouting';

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

console.log('outbound routing');

test('已登录 + 内置路径 → 走服务端网关（前端不需要密钥）', () => {
  const r = decideOutboundRoute({ mcpUrl: '', hasToken: true });
  assert.equal(r.route, 'gateway');
  assert.ok(r.reason.includes('不接触密钥'));
  assert.equal(decideOutboundRoute({ mcpUrl: '/api-proxy/sellersprite-mcp', hasToken: true }).route, 'gateway');
});

test('未登录（游客）→ 浏览器直连，并明确标注这是临时路径', () => {
  const r = decideOutboundRoute({ mcpUrl: '', hasToken: false });
  assert.equal(r.route, 'browser-legacy');
  assert.ok(r.reason.includes('临时路径'), r.reason);
  assert.ok(r.reason.includes('未登录'));
});

test('用户自定义地址优先于网关（他的地址他的密钥他的责任）', () => {
  const r = decideOutboundRoute({ mcpUrl: 'https://my-mcp.example.com/mcp', hasToken: true });
  assert.equal(r.route, 'custom-endpoint');
  assert.ok(r.reason.includes('自定义 MCP 地址'));
  // 自定义地址 + 未登录也是自定义优先（否则游客用不了自己的中转）
  assert.equal(decideOutboundRoute({ mcpUrl: 'https://my-mcp.example.com/mcp', hasToken: false }).route, 'custom-endpoint');
});

test('内置路径判定：空、/api-proxy/* 都算内置；域名与相对路径不算', () => {
  assert.equal(isBuiltinProxyPath(''), true);
  assert.equal(isBuiltinProxyPath('   '), true);
  assert.equal(isBuiltinProxyPath('/api-proxy/xydc-mcp'), true);
  assert.equal(isBuiltinProxyPath('https://mcp.sellersprite.com/mcp'), false);
  assert.equal(isBuiltinProxyPath('/custom/mcp'), false);
});

test('工具 → 缓存类型/记账分类：口径与 poolCache、用量记账一致', () => {
  assert.equal(poolTypeForTool('review'), 'reviews');
  assert.equal(poolTypeForTool('traffic_keyword'), 'traffic');
  assert.equal(poolTypeForTool('keyword_miner'), 'keywords');
  assert.equal(poolTypeForTool('aba_research_weekly'), 'keywords');
  assert.equal(poolTypeForTool('asin_listing'), 'listing');
  assert.equal(poolTypeForTool('asin_detail'), 'asin_detail');
  assert.equal(poolTypeForTool('未知工具'), 'other', '不认识的一律 other（TTL 最短，宁少缓存不串数据）');

  assert.equal(usageToolForTool('review'), 'reviews');
  assert.equal(usageToolForTool('asin_listing'), 'competitor_listing');
  assert.equal(usageToolForTool('traffic_keyword'), 'traffic');
  assert.equal(usageToolForTool('未知工具'), 'market');
});

test('源码级：卖家精灵调用点必须用路由决策，且网关失败不回退到浏览器直连', () => {
  const src = fs.readFileSync('src/utils/sellerspriteApi.ts', 'utf8');
  assert.ok(src.includes('decideOutboundRoute('), '必须走统一路由决策');
  assert.ok(src.includes("route.route === 'gateway'"), '必须有网关分支');
  assert.ok(
    src.includes('不回退到浏览器直连') || src.includes('不回退到浏览器直连（那需要密钥'),
    '必须写明网关失败不回退（否则会偷偷回去用浏览器里的密钥）'
  );
  assert.ok(!/if \(!wantsCustomEndpoint/.test(src), '旧的临时判断应该已被路由函数取代');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
