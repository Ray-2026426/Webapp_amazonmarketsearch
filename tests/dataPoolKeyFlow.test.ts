// BYO Key（自带密钥）· 密钥流向的**行为测试**（2026-09 用户决策变更）。
//
// 为什么要有这个文件：安全守卫（tests/securityKeys.test.ts）是**源码级**扫描，它能证明"没有坏写法"，
// 但不能证明"功能真的是这样跑的"。这里把密钥流向当成可执行的事实来测：
//   1) 本机填了 Key → 随**同源 POST 请求体**带给网关（URL 里绝没有 Key）；
//   2) 没填 → 请求体里连 userKey 字段都不出现（网关走平台兜底）；
//   3) 保存（saveMcpSettings）**一个网络请求都不发**：用户 Key 绝不写库；
//   4) 「验证」按来源验证：明文只在请求体里出现一次，返回体只回 keySource 与一句话；
//   5) 用量记账只记 keySource 标签（user / platform），并能在汇总里按来源分账。
import assert from 'node:assert/strict';

// ── 浏览器环境替身：localStorage + fetch 记录器（在 import 业务模块之前装好） ──────────────
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};

interface RecordedCall {
  url: string;
  init: { method?: string; body?: string; headers?: Record<string, string> };
}
const calls: RecordedCall[] = [];
let reply: { status?: number; body: unknown } = { status: 200, body: { ok: true } };

(globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RecordedCall['init']) => {
  calls.push({ url: String(url), init: init ?? {} });
  const status = reply.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => reply.body,
  };
};

const {
  callDataPool,
  verifyDataPoolProvider,
  withUserKey,
  canUseDataPool,
} = await import('../src/utils/dataPoolClient');
const { loadMcpSettings, saveMcpSettings, getUserKeyForProvider, createSellerSpriteProvider } = await import(
  '../src/utils/mcpConfig'
);
const { createUsageEvent, summarizeUsage, describeUsage, USAGE_KEY_SOURCE_LABELS } = await import(
  '../src/utils/usageAccounting'
);

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  const run = async () => {
    try {
      await fn();
      passed++;
      console.log('  OK ' + name);
    } catch (e) {
      failed++;
      console.error('  FAIL ' + name);
      console.error('    ' + (e instanceof Error ? e.message : String(e)));
    }
  };
  return run();
}

/** 造一份"本机已填 Key"的 MCP 配置，并完成登录态 */
function seed(providers: { kind: string; secretKey: string; mcpUrl?: string }[]) {
  store.clear();
  calls.length = 0;
  reply = { status: 200, body: { ok: true, data: { rows: [] }, keySource: 'user' } };
  store.set('amzdev_auth_token', 'tok-test');
  saveMcpSettingsRaw(
    providers.map((p, i) => ({
      id: `${p.kind}_${i}`,
      name: p.kind,
      kind: p.kind,
      secretKey: p.secretKey,
      mcpUrl: p.mcpUrl ?? '',
      enabled: true,
    }))
  );
}

/** 直接写 localStorage（跳过 saveMcpSettings 的规整逻辑，保证测的是"读"这一侧） */
function saveMcpSettingsRaw(providers: Record<string, unknown>[]) {
  store.set(
    'amzdev_mcp_settings',
    JSON.stringify({
      secretKey: '',
      mcpUrl: '',
      providers,
    })
  );
}

console.log('BYO key flow（用户自带 Key 的完整链路）');

await test('填了自己的 Key → 随**同源 POST 请求体**带给网关，URL 里没有 Key', async () => {
  seed([{ kind: 'sellersprite', secretKey: 'sk-mine-1234', mcpUrl: '' }]);
  const res = await callDataPool({ provider: 'sellersprite', tool: 'review', args: { asin: 'B0TEST' } });

  assert.equal(calls.length, 1, '应当只有一次请求');
  assert.equal(calls[0].url, '/api/data/mcp', '必须走同源相对路径（不是绝对地址、不是 query 拼接）');
  assert.ok(!/[?&](key|userKey|secret|api_key)=/.test(calls[0].url), `Key 不得进 URL query：${calls[0].url}`);
  const body = JSON.parse(calls[0].init.body || '{}');
  assert.equal(body.userKey, 'sk-mine-1234', '本机填的 Key 必须随请求体带给网关');
  assert.equal(body.token, 'tok-test');
  assert.equal(res.ok, true);
  assert.equal(res.keySource, 'user', '网关回报的来源标签要能透传给调用方');
});

