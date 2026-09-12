// M5 · 出网路由决策测试（用户决策 A：数据池只对登录用户开放）。
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { decideOutboundRoute, canFetchFromPool, poolTypeForTool, usageToolForTool } from '../src/utils/dataPoolRouting';

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

console.log('outbound routing (decision A)');

test('已登录 → 走服务端数据池（浏览器不接触密钥）', () => {
  const r = decideOutboundRoute({ hasToken: true });
  assert.equal(r.route, 'gateway');
  assert.ok(r.reason.includes('不接触密钥'));
  assert.equal(canFetchFromPool(true), true);
});

test('未登录 → 明确拒绝，并指向示例数据/登录（不再有浏览器直连这条退路）', () => {
  const r = decideOutboundRoute({ hasToken: false });
  assert.equal(r.route, 'blocked');
  assert.ok(r.reason.includes('只对登录用户开放'), r.reason);
  assert.ok(r.reason.includes('示例数据'), '要告诉游客还能怎么体验');
  assert.ok(r.reason.includes('登录'));
  assert.equal(canFetchFromPool(false), false);
});

test('路由只有两种结论（没有"自定义地址""浏览器兜底"这类旁路）', () => {
  const routes = new Set([decideOutboundRoute({ hasToken: true }).route, decideOutboundRoute({ hasToken: false }).route]);
  assert.deepEqual([...routes].sort(), ['blocked', 'gateway']);
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

test('源码级：卖家精灵调用点只走网关，且未登录时抛错而不是回退', () => {
  const src = fs.readFileSync('src/utils/sellerspriteApi.ts', 'utf8');
  assert.ok(src.includes('decideOutboundRoute({ hasToken: canUseDataPool() })'), '必须走统一路由决策');
  assert.ok(src.includes("route.route === 'blocked'"), '未登录必须被拦下');
  assert.ok(src.includes('只走服务端数据池'), '必须写明口径');
  assert.ok(!src.includes('resolveSellerSpriteAuth('), '不得再解析浏览器侧的密钥');
  assert.ok(!src.includes("'secret-key': secretKey"), '不得再往请求头里塞浏览器密钥');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
