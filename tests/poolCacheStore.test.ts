// M5 · 数据池持久化缓存（Supabase `pool_cache`）行映射测试。
// 这一层是"库里的行"和"内存里的条目"之间唯一的转换点：脏行必须被兜住而不是变成 NaN / 非法枚举，
// 否则一次脏读就能让命中决策和成本统计同时说错话。
import assert from 'node:assert/strict';

import {
  buildCacheKey,
  decideCache,
  isFresh,
  makeCacheEntry,
  pruneCache,
  type PoolCacheEntry,
} from '../src/utils/poolCache';
import {
  entryToCacheRow,
  prunePlan,
  rowToCacheEntry,
  summarizeCacheRows,
  type PoolCacheRow,
} from '../src/utils/poolCacheStore';

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

const NOW = '2026-09-10T00:00:00.000Z';

/** 造一行"完好"的库行，方便各用例只覆盖自己关心的字段 */
function row(over: Partial<PoolCacheRow> = {}): PoolCacheRow {
  return {
    key: buildCacheKey('reviews', { asin: 'B0AAA', marketplace: 'US' }),
    type: 'reviews',
    value: { rows: 1 },
    created_at: '2026-09-01T00:00:00.000Z',
    expires_at: '2026-09-15T00:00:00.000Z',
    hits: 0,
    ...over,
  };
}

console.log('pool cache store');

test('往返：entry → row → entry 完全一致（字段名转换不丢信息）', () => {
  const entry: PoolCacheEntry<{ rows: number[] }> = {
    key: buildCacheKey('reviews', { asin: 'B0AAA', marketplace: 'US' }),
    type: 'reviews',
    value: { rows: [1, 2, 3] },
    createdAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-09-15T00:00:00.000Z',
    hits: 7,
  };
  const dbRow = entryToCacheRow(entry);
  assert.deepEqual(dbRow, {
    key: entry.key,
    type: 'reviews',
    value: { rows: [1, 2, 3] },
    created_at: '2026-09-01T00:00:00.000Z',
    expires_at: '2026-09-15T00:00:00.000Z',
    hits: 7,
  });
  assert.deepEqual(rowToCacheEntry(dbRow), entry, '往返必须是无损的');

  // 往返后的条目要能直接喂给命中决策（内存缓存与持久缓存同一条规则）
  const back = rowToCacheEntry<{ rows: number[] }>(dbRow)!;
  assert.equal(decideCache([back], entry.key, NOW).hit, true);
  assert.equal(isFresh(back, NOW), true);
});

test('往返：value 为 null / 标量 / 数组时也能原样读回（jsonb 任意 JSON）', () => {
  for (const v of [null, 0, 'text', [1, 2], false]) {
    const e: PoolCacheEntry = {
      key: 'v1:other:k',
      type: 'other',
      value: v,
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-02T00:00:00.000Z',
      hits: 1,
    };
    const round = rowToCacheEntry(entryToCacheRow(e))!;
    assert.deepEqual(round.value, v, `value=${JSON.stringify(v)} 必须原样读回`);
  }
  // undefined 落库只能变成 null，因此显式写成 null（避免"写进去的和读回来的不一致"）
  const withUndefined = entryToCacheRow({
    key: 'k',
    type: 'other',
    value: undefined,
    createdAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-09-02T00:00:00.000Z',
    hits: 0,
  });
  assert.equal(withUndefined.value, null);
});

test('坏行返回 null：非对象 / 缺 key / key 只有空白', () => {
  assert.equal(rowToCacheEntry(null), null);
  assert.equal(rowToCacheEntry(undefined), null);
  assert.equal(rowToCacheEntry('not-a-row'), null);
  assert.equal(rowToCacheEntry(42), null);
  assert.equal(rowToCacheEntry([]), null, '数组不是一行（防止 PostgREST 误传整个结果集）');
  assert.equal(rowToCacheEntry({}), null);
  assert.equal(rowToCacheEntry({ key: '' }), null);
  assert.equal(rowToCacheEntry({ key: '   ' }), null);
  assert.equal(rowToCacheEntry({ key: 123 }), null, '数字 key 不接受');
});

