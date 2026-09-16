/**
 * 只读探针：查线上 Supabase 的迁移状态（不需要 PAT，只用 publishable/anon key）。
 * 用法：node scripts/check-db-status.mjs
 *
 * 为什么需要它：Supabase 的 PostgREST 只能读写数据、不能建表，所以「表建了没」这件事
 * 以前只能靠带 PAT 的 run-migration.mjs 才知道。这个脚本用 anon key 逐张表探一下即可：
 *   - 表不存在 → PostgREST 返回 404（PGRST205）
 *   - 表存在但 RLS 全拒 → 返回 200 + 空数组（对我们来说就是「已就绪」）
 * 只做 GET，不写任何数据，可安全反复运行。
 */
import { readFileSync, existsSync } from 'node:fs';

const EXPECTED_TABLES = [
  'projects',
  'project_members',
  'usage_events',
  'audit_events',
  'pool_cache',
  'app_config',
  'user_provider_keys',
];

function readEnvLocal() {
  if (!existsSync('.env.local')) return {};
  const out = {};
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const local = readEnvLocal();
const url = (process.env.SUPABASE_URL || local.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || local.SUPABASE_PUBLISHABLE_KEY
  || local.VITE_SUPABASE_ANON_KEY
  || '';

if (!url) {
  console.error('缺少 SUPABASE_URL（环境变量或 .env.local）。');
  process.exit(1);
}
if (!key) {
  console.error('缺少 publishable/anon key（环境变量或 .env.local 里的 SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY）。');
  process.exit(1);
}
console.log(`项目：${url.replace(/^https:\/\//, '')}`);
console.log('（只读探测，不发写请求；密钥不打印）\n');

async function probe(path) {
  const res = await fetch(`${url}${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 保留原文 */ }
  return { status: res.status, body, text };
}

const missing = [];
console.log('=== 7 张表 ===');
for (const table of EXPECTED_TABLES) {
  const r = await probe(`/rest/v1/${table}?select=*&limit=0`);
  const code = r.body && typeof r.body === 'object' && !Array.isArray(r.body) ? String(r.body.code || '') : '';
  const exists = r.status !== 404 && code !== 'PGRST205';
  console.log(`  ${exists ? '✅' : '❌'} ${table}${exists ? '' : `  （HTTP ${r.status}${code ? ' ' + code : ''}）`}`);
  if (!exists) missing.push(table);
}

console.log('\n=== 关键列：usage_events.key_source（跨设备与成本归因要用）===');
const col = await probe('/rest/v1/usage_events?select=key_source&limit=0');
const colCode = col.body && typeof col.body === 'object' && !Array.isArray(col.body) ? String(col.body.code || '') : '';
const colOk = col.status !== 404 && colCode !== 'PGRST205' && colCode !== '42703';
console.log(`  ${colOk ? '✅' : '❌'} key_source${colOk ? '' : `  （HTTP ${col.status}${colCode ? ' ' + colCode : ''}）`}`);

console.log('\n=== 结论 ===');
if (missing.length === 0 && colOk) {
  console.log('✅ 数据库已迁移到位，跨设备密钥、用量归因、后台配置中心都可以工作。');
  process.exit(0);
}
console.log(`❌ 还缺 ${missing.length} 张表${colOk ? '' : ' + key_source 列'}：${missing.join(', ') || '(列缺失)'}`);
console.log('   下一步（二选一）：');
console.log('     A. 有 Supabase Personal Access Token 时：SUPABASE_PAT=<pat> node scripts/run-migration.mjs');
console.log('     B. 或在 Supabase 控制台 → SQL Editor 里整段粘贴并运行 supabase/migrations/all_in_one.sql');
console.log('   （应用侧的体检入口：管理员账号登录后看「配置中心」的建表状态，缺表会以琥珀色提示列出）');
process.exit(1);
