/**
 * 用 Supabase Management API 执行仓库里的迁移 SQL，并逐表验证。
 * 用法：SUPABASE_PAT=<你的 PAT> node scripts/run-migration.mjs
 * 安全：token 只从环境变量读，不写盘、不打印；脚本只执行 all_in_one.sql 这一个文件的内容。
 */
import { readFileSync, existsSync } from 'node:fs';

const PAT = String(process.env.SUPABASE_PAT || '').trim();

/** 项目 ref：优先环境变量，其次从 .env.local 的 SUPABASE_URL 推断（不硬编码，换项目也不用改脚本） */
function projectRef() {
  const fromEnv = String(process.env.SUPABASE_PROJECT_REF || '').trim();
  if (fromEnv) return fromEnv;
  const url = String(process.env.SUPABASE_URL || '').trim()
    || (existsSync('.env.local')
      ? (/^SUPABASE_URL=(.*)$/m.exec(readFileSync('.env.local', 'utf8'))?.[1] ?? '').trim()
      : '');
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url);
  return m ? m[1] : '';
}

const REF = projectRef();
if (!PAT) {
  console.error('缺少 SUPABASE_PAT 环境变量。');
  console.error('用法：SUPABASE_PAT=<你的 Supabase Personal Access Token> node scripts/run-migration.mjs');
  console.error('生成地址：https://supabase.com/dashboard/account/tokens （用完请立刻撤销）');
  process.exit(1);
}
if (!REF) {
  console.error('拿不到项目 ref：请设置 SUPABASE_URL 或 SUPABASE_PROJECT_REF。');
  process.exit(1);
}
console.log(`项目 ref：${REF}`);

const SQL = readFileSync('supabase/migrations/all_in_one.sql', 'utf8');
console.log(`待执行 SQL：${SQL.length} 字符 / ${SQL.split(/\r?\n/).length} 行`);

async function runQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON 时留原文 */ }
  return { status: res.status, ok: res.ok, body: parsed ?? text };
}

console.log('\n=== 执行迁移 ===');
const migrated = await runQuery(SQL);
if (!migrated.ok) {
  console.error('❌ 执行失败：HTTP', migrated.status);
  console.error(typeof migrated.body === 'string' ? migrated.body.slice(0, 800) : JSON.stringify(migrated.body).slice(0, 800));
  process.exit(1);
}
console.log('✅ 执行成功（HTTP', migrated.status + '）');

console.log('\n=== 逐表验证 ===');
const check = await runQuery(`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('projects','project_members','usage_events','audit_events',
                       'pool_cache','app_config','user_provider_keys')
  order by table_name;
`);
if (!check.ok) {
  console.error('❌ 验证查询失败：HTTP', check.status, JSON.stringify(check.body).slice(0, 400));
  process.exit(1);
}
const rows = Array.isArray(check.body) ? check.body : [];
const found = rows.map((r) => r.table_name);
const EXPECTED = ['app_config', 'audit_events', 'pool_cache', 'project_members', 'projects', 'usage_events', 'user_provider_keys'];
for (const t of EXPECTED) console.log(`  ${found.includes(t) ? '✅' : '❌'} ${t}`);
console.log(`\n共 ${found.length}/7 张表就绪`);

console.log('\n=== RLS 是否都开着（应该全为 true）===');
const rls = await runQuery(`
  select relname as table_name, relrowsecurity as rls_on
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in ('projects','project_members','usage_events','audit_events',
                    'pool_cache','app_config','user_provider_keys')
  order by relname;
`);
if (rls.ok && Array.isArray(rls.body)) {
  for (const r of rls.body) console.log(`  ${r.rls_on ? '✅' : '❌'} ${r.table_name} RLS=${r.rls_on}`);
} else {
  console.log('  （RLS 查询未返回结果，可忽略）');
}

console.log('\n=== key_source 列（跨设备/成本归因要用）===');
const col = await runQuery(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'usage_events' and column_name = 'key_source';
`);
console.log(Array.isArray(col.body) && col.body.length > 0 ? '  ✅ usage_events.key_source 已存在' : '  ❌ 缺 usage_events.key_source');

console.log('\n完成。');
