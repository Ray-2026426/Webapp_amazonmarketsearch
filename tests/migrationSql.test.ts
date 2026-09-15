// M6 · 缺表自愈（PRD §15.25，接 §15.21）：把"数据库还没迁移"从一句泛泛的提示，
// 变成"缺哪张表 + 一键复制建表 SQL + 不跑也能用"的可照做流程。
//
// 三个必须钉死的东西：
//   ① 复制出去的 DDL 与我们自己跑的迁移**逐字一致**（防两边漂移）；
//   ② 表清单与 supabase/migrations/all_in_one.sql 完全一致（不多不少）；
//   ③ 权限错误绝不能被判成"缺表" —— 否则用户会一直去跑一个解决不了问题的迁移。
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  MIGRATION_TABLE_NAMES,
  MIGRATION_TABLE_DDL,
  MIGRATION_SHARED_HELPERS_SQL,
  MIGRATION_SHARED_RPC_SQL,
  SOURCE_MIGRATION_FILE,
  buildMigrationSql,
  classifyDbError,
  describeMissingTables,
  hasMigrationDdl,
  isMissingTableError,
  isPermissionError,
  missingTableName,
} from '../src/utils/migrationSql';

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

/** 迁移文件是 CRLF；常量是 LF。比对前统一成 LF。 */
const migrationFile = fs.readFileSync(SOURCE_MIGRATION_FILE, 'utf8').replace(/\r\n/g, '\n');
const declaredTables = [...migrationFile.matchAll(/create table if not exists public\.([a-z0-9_]+)/g)].map((m) => m[1]);

console.log('migration sql：DDL 与迁移文件不漂移');

test('常量里的表名与 all_in_one.sql 完全一致（不多不少）', () => {
  assert.deepEqual(
    [...MIGRATION_TABLE_NAMES].sort(),
    [...new Set(declaredTables)].sort(),
    `表清单漂移了：常量=${[...MIGRATION_TABLE_NAMES].join(',')}；迁移文件=${[...new Set(declaredTables)].join(',')}`
  );
});

test('每张表的 DDL 都是迁移文件的逐字片段（不是手抄的）', () => {
  for (const name of MIGRATION_TABLE_NAMES) {
    const ddl = MIGRATION_TABLE_DDL[name];
    assert.ok(ddl.length > 0, `${name} 没有 DDL`);
    // 一张表的 DDL 由多段原文拼成（建表 / 索引 / RLS / 策略…）：逐段、逐行都必须是原文里有的，
    // 任何一处手抄错字都会在这里失败。
    for (const piece of ddl.split('\n\n').map((s) => s.trim()).filter(Boolean)) {
      assert.ok(migrationFile.includes(piece), `${name} 的片段不是 ${SOURCE_MIGRATION_FILE} 的原文：\n${piece.slice(0, 120)}`);
    }
    for (const line of ddl.split('\n').map((s) => s.trim()).filter(Boolean)) {
      assert.ok(migrationFile.includes(line), `${name} 里有迁移文件中不存在的行（手抄/漂移）：${line}`);
    }
    const creates = ddl.match(/create table if not exists public\.([a-z0-9_]+)/g) || [];
    assert.equal(creates.length, 1, `${name} 的片段应只含 1 条建表语句，实际 ${creates.length}`);
    assert.ok(ddl.includes(`create table if not exists public.${name}`), `${name} 片段里的建表语句不是这张表`);
    assert.ok(/enable row level security/.test(ddl), `${name} 片段缺少 RLS 开启（该表的数据不该裸奔）`);
  }
});

test('共享依赖段同样是原文片段（策略引用的函数不能漏）', () => {
  for (const [label, sql] of [['RLS 帮助函数', MIGRATION_SHARED_HELPERS_SQL], ['RPC', MIGRATION_SHARED_RPC_SQL]] as const) {
    assert.ok(sql.length > 0, `${label} 为空`);
    assert.ok(migrationFile.includes(sql), `${label} 不是迁移文件的原文片段`);
    assert.ok(!/create table/i.test(sql), `${label} 里不该有建表语句`);
  }
});

