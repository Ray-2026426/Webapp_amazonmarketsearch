// M5 · 用量记账 + 数据池缓存 + 密钥掩码测试。
// 这三块是数据池与管理后台的确定性核心：钱、缓存、密钥，都不允许"靠猜"。
import assert from 'node:assert/strict';

import {
  estimateEventCost,
  summarizeUsage,
  summarizeUsageByDay,
  filterUsageByRange,
  checkQuota,
  createUsageEvent,
  describeUsage,
  DEFAULT_COST_TABLE,
  type UsageEvent,
} from '../src/utils/usageAccounting';
import {
  buildCacheKey,
  decideCache,
  makeCacheEntry,
  bumpHit,
  isFresh,
  pruneCache,
  cacheHitRate,
  DEFAULT_TTL_SECONDS,
} from '../src/utils/poolCache';
import { maskKey, describeKey, describeKeys, redactSecrets } from '../src/utils/keyMasking';

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

let seq = 0;
function event(over: Partial<UsageEvent> = {}): UsageEvent {
  seq += 1;
  return {
    id: `u${seq}`,
    workspaceId: 'ws1',
    userId: 'user-a',
    projectId: 'p1',
    tool: 'reviews',
    provider: 'sellersprite',
    ok: true,
    calls: 3,
    createdAt: '2026-09-10T00:00:00.000Z',
    ...over,
  };
}

console.log('usage accounting');

test('成本估算：MCP 按调用次数，LLM 按 token；缓存命中为 0', () => {
  const mcp = estimateEventCost(event({ calls: 3 }));
  assert.equal(mcp, 3 * DEFAULT_COST_TABLE.mcpCallUsd);
  const ai = estimateEventCost(event({ tool: 'ai', calls: 0, inputTokens: 1_000_000, outputTokens: 0 }));
  assert.equal(ai, DEFAULT_COST_TABLE.llmInputPerMillionUsd, '一百万输入 token 按表计费');
  assert.equal(estimateEventCost(event({ cacheHit: true, calls: 5 })), 0, '缓存命中不花钱');
});

test('汇总：按工具/用户/项目/供应商分组，成本降序，且能算缓存省下的钱与失败率', () => {
  const events = [
    event({ tool: 'reviews', userId: 'user-a', projectId: 'p1', calls: 3 }),
    event({ tool: 'reviews', userId: 'user-b', projectId: 'p1', calls: 1, cacheHit: true }),
    event({ tool: 'ai', userId: 'user-a', projectId: 'p2', calls: 0, inputTokens: 100_000, ok: false, error: 'x' }),
  ];
  const s = summarizeUsage(events);
  assert.equal(s.total.events, 3);
  assert.equal(s.total.calls, 4);
  assert.equal(s.total.cacheHits, 1);
  assert.equal(s.total.billedEvents, 2);
  assert.equal(s.total.failures, 1);
  assert.equal(s.total.failureRate, 0.333);
  assert.ok(s.total.savedUsd > 0, '缓存命中应体现"省下的钱"');
  assert.equal(s.byTool.length, 2);
  assert.ok(s.byTool[0].costUsd >= s.byTool[1].costUsd, '必须按成本降序（钱花在哪一眼看到）');
  // 这次 ai（10 万输入 token ≈ $0.028）比 reviews（3 次 MCP = $0.006）贵，所以 ai 在前
  assert.equal(s.byTool[0].key, 'ai');
  assert.equal(s.byTool.find((r) => r.key === 'reviews')!.costUsd, 3 * DEFAULT_COST_TABLE.mcpCallUsd);
  assert.equal(s.byTool.find((r) => r.key === 'ai')!.failures, 1);
  assert.equal(s.byUser.length, 2);
  assert.equal(s.byProject.length, 2);
  assert.equal(s.byProvider.length, 1);
  assert.ok(describeUsage(s).includes('本月'));
});

test('空输入不崩：全 0 且不产生 NaN', () => {
  const s = summarizeUsage([]);
  assert.equal(s.total.events, 0);
  assert.equal(s.total.costUsd, 0);
  assert.equal(s.total.failureRate, 0);
  assert.equal(summarizeUsageByDay([]).length, 0);
});

