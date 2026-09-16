// §15.28 密钥跟着账号走 · 密钥流向的**行为测试**（用户原话：「我的mcp没有跟着账号走吗，需要跟着账号」）。
//
// 为什么要有这个文件：安全守卫（tests/securityKeys.test.ts）是**源码级**扫描，它能证明"没有坏写法"，
// 但不能证明"功能真的是这样跑的"。这里把密钥流向当成可执行的事实来测：
//   1) 调数据池时**客户端不传 Key**（请求体里没有 userKey 字段，URL 里更没有）；
//   2) 保存/清除 Key 走 keySet / keyClear，body 里**只有 provider + value + token，没有 userId**
//      —— userId 只能由服务端从 JWT 取，客户端连提都不提；
//   3) 读状态走 keyList，且**只把 configured + 指纹**写进缓存：服务端就算"手滑"回了明文也不采纳；
//   4) 旧本机明文 Key 一次性迁到账号里，**成功即删本机副本**；失败则保留副本并如实提示；
//   5) 「验证」不再携带 Key（只发 provider / endpoint），keySource 由服务端回报；
//   6) 未登录不发任何请求；
//   7) 保存 MCP 设置只写**非密钥**字段（且不会把待迁移的旧 Key 弄丢）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const { callDataPool, verifyDataPoolProvider, canUseDataPool } = await import('../src/utils/dataPoolClient');
const {
  loadMcpSettings,
  saveMcpSettings,
  createSellerSpriteProvider,
  saveUserKey,
  clearUserKey,
  loadUserKeyStatuses,
  migrateLegacyLocalKeys,
  getUserKeyStatus,
  resetUserKeyState,
  readLegacyLocalKeys,
} = await import('../src/utils/mcpConfig');
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

/** 清成"已登录 + 干净本机配置"的起点 */
function seed() {
  store.clear();
  calls.length = 0;
  reply = { status: 200, body: { ok: true } };
  resetUserKeyState();
  store.set('amzdev_auth_token', 'tok-test');
}

function bodyOf(index: number): Record<string, unknown> {
  return JSON.parse(calls[index]?.init?.body || '{}') as Record<string, unknown>;
}

console.log('§15.28 key flow（密钥按账号存在服务端，客户端不接触明文）');

await test('调数据池：请求体里**没有** userKey（服务端按 JWT 自己取 Key）', async () => {
  seed();
  reply = { status: 200, body: { ok: true, data: { rows: [] }, keySource: 'user' } };
  const res = await callDataPool({ provider: 'sellersprite', tool: 'review', args: { asin: 'B0TEST' } });

  const mcpCall = calls.find((c) => c.url === '/api/data/mcp');
  assert.ok(mcpCall, '必须走同源 /api/data/mcp（相对路径）');
  assert.ok(!/[?&](key|userKey|secret|api_key)=/.test(mcpCall!.url), `Key 不得进 URL query：${mcpCall!.url}`);
  const body = bodyOf(calls.findIndex((c) => c.url === '/api/data/mcp'));
  assert.ok(!('userKey' in body), '客户端不再把 Key 随请求体发送（那一份已经移除了）');
  assert.equal(body.token, 'tok-test');
  assert.equal(body.provider, 'sellersprite');
  assert.equal(res.ok, true);
  assert.equal(res.keySource, 'user', '网关回报的来源标签要能透传给调用方');
});

await test('没配 Key 时也一样：客户端不传 Key，网关按 none 拒绝', async () => {
  seed();
  reply = { status: 400, body: { ok: false, error: '请填写你自己的 Key', keySource: 'none' } };
  const res = await callDataPool({ provider: 'xydc', tool: 'asin_listing', args: {} });
  assert.ok(!('userKey' in bodyOf(0)), '没配也不该凭空冒出一个密钥字段');
  assert.equal(res.keySource, 'none');
  assert.equal(res.ok, false);
  assert.ok(res.error?.includes('Key'));
});

