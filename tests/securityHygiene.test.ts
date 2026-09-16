/**
 * 上生产前的安全守卫（这两个都是本轮真实踩到的坑，不是假想）：
 *
 * 1. **密钥明文进仓库**：`docs/admin-and-keys-setup.md` 曾把 SellerSprite / 西柚洞察的**真实密钥**
 *    写着明文提交进 git，而远端仓库可匿名读取 → 等于公开泄露。这里加常驻扫描防复发。
 * 2. **任何人都能注册**：数据池密钥在服务端，任何能注册的人都能**用**这些密钥抓数据（花账号主人的钱）。
 *    注册接口此前没有任何邀请码校验。这里锁死"必须过邀请码闸门，且线上缺配置时 fail closed"。
 *
 * 扫描口径：只查"高熵"串（长度≥20、无空格、非中文、非邮箱/URL），避免把 provider 名、示例域名
 * 这类正常文本误判成密钥。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

/** 取 git 跟踪的文件列表；没有 git 就退化为扫描 src/docs/api/tests */
function trackedFiles(): string[] {
  const candidates = [
    'C:\\Users\\A\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\git\\cmd\\git.exe',
    'git',
  ];
  for (const bin of candidates) {
    try {
      return execFileSync(bin, ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    } catch {
      /* 试下一个 */
    }
  }
  return [];
}

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|md|html|json|sql|yml|yaml|txt|example)$/i;

/**
 * 是不是"像密钥"的串。
 *
 * 这个判据被反复收紧过：第一版太松，把 URL、文件路径、文档引用、商品图片链接、
 * 甚至函数名 `salesVelocityForAsin(p.asin)` 全判成了密钥（546 处假阳性）。
 * 现在的口径：**只认凭证形态** —— 要么带已知密钥前缀，要么是"大小写+数字混合的长串且不含
 * 路径/URL 分隔符"。文件路径含 `/` `.`、URL 含 `://`、git 哈希全小写、函数名含 `(`，都会被排除。
 */
function looksLikeSecret(s: string): boolean {
  if (s.length < 20 || s.length > 400) return false;
  if (/\s/.test(s)) return false;
  // 已知密钥前缀：直接认定
  if (/^(sk-|sk-ant-|mcp_|AIza|github_pat_|eyJ|sb_secret_|secret_|Bearer)/.test(s)) return true;
  // 通用判据：纯 [A-Za-z0-9_-]，且大小写与数字混合
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return false;
  if (s.length < 24) return false;
  const hasUpper = /[A-Z]/.test(s);
  const hasLower = /[a-z]/.test(s);
  const hasDigit = /[0-9]/.test(s);
  return hasUpper && hasLower && hasDigit;
}

