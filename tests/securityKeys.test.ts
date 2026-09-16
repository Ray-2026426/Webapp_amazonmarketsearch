// M5 · 安全守卫：密钥不得离开"它该待的地方"。
//
// ── 口径变更记录（重要：这不是放松约束，是用户决策又变了一次） ─────────────────────────────
// 2026-09 第一版（§15.26 BYO Key）：所有用户填**自己的** Key → 只存浏览器 localStorage +
// 随同源请求体 `userKey` 带给网关；平台 Key 仍可兜底。
// 2026-09 第二版（§15.28，用户原话「我的mcp没有跟着账号走吗，需要跟着账号」）：
//   · 用户 Key 的**唯一真相**改成服务端表 `public.user_provider_keys`（主键 user_id + provider），
//     跨设备跟着账号走；客户端**不再保存、也不传送**明文；
//   · **政策 A**：平台 Key 不再作为 MCP 数据的兜底（`resolvePlatformSecret` 整段删除）；
//   · user_id 一律取自 JWT，绝不接受客户端传来的 userId（跨账号隔离）。
//
// 断言因此从"用户 Key 不许写库"变成"用户 Key **只许**写进 user_provider_keys，且只有 service_role 能读"，
// 并逐条显式化下面这些承诺：
//   1) /api/settings 只回状态与指纹，不得回显密钥；
//   2) 前端不得保存**平台**密钥明文（saveServerKeys / amzdev_admin_keys 必须消失）；
//   3) 掩码逻辑只允许有一个实现（src/utils/keyMasking.ts）；
//   4) 浏览器永不持有、永不解析平台密钥；网关也不再读写 app_config（平台 Key 不作兜底）；
//   5) 每个数据源都有 名称 / 地址 / Key / 验证 四样；已配置只显示"指纹 + 替换 + 清除"，页面永不出现明文；
//   6) 用户密钥只能写进 user_provider_keys（RLS 全部拒绝，只有 service_role）；
//   7) 用户密钥不得写日志（含 console）、错误信息必须脱敏后才准往外抛；
//   8) 任何响应体里都不得出现明文（只给 configured + maskKey 指纹）；
//   9) 密钥不得进 URL query；
//  10) 网关解析顺序必须是「库里该用户的 Key → 请求体（迁移期）→ none」，且有可单测的纯函数；
//  11) userId 只认 JWT：A 读不到 / 改不了 / 清不掉 B 的密钥；
//  12) 本机旧明文迁移成功后必须删除本机副本（不留两处真相）。
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

/** 所有 `json(res, <status>, { ... })` 的返回体（只需覆盖到第一个 `})`，够守卫用） */
function responseBodies(src: string): string[] {
  return [...src.matchAll(/json\(res,\s*\d+,\s*\{[\s\S]{0,700}?\n?\s*\}\)/g)].map((m) => m[0]);
}

console.log('security guard（§15.28：用户密钥按账号存服务端，只回指纹）');

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
  const masking = read('src/utils/keyMasking.ts');
  assert.ok(masking.includes('export function maskKey'));
  assert.ok(/if \(v\.length <= 8\)[\s\S]{0,120}?…/.test(masking), '短 key 也要给"前 2 末 2"的掩码（不许原样回显）');
});

test('浏览器永不持有/解析平台密钥，网关也不再读 app_config（政策 A）', () => {
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
  // 客户端往 MCP 打请求头的那种写法，一律不许再长回来（用户 Key 也不许出现在客户端）
  for (const f of POOL_CLIENT_FILES) {
    const text = read(f);
    assert.ok(!/'secret-key'[ \t]*:[ \t]*[A-Za-z_$]/.test(text), `${f}: 不得往请求头塞 secret-key`);
    assert.ok(!/'X-Mcp-Key'[ \t]*:[ \t]*[A-Za-z_$]/.test(text), `${f}: 不得往请求头塞 X-Mcp-Key`);
  }
  // 政策 A：网关既不读也不写 app_config（平台 Key 不再作 MCP 数据的兜底）
  const gw = read('api/data/[action].ts');
  assert.ok(!/from\('app_config'\)/.test(gw), '网关不得再碰 app_config：平台 Key 不再是 MCP 兜底');
  assert.ok(!/resolvePlatformSecret/.test(gw), '平台 Key 解析入口必须整段删除，不留死代码');
});