await test('保存 Key → keySet：body 里只有 provider / value / token，**没有 userId**', async () => {
  seed();
  reply = { status: 200, body: { ok: true, provider: 'lingxing', configured: true, fingerprint: 'lk-…1234' } };
  const res = await saveUserKey('lingxing', '  lk-mine-1234  ');
  assert.equal(calls.length, 1, '保存只发一次请求');
  assert.equal(calls[0].url, '/api/data/keySet');
  assert.equal(calls[0].init.method, 'POST');
  const body = bodyOf(0);
  assert.equal(body.provider, 'lingxing', 'provider 必须原样带上（服务端按它选那一格）');
  assert.equal(body.value, 'lk-mine-1234', '首尾空白在客户端就 trim 掉');
  assert.equal(body.token, 'tok-test');
  assert.ok(!('userId' in body), 'userId 一律由服务端从 JWT 取：客户端连字段都不许出现');
  assert.equal(res.ok, true);
  // 本机只留"配没配 + 指纹"，明文不进任何缓存
  assert.deepEqual(getUserKeyStatus('lingxing'), { configured: true, fingerprint: 'lk-…1234' });
  assert.ok(!JSON.stringify([...store.entries()]).includes('lk-mine-1234'), '本机任何存储里都不该出现明文');
});

await test('空 / 超长 / 含控制字符的 Key 在客户端就被挡下（不发请求）', async () => {
  seed();
  assert.equal((await saveUserKey('xydc', '   ')).ok, false, '空 Key 不发请求');
  assert.equal((await saveUserKey('xydc', 'x'.repeat(513))).ok, false, '超长（>512）不合法');
  assert.equal((await saveUserKey('xydc', 'xy-a\nb')).ok, false, '含控制字符不合法（拒绝 header 注入）');
  assert.equal(calls.length, 0, '三种非法输入都不该发出请求');
});

await test('清除 Key → keyClear：只发 provider + token（删的是自己那一行）', async () => {
  seed();
  reply = { status: 200, body: { ok: true, provider: 'xydc', configured: false } };
  const res = await clearUserKey('xydc');
  assert.equal(calls[0].url, '/api/data/keyClear');
  const body = bodyOf(0);
  assert.deepEqual(Object.keys(body).sort(), ['provider', 'token'], '只允许这两个字段');
  assert.equal(res.ok, true);
  assert.deepEqual(getUserKeyStatus('xydc'), { configured: false, fingerprint: '' });
});

await test('读状态 → keyList：只采纳 configured + 掩码指纹（明文一律丢掉）', async () => {
  seed();
  reply = {
    status: 200,
    body: {
      ok: true,
      keys: {
        sellersprite: { configured: true, fingerprint: 'sk-1…ab12' },
        // 服务端将来若"手滑"回了明文，客户端不得采纳、不得显示
        xydc: { configured: true, fingerprint: 'xy-plaintext-key', value: 'xy-plaintext-key' },
        lingxing: { configured: false, fingerprint: '' },
      },
    },
  };
  const res = await loadUserKeyStatuses();
  assert.equal(calls[0].url, '/api/data/keyList');
  assert.equal(res.ok, true);
  assert.deepEqual(res.keys.sellersprite, { configured: true, fingerprint: 'sk-1…ab12' });
  assert.deepEqual(res.keys.xydc, { configured: true, fingerprint: '' }, '不像掩码的"指纹"一律置空（绝不显示明文）');
  assert.deepEqual(res.keys.sorftime, { configured: false, fingerprint: '' }, '服务端没提的数据源按未配置处理');
  assert.ok(!JSON.stringify(res.keys).includes('xy-plaintext-key'), '明文不得进入任何状态对象');
});

