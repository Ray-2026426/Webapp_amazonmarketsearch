/**
 * 从 supabase/migrations/all_in_one.sql **逐字切出**每张表的 DDL，生成
 * src/utils/migrationSqlTables.ts。
 *
 * 为什么用"切"而不是"抄"：管理员后台要一键复制"缺失那几张表"的建表语句。
 * 手抄一次 SQL 就多一份会漂移的副本（抄错一个 policy 名，用户粘进 SQL Editor 就报错，
 * 而且我们看不到）。这里按锚点从迁移文件里 slice，生成物天然与服务端执行的那份逐字一致；
 * tests/migrationSql.test.ts 再把"表名集合一致 + 每段 SQL 都是 all_in_one.sql 的子串"钉死。
 *
 * 用法：node scripts/gen-migration-sql.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'supabase/migrations/all_in_one.sql';
const OUT = 'src/utils/migrationSqlTables.ts';

// 迁移文件是 CRLF：统一成 LF 再切，生成物与源码都用 LF（剪贴板里粘贴执行不受影响）。
// tests/migrationSql.test.ts 同样按 LF 归一化后比对，因此"逐字一致"的断言依然成立。
const text = readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');

/** 取 [startAnchor, endAnchor) 之间的原文（endAnchor 为 null 表示到文件末尾） */
function sliceBetween(startAnchor, endAnchor, label, inclusiveEnd = false) {
  const start = text.indexOf(startAnchor);
  if (start < 0) throw new Error(`找不到起点锚：${label} → ${startAnchor.slice(0, 60)}`);
  let end = text.length;
  if (endAnchor) {
    end = text.indexOf(endAnchor, start);
    if (end < 0) throw new Error(`找不到终点锚：${label} → ${endAnchor.slice(0, 60)}`);
    if (inclusiveEnd) end += endAnchor.length;
  }
  return text.slice(start, end).replace(/\s+$/, '');
}

/** 每张表一段；顺序即复制到 SQL Editor 时的执行顺序（有外键依赖的在前） */
const TABLES = [
  {
    name: 'projects',
    chunks: [
      ['create table if not exists public.projects (', '-- ========== 002_project_members ==========', 'projects/建表+索引+RLS+001 策略'],
      ['alter table public.projects\n  add column if not exists owner_id', 'create table if not exists public.project_members', 'projects/owner_id 列'],
      // 起点用连续两行定位：单行 "drop policy if exists \"projects_select_own\"" 在 001 段也出现过
      [
        'drop policy if exists "projects_select_own" on public.projects;\ndrop policy if exists "projects_insert_own" on public.projects;',
        'drop policy if exists "project_members_select_member" on public.project_members;',
        'projects/成员可读写的最终策略',
      ],
      ['alter table public.projects\n  add column if not exists revision bigint', 'create or replace function public.find_user_id_by_email', 'projects/revision 列'],
    ],
  },
  {
    name: 'project_members',
    chunks: [
      ['create table if not exists public.project_members (', 'alter table public.project_members enable row level security;', 'project_members/建表+回填'],
      ['alter table public.project_members enable row level security;', 'create or replace function public.current_project_role', 'project_members/RLS'],
      ['drop policy if exists "project_members_select_member" on public.project_members;', '-- ========== 003_owner_upsert_bootstrap ==========', 'project_members/策略'],
    ],
  },
  {
    name: 'usage_events',
    chunks: [['create table if not exists public.usage_events (', 'create table if not exists public.audit_events (', 'usage_events/建表+索引+RLS']],
  },
  {
    name: 'audit_events',
    chunks: [['create table if not exists public.audit_events (', '-- ============================================================\n-- 009 · pool_cache', 'audit_events/建表+索引+RLS']],
  },
  {
    name: 'pool_cache',
    chunks: [['create table if not exists public.pool_cache (', '-- ============================================================\n-- 010 · app_config', 'pool_cache/建表+索引+RLS']],
  },
  {
    name: 'app_config',
    chunks: [['create table if not exists public.app_config (', null, 'app_config/建表+RLS']],
  },
];

