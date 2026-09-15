// M5 · 安全守卫：密钥不得离开"它该待的地方"。
//
// ── 口径变更记录（重要：这不是放松约束，是用户决策变了） ───────────────────────────────
// 用户 2026-09 原话：「需要其他用户也能填key，后续我们再考虑做付费，那时候再关闭mcp入口，
// 换成计费模式。」 → 旧的**决策 A**（"数据池密钥只在服务端，浏览器不保存任何密钥"，
// 以及配套的"MCP 面板不得有密钥输入框"）被用户推翻，改为 **BYO Key**：
//   · 所有用户都可以在 MCP 面板填**自己的** Key（名称 / 地址 / Key / 验证 四样，人人都有）；
//   · 平台仍然保留服务端默认 Key 作兜底（没填自己 Key 的人走平台 Key，团队共享）；
//   · 以后进入付费阶段再关闭 MCP 入口、改成计费模式（现在不做）。
//
// 因此本文件的断言从「面板里不许有 Key 输入框」改成「Key 输入框必须有，且**每一家**都有」，
// 同时把原来隐含在"没有输入框"里的安全承诺**逐条显式化**（下面 6/7/8/9 条）：
//   1) /api/settings 只回状态与指纹，不得回显密钥；
//   2) 前端不得保存**平台**密钥明文（saveServerKeys / amzdev_admin_keys 必须消失）；
//   3) 掩码逻辑只允许有一个实现（src/utils/keyMasking.ts）；
//   4) 浏览器永不持有、永不解析平台密钥（平台 Key 不进浏览器）；
//   5) 每个数据源都有 Key 输入框 + 掩码显示 + 清除按钮 + 一行"只存本机"提示；
//   6) 用户 Key **不得写库**（不写 app_config、不写任何表、浏览器不再 push 到服务端）；
//   7) 用户 Key **不得写日志**（含 console）、上游报错必须脱敏后才准往外抛；
//   8) 用户 Key **不得进任何响应体**（返回体里连平台 Key 的指纹都不给）；
//   9) 用户 Key **不得进 URL query**（只能进同源 POST 请求体或请求头）；
//  10) 网关的解析顺序必须是「用户 Key 优先、平台兜底」，且有可单测的纯函数。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { decideProviderKeySource, resolveProviderKey, sanitizeUserKey } from '../src/utils/mcpRequestKey';

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

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 数据池这条链路上的客户端文件（Key 只允许从这里走同一个通道） */
const POOL_CLIENT_FILES = [
  'src/utils/dataPoolClient.ts',
  'src/utils/mcpConfig.ts',
  'src/utils/listingFetchExecutor.ts',
  'src/components/AiSettingsPanel.tsx',
];

console.log('security guard (BYO key：用户自带 Key 只存本机，平台 Key 只在服务端)');