test('坏行返回 null：日期缺失或不可解析（新鲜度猜不得）', () => {
  assert.equal(rowToCacheEntry(row({ created_at: undefined as unknown as string })), null);
  assert.equal(rowToCacheEntry(row({ expires_at: undefined as unknown as string })), null);
  assert.equal(rowToCacheEntry(row({ created_at: '' })), null);
  assert.equal(rowToCacheEntry(row({ created_at: 'not-a-date' })), null);
  assert.equal(rowToCacheEntry(row({ expires_at: '2026-13-45T99:99:99Z' })), null);
  assert.equal(rowToCacheEntry(row({ expires_at: 0 as unknown as string })), null, '时间戳数字不当作日期');
  // 只有一边有效也不行
  assert.equal(rowToCacheEntry({ key: 'k', created_at: '2026-09-01T00:00:00.000Z' }), null);
  assert.equal(rowToCacheEntry({ key: 'k', expires_at: '2026-09-15T00:00:00.000Z' }), null);
  // 合法日期正常通过，并归一化成 ISO
  assert.equal(rowToCacheEntry(row({ created_at: '2026-09-01T08:00:00+08:00' }))!.createdAt, '2026-09-01T00:00:00.000Z');
});

test('hits 夹成非负整数：负数→0、小数截断、缺失/NaN/非数字→0', () => {
  assert.equal(rowToCacheEntry(row({ hits: -3 }))!.hits, 0);
  assert.equal(rowToCacheEntry(row({ hits: -0.5 }))!.hits, 0);
  assert.equal(rowToCacheEntry(row({ hits: 2.9 }))!.hits, 2);
  assert.equal(rowToCacheEntry(row({ hits: 12 }))!.hits, 12);
  assert.equal(rowToCacheEntry(row({ hits: undefined as unknown as number }))!.hits, 0);
  assert.equal(rowToCacheEntry(row({ hits: Number.NaN }))!.hits, 0);
  assert.equal(rowToCacheEntry(row({ hits: 'abc' as unknown as number }))!.hits, 0);
  assert.equal(rowToCacheEntry(row({ hits: '5' as unknown as number }))!.hits, 5, '数字字符串（pg numeric）也接受');
  // 写库方向同样夹住，脏计数不进库
  const e = makeCacheEntry({ key: 'k', type: 'reviews', value: 1, ok: true, nowIso: NOW })!;
  assert.equal(entryToCacheRow({ ...e, hits: -4 }).hits, 0);
  assert.equal(entryToCacheRow({ ...e, hits: 3.7 }).hits, 3);
});

test('未知/非法 type 回落 other，已知 type 大小写与空白归一后保留', () => {
  assert.equal(rowToCacheEntry(row({ type: 'unicorn' }))!.type, 'other');
  assert.equal(rowToCacheEntry(row({ type: 'REVIEWS' }))!.type, 'reviews');
  assert.equal(rowToCacheEntry(row({ type: ' asin_detail ' }))!.type, 'asin_detail');
  assert.equal(rowToCacheEntry(row({ type: '' }))!.type, 'other');
  assert.equal(rowToCacheEntry(row({ type: undefined as unknown as string }))!.type, 'other');
  assert.equal(rowToCacheEntry(row({ type: 42 as unknown as string }))!.type, 'other');
  assert.equal(rowToCacheEntry(row({ type: null as unknown as string }))!.type, 'other');
});

test('prunePlan：返回判定时刻；expires_at 恰好等于该时刻算"可清理"（边界）', () => {
  const plan = prunePlan(NOW);
  assert.deepEqual(plan, { expiredBefore: '2026-09-10T00:00:00.000Z' });

  const boundary = rowToCacheEntry(row({ expires_at: NOW }))!;
  assert.equal(isFresh(boundary, plan.expiredBefore), false, 'expires_at == now 已不新鲜');
  // SQL 侧 where expires_at <= expiredBefore 与内存侧 pruneCache 必须选出同一批行
  assert.equal(pruneCache([boundary], { nowIso: plan.expiredBefore }).expired, 1);
  assert.equal(pruneCache([boundary], { nowIso: plan.expiredBefore }).kept.length, 0);

  const stillFresh = rowToCacheEntry(row({ expires_at: '2026-09-10T00:00:00.001Z' }))!;
  assert.equal(isFresh(stillFresh, plan.expiredBefore), true, '晚 1 毫秒就不该被清');

  // 不传 / 传坏值时取当前时间，函数永远可用且不抛错
  const auto = prunePlan();
  assert.equal(Number.isFinite(new Date(auto.expiredBefore).getTime()), true);
  const before = Date.now();
  const bad = new Date(prunePlan('nonsense').expiredBefore).getTime();
  assert.ok(bad >= before - 1000 && bad <= Date.now() + 1000, '坏入参回落当前时间');
});