/** 共享依赖（策略里用到的 security definer 函数与授权）——projects/project_members 缺一不可 */
const SHARED = [
  {
    constName: 'MIGRATION_SHARED_HELPERS_SQL',
    chunk: sliceBetween(
      'create or replace function public.current_project_role(project_id text)',
      'grant execute on function public.is_project_owner_column(text) to anon, authenticated;',
      '共享 RLS 帮助函数',
      true
    ),
  },
  {
    constName: 'MIGRATION_SHARED_RPC_SQL',
    chunk: sliceBetween(
      'create or replace function public.find_user_id_by_email(target_email text)',
      '-- ========== 007_project_assets ==========',
      '共享 RPC 与授权'
    ),
  },
];

for (const s of SHARED) {
  if (/create table/i.test(s.chunk)) throw new Error(`${s.constName} 里混进了 create table，锚点切错了`);
  if (!s.chunk.includes('grant execute on function')) throw new Error(`${s.constName} 缺少授权语句`);
}

/** 每个表段必须正好含 1 条 create table（防锚点漂移后切错东西） */
for (const t of TABLES) {
  const joined = t.chunks.map(([a, b, label]) => sliceBetween(a, b, label)).join('\n\n');
  const n = (joined.match(/create table/gi) || []).length;
  if (n !== 1) throw new Error(`${t.name} 的 DDL 里 create table 出现 ${n} 次（应为 1 次）`);
  if (!joined.includes(`public.${t.name} `) && !joined.includes(`public.${t.name}(`)) {
    throw new Error(`${t.name} 的 DDL 段里没提到这张表，锚点可能漂移了`);
  }
  t.sql = joined;
}

/** 生成物里的 create table 名字必须与迁移文件解析结果完全一致 */
const declared = [...text.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
const generated = TABLES.map((t) => t.name);
const missing = declared.filter((n) => !generated.includes(n));
const extra = generated.filter((n) => !declared.includes(n));
if (missing.length || extra.length) {
  throw new Error(`表清单与 ${SOURCE} 不一致：缺 ${missing.join(',') || '无'}；多 ${extra.join(',') || '无'}`);
}

const escape = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const tpl = (s) => '`' + escape(s) + '`';

const out = `// ⚠️ 本文件由 scripts/gen-migration-sql.mjs 从 ${SOURCE} **逐字切出**，请勿手改。
// 要改 SQL：改那份迁移文件，然后 node scripts/gen-migration-sql.mjs 重新生成。
// tests/migrationSql.test.ts 会断言：这里的表名集合与迁移文件一致，且每段 SQL 都是它的子串。

/** 权威来源（管理员后台会把它显示给用户） */
export const SOURCE_MIGRATION_FILE = '${SOURCE}';

/** 表名（复制 SQL 时的执行顺序：被引用的表在前） */
export const MIGRATION_TABLE_NAMES = [${generated.map((n) => `'${n}'`).join(', ')}] as const;

export type MigrationTableName = (typeof MIGRATION_TABLE_NAMES)[number];

/** 共享依赖：RLS 策略里用到的 security definer 函数与授权（projects / project_members 必需） */
export const MIGRATION_SHARED_HELPERS_SQL = ${tpl(SHARED[0].chunk)};

/** 共享依赖：成员查询与乐观并发推送 RPC（同一批函数的后半段） */
export const MIGRATION_SHARED_RPC_SQL = ${tpl(SHARED[1].chunk)};

/** 每张表的建表语句（含索引 / RLS / 策略；逐字来自迁移文件） */
export const MIGRATION_TABLE_DDL: Record<MigrationTableName, string> = {
${TABLES.map((t) => `  ${t.name}: ${tpl(t.sql)},`).join('\n')}
};
`;

writeFileSync(OUT, out, 'utf8');
console.log(`已生成 ${OUT}：${generated.length} 张表（${generated.join(', ')}）`);