test('api/settings 只回"状态 + 指纹"，不得把密钥值放进返回体', () => {
  const src = read('api/settings/[action].ts');
  assert.ok(src.includes('describeKeys('), '必须走统一的掩码函数');
  assert.ok(src.includes('不回显密钥值'), '必须写明口径');
  // 精确禁止"把 env 值直接塞进返回体"的三种写法（旧实现就是第一种）
  assert.ok(!/keys:\s*\{[^}]*env\(/s.test(src), '不得再出现 keys: { …: env(...) } 这种明文回显');
  assert.ok(!/fingerprint:\s*env\(/.test(src), '不得把 env 值当指纹返回（等于回显）');
  assert.ok(!/value:\s*env\(/.test(src), '不得把 env 值当字段值返回');
  // 返回体里只能出现掩码函数产出的 keys
  assert.ok(/keys:\s*describeKeys\(/.test(src), '返回体里的 keys 必须是 describeKeys(...) 的结果');
  // 服务端保存密钥的入口必须仍然只对管理员开放（否则任何人都能把 Key 写进平台）
  assert.ok(src.includes('isAdminEmail(auth.email)'), '保存/读取密钥必须校验管理员身份');
  assert.ok(src.includes("'非管理员'"), '非管理员必须被明确拒绝');
});

test('api/admin 的环境自检同样只回状态与指纹', () => {
  const src = read('api/admin/[action].ts');
  assert.ok(src.includes('describeCheck('), '自检项必须走掩码');
  assert.ok(src.includes('不回显任何密钥值'));
  assert.ok(!/fingerprint:\s*env\(/.test(src), '不得把 env 值当指纹返回（那等于回显）');
});

test('前端不再保存密钥明文：saveServerKeys 与明文缓存写入必须消失', () => {
  const files = walk('src');
  const offenders: string[] = [];
  for (const f of files) {
    const text = read(f);
    if (/export function saveServerKeys/.test(text)) offenders.push(`${f}: 仍有 saveServerKeys`);
    if (/localStorage\.setItem\(\s*['"]amzdev_admin_keys['"]/.test(text)) {
      offenders.push(`${f}: 仍在往 amzdev_admin_keys 写明文`);
    }
  }
  assert.deepEqual(offenders, [], `前端仍在保存密钥：\n${offenders.join('\n')}`);
});

test('serverKeys：默认密钥读取必须返回空（平台 Key 进不了浏览器）', () => {
  const src = read('src/utils/serverKeys.ts');
  assert.ok(/export function getDefaultServerKey[\s\S]{0,200}?return '';/.test(src), 'getDefaultServerKey 必须返回空串');
  assert.ok(src.includes('清除浏览器副本') || src.includes('删除本地明文副本'), '必须提供明文清理路径');
  assert.ok(src.includes('LEGACY_STORAGE_KEY'), '必须认识旧版明文存储键（否则迁移不到）');
});

test('掩码只有一个实现：api 层不得自己写一份 maskKey', () => {
  const apiFiles = walk('api');
  const offenders: string[] = [];
  for (const f of apiFiles) {
    const text = read(f);
    // api 层可以 import maskKey，但不应再定义函数体
    if (/function maskKey\s*\(/.test(text)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `api 层重写了 maskKey（应统一用 src/utils/keyMasking）：${offenders.join(', ')}`);
  assert.ok(read('src/utils/keyMasking.ts').includes('export function maskKey'));
});

test('浏览器永不持有/解析平台密钥（BYO 之后这条仍然是红线）', () => {
  const offenders: string[] = [];
  for (const f of walk('src')) {
    const text = read(f);
    if (/function\s+mcpHttp\s*\(/.test(text)) offenders.push(`${f}: 仍有浏览器直连 mcpHttp`);
    if (/function\s+resolveSellerSpriteAuth\s*\(/.test(text)) offenders.push(`${f}: 仍会解析浏览器侧的密钥`);
    // 平台 Key 的来源只能是服务端；浏览器侧不得出现"从服务端拿 Key 存起来"的写法
    if (/getDefaultServerKey\([^)]*\)[\s\S]{0,80}localStorage\.setItem/.test(text)) {
      offenders.push(`${f}: 把服务端密钥写进了浏览器`);
    }
  }
  assert.deepEqual(offenders, [], `仍存在浏览器侧平台密钥路径：\n${offenders.join('\n')}`);
  // 客户端往 MCP 打请求头的那种写法，一律不许再长回来（用户 Key 也只走同源请求体）
  for (const f of POOL_CLIENT_FILES) {
    const text = read(f);
    assert.ok(!/'secret-key'[ \t]*:[ \t]*[A-Za-z_$]/.test(text), `${f}: 不得往请求头塞 secret-key`);
    assert.ok(!/'X-Mcp-Key'[ \t]*:[ \t]*[A-Za-z_$]/.test(text), `${f}: 不得往请求头塞 X-Mcp-Key`);
  }
});

test('BYO：每个数据源都有「名称 / 地址 / Key / 验证」——不再按 kind 分支', () => {
  const panel = read('src/components/AiSettingsPanel.tsx');
  const mapStart = panel.indexOf('mcpProviders.map(');
  assert.ok(mapStart > 0, '找不到数据源列表的渲染入口');
  const mapEnd = panel.indexOf('添加数据源', mapStart);
  assert.ok(mapEnd > mapStart, '找不到数据源列表的结尾');
  const region = panel.slice(mapStart, mapEnd);

  // ① 每一家都有 Key 输入框（结构上统一渲染：不按 kind 走不同分支）
  assert.equal(
    (region.match(/type="password"/g) || []).length,
    1,
    '数据源行里应当只有一处 Key 输入框（统一渲染），多了说明又按 kind 分叉了'
  );
  assert.ok(/type="password"[\s\S]{0,400}?updateProvider\(p\.id,\s*\{\s*secretKey/.test(region), 'Key 输入框必须写回 secretKey');
  // 四样（名称/地址/Key/验证）必须是**同一段 JSX**：行内不得再按 kind 走三元分支
  assert.ok(!/p\.kind === '[a-z]+'\s*\?/.test(region), '名称/地址/Key 不得再按 kind 分支（那会让平台数据源没有输入框）');
  assert.ok(!/mcpProviders\.filter\(/.test(region), '不得先过滤掉某些数据源再渲染（每一家都要有这四样）');
  // ② 名称 / 地址 同样人人都有
  assert.ok(/updateProvider\(p\.id,\s*\{\s*name:/.test(region), '每一家都要能改名称');
  assert.ok(/updateProvider\(p\.id,\s*\{\s*mcpUrl:/.test(region), '每一家都要能改地址');
  // ③ 验证按钮
  assert.ok(region.includes('handleTestMcpProvider(p)'), '每一家都要有「验证」按钮');
  // ④ 留空与填了的差别必须写在占位符里
  assert.ok(region.includes('留空'), '占位符必须说清"留空会怎样"');
  assert.ok(region.includes('平台 Key'), '占位符必须说清留空走平台 Key');
  assert.ok(region.includes('只存在本机'), '占位符必须说清填了只存在本机');
  // ⑤ 已填时掩码显示 + 清除按钮
  assert.ok(region.includes('maskKey(p.secretKey)'), '已填 Key 必须掩码显示（复用 keyMasking 的 maskKey）');
  assert.ok(region.includes('清除本机密钥'), '必须给「清除本机密钥」按钮');
  // ⑥ 一行提示：你自己的 Key 只存在本机（≤30 字，别又写成长篇大论）
  const hint = (/你自己的 Key 只存在[^\n<]*/.exec(panel)?.[0] ?? '').trim();
  assert.ok(hint.length > 0, '必须有一行"只存本机"的提示');
  assert.ok(hint.length <= 30, `这行提示太长了（${hint.length} 字）：${hint}`);
});

test('用户 Key 不得写库：浏览器不再 push，网关对 app_config 只读不写', () => {
  const mcp = read('src/utils/mcpConfig.ts');
  assert.ok(!/pushServerKeys\s*\(/.test(mcp), 'BYO 之后保存只写 localStorage：不得再把本机 Key 推给服务端');
  assert.ok(!/\/api\/settings\/save/.test(mcp), '不得调用服务端密钥保存接口');
  assert.ok(mcp.includes('绝不写库'), '必须写明"用户 Key 绝不写库"这条红线');

  const panel = read('src/components/AiSettingsPanel.tsx');
  assert.ok(!/pushServerKeys/.test(panel), '设置页不得把面板里的 Key 推到服务端');

  const gw = read('api/data/[action].ts');
  // 网关只能**读**平台 Key；任何写操作都意味着用户带来的 Key 可能被持久化
  assert.ok(
    !/from\('app_config'\)\s*\.\s*(upsert|insert|update|delete)/.test(gw),
    '数据池网关不得写 app_config（用户 Key 绝不落库）'
  );
  assert.ok(/from\('app_config'\)\s*\.select\('value'\)/.test(gw), '网关对 app_config 只允许 select 平台 Key');
  // 用量表里只能记 keySource 标签，不能记 Key 值：把 insert 对象的**字段名**列出来逐个查
  const inserts = [...gw.matchAll(/\.insert\(\{[\s\S]{0,400}?\}\)/g)].map((m) => m[0]);
  assert.ok(inserts.length >= 1, '找不到 usage_events 的写入语句（守卫拦不住）');
  const fields = inserts.flatMap((ins) => [...ins.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]));
  const badFields = fields.filter((f) => /secret|userkey|user_key|password|apikey|api_key/i.test(f));
  assert.deepEqual(badFields, [], `usage_events 的写入里出现了密钥字段：${badFields.join(', ')}`);
  assert.ok(fields.includes('key_source'), '用量记录要带 key_source 标签（成本归因）');
});

test('用户 Key 不得写日志：网关零 console，上游报错必须先脱敏', () => {
  const gw = read('api/data/[action].ts');
  assert.ok(
    !/console\./.test(gw),
    '数据池网关不得有任何 console 输出：Key 就在局部变量里，日志是泄密第一现场'
  );
  assert.ok(gw.includes('redactText('), '上游报错文本必须先过 redactText（外部服务经常把 Key 原样回显在错误里）');
  assert.ok(!/throw new Error\(`MCP HTTP/.test(gw), '不得再把上游原文直接抛出去（会连 Key 一起抛）');
});

test('用户 Key 不得进响应体：返回体里连指纹都不给', () => {
  const gw = read('api/data/[action].ts');
  const returned = [...gw.matchAll(/json\(res,\s*\d+,\s*\{[^}]*\b(secret|userKey|user_key)\b[^}]*\}/g)];
  assert.deepEqual(returned.map((m) => m[0].slice(0, 80)), [], '返回体里出现了密钥字段');
  assert.ok(!/fingerprint:\s*secret/.test(gw), '不得把平台 Key 的指纹回给普通用户');
  assert.ok(!/secret\.slice\(/.test(gw), '不得对密钥做任何切片回显');
  // 数据池状态是给所有登录用户看的：只回布尔
  assert.ok(
    /providers\[p\]\s*=\s*\{[\s\S]{0,400}?configured:/.test(gw) && !/configured:[^,]*,\s*fingerprint/.test(gw),
    '状态接口只允许回 configured / hasCustomUrl'
  );
});

test('用户 Key 不得进 URL query：只能进同源 POST 的请求体', () => {
  const offenders: string[] = [];
  for (const f of POOL_CLIENT_FILES) {
    const text = read(f);
    if (/[?&](userKey|user_key|secret|api_key|key)=\$\{/.test(text)) offenders.push(`${f}: 把 Key 拼进了 URL query`);
    if (/[?&]userKey=/.test(text)) offenders.push(`${f}: URL query 里出现了 userKey`);
  }
  assert.deepEqual(offenders, [], `Key 不得进 URL query（会进历史/代理日志/Referer）：\n${offenders.join('\n')}`);

  const client = read('src/utils/dataPoolClient.ts');
  assert.ok(client.includes("fetch('/api/data/mcp'"), '数据池调用必须走同源相对路径');
  assert.ok(client.includes("fetch('/api/data/verify'"), '验证必须走同源相对路径');
  assert.ok(/withUserKey\(/.test(client), '用户 Key 只能通过唯一的 withUserKey 通道附加到请求体');
  assert.ok(read('src/utils/listingFetchExecutor.ts').includes('withUserKey('), 'Listing 抓取也必须走同一个通道（否则会偷偷用平台 Key）');
  // 说明：AI 那边的 Gemini 走 `?key=` 是它自己的协议（AI tab，不是数据池这条路），不在本条的红线范围内。
});

test('解析顺序：用户 Key 优先、平台兜底（纯函数）', () => {
  assert.equal(sanitizeUserKey('  sk-user-123  '), 'sk-user-123', '首尾空白要去掉');
  assert.equal(sanitizeUserKey(''), '', '空 = 未提供');
  assert.equal(sanitizeUserKey('   '), '', '只有空白 = 未提供');
  assert.equal(sanitizeUserKey(undefined), '', 'undefined = 未提供（不得报错）');
  assert.equal(sanitizeUserKey(12345), '', '非字符串 = 未提供');
  assert.equal(sanitizeUserKey('x'.repeat(513)), '', '超长（>512）= 未提供，不报错不泄露细节');
  assert.equal(sanitizeUserKey('x'.repeat(512)), 'x'.repeat(512), '512 位仍是合法上限');
  assert.equal(sanitizeUserKey('sk-a\nb'), '', '含控制字符 = 未提供（拒绝 header 注入）');

  assert.deepEqual(decideProviderKeySource('user-key'), { source: 'user', userKey: 'user-key' });
  assert.deepEqual(decideProviderKeySource('  '), { source: 'platform', userKey: '' }, '没有用户 Key 才轮到平台');

  assert.deepEqual(resolveProviderKey({ userKey: 'u', platformKey: 'p' }), { key: 'u', source: 'user' }, '用户 Key 优先');
  assert.deepEqual(resolveProviderKey({ userKey: '  ', platformKey: 'p' }), { key: 'p', source: 'platform' }, '无效用户 Key → 平台兜底');
  assert.deepEqual(resolveProviderKey({ userKey: 'x'.repeat(600), platformKey: 'p' }), { key: 'p', source: 'platform' }, '超长 → 平台兜底');
  assert.deepEqual(resolveProviderKey({ platformKey: 'p' }), { key: 'p', source: 'platform' });
  assert.deepEqual(resolveProviderKey({}), { key: '', source: 'none' }, '两边都没有 → none（如实报"未配置"）');
  assert.deepEqual(resolveProviderKey({ userKey: 'u' }), { key: 'u', source: 'user' }, '没有平台 Key 也不影响用用户 Key');
});

test('解析顺序：用户 Key 优先、平台兜底（源码级：平台 Key 只在用户没带时才读）', () => {
  const gw = read('api/data/[action].ts');
  assert.ok(gw.includes('decideProviderKeySource('), '来源判定必须走统一的纯函数');
  assert.ok(gw.includes('resolveProviderKey({'), '最终取值必须走同一个纯函数（服务端与前端同一份口径）');
  // 关键顺序断言放在解析函数**体内**看（函数定义在调用点之前，按整文件 indexOf 比会误判）：
  const fnStart = gw.indexOf('async function resolveRequestSecret');
  assert.ok(fnStart > 0, '找不到统一的密钥解析入口 resolveRequestSecret');
  const fnBody = gw.slice(fnStart, gw.indexOf('function resolveProviderUrl', fnStart));
  const userIdx = fnBody.indexOf('decideProviderKeySource(');
  const platformIdx = fnBody.indexOf('await resolvePlatformSecret(');
  assert.ok(userIdx > 0, '解析入口必须先看用户 Key');
  assert.ok(platformIdx > userIdx, '顺序必须是"先看用户 Key、再兜底平台 Key"');
  assert.ok(
    /decision\.source === 'platform'\s*\?\s*await resolvePlatformSecret\(/.test(fnBody),
    '平台 Key 只能在"用户没带 Key"时才去读（用户自带 Key 时一次都不碰 app_config）'
  );
  assert.ok(gw.includes('resolveRequestSecret(provider, body.userKey)'), '调用点必须把请求体里的用户 Key 交给统一解析');
  assert.ok(!/userKey[\s\S]{0,60}(upsert|insert)/.test(gw), '用户 Key 不得进入任何写库语句');
});

test('BYO 的用量记账：只记字面量标签，不记 Key', () => {
  const gw = read('api/data/[action].ts');
  const usageCalls = [...gw.matchAll(/createUsageEvent\(\{[\s\S]{0,700}?\}\)/g)].map((m) => m[0]);
  assert.equal(usageCalls.length, 2, `用量事件应恰好 2 条（缓存命中 / 真实调用），实际 ${usageCalls.length}`);
  for (const call of usageCalls) {
    assert.ok(/keySource/.test(call), '每条用量事件都要带 keySource 标签');
    assert.ok(!/\b(secret|userKey)\b/.test(call), '用量事件里不得出现密钥字段');
  }
  assert.ok(/keySource:\s*keyDecision\.source/.test(gw), '缓存命中也要记来源标签（缓存共享，但来源要说清楚）');

  const usage = read('src/utils/usageAccounting.ts');
  assert.ok(/keySource\?: UsageKeySource/.test(usage), 'UsageEvent 必须有 keySource 字段');
  assert.ok(/UsageKeySource = 'user' \| 'platform' \| 'none'/.test(usage), "字面量口径必须是 'user' | 'platform'（+ none）");
  assert.ok(!/keySource[\s\S]{0,40}(secret|Key 值)/.test(usage), 'keySource 只能记标签，不得夹带 Key');
});

test('游客（未登录）被明确拦下，且理由指向示例数据与登录', async () => {
  const routing = read('src/utils/dataPoolRouting.ts');
  assert.ok(routing.includes("route: 'blocked'"), '未登录必须返回 blocked');
  assert.ok(routing.includes('只对登录用户开放'), '必须写明这条口径');
  assert.ok(routing.includes('示例数据'), '要告诉游客还能怎么体验');
  const seller = read('src/utils/sellerspriteApi.ts');
  assert.ok(seller.includes('只走服务端数据池'), '取数入口必须写明只走服务端');
  assert.ok(!seller.includes("'secret-key'"), '取数入口不得再出现密钥请求头');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
