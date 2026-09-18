// M6 · 缺表自愈：把"数据库还没迁移"从一句泛泛的提示，变成**能直接照做**的动作。
//
// 背景（用户原话）：「数据库还没迁移（不是故障，跑一次就好）…去 Supabase → SQL Editor 执行
// supabase/migrations/all_in_one.sql」—— 上一轮特意把"缺表"从 500 改成琥珀色提示（PRD §15.21），
// 但用户要的是"能直接用"，所以本轮补三件事：
//   ① 说清楚**到底缺哪张表**、哪张必建/可选、各自影响什么（不是一句话打发）；
//   ② 一键把**缺失那几张表**的建表 SQL 复制到剪贴板（navigator.clipboard.writeText）；
//   ③ 明确告知**不跑也能用**：只是用量统计/审计/缓存持久化会缺失或退化。
//
// 本模块只做三件纯函数的事，好测也好复用：
//   · DDL 常量：来自 migrationSqlTables.ts（由 scripts/gen-migration-sql.mjs 从迁移文件逐字切出）；
//   · buildMigrationSql()：按缺失表拼装可粘贴执行的 SQL（含 RLS 依赖的共享函数）；
//   · 错误分类：缺表 vs 权限错误 vs 真错误 —— 权限问题**绝不能**被当成"该跑迁移了"。
//
// 为什么错误分类要独立出来：`isMissingTable()` 原来只看 42P01 / "does not exist" / "schema cache"，
// 而 PostgREST 的权限错误（42501 / permission denied）一旦被归到"缺表"，用户会去反复跑迁移，
// 真问题（RLS 策略或角色被改）永远暴露不出来。这里把它做成可单测的纯函数。

import {
  MIGRATION_TABLE_NAMES,
  MIGRATION_TABLE_DDL,
  MIGRATION_SHARED_HELPERS_SQL,
  MIGRATION_SHARED_RPC_SQL,
  SOURCE_MIGRATION_FILE,
  type MigrationTableName,
} from './migrationSqlTables.js';

export {
  MIGRATION_TABLE_NAMES,
  MIGRATION_TABLE_DDL,
  MIGRATION_SHARED_HELPERS_SQL,
  MIGRATION_SHARED_RPC_SQL,
  SOURCE_MIGRATION_FILE,
};
export type { MigrationTableName };

/** 需要共享 RLS 帮助函数 / RPC 的表（它们的策略里引用了 security definer 函数） */
const TABLES_NEEDING_HELPERS = new Set<string>(['projects', 'project_members']);

export function hasMigrationDdl(table: string): boolean {
  return (MIGRATION_TABLE_NAMES as readonly string[]).includes((table || '').trim());
}

/**
 * 拼装"只包含缺失表"的建表 SQL。
 *
 * 两条硬规则：
 * 1. **逐字来自迁移文件**：每段 DDL 都是 `all_in_one.sql` 的子串（tests/migrationSql.test.ts 断言），
 *    所以复制出去执行的 SQL 和我们自己跑的那份不会漂移；
 * 2. **依赖一起带上**：projects / project_members 的策略引用了 security definer 函数，
 *    只复制建表语句会留下"策略建好了但函数不存在"的半成品，因此这两张表在列时会自动附带共享函数段。
 */
