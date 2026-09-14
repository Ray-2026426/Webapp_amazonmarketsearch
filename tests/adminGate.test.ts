/**
 * 管理员身份判定回归（真实事故）：
 *   「设置 → 管理员后台 / 团队空间」两个 Tab 曾经对**所有人**都不显示，
 *   因为 AiSettingsPanel 写的是 `isAdminSession(undefined)`，而 isAdminSession 第一步就是
 *   `Boolean(user) && …` → 恒为 false。用户 ljh15874760218@gmail.com 因此看不到管理员功能。
 *
 * 本文件同时锁死新的权威口径：
 *   - 管理员身份由**服务端**（ADMIN_EMAILS 白名单）判定，随登录/注册/me 响应下发 isAdmin；
 *   - 前端不再依赖构建期注入的 VITE_ADMIN_EMAILS（它会把管理员邮箱明文打进公开 JS 包，
 *     且改一次白名单就得重新部署一次）；
 *   - 服务端接口自己也要拦（403），不能只靠前端藏 Tab。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err as Error).message}`);
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

console.log('adminGate：管理员身份判定');

test('全仓库不存在 isAdminSession(undefined)（恒 false 的权限门）', () => {
  const offenders: string[] = [];
  for (const file of walk(join(process.cwd(), 'src'))) {
    const text = readFileSync(file, 'utf8');
    // 先去掉注释：本次修复就在出问题的那行上方留了"以前写的是 isAdminSession(undefined)"的说明，
    // 注释里提到旧写法是好事，不该被判成违规。
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    if (/isAdminSession\(\s*undefined\s*\)/.test(code)) offenders.push(file.replace(process.cwd() + '\\', ''));
  }
  assert(offenders.length === 0, `仍有恒 false 的管理员判定：${offenders.join(', ')}`);
});

test('AiSettingsPanel 用 getCurrentUser() 判定，两个管理员 Tab 都受它控制', () => {
  const text = read('src/components/AiSettingsPanel.tsx');
  const gates = text.match(/isAdminSession\(getCurrentUser\(\)\)/g) || [];
  assert(gates.length === 2, `应有 2 处（管理员后台 + 团队空间），实际 ${gates.length}`);
  assert(text.includes("label: '管理员后台'"), '缺少「管理员后台」Tab');
  assert(text.includes("label: '团队空间'"), '缺少「团队空间」Tab');
  assert(text.includes('getCurrentUser'), 'AiSettingsPanel 必须 import 并使用 getCurrentUser');
});

test('isAdminSession 口径：role=admin 或邮箱在白名单里，二者取或', () => {
  const text = read('src/utils/auth.ts');
  assert(
    /isAdminSession[\s\S]{0,220}user\.role === 'admin'[\s\S]{0,80}isAdminEmail\(user\.email\)/.test(text),
    'isAdminSession 应同时认 role 与邮箱白名单'
  );
});

test('服务端是权威：登录/注册/me 都下发 isAdmin，且用的是 ADMIN_EMAILS', () => {
  const shared = read('api/auth/_shared.ts');
  assert(/isAdminEmail[\s\S]{0,200}ADMIN_EMAILS/.test(shared), '服务端 isAdminEmail 必须读 ADMIN_EMAILS');
  assert(
    /env\('ADMIN_EMAILS'\)\s*\|\|\s*env\('VITE_ADMIN_EMAILS'\)/.test(shared),
    'VITE_ADMIN_EMAILS 只能作为兜底（后者），不能反过来'
  );

  const auth = read('api/auth/[action].ts');
  assert(auth.includes('withAdmin'), '登录响应应通过 withAdmin 附加 isAdmin');
  assert(auth.includes('isAdminEmail'), 'withAdmin 必须基于 isAdminEmail 判定');
  assert(/login,\s*register,\s*me,/.test(auth.replace(/\s+/g, ' ')) || auth.includes('  me,'), '应注册 me action');
  const withAdminCalls = auth.match(/withAdmin\(/g) || [];
  assert(withAdminCalls.length >= 5, `withAdmin 应覆盖所有返回用户的出口（含本地/云两条路），实际 ${withAdminCalls.length} 处`);
});

test('前端采信服务端 isAdmin，并且没有 token 时能刷新（改白名单不必重登/重部署）', () => {
  const text = read('src/utils/auth.ts');
  assert(text.includes('isAdmin?: boolean'), 'writeSession 应接受服务端下发的 isAdmin');
  assert(/user\.isAdmin === true/.test(text), '服务端说 true 就应是 admin');
  assert(/export async function refreshAdminFlag/.test(text), '应导出 refreshAdminFlag');
  assert(text.includes("'/api/auth/me'"), 'refreshAdminFlag 应调用 /api/auth/me');

  const app = read('src/App.tsx');
  assert(app.includes('refreshAdminFlag'), 'App 启动时应调用 refreshAdminFlag');
});

test('服务端接口不得只靠前端藏 Tab：管理接口必须自己校验并 403', () => {
  const admin = read('api/admin/[action].ts');
  assert(admin.includes('isAdminEmail'), '管理接口必须校验管理员邮箱');
  assert(admin.includes('需要管理员权限'), '管理接口必须返回 403 文案');

  const data = read('api/data/[action].ts');
  assert(data.includes('isAdminEmail'), '数据池网关的管理员动作也应校验');
});

test('示例环境文件把 ADMIN_EMAILS 说成权威来源（避免又有人去加构建期变量）', () => {
  const text = read('.env.example');
  assert(text.includes('ADMIN_EMAILS='), '.env.example 应包含 ADMIN_EMAILS');
  assert(/ADMIN_EMAILS 是\*\*唯一权威\*\*来源/.test(text), '.env.example 应写明 ADMIN_EMAILS 是权威来源');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