test('汇总：空输入与"全是坏行"都是全 0，且绝不产生 NaN', () => {
  const empty = summarizeCacheRows([]);
  assert.deepEqual(empty, { entries: 0, fresh: 0, expired: 0, hits: 0, hitRate: 0, byType: [] });
  assert.equal(Number.isNaN(empty.hitRate), false);

  const garbage = summarizeCacheRows([null, 'x', 3, {}, { key: 'k' }, []]);
  assert.equal(garbage.entries, 0);
  assert.equal(garbage.hits, 0);
  assert.equal(garbage.hitRate, 0);
  assert.deepEqual(garbage.byType, []);
  assert.equal(summarizeCacheRows([null], NOW).hitRate, 0, '分母为 0 时命中率为 0');
});

test('汇总：条目/新鲜/过期/命中与按类型分组（命中降序 → 条目降序 → 类型升序）', () => {
  const rows: unknown[] = [
    row({ key: 'v1:reviews:a', type: 'reviews', expires_at: '2026-09-15T00:00:00.000Z', hits: 3 }),
    row({ key: 'v1:reviews:b', type: 'reviews', expires_at: '2026-09-05T00:00:00.000Z', hits: 2 }),
    row({ key: 'v1:market:a', type: 'market', expires_at: '2026-09-20T00:00:00.000Z', hits: 5 }),
    row({ key: 'v1:keywords:a', type: 'keywords', expires_at: '2026-09-12T00:00:00.000Z', hits: 0 }),
    row({ key: 'v1:other:a', type: 'unicorn', expires_at: '2026-09-12T00:00:00.000Z', hits: 0 }),
    'garbage-row', // 坏行必须被跳过，不影响其它统计
  ];
  const s = summarizeCacheRows(rows, NOW);
  assert.equal(s.entries, 5, '坏行不计入');
  assert.equal(s.fresh, 4);
  assert.equal(s.expired, 1);
  assert.equal(s.hits, 10);
  // 公式：hits / (hits + 缓存行数) = 10 / 15
  assert.equal(s.hitRate, 0.667);
  assert.deepEqual(s.byType, [
    { type: 'reviews', entries: 2, hits: 5 },
    { type: 'market', entries: 1, hits: 5 },
    { type: 'keywords', entries: 1, hits: 0 },
    { type: 'other', entries: 1, hits: 0 },
  ]);
});

test('汇总：分组顺序确定，与输入行顺序无关（同一份数据两次输出一致）', () => {
  const rows: unknown[] = [
    row({ key: 'k1', type: 'traffic', hits: 4, expires_at: '2026-09-12T00:00:00.000Z' }),
    row({ key: 'k2', type: 'listing', hits: 1, expires_at: '2026-09-12T00:00:00.000Z' }),
    row({ key: 'k3', type: 'asin_detail', hits: 4, expires_at: '2026-09-12T00:00:00.000Z' }),
    row({ key: 'k4', type: 'traffic', hits: 2, expires_at: '2026-09-12T00:00:00.000Z' }),
  ];
  const forward = summarizeCacheRows(rows, NOW);
  const backward = summarizeCacheRows([...rows].reverse(), NOW);
  assert.deepEqual(forward.byType, backward.byType, '分组顺序不得依赖输入顺序');
  // traffic 6 次命中居首；asin_detail 与 listing 同 1 条时按命中降序 → asin_detail 在前
  assert.deepEqual(
    forward.byType.map((b) => b.type),
    ['traffic', 'asin_detail', 'listing']
  );
  assert.equal(forward.byType[0].entries, 2);
  assert.equal(forward.hits, 11);
});

test('汇总的命中率与内存缓存同口径（缓存行数当作未命中代理）', () => {
  // 3 次命中、1 行缓存 → 3 / (3 + 1) = 0.75
  const s = summarizeCacheRows([row({ key: 'v1:reviews:a', hits: 3, expires_at: '2026-09-15T00:00:00.000Z' })], NOW);
  assert.equal(s.hits, 3);
  assert.equal(s.entries, 1);
  assert.equal(s.hitRate, 0.75);
  // 全是过期行时仍能算出命中率（命中发生过就该被记账）
  const stale = summarizeCacheRows([row({ key: 'v1:reviews:a', hits: 1, expires_at: '2026-09-01T00:00:00.000Z' })], NOW);
  assert.equal(stale.expired, 1);
  assert.equal(stale.hitRate, 0.5);
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
