// M5 · 安全守卫：密钥不得离开服务端（PRD §11.2 / §11.4）。
//
// 为什么要有这个测试：密钥泄露是"一次性、不可逆"的事故，而"不回显密钥"是靠人记得住的约定。
// 这里直接扫源码，把约定变成会失败的测试：
//   1) /api/settings 只回状态与指纹，不得把 env 值直接放进返回体；
//   2) 前端不得保存密钥明文（旧实现的 saveServerKeys 必须消失）；
//   3) 掩码逻辑只允许有一个实现（src/utils/keyMasking.ts），api 层不得自己重写一份。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

console.log('security guard (keys stay server-side)');

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

test('serverKeys：默认密钥读取必须返回空（前端拿不到密钥）', () => {
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

test('数据池网关不把密钥写进日志/返回（只允许出现在请求头）', () => {
  const src = read('api/data/[action].ts');
  // secret 只应出现在 "secret-key": secret 这类请求头里，不应对外返回
  const returned = [...src.matchAll(/json\(res,\s*\d+,\s*\{[^}]*secret[^}]*\}/g)];
  assert.deepEqual(returned, [], '返回体里出现了 secret');
  assert.ok(src.includes("'secret-key': secret"), '密钥应只用于服务端→MCP 的请求头');
  assert.ok(src.includes('密钥只在服务端'), '必须写明该口径');
});

test('用户决策 A：源码里不再有任何"浏览器带密钥调 MCP"的实现', () => {
  const offenders: string[] = [];
  for (const f of walk('src')) {
    const text = read(f);
    // 只在同一行内匹配"请求头构造"，避免跨行匹配到 UI 标签文案（如三元表达式里的 'X-Mcp-Key'）
    if (/'secret-key'[ \t]*:[ \t]*[A-Za-z_$]/.test(text)) offenders.push(`${f}: 仍在往请求头塞 secret-key`);
    if (/'X-Mcp-Key'[ \t]*:[ \t]*[A-Za-z_$]/.test(text)) offenders.push(`${f}: 仍在往请求头塞 X-Mcp-Key`);
    if (/function\s+mcpHttp\s*\(/.test(text)) offenders.push(`${f}: 仍有浏览器直连 mcpHttp`);
    if (/function\s+resolveSellerSpriteAuth\s*\(/.test(text)) offenders.push(`${f}: 仍会解析浏览器侧密钥`);
  }
  assert.deepEqual(offenders, [], `仍存在浏览器侧密钥路径：\n${offenders.join('\n')}`);
});

test('用户决策 A：设置页不再提供密钥输入框', () => {
  const panel = read('src/components/AiSettingsPanel.tsx');
  assert.ok(panel.includes('密钥由平台在服务端管理'), '必须明确告知密钥由服务端管理');
  assert.ok(
    !/type="password"[\s\S]{0,200}updateProvider\([^)]*secretKey/.test(panel),
    '不得再渲染"输入密钥并写回设置"的输入框（那等于保留本地 Key 模式）'
  );
});

test('用户决策 A：游客（未登录）被明确拦下，且理由指向示例数据与登录', async () => {
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