await test('旧本机明文 Key：迁到账号里，成功即删本机副本', async () => {
  seed();
  store.set('amzdev_mcp_settings', JSON.stringify({
    secretKey: 'sk-legacy-top',
    mcpUrl: '',
    providers: [
      { id: 'ss_1', name: '卖家精灵', kind: 'sellersprite', secretKey: 'sk-legacy-top', mcpUrl: '', enabled: true },
      { id: 'xydc_1', name: '西柚洞察', kind: 'xydc', secretKey: 'xy-legacy-2', mcpUrl: '', enabled: true },
      { id: 'lx_1', name: '领星', kind: 'lingxing', secretKey: '', mcpUrl: '', enabled: true },
    ],
  }));
  assert.deepEqual(readLegacyLocalKeys(), { sellersprite: 'sk-legacy-top', xydc: 'xy-legacy-2' }, '先能读出本机残留');

  reply = { status: 200, body: { ok: true, configured: true, fingerprint: 'sk-…top1' } };
  const migration = await migrateLegacyLocalKeys();
  assert.equal(migration.migrated.length, 2, `两个旧明文都应迁走，实际 ${JSON.stringify(migration.migrated)}`);
  assert.equal(migration.failed.length, 0);
  assert.ok(migration.message.includes('本机副本已删除'));
  const sent = calls.map((c) => bodyOf(calls.indexOf(c)));
  assert.ok(sent.every((b) => b.token === 'tok-test' && !('userId' in b)), '每个迁移请求都不带 userId');
  assert.deepEqual(sent.map((b) => b.provider).sort(), ['sellersprite', 'xydc']);
  // 写完即删：本机不再保留明文（否则又是两处真相）
  const raw = store.get('amzdev_mcp_settings') || '';
  assert.ok(!raw.includes('sk-legacy-top') && !raw.includes('xy-legacy-2'), `本机副本必须删除：${raw}`);
  assert.deepEqual(readLegacyLocalKeys(), {}, '迁移后本机读不到任何明文');
});

await test('迁移失败：**保留**本机副本并如实告知（绝不静默丢密钥）', async () => {
  seed();
  store.set('amzdev_mcp_settings', JSON.stringify({
    mcpUrl: '',
    providers: [{ id: 'ss_1', kind: 'sellersprite', secretKey: 'sk-keep-me', mcpUrl: '', enabled: true }],
  }));
  reply = { status: 500, body: { ok: false, error: '数据库还没迁移' } };
  const migration = await migrateLegacyLocalKeys();
  assert.deepEqual(migration.failed, ['sellersprite']);
  assert.ok(migration.message.includes('本机副本已保留'), migration.message);
  assert.equal(readLegacyLocalKeys().sellersprite, 'sk-keep-me', '失败时本机副本必须还在');
});

await test('「验证」不再携带 Key：只发 provider / endpoint，来源由服务端回报', async () => {
  seed();
  reply = { status: 200, body: { ok: true, keySource: 'user', message: '连接成功（用的是你自己的 Key）' } };
  const res = await verifyDataPoolProvider({ provider: 'xydc' });
  const verifyCall = calls.find((c) => c.url === '/api/data/verify');
  assert.ok(verifyCall, '验证必须走同源 verify 动作');
  assert.ok(!/[?&](key|userKey|secret)=/.test(verifyCall!.url), 'Key 不得进 URL query');
  const body = bodyOf(calls.indexOf(verifyCall!));
  assert.ok(!('userKey' in body), '客户端不传明文 Key');
  assert.equal(body.provider, 'xydc');
  assert.equal(res.keySource, 'user');
  assert.ok(res.message.includes('你自己的 Key'), '要如实告诉用户这次用的是谁的 Key');
  assert.ok(!res.message.includes('xy-mine-key-9'), '返回文案里不得出现 Key 片段');
});

await test('自定义 MCP：没填地址就先说清楚，不偷偷去连别人的服务', async () => {
  seed();
  const res = await verifyDataPoolProvider({ provider: 'custom', endpoint: '' });
  assert.equal(res.ok, false);
  assert.ok(res.message.includes('地址'), res.message);
  assert.equal(calls.length, 0, '没地址就不该发请求');
});

await test('未登录：明确拒绝，且不发出任何请求', async () => {
  seed();
  store.delete('amzdev_auth_token');
  assert.equal(canUseDataPool(), false);
  const res = await callDataPool({ provider: 'sellersprite', tool: 'review', args: {} });
  assert.equal(res.ok, false);
  assert.equal(res.viaGateway, false);
  assert.ok(res.error.includes('未登录'));
  assert.equal(calls.length, 0, '未登录不得发出任何请求（也没 Key 可发）');
});