await test('没填自己的 Key → 请求体里连 userKey 字段都不出现（网关走平台兜底）', async () => {
  seed([{ kind: 'sellersprite', secretKey: '', mcpUrl: '' }]);
  assert.equal(getUserKeyForProvider('sellersprite'), '', '读不到 Key 应回空串');
  reply = { status: 200, body: { ok: true, data: {}, keySource: 'platform' } };
  const res = await callDataPool({ provider: 'sellersprite', tool: 'review', args: {} });
  const body = JSON.parse(calls[0].init.body || '{}');
  assert.ok(!('userKey' in body), '没填就不该发这个字段（服务端按"未提供"回退平台 Key）');
  assert.equal(res.keySource, 'platform');
});

await test('多个数据源各用各的 Key，互不串（按 provider 精确取本机 Key）', async () => {
  seed([
    { kind: 'sellersprite', secretKey: 'sk-sellersprite', mcpUrl: '' },
    { kind: 'lingxing', secretKey: 'lk-lingxing-key', mcpUrl: '' },
    { kind: 'xydc', secretKey: '', mcpUrl: '' },
  ]);
  assert.equal(getUserKeyForProvider('sellersprite'), 'sk-sellersprite');
  assert.equal(getUserKeyForProvider('lingxing'), 'lk-lingxing-key');
  assert.equal(getUserKeyForProvider('xydc'), '', '没填的那家不得借用别家的 Key');

  await callDataPool({ provider: 'lingxing', tool: 'asin_listing', args: {} });
  assert.equal(JSON.parse(calls[0].init.body || '{}').userKey, 'lk-lingxing-key');

  await callDataPool({ provider: 'xydc', tool: 'asin_listing', args: {} });
  assert.ok(!('userKey' in JSON.parse(calls[1].init.body || '{}')), 'xydc 没填 → 不带 userKey');
});

await test('保存 MCP 设置**不发任何网络请求**：用户 Key 绝不写库', async () => {
  seed([{ kind: 'sellersprite', secretKey: 'sk-should-stay-local', mcpUrl: '' }]);
  calls.length = 0;
  saveMcpSettings({
    secretKey: 'sk-should-stay-local',
    mcpUrl: '',
    providers: [
      createSellerSpriteProvider({ secretKey: 'sk-should-stay-local' }),
    ],
  });
  assert.equal(calls.length, 0, '保存只写 localStorage；推送到服务端等于把用户 Key 写进库里');
  assert.equal(getUserKeyForProvider('sellersprite'), 'sk-should-stay-local', '保存后本机仍能读到');
  // 顺手确认读回来的是同一份数据（不是被"规整"丢了）
  assert.ok(loadMcpSettings().providers.some((p) => p.secretKey === 'sk-should-stay-local'));
});

await test('「验证」按来源验证：明文只在请求体里，返回体只回来源与一句话', async () => {
  seed([{ kind: 'xydc', secretKey: 'xy-mine-key-9', mcpUrl: '' }]);
  reply = { status: 200, body: { ok: true, keySource: 'user', message: '连接成功（用的是你自己的 Key）' } };
  const withKey = await verifyDataPoolProvider({ provider: 'xydc' });
  assert.equal(calls[0].url, '/api/data/verify', '验证必须走同源 verify 动作');
  assert.ok(!/[?&](key|userKey|secret)=/.test(calls[0].url), 'Key 不得进 URL query');
  const body = JSON.parse(calls[0].init.body || '{}');
  assert.equal(body.userKey, 'xy-mine-key-9', '填了自己的 Key 就验证自己的');
  assert.equal(body.provider, 'xydc');
  assert.equal(withKey.ok, true);
  assert.equal(withKey.keySource, 'user');
  assert.ok(withKey.message.includes('你自己的 Key'), '要如实告诉用户这次用的是谁的 Key');
  assert.ok(!withKey.message.includes('xy-mine-key-9'), '返回文案里不得出现 Key 片段');

  // 没填 → 验证平台的
  seed([{ kind: 'xydc', secretKey: '', mcpUrl: '' }]);
  reply = { status: 200, body: { ok: true, keySource: 'platform', message: '连接成功（用的是平台 Key）' } };
  const onPlatform = await verifyDataPoolProvider({ provider: 'xydc' });
  assert.ok(!('userKey' in JSON.parse(calls[0].init.body || '{}')), '没填就不带 userKey');
  assert.equal(onPlatform.keySource, 'platform');
  assert.ok(onPlatform.message.includes('平台 Key'));
});