/** 该行明显是普通文本（URL / 路径 / 文档引用 / Git 命令）时整行跳过，进一步压假阳性 */
function isBenignLine(line: string): boolean {
  if (/https?:\/\//.test(line)) return true;
  if (/\bgit (clone|remote|push|pull)\b/.test(line)) return true;
  if (/\.(md|html|ts|tsx|json|sql|png|jpg|jpeg|svg|mp4)\b/.test(line)) return true;
  if (/resolved"\s*:/.test(line)) return true; // package-lock
  return false;
}

console.log('安全守卫：仓库里不得出现密钥明文');

test('跟踪的文本文件里没有高熵密钥串（排除占位符/示例）', () => {
  const files = trackedFiles();
  assert(files.length > 50, `git 文件列表异常（${files.length} 个），守卫无法生效`);
  const offenders: string[] = [];
  for (const f of files) {
    if (!TEXT_EXT.test(f) || !existsSync(f) || statSync(f).size > 2_000_000) continue;
    let text = '';
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    // 逐行看，且跳过明显是普通文本/占位/示例的行
    text.split(/\r?\n/).forEach((line, i) => {
      if (/已移除|占位|placeholder|example|<your|YOUR_|xxxx|\*\*\*|…/.test(line)) return;
      if (isBenignLine(line)) return;
      // 只看赋值/表格里的值片段（`KEY` | `value` 或 KEY=value 或 "key": "value"）
      for (const m of line.matchAll(/(?:=|:\s*|`)([A-Za-z0-9_\-+/.=]{20,})/g)) {
        if (looksLikeSecret(m[1])) offenders.push(`${f}:${i + 1}`);
      }
    });
  }
  const unique = [...new Set(offenders)];
  assert(unique.length === 0, `疑似密钥明文（需人工确认并轮换）：\n       ${unique.slice(0, 12).join('\n       ')}`);
});

test('曾泄露的那份文档已改成占位符，且明确要求填自己的 Key', () => {
  const doc = 'docs/admin-and-keys-setup.md';
  if (!existsSync(doc)) return; // 文档被删掉也算安全
  const text = read(doc);
  assert(/已移除|请填你自己的|占位/.test(text), '文档里必须明确写"已移除/请填你自己的"');
  assert(!/VITE_DEFAULT_SELLERSPRITE_SECRET_KEY`\s*\|\s*`[A-Za-z0-9]{20,}/.test(text), '不得再出现真实值的表格');
});

test('.env.local 必须被 git 忽略', () => {
  const ig = read('.gitignore');
  assert(/^\.env\.local\s*$/m.test(ig), '.gitignore 必须包含 .env.local');
});

test('示例环境文件里不能有真实密钥（只能是空值或占位）', () => {
  const text = read('.env.example');
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_0-9]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const value = m[2].trim();
    if (!value) continue;
    assert(!looksLikeSecret(value), `.env.example 的 ${m[1]} 像真实密钥，应留空或写占位`);
  }
});

console.log('安全守卫：注册必须有邀请码闸门（否则陌生人能用你的数据池密钥）');

test('注册接口实现邀请码闸门，且线上缺配置时 fail closed', () => {
  const src = read('api/auth/[action].ts');
  assert(src.includes('SIGNUP_INVITE_CODE'), '必须读 SIGNUP_INVITE_CODE');
  assert(src.includes('inviteGate'), '必须有统一的闸门函数');
  assert(/VERCEL_ENV === 'production'/.test(src), '线上未配置时必须 fail closed');
  assert(/邀请码不正确/.test(src), '拒绝时要给出中文原因');
  // 闸门必须在真正创建用户之前
  const gateIdx = src.indexOf('inviteGate(body.inviteCode)');
  const createIdx = src.indexOf('auth.admin.createUser');
  assert(gateIdx > 0 && createIdx > gateIdx, '闸门必须在建用户之前执行');
});

test('前端注册会带上邀请码，且界面上有邀请码输入框', () => {
  const auth = read('src/utils/auth.ts');
  assert(/register\(account: string, password: string, inviteCode\?: string\)/.test(auth), 'register 必须接收邀请码');
  assert(/inviteCode: inviteCode \?\? ''/.test(auth), '必须把邀请码发给服务端');
  const page = read('src/components/LoginPage.tsx');
  assert(page.includes('邀请码'), '登录页必须有邀请码输入框');
  assert(/register\(email, password, inviteCode\)/.test(page), '提交时要把邀请码传下去');
});

test('自检接口会报告"是否配了邀请码"（管理员能一眼看出线上注册开没开）', () => {
  const shared = read('api/auth/_shared.ts');
  assert(shared.includes('signupInviteConfigured'), '云配置自检必须包含该项');
  assert(/线上注册已关闭/.test(shared), '未配置时要在 warnings 里说清楚后果');
});

console.log('安全守卫：数据库迁移状态可自检（不靠猜）');

test('管理员自检逐表探测，并给出"要不要迁移"的结论与补法', () => {
  const api = read('api/admin/[action].ts');
  assert(api.includes('EXPECTED_TABLES'), '必须维护期望表清单');
  for (const t of ['projects', 'project_members', 'project_assets', 'usage_events', 'audit_events', 'pool_cache']) {
    assert(api.includes(`name: '${t}'`), `期望表清单缺少 ${t}`);
  }
  assert(api.includes('all_in_one.sql'), '必须告诉用户跑哪个文件');
  assert(/无需迁移/.test(api), '齐了要明说"无需迁移"');
  assert(/missingRequired/.test(api), '必须区分必建表与可选表');

  const panel = read('src/components/AdminConsolePanel.tsx');
  assert(panel.includes('数据库表'), '管理员后台必须显示表状态');
  assert(panel.includes('要不要跑迁移'), '标题要说人话');
});

test('数据库自检不得回显任何表内数据（只回状态）', () => {
  const api = read('api/admin/[action].ts');
  assert(/head: true/.test(api), '探测应该用 head:true，不取任何行');
  assert(!/return json\(res, 200, \{[\s\S]*rows/.test(api.split('async function tableStatus')[1]?.split('async function health')[0] ?? ''), '表自检不得返回行数据');
});

console.log('安全守卫：碰密钥的脚本必须只读、不落盘、不回显');

test('check-db-status.mjs 是只读探针，且不打印密钥、不写文件', () => {
  const src = read('scripts/check-db-status.mjs');
  assert(!/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src), '探针不得发任何写请求');
  assert(!/writeFileSync|appendFileSync/.test(src), '探针不得写文件');
  assert(!/console\.log\([^)]*\$\{key\}/i.test(src), '不得把密钥的值打印到 stdout');
  assert(src.includes('PGRST205'), '必须用 PGRST205 区分"表不存在"与"表存在但 RLS 全拒"');
  for (const t of ['projects', 'usage_events', 'app_config', 'user_provider_keys']) {
    assert(src.includes(`'${t}'`), `探针的表清单缺少 ${t}`);
  }
  assert(/key_source/.test(src), '必须覆盖跨设备要用的 key_source 列');
});

test('run-migration.mjs 的 PAT 只从环境变量读，不写盘、不打印', () => {
  const src = read('scripts/run-migration.mjs');
  assert(/process\.env\.SUPABASE_PAT/.test(src), 'PAT 必须只从环境变量读');
  assert(!/writeFileSync|appendFileSync/.test(src), '不得把 PAT 写盘');
  assert(!/console\.(log|error)\([^)]*\$\{PAT\}/.test(src), '不得把 PAT 的值打印出来（打印变量名可以）');
  assert(/Authorization: `Bearer \$\{PAT\}`/.test(src), 'PAT 只应出现在请求头里');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