console.log('migration sql：一键复制的拼装');

test('只复制缺失的那几张表（不把整份迁移塞给用户）', () => {
  const one = buildMigrationSql(['usage_events']);
  assert.deepEqual(one.tables, ['usage_events']);
  assert.ok(one.sql.includes('create table if not exists public.usage_events'));
  assert.ok(!one.sql.includes('create table if not exists public.projects'), '没缺的表不该出现在复制内容里');
  assert.ok(!one.sql.includes('public.current_project_role'), '不需要共享函数时也不该带（少即是准）');
  assert.ok(one.sql.includes('幂等'), '要写明可重复执行，用户才敢粘');
});

test('projects / project_members 自动带上策略依赖的共享函数，且顺序有依赖在前面', () => {
  const both = buildMigrationSql(['project_members', 'projects']);
  assert.deepEqual(both.tables, ['projects', 'project_members'], '顺序必须按依赖（projects 在前）');
  assert.ok(both.sql.includes('create or replace function public.current_project_role'), '策略引用的函数必须一起带上');
  assert.ok(both.sql.includes('public.push_project_if_revision'), '成员/项目 RPC 也要带');
  assert.ok(both.sql.indexOf('create table if not exists public.projects') < both.sql.indexOf('create table if not exists public.project_members'));
});

test('拼装出来的每一段都能在迁移文件里找到（整段可粘贴执行）', () => {
  const sql = buildMigrationSql([...MIGRATION_TABLE_NAMES]).sql;
  for (const chunk of sql.split('\n\n')) {
    const part = chunk.trim();
    if (!part || part.startsWith('-- Kairo')) continue; // 头部说明是本模块写的注释
    assert.ok(migrationFile.includes(part), `复制内容里有迁移文件里不存在的语句：\n${part.slice(0, 120)}…`);
  }
});

test('没有缺表 / 只有非表项（bucket）时，说清楚"不需要迁移"而不是编一张表', () => {
  assert.equal(buildMigrationSql([]).tables.length, 0);
  assert.ok(buildMigrationSql([]).note.includes('无需迁移'));
  const bucketOnly = buildMigrationSql(['project_assets']);
  assert.deepEqual(bucketOnly.tables, []);
  assert.deepEqual(bucketOnly.unknown, ['project_assets']);
  assert.ok(bucketOnly.note.includes('不是数据表'), `要解释为什么复制不了：${bucketOnly.note}`);
  assert.equal(hasMigrationDdl('project_assets'), false, 'Storage 桶没有建表语句');
  assert.equal(hasMigrationDdl('app_config'), true, 'app_config 是表，且已补进迁移');
});

console.log('migration sql：缺表 vs 权限错误（不得误判）');

test('权限错误不得被判成缺表（42501 / permission denied / RLS）', () => {
  const cases = [
    { code: '42501', message: 'permission denied for table usage_events' },
    { code: '', message: 'permission denied for schema public' },
    { code: '', message: 'new row violates row-level security policy for table "projects"' },
    { code: '', message: 'insufficient privilege' },
  ];
  for (const c of cases) {
    assert.equal(classifyDbError(c), 'permission', `应判成权限错误：${JSON.stringify(c)}`);
    assert.equal(isMissingTableError(c), false, `权限错误不得判成缺表：${JSON.stringify(c)}`);
    assert.equal(isPermissionError(c), true);
  }
});

test('缺表判定：42P01 / does not exist / schema cache', () => {
  assert.equal(classifyDbError({ code: '42P01', message: '' }), 'missing-table');
  assert.equal(classifyDbError({ code: '', message: 'relation "public.usage_events" does not exist' }), 'missing-table');
  assert.equal(classifyDbError({ code: 'PGRST205', message: "Could not find the table 'public.pool_cache' in the schema cache" }), 'missing-table');
  assert.equal(isPermissionError({ code: '42P01', message: 'relation does not exist' }), false, '缺表不是权限错误');
  assert.equal(classifyDbError(null), 'none');
  assert.equal(classifyDbError({ code: '', message: 'network timeout' }), 'error', '认不出来的就是真错误，不猜');
});