test('用户密钥只能写进 user_provider_keys（只有 service_role 能读写）', () => {
  const gw = read('api/data/[action].ts');
  const writes = [...gw.matchAll(/from\('([a-z_]+)'\)[\s\S]{0,40}?\.\s*(upsert|insert|update|delete)\b/g)].map((m) => m[1]);
  assert.ok(writes.includes('user_provider_keys'), '密钥必须写进 user_provider_keys（跨设备跟随账号）');
  const nonBookkeeping = [...new Set(writes.filter((t) => t !== 'pool_cache' && t !== 'usage_events'))];
  assert.deepEqual(nonBookkeeping, ['user_provider_keys'], `除缓存/记账外只允许写密钥表：${nonBookkeeping.join(',')}`);

  const sql = read('supabase/migrations/all_in_one.sql');
  assert.ok(/create table if not exists public\.user_provider_keys/.test(sql), '迁移里必须建这张表');
  assert.ok(/primary key \(user_id, provider\)/.test(sql), '主键必须是 (user_id, provider)：一个用户一个数据源一条');
  assert.ok(
    /drop policy if exists user_provider_keys_service_only on public\.user_provider_keys;[\s\S]{0,160}?using \(false\)[\s\S]{0,80}?with check \(false\)/.test(sql),
    'RLS 必须"全部拒绝"（只有 service_role 绕得过）'
  );
  assert.ok(/user_id\s+text not null/.test(sql), 'user_id 必须是 not null 的 text（JWT 的 sub 原样存）');
});