export function buildMigrationSql(tables: string[]): {
  sql: string;
  tables: MigrationTableName[];
  /** 传进来但迁移文件里没有的表（例如 project_assets 是 Storage bucket，不是表） */
  unknown: string[];
  note: string;
} {
  const wanted = new Set((tables ?? []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean));
  const ordered = (MIGRATION_TABLE_NAMES as readonly MigrationTableName[]).filter((n) => wanted.has(n));
  const unknown = [...wanted].filter((t) => !hasMigrationDdl(t));
  const needsHelpers = ordered.some((n) => TABLES_NEEDING_HELPERS.has(n));

  const parts: string[] = [];
  parts.push(
    [
      `-- Kairo 缺表自愈：只包含缺失的 ${ordered.length} 张表（${ordered.join(' / ')}）`,
      `-- 语句逐字来自 ${SOURCE_MIGRATION_FILE}，全部是幂等写法（if not exists / drop policy if exists），`,
      '-- 可重复执行，不会破坏已有数据。粘进 Supabase → SQL Editor → Run 即可。',
    ].join('\n')
  );
  if (needsHelpers) parts.push(MIGRATION_SHARED_HELPERS_SQL);
  for (const name of ordered) parts.push(MIGRATION_TABLE_DDL[name]);
  if (needsHelpers) parts.push(MIGRATION_SHARED_RPC_SQL);

  const note = ordered.length === 0
    ? unknown.length > 0
      ? `没有可复制的建表语句（${unknown.join('、')} 不在 ${SOURCE_MIGRATION_FILE} 里）；这几项不是数据表，缺了也能用`
      : '没有缺失的表，无需迁移'
    : `已包含 ${ordered.length} 张表的建表语句${needsHelpers ? '（含策略依赖的共享函数）' : ''}` +
      (unknown.length > 0 ? `；${unknown.join('、')} 没有建表语句（不是数据表，可忽略）` : '');

  return { sql: parts.join('\n\n'), tables: ordered, unknown, note };
}

export type DbErrorKind = 'none' | 'missing-table' | 'permission' | 'error';

/** 权限类错误：RLS 拒绝、角色无权限（这些是**真错误**，不是"该跑迁移了"） */
const PERMISSION_CODES = new Set(['42501', '42P17', 'PGRST301']);
const PERMISSION_PATTERN = /permission denied|insufficient privilege|row-level security|not authorized|must be owner|JWT|api key/i;

/** 缺表：PostgREST 42P01 / 关系不存在 / schema cache 里找不到 */
const MISSING_CODES = new Set(['42P01', 'PGRST205']);
const MISSING_PATTERN = /does not exist|could not find the table|schema cache|undefined table/i;

export function isPermissionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  if (PERMISSION_CODES.has(code)) return true;
  return PERMISSION_PATTERN.test(String(error.message || ''));
}

/**
 * 缺表判定。**顺序很重要**：先判权限，再判缺表 ——
 * 权限错误的报错文本里也可能出现 "does not exist"（例如 "function ... does not exist"），
 * 一旦先判缺表，用户就会被指去跑一个根本解决不了问题的迁移。
 */
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  if (MISSING_CODES.has(code)) return true;
  if (isPermissionError(error)) return false;
  return MISSING_PATTERN.test(String(error.message || ''));
}

export function classifyDbError(error: { code?: string; message?: string } | null | undefined): DbErrorKind {
  if (!error) return 'none';
  if (isPermissionError(error)) return 'permission';
  if (isMissingTableError(error)) return 'missing-table';
  return 'error';
}

/**
 * 从 PostgREST 报错里取"到底缺哪张表"。
 *
 * 修一个真 bug：原实现是 `/"([a-z_]+)"/`，而报错原文是
 * `relation "public.usage_events" does not exist` —— 第一对引号里是 `public`，
 * 于是界面永远显示「缺的表：public」，用户拿不到任何有用信息（这正是"信息没展示到位"的根因之一）。
 * 这里优先取 `public.<table>`，再退回任意引号里的标识符。
 */
export function missingTableName(message: string): string {
  const text = String(message || '');
  const withSchema = /"public\.([a-z0-9_]+)"/i.exec(text)?.[1] ?? /'public\.([a-z0-9_]+)'/i.exec(text)?.[1];
  if (withSchema) return withSchema;
  const quoted = /"([a-z0-9_]+)"\s+does not exist/i.exec(text)?.[1] ?? /'([a-z0-9_]+)'\s+in the schema cache/i.exec(text)?.[1];
  if (quoted && quoted.toLowerCase() !== 'public') return quoted;
  return '';
}

/**
 * 缺表提示的统一文案（服务端与界面共用同一句话，避免两边说法不一致）。
 * 关键点：**说清"不跑也能用"**，否则用户会以为整个后台坏了。
 */
export function describeMissingTables(tables: string[]): string {
  const list = (tables ?? []).filter(Boolean);
  if (list.length === 0) return '数据库表未就绪。';
  return `缺表：${list.join('、')}。可以一键复制建表 SQL，去 Supabase → SQL Editor 粘贴执行（可重复执行，不会破坏已有数据）；不跑也能用，只是用量统计/审计/缓存持久化会缺失或退化。`;
}