test('时间过滤与按天汇总：左闭右开，日期升序', () => {
  const events = [
    event({ createdAt: '2026-09-01T10:00:00.000Z' }),
    event({ createdAt: '2026-09-02T10:00:00.000Z' }),
    event({ createdAt: '2026-10-01T00:00:00.000Z' }),
  ];
  const sept = filterUsageByRange(events, '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
  assert.equal(sept.length, 2, '右边界不含');
  const byDay = summarizeUsageByDay(sept);
  assert.deepEqual(byDay.map((d) => d.day), ['2026-09-01', '2026-09-02']);
});

test('配额：只计实际计费事件（缓存命中不占额度）；limit 为空表示不限', () => {
  const events = [event({ userId: 'u1' }), event({ userId: 'u1', cacheHit: true }), event({ userId: 'u2' })];
  const q = checkQuota({ events, userId: 'u1', monthlyLimit: 2 });
  assert.equal(q.used, 1, '缓存命中不计入');
  assert.equal(q.allowed, true);
  assert.equal(q.remaining, 1);
  const over = checkQuota({ events, userId: 'u1', monthlyLimit: 1 });
  assert.equal(over.allowed, false);
  assert.ok(over.reason?.includes('已达到本月配额'));
  const unlimited = checkQuota({ events, userId: 'u1', monthlyLimit: null });
  assert.equal(unlimited.allowed, true);
  assert.equal(unlimited.limit, null);
  assert.equal(unlimited.remaining, null);
});

test('createUsageEvent：补齐 id/时间戳，并夹住负数调用次数', () => {
  const e = createUsageEvent({ workspaceId: 'w', userId: 'u', tool: 'other', provider: 'x', ok: true, calls: -5 });
  assert.ok(e.id.startsWith('u_'));
  assert.ok(e.createdAt.length > 0);
  assert.equal(e.calls, 0);
});

console.log('pool cache');

test('缓存键：参数顺序无关、空值忽略、字符串归一化（避免同一个请求算出两个键）', () => {
  const a = buildCacheKey('reviews', { asin: 'B0AAA', marketplace: 'US', limit: 100 });
  const b = buildCacheKey('reviews', { limit: 100, marketplace: 'us ', asin: 'b0aaa' });
  assert.equal(a, b, '键必须稳定（大小写/空白/顺序都不影响）');
  const c = buildCacheKey('reviews', { asin: 'B0AAA', marketplace: 'US', limit: 100, extra: '' });
  assert.equal(a, c, '空参数不进键');
  assert.notEqual(a, buildCacheKey('reviews', { asin: 'B0BBB', marketplace: 'US', limit: 100 }));
  assert.ok(a.startsWith('v1:reviews:'));
  // ASIN 列表顺序无关
  assert.equal(
    buildCacheKey('listing', { asins: ['B0A', 'B0B'] }),
    buildCacheKey('listing', { asins: ['B0B', 'B0A'] })
  );
});

test('TTL：按数据类型分档，评论比关键词短、大盘最长', () => {
  assert.ok(DEFAULT_TTL_SECONDS.reviews >= 14 * 24 * 3600, '评论至少缓存 14 天（§15.1-13）');
  assert.ok(DEFAULT_TTL_SECONDS.keywords < DEFAULT_TTL_SECONDS.reviews, '关键词比评论更易变');
  assert.ok(DEFAULT_TTL_SECONDS.market > DEFAULT_TTL_SECONDS.keywords);
});

test('命中决策：不存在不命中、过期不命中、未过期命中，且都给出人话原因', () => {
  const key = buildCacheKey('reviews', { asin: 'B0A' });
  const missing = decideCache([], key);
  assert.equal(missing.hit, false);
  assert.ok(missing.reason.includes('没有这条键'));

  const entry = makeCacheEntry({ key, type: 'reviews', value: { rows: 1 }, ok: true, nowIso: '2026-09-01T00:00:00.000Z' })!;
  assert.equal(decideCache([entry], key, '2026-09-02T00:00:00.000Z').hit, true);
  assert.equal(decideCache([entry], key, '2026-10-01T00:00:00.000Z').hit, false, '超过 14 天应过期');
  assert.ok(decideCache([entry], key, '2026-10-01T00:00:00.000Z').reason.includes('已过期'));
});

test('失败结果不入缓存（避免把错误缓存起来挡住重试）', () => {
  const key = buildCacheKey('reviews', { asin: 'B0A' });
  assert.equal(makeCacheEntry({ key, type: 'reviews', value: null, ok: false }), null);
  assert.ok(makeCacheEntry({ key, type: 'reviews', value: 1, ok: true }));
});

test('命中计数与淘汰：过期先清，超上限按创建时间淘汰最早的', () => {
  const key = buildCacheKey('reviews', { asin: 'B0A' });
  const e1 = makeCacheEntry({ key, type: 'reviews', value: 1, ok: true, nowIso: '2026-09-01T00:00:00.000Z' })!;
  assert.equal(bumpHit(e1).hits, 1);
  assert.equal(e1.hits, 0, '不修改原对象');

  const entries = [1, 2, 3, 4].map((i) =>
    makeCacheEntry({
      key: buildCacheKey('reviews', { asin: `B0${i}` }),
      type: 'reviews',
      value: i,
      ok: true,
      nowIso: `2026-09-0${i}T00:00:00.000Z`,
    })!
  );
  const pruned = pruneCache(entries, { maxEntries: 2, nowIso: '2026-09-10T00:00:00.000Z' });
  assert.equal(pruned.kept.length, 2);
  assert.equal(pruned.evicted, 2);
  assert.deepEqual(pruned.kept.map((e) => e.value), [3, 4], '保留最新的两条');

  const expired = pruneCache(entries, { maxEntries: 10, nowIso: '2026-11-01T00:00:00.000Z' });
  assert.equal(expired.kept.length, 0);
  assert.equal(expired.expired, 4);
  assert.equal(isFresh(entries[0], '2026-11-01T00:00:00.000Z'), false);
});

test('命中率：0 次总请求时为 0，不产生 NaN', () => {
  assert.equal(cacheHitRate({ hits: 0, misses: 0 }), 0);
  assert.equal(cacheHitRate({ hits: 3, misses: 1 }), 0.75);
});

console.log('key masking');

test('掩码：长 key 只露首 3 末 4，短 key 露首 2 末 2，空 key 给空串', () => {
  assert.equal(maskKey('sk-1234567890abcdef'), 'sk-…cdef');
  assert.equal(maskKey('abc12345'), 'ab…45');
  assert.equal(maskKey(''), '');
  assert.equal(maskKey(null), '');
  const masked = maskKey('github_pat_11ABCDEFGHIJKLMNOP');
  assert.ok(!masked.includes('ABCDEFGHIJKLMN'), '中间部分不得泄露');
});

test('状态描述：configured 与指纹（前端据此显示"已配置"，拿不到值）', () => {
  assert.deepEqual(describeKey('secret-value-1234'), { configured: true, fingerprint: 'sec…1234' });
  assert.deepEqual(describeKey(''), { configured: false, fingerprint: '' });
  const all = describeKeys({ deepseek: 'sk-aaaaaaaaaaaa', sellersprite: '' });
  assert.equal(all.deepseek.configured, true);
  assert.equal(all.sellersprite.configured, false);
  assert.equal(all.sellersprite.fingerprint, '');
});

test('redactSecrets：日志/错误上报兜底，键名疑似密钥的一律掩码', () => {
  const out = redactSecrets({ apiKey: 'sk-1234567890', Authorization: 'Bearer abcdefgh', projectId: 'p1' });
  assert.equal(out.projectId, 'p1', '普通字段不动');
  assert.ok(!String(out.apiKey).includes('1234567890'));
  assert.ok(!String(out.Authorization).includes('abcdefgh'));
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