await test('保存 MCP 设置：只写非密钥字段，且不会把待迁移的旧 Key 弄丢', async () => {
  seed();
  store.set('amzdev_mcp_settings', JSON.stringify({
    mcpUrl: '',
    providers: [{ id: 'ss_1', kind: 'sellersprite', secretKey: 'sk-pending', mcpUrl: '', enabled: true }],
  }));
  calls.length = 0;
  saveMcpSettings({
    mcpUrl: '',
    providers: [createSellerSpriteProvider({ id: 'ss_1', name: '我的卖家精灵' })],
  });
  assert.equal(calls.length, 0, '保存设置不发任何网络请求（密钥走 saveUserKey / clearUserKey）');
  const saved = JSON.parse(store.get('amzdev_mcp_settings') || '{}');
  const savedSs = saved.providers.find((p: { kind: string }) => p.kind === 'sellersprite');
  assert.equal(savedSs.name, '我的卖家精灵', '非密钥字段要真的存下来');
  assert.equal(savedSs.secretKey, 'sk-pending', '还没迁移的旧明文不能被保存动作顺手抹掉');
  const loaded = loadMcpSettings().providers.find((p) => p.kind === 'sellersprite')!;
  assert.equal(loaded.name, '我的卖家精灵');
  // 归一化时**不把明文当配置读出来**：读回的对象里没有 secretKey 字段
  assert.ok(!('secretKey' in (loaded as unknown as Record<string, unknown>)), '配置读取不得把密钥当真相');
});

console.log('§15.28 key flow（用量记账只记来源标签）');

await test('记账只记 keySource 字面量，并能在汇总里按来源分账', () => {
  const events = [
    createUsageEvent({ workspaceId: 'w', userId: 'u1', tool: 'reviews', provider: 'sellersprite', ok: true, calls: 2, keySource: 'user' }),
    createUsageEvent({ workspaceId: 'w', userId: 'u2', tool: 'reviews', provider: 'sellersprite', ok: true, calls: 1, keySource: 'platform' }),
    createUsageEvent({ workspaceId: 'w', userId: 'u3', tool: 'keywords', provider: 'lingxing', ok: false, calls: 0, keySource: 'none' }),
  ];
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

console.log('§15.28 换账号：进程内状态必须重置（否则会串号）');

await test('登录/登出时 App 必须清掉 MCP 密钥的进程内状态', async () => {
  /**
   * 这是一个真实漏洞的回归守卫：`resetUserKeyState()` 原本**只有测试在调用**。
   * 后果是同一页面里 A 登出、B 登录时：
   *   ① B 会看到 A 的「已配置（指纹）」（状态缓存没清）；
   *   ② B 自己那份旧本机密钥**不会被迁移**（一次性迁移的闸门 migrationSettled 还关着）。
   * 这类跨账号错乱不会报错、只会"显示错"，所以必须由测试钉住。
   */
  const src = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const loginFn = /const handleLoginSuccess[\s\S]*?\n  \}, \[\]\);/.exec(src)?.[0] ?? '';
  const logoutFn = /const handleLogout[\s\S]*?\n  \}, \[\]\);/.exec(src)?.[0] ?? '';
  assert.ok(loginFn, '找不到 handleLoginSuccess');
  assert.ok(logoutFn, '找不到 handleLogout');
  assert.ok(loginFn.includes('resetUserKeyState()'), '登录成功时必须重置 MCP 密钥的进程内状态（换账号不串号）');
  assert.ok(logoutFn.includes('resetUserKeyState()'), '登出时也必须重置');
  assert.ok(src.includes('import') && src.includes('resetUserKeyState'), 'App 必须真的导入它');

  // 顺序要求：必须先重置、再迁移（反了的话迁移闸门还关着，B 的旧密钥永远迁不过去）
  const resetAt = loginFn.indexOf('resetUserKeyState()');
  const migrateAt = loginFn.indexOf('migrateLegacyLocalKeys()');
  assert.ok(resetAt > 0 && migrateAt > 0, '登录时应同时重置状态并触发旧密钥迁移');
  assert.ok(resetAt < migrateAt, '顺序必须是"先 resetUserKeyState()、再 migrateLegacyLocalKeys()"');

  // 反向守卫：不能只在登出里清、登录里不清（只清一边仍会串号）
  assert.ok(
    /resetUserKeyState[\s\S]{0,600}migrateLegacyLocalKeys/.test(loginFn),
    '登录路径里两个动作必须相邻出现（防止以后被人拆散/删掉其中一个）'
  );
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