test('权限优先于缺表：报文里同时出现 "does not exist" 也仍按权限报错', () => {
  const tricky = { code: '42501', message: 'permission denied: relation "public.audit_events" does not exist for role' };
  assert.equal(classifyDbError(tricky), 'permission');
  assert.equal(isMissingTableError(tricky), false, '先判权限：否则用户会反复跑一个解决不了问题的迁移');
});

test('缺哪张表要取对：不能把 schema 名 public 当成表名', () => {
  assert.equal(missingTableName('relation "public.usage_events" does not exist'), 'usage_events');
  assert.equal(missingTableName("Could not find the table 'public.pool_cache' in the schema cache"), 'pool_cache');
  assert.equal(missingTableName('some other failure'), '');
  assert.notEqual(missingTableName('relation "public.projects" does not exist'), 'public');
});

test('缺表文案：列出具体表名 + 写明"不跑也能用"', () => {
  const text = describeMissingTables(['usage_events', 'pool_cache']);
  assert.ok(text.includes('usage_events') && text.includes('pool_cache'), '必须列出具体表名');
  assert.ok(text.includes('不跑也能用'), '必须写清不跑迁移的后果，用户才知道要不要现在处理');
  assert.ok(text.includes('SQL Editor'), '要给出可照做的路径');
});

console.log('migration sql：服务端与界面真的用上了它');

test('服务端：用统一分类器，且缺表提示带具体表名', () => {
  const api = fs.readFileSync('api/admin/[action].ts', 'utf8');
  assert.ok(api.includes('classifyDbError'), '服务端必须用可单测的分类器（缺表 / 权限 / 真错误）');
  assert.ok(api.includes('missingTableName'), '缺表提示必须给出具体表名');
  assert.ok(!/'\(\[a-z_\]\+\)'/.test(api), '不得再用会匹配到 "public" 的旧正则');
  assert.ok(api.includes('needsMigration'), '缺表仍要返回 needsMigration（界面据此显示琥珀色提示）');
  assert.ok(api.includes('app_config'), '表清单必须包含 app_config（配置中心读写的就是它）');
  assert.ok(api.includes('storage.getBucket'), 'project_assets 是桶不是表，探测方式要对应');
  assert.ok(api.includes('copyableTables'), '要告诉界面哪几张表有建表语句可复制');
  assert.ok(api.includes('needsMigration: stillMissing.length > 0'), '环境自检本身就要主动报缺表（不必等某个接口先失败）');

  // 指引必须落到具体文件名，而且这个名字不能和生成常量漂移
  const literal = /const MIGRATION_FILE = '([^']+)'/.exec(api)?.[1] ?? '';
  assert.equal(literal, SOURCE_MIGRATION_FILE, `服务端写的迁移文件名与生成常量不一致：${literal}`);
  assert.ok(fs.existsSync(literal), `指引里的迁移文件不存在：${literal}`);
  assert.ok(api.includes('${MIGRATION_FILE}'), '提示文案要真的把这个文件名插进去（用户才知道跑哪个文件）');
});

test('界面：列出具体表名 + 一键复制 + 不跑也能用（源码级）', () => {
  const panel = fs.readFileSync('src/components/AdminConsolePanel.tsx', 'utf8');
  assert.ok(panel.includes('不跑也能用'), '缺表提示必须讲清楚"不跑也能用"');
  assert.ok(panel.includes('t.name'), '必须逐张列出缺的表名（不能只给一句泛泛提示）');
  assert.ok(panel.includes('t.required'), '必须区分必建 / 可选');
  assert.ok(panel.includes('t.why'), '必须说明每张表缺失的影响');
  assert.ok(panel.includes('一键复制建表 SQL'), '必须有复制按钮');
  assert.ok(panel.includes('navigator.clipboard.writeText'), '复制要走剪贴板 API');
  assert.ok(panel.includes('buildMigrationSql'), 'SQL 必须来自 migrationSql 常量（不许手写一份）');
  assert.ok(panel.includes('SQL Editor'), '要告诉用户粘到哪里执行');
});

console.log(`\nresult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