await test('自定义 MCP：没填地址就先说清楚，不偷偷去连别人的服务', async () => {
  seed([{ kind: 'custom', secretKey: 'custom-key', mcpUrl: '' }]);
  const res = await verifyDataPoolProvider({ provider: 'custom', endpoint: '' });
  assert.equal(res.ok, false);
  assert.ok(res.message.includes('地址'), res.message);
  assert.equal(calls.length, 0, '没地址就不该发请求');
});

await test('未登录：明确拒绝，且不发出任何请求', async () => {
  seed([{ kind: 'sellersprite', secretKey: 'sk-mine-1234', mcpUrl: '' }]);
  store.delete('amzdev_auth_token');
  calls.length = 0;
  assert.equal(canUseDataPool(), false);
  const res = await callDataPool({ provider: 'sellersprite', tool: 'review', args: {} });
  assert.equal(res.ok, false);
  assert.equal(res.viaGateway, false);
  assert.ok(res.error.includes('未登录'));
  assert.equal(calls.length, 0, '未登录不得把 Key 发出去');
});

await test('withUserKey 是唯一的附加通道：有值才加，没值保持原样', () => {
  seed([{ kind: 'sorftime', secretKey: 'sf-key-1', mcpUrl: '' }]);
  const withKey = withUserKey('sorftime', { tool: 'x' });
  assert.deepEqual(withKey, { tool: 'x', userKey: 'sf-key-1' });
  const withoutKey = withUserKey('lingxing', { tool: 'x' });
  assert.deepEqual(withoutKey, { tool: 'x' }, '没填就不加字段');
  assert.ok(!JSON.stringify(withoutKey).includes('userKey'));
});

console.log('BYO key flow（用量记账只记来源标签）');

await test('记账只记 keySource 字面量，并能在汇总里按来源分账', () => {
  const events = [
    createUsageEvent({ workspaceId: 'w', userId: 'u1', tool: 'reviews', provider: 'sellersprite', ok: true, calls: 2, keySource: 'user' }),
    createUsageEvent({ workspaceId: 'w', userId: 'u2', tool: 'reviews', provider: 'sellersprite', ok: true, calls: 1, keySource: 'platform' }),
    createUsageEvent({ workspaceId: 'w', userId: 'u3', tool: 'keywords', provider: 'lingxing', ok: false, calls: 0, keySource: 'none' }),
  ];
  // 事件里只有标签，没有任何 Key 形态的字符串
  for (const e of events) {
    assert.ok(['user', 'platform', 'none'].includes(String(e.keySource)), `keySource 必须是字面量标签：${e.keySource}`);
    assert.ok(!/sk-|key-|secret/i.test(JSON.stringify(e)), '事件里不得出现 Key');
  }
  const summary = summarizeUsage(events);
  const bySource = Object.fromEntries(summary.byKeySource.map((r) => [r.key, r.events]));
  assert.deepEqual(bySource, { user: 1, platform: 1, none: 1 }, 'byKeySource 必须按来源分账（付费阶段据此区分自付/平台承担）');
  assert.equal(summary.byKeySource.find((r) => r.key === 'user')!.label, USAGE_KEY_SOURCE_LABELS.user);
  assert.ok(describeUsage(summary).includes('用户自带 Key'), '人话摘要要说清有多少次是用户自付的 Key');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