test('BYO：每个数据源都有「名称 / 地址 / Key / 验证」——Key 只显示指纹，且能替换/清除', () => {
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
  assert.ok(/type="password"[\s\S]{0,700}?setKeyDrafts\(/.test(region), 'Key 输入框只能写进"待保存草稿"');
  // 四样（名称/地址/Key/验证）必须是**同一段 JSX**：行内不得再按 kind 走三元分支
  assert.ok(!/p\.kind === '[a-z]+'\s*\?/.test(region), '名称/地址/Key 不得再按 kind 分支（那会让平台数据源没有输入框）');
  assert.ok(!/mcpProviders\.filter\(/.test(region), '不得先过滤掉某些数据源再渲染（每一家都要有这四样）');
  // ② 名称 / 地址 同样人人都有
  assert.ok(/updateProvider\(p\.id,\s*\{\s*name:/.test(region), '每一家都要能改名称');
  assert.ok(/updateProvider\(p\.id,\s*\{\s*mcpUrl:/.test(region), '每一家都要能改地址');
  // ③ 验证按钮
  assert.ok(region.includes('handleTestMcpProvider(p)'), '每一家都要有「验证」按钮');
  // ④ 必须说清 Key 是用户自己的，不能暗示留空走平台兜底
  assert.ok(region.includes('你自己的 Key'), '占位符必须说清要填写自己的 Key');
  assert.ok(!region.includes('平台 Key'), 'Key 输入区不得再暗示留空走平台 Key');
  // ⑤ 已配置：只显示指纹 + 替换 / 清除（**不回显明文**）
  assert.ok(region.includes('已配置（'), '已配置必须显示成「已配置（指纹）」');
  assert.ok(region.includes('{keyFingerprint}'), '指纹必须来自服务端状态，而不是本地明文');
  assert.ok(region.includes('handleSaveUserKey(p)'), '必须有「保存」按钮');
  assert.ok(region.includes('handleClearUserKey(p)'), '必须有「清除」按钮');
  assert.ok(region.includes('替换'), '必须有「替换」按钮');
  assert.ok(region.includes('setReplacingKeyId(p.id)'), '「替换」要能切换回输入框');
  // ⑥ 页面不得再持有明文：整份设置页里不该有 secretKey 这种字段
  assert.ok(!/secretKey/.test(panel), '设置页不得再持有密钥字段（明文只能活在输入框草稿里）');
  // ⑦ 一行提示：密钥跟着账号走（≤30 字，别又写成长篇大论）
  const hint = (/密钥存在你的账号里[^\n<]*/.exec(panel)?.[0] ?? '').trim();
  assert.ok(hint.length > 0, '必须有一行"密钥跟着账号走"的提示');
  assert.ok(hint.length <= 30, `这行提示太长了（${hint.length} 字）：${hint}`);
});

test('userId 只认 JWT：三个密钥动作都不接受客户端传来的 userId（A 动不了 B 的密钥）', () => {
  const gw = read('api/data/[action].ts');
  // userId 的唯一来源：verifyToken（JWT 的 sub）
  assert.ok(/const auth = await verifyToken\(token\)/.test(gw), 'userId 必须来自 verifyToken');
  assert.ok(!/(body|req\.body|req\.query)\s*\.\s*userId/.test(gw), '任何地方都不得读客户端传来的 userId');
  assert.ok(!/String\(body\.userId/.test(gw), '不得把请求体里的 userId 转成字符串使用');

  const keyStart = gw.indexOf('async function handleKeyList');
  const keyEnd = gw.indexOf('interface GatewayAuth');
  assert.ok(keyStart > 0 && keyEnd > keyStart, '找不到三个密钥动作的实现区段');
  const keyRegion = gw.slice(keyStart, keyEnd);
  assert.ok((keyRegion.match(/auth\.userId/g) || []).length >= 4, '三个动作都必须用 auth.userId（JWT）过滤');
  assert.ok(!/body\.userId/.test(keyRegion), '密钥动作里不得出现客户端传来的 userId');
  // 读只读自己那一行
  assert.ok(
    /from\('user_provider_keys'\)[\s\S]{0,160}?\.eq\('user_id',\s*auth\.userId\)/.test(keyRegion),
    'keyList 必须按 user_id 过滤（否则能读到别人的密钥状态）'
  );
  // 写只写自己那一行（upsert 的 user_id 取自 JWT）
  assert.ok(
    /from\('user_provider_keys'\)[\s\S]{0,80}?\.upsert\(\{\s*user_id:\s*auth\.userId/.test(keyRegion),
    'keySet 必须把 user_id 写成 JWT 的 userId'
  );
  assert.ok(
    /from\('user_provider_keys'\)[\s\S]{0,80}?\.delete\(\)\s*\.eq\('user_id',\s*auth\.userId\)/.test(keyRegion),
    'keyClear 必须只能删自己的那一行'
  );
  // 网关自身取 Key 也必须按 JWT 的 userId
  assert.ok(/readUserProviderKey\(auth\.userId/.test(gw), '状态接口只能回报"自己"的密钥状态');
  assert.ok(!/readUserProviderKey\([^)]*body/.test(gw), '取密钥时不得用请求体里的任何标识');
});

test('用户密钥不得写日志：网关零 console，错误信息必须先脱敏', () => {
  const gw = read('api/data/[action].ts');
  assert.ok(
    !/console\./.test(gw),
    '数据池网关不得有任何 console 输出：密钥就在局部变量里，日志是泄密第一现场'
  );
  assert.ok(gw.includes('redactText('), '错误文本必须先过 redactText（外部服务经常把 Key 原样回显在错误里）');
  assert.ok((gw.match(/redactText\(/g) || []).length >= 3, '密钥动作的错误路径也要脱敏，不能只脱一处');
  assert.ok(!/throw new Error\(`MCP HTTP/.test(gw), '不得再把上游原文直接抛出去（会连 Key 一起抛）');
  assert.ok(/JSON.stringify|const base = \{/.test(gw), '记账仍是字段白名单式写入（不做整对象透传）');
});

test('任何响应体都不得出现明文：只给 configured + maskKey 指纹', () => {
  const gw = read('api/data/[action].ts');
  const bodies = responseBodies(gw);
  assert.ok(bodies.length >= 8, `返回体至少要能扫到 8 处，实际 ${bodies.length}（守卫拦不住就要先修守卫）`);
  for (const body of bodies) {
    const masked = body.replace(/maskKey\(\s*[A-Za-z_$][\w$]*\s*\)/g, '<masked>');
    assert.ok(!/\b(secret|userKey|user_key|plaintext|rawValue)\b/.test(masked), `返回体里出现密钥字段：${body.slice(0, 120)}`);
    // 只拦"直接的密钥值"：`bumped.value`（缓存数据）这种字段访问不算，`value,` / `value }` 才算
    assert.ok(!/(?<![.\w])value\s*[,}]/.test(masked), `返回体里不得直接回传密钥值：${body.slice(0, 120)}`);
  }
  // 指纹只允许两种形态：maskKey(...) 或空串（只看返回体里的，避免误伤类型标注）
  const fingerprints = bodies.flatMap((b) => [...b.matchAll(/fingerprint:\s*([^,}\n]+)/g)].map((m) => m[1].trim()));
  assert.ok(fingerprints.length >= 2, `必须能扫到指纹字段，实际 ${fingerprints.length}`);
  for (const fp of fingerprints) {
    assert.ok(fp === "''" || fp.startsWith('maskKey('), `指纹只能是 maskKey 产物或空串，实际：${fp}`);
  }
  assert.ok(!/secret\.slice\(/.test(gw), '不得对密钥做任何切片回显');
  assert.ok(!/body\.value\s*[,}]/.test(gw), '不得把请求体里的密钥值直接放进返回体');
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
  // §15.28：客户端不再把 Key 随请求体发送 —— 那条通道已删除（定义与调用点都不得再出现）
  assert.ok(!/withUserKey\s*\(/.test(client), 'withUserKey 通道必须删除（服务端按 JWT 自己取 Key）');
  assert.ok(!/export function withUserKey/.test(client), '不得再导出"把 Key 塞进请求体"的工具函数');
  assert.ok(!/withUserKey\s*\(/.test(read('src/utils/listingFetchExecutor.ts')), 'Listing 抓取也不得再带 Key');
  assert.ok(client.includes('客户端不传 Key') || client.includes('客户端**不传 Key**'), '文件头必须写明"客户端不传 Key"');
  // 密钥的读写只走 mcpConfig 的三个动作（同源 POST）
  const mcp = read('src/utils/mcpConfig.ts');
  assert.ok(/postKeyAction\('keySet'/.test(mcp) && /postKeyAction\('keyClear'/.test(mcp) && /postKeyAction\('keyList'/.test(mcp));
  assert.ok(!/export function getUserKeyForProvider/.test(mcp), '不得再提供"读本机明文 Key 当真相"的函数');
  assert.ok(!/localStorage\.setItem\([^)]*secretKey/i.test(mcp), '密钥绝不写 localStorage（迁移期例外只保留旧值）');
  // 说明：AI 那边的 Gemini 走 `?key=` 是它自己的协议（AI tab，不是数据池这条路），不在本条的红线范围内。
});

test('解析顺序：库里该用户的 Key → 请求体（迁移期）→ none（纯函数）', () => {
  assert.equal(sanitizeUserKey('  sk-user-123  '), 'sk-user-123', '首尾空白要去掉');
  assert.equal(sanitizeUserKey(''), '', '空 = 未提供');
  assert.equal(sanitizeUserKey('   '), '', '只有空白 = 未提供');
  assert.equal(sanitizeUserKey(undefined), '', 'undefined = 未提供（不得报错）');
  assert.equal(sanitizeUserKey(12345), '', '非字符串 = 未提供');
  assert.equal(sanitizeUserKey('x'.repeat(513)), '', '超长（>512）= 未提供，不报错不泄露细节');
  assert.equal(sanitizeUserKey('x'.repeat(512)), 'x'.repeat(512), '512 位仍是合法上限');
  assert.equal(sanitizeUserKey('sk-a\nb'), '', '含控制字符 = 未提供（拒绝 header 注入）');

  assert.deepEqual(decideProviderKeySource('user-key'), { source: 'user', userKey: 'user-key' });
  assert.deepEqual(decideProviderKeySource('  '), { source: 'none', userKey: '' }, '没有用户 Key 就不能兜底平台');

  assert.deepEqual(resolveProviderKey({ userKey: 'u', platformKey: 'p' }), { key: 'u', source: 'user' }, '用户 Key 优先');
  assert.deepEqual(resolveProviderKey({ userKey: '  ', platformKey: 'p' }), { key: '', source: 'none' }, '无效用户 Key → none，不兜底平台');
  assert.deepEqual(resolveProviderKey({ userKey: 'x'.repeat(600), platformKey: 'p' }), { key: '', source: 'none' }, '超长 → none，不兜底平台');
  assert.deepEqual(resolveProviderKey({ platformKey: 'p' }), { key: '', source: 'none' }, '只有平台 Key 也不能给普通 MCP 用');
  assert.deepEqual(resolveProviderKey({}), { key: '', source: 'none' }, '两边都没有 → none（如实报"未配置"）');
  assert.deepEqual(resolveProviderKey({ userKey: 'u' }), { key: 'u', source: 'user' }, '没有平台 Key 也不影响用用户 Key');
});

test('解析顺序：库里该用户的 Key → 请求体 → none（源码级：不得再读平台 Key）', () => {
  const gw = read('api/data/[action].ts');
  assert.ok(gw.includes('decideProviderKeySource('), '来源判定必须走统一的纯函数');
  assert.ok(gw.includes('resolveProviderKey({'), '最终取值必须走同一个纯函数（服务端与客户端同一份口径）');
  // 关键顺序断言放在解析函数**体内**看（函数定义在调用点之前，按整文件 indexOf 比会误判）：
  const fnStart = gw.indexOf('async function resolveRequestSecret');
  assert.ok(fnStart > 0, '找不到统一的密钥解析入口 resolveRequestSecret');
  const fnBody = gw.slice(fnStart, gw.indexOf('function resolveProviderUrl', fnStart));
  const storedIdx = fnBody.indexOf('readUserProviderKey(');
  const legacyIdx = fnBody.indexOf('resolveProviderKey(');
  assert.ok(storedIdx > 0, '解析入口必须先去库里取该用户自己的 Key');
  assert.ok(legacyIdx > storedIdx, '顺序必须是：先查库里的（按 JWT 的 userId）→ 再兼容请求体里的旧 Key');
  assert.ok(!fnBody.includes('resolvePlatformSecret'), '解析入口不得读取平台 Key');
  assert.ok(!fnBody.includes('app_config'), '解析入口不得读 app_config（政策 A）');
  assert.ok(gw.includes('resolveRequestSecret(provider, auth.userId, body.userKey)'), '调用点必须把 JWT 的 userId 交给统一解析');
  const mcpStart = gw.indexOf('async function handleMcp');
  const mcpBody = gw.slice(mcpStart, gw.indexOf('/** 状态', mcpStart));
  assert.ok(mcpBody.indexOf('resolveRequestSecret(') < mcpBody.indexOf('readCacheEntry('), '必须先校验用户 Key，再允许读共享缓存');
});

test('本机旧明文迁移：成功后删除本机副本，失败则保留并如实提示', () => {
  const mcp = read('src/utils/mcpConfig.ts');
  assert.ok(/export async function migrateLegacyLocalKeys/.test(mcp), '必须提供一次性迁移入口');
  assert.ok(/dropLegacyLocalKeys\(migrated\)/.test(mcp), '迁移成功（migrated 非空）时必须删掉本机副本');
  assert.ok(/if \(failed\.length > 0\)[\s\S]{0,400}?本机副本已保留/.test(mcp), '失败必须如实告知且保留副本（不静默丢密钥）');
  assert.ok(!/export function getUserKeyForProvider/.test(mcp), '旧的"读本机 Key"入口必须消失（否则又是两处真相）');
  // 数据池链路会自动补跑一次迁移（老设备不打开设置也能用）
  assert.ok(read('src/utils/dataPoolClient.ts').includes('migrateLegacyLocalKeys()'), '调数据池前要先补跑迁移');
  assert.ok(read('src/utils/listingFetchExecutor.ts').includes('migrateLegacyLocalKeys()'), 'Listing 抓取同理');
});

test('密钥记账：只记字面量标签，不记 Key', () => {
  const gw = read('api/data/[action].ts');
  const usageCalls = [...gw.matchAll(/createUsageEvent\(\{[\s\S]{0,700}?\}\)/g)].map((m) => m[0]);
  assert.equal(usageCalls.length, 2, `用量事件应恰好 2 条（缓存命中 / 真实调用），实际 ${usageCalls.length}`);
  for (const call of usageCalls) {
    assert.ok(/keySource/.test(call), '每条用量事件都要带 keySource 标签');
    assert.ok(!/\b(secret|userKey)\b/.test(call), '用量事件里不得出现密钥字段');
  }
  assert.ok(/cacheHit:\s*true[\s\S]{0,120}\bkeySource\b/.test(gw), '缓存命中也要记来源标签（缓存共享，但来源要说清楚）');

  const usage = read('src/utils/usageAccounting.ts');
  assert.ok(/keySource\?: UsageKeySource/.test(usage), 'UsageEvent 必须有 keySource 字段');
  assert.ok(/UsageKeySource = 'user' \| 'platform' \| 'none'/.test(usage), "字面量口径必须是 'user' | 'platform'（+ none）");
  assert.ok(!/keySource[\s\S]{0,40}(secret|Key 值)/.test(usage), 'keySource 只能记标签，不得夹带 Key');
});

test('游客（未登录）被明确拦下，且理由指向示例数据与登录', () => {
  const routing = read('src/utils/dataPoolRouting.ts');
  assert.ok(routing.includes("route: 'blocked'"), '未登录必须返回 blocked');
  assert.ok(routing.includes('只对登录用户开放'), '必须写明这条口径');
  assert.ok(routing.includes('示例数据'), '要告诉游客还能怎么体验');
  const seller = read('src/utils/sellerspriteApi.ts');
  assert.ok(seller.includes('只走服务端数据池'), '取数入口必须写明只走服务端');
  assert.ok(!seller.includes("'secret-key'"), '取数入口不得再出现密钥请求头');
  assert.ok(!/secretKey/.test(seller), '取数入口不得再从本机配置读密钥（密钥在服务端）');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
