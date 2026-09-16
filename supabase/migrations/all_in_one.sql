-- 全量迁移（合并 supabase/migrations/001-011）
-- 在 Supabase 网页 SQL Editor 里「一次全选粘贴 → Run」即可。
-- 所有语句都是幂等写法（if not exists / drop policy if exists / create or replace），重复执行也安全。
--
-- 2026-09 追加 010 · app_config：管理员后台「配置中心」与数据池密钥解析（api/data 的 resolveProviderSecret）
-- 读写的就是这张表，但 001-009 里从来没有建过它 —— 于是"跑完迁移配置中心还是坏的"。
-- 这不是新功能，是把已经写进代码的表补进迁移，缺表自愈才真的能自愈。
--
-- 2026-09 追加 011 · user_provider_keys：用户自带 Key（BYO Key）改成**跟着账号走**。
-- 原先用户 Key 只存浏览器 localStorage，换设备登录同一账号就丢；现在密钥的唯一真相是这张表，
-- 网关按 JWT 里的 userId 读写（keyList / keySet / keyClear），前端永远拿不到明文，只拿指纹。

-- ========== 001_projects ==========
create table if not exists public.projects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_updated_idx
  on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
  on public.projects for select
  using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
  on public.projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
  on public.projects for delete
  using (auth.uid() = user_id);

-- ========== 002_project_members ==========
alter table public.projects
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

update public.projects
  set owner_id = user_id
  where owner_id is null;

alter table public.projects
  alter column owner_id set not null;

create table if not exists public.project_members (
  project_id text not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

insert into public.project_members (project_id, user_id, role)
select id, owner_id, 'owner'
from public.projects
on conflict (project_id, user_id) do update
  set role = excluded.role;

alter table public.project_members enable row level security;

create or replace function public.current_project_role(project_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pm.role
  from public.project_members pm
  where pm.project_id = $1
    and pm.user_id = auth.uid()
  limit 1
$$;

create or replace function public.can_read_project(project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_project_role($1) in ('owner', 'editor', 'viewer')
$$;

create or replace function public.can_write_project(project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_project_role($1) in ('owner', 'editor')
$$;

create or replace function public.can_own_project(project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_project_role($1) = 'owner'
$$;

create or replace function public.is_project_owner_column(project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = $1
      and p.owner_id = auth.uid()
  )
$$;

grant execute on function public.current_project_role(text) to anon, authenticated;
grant execute on function public.can_read_project(text) to anon, authenticated;
grant execute on function public.can_write_project(text) to anon, authenticated;
grant execute on function public.can_own_project(text) to anon, authenticated;
grant execute on function public.is_project_owner_column(text) to anon, authenticated;

drop policy if exists "projects_select_own" on public.projects;
drop policy if exists "projects_insert_own" on public.projects;
drop policy if exists "projects_update_own" on public.projects;
drop policy if exists "projects_delete_own" on public.projects;
drop policy if exists "projects_select_member" on public.projects;
drop policy if exists "projects_insert_owner" on public.projects;
drop policy if exists "projects_update_editor" on public.projects;
drop policy if exists "projects_delete_owner" on public.projects;

create policy "projects_select_member"
  on public.projects for select
  using (public.can_read_project(id) or owner_id = auth.uid());

create policy "projects_insert_owner"
  on public.projects for insert
  with check (auth.uid() = owner_id and auth.uid() = user_id);

create policy "projects_update_editor"
  on public.projects for update
  using (public.can_write_project(id) or owner_id = auth.uid())
  with check (public.can_write_project(id) or owner_id = auth.uid());

create policy "projects_delete_owner"
  on public.projects for delete
  using (public.can_own_project(id));

drop policy if exists "project_members_select_member" on public.project_members;
drop policy if exists "project_members_insert_owner" on public.project_members;
drop policy if exists "project_members_update_owner" on public.project_members;
drop policy if exists "project_members_delete_owner" on public.project_members;

create policy "project_members_select_member"
  on public.project_members for select
  using (public.can_read_project(project_id) or public.is_project_owner_column(project_id));

create policy "project_members_insert_owner"
  on public.project_members for insert
  with check (
    (role = 'owner' and user_id = auth.uid() and public.is_project_owner_column(project_id))
    or public.can_own_project(project_id)
  );

create policy "project_members_update_owner"
  on public.project_members for update
  using (public.can_own_project(project_id) or public.is_project_owner_column(project_id))
  with check (public.can_own_project(project_id) or public.is_project_owner_column(project_id));

create policy "project_members_delete_owner"
  on public.project_members for delete
  using (public.can_own_project(project_id) or public.is_project_owner_column(project_id));

-- ========== 003_owner_upsert_bootstrap ==========
drop policy if exists "projects_select_member" on public.projects;
drop policy if exists "projects_update_editor" on public.projects;

create policy "projects_select_member"
  on public.projects for select
  using (public.can_read_project(id) or owner_id = auth.uid());

create policy "projects_update_editor"
  on public.projects for update
  using (public.can_write_project(id) or owner_id = auth.uid())
  with check (public.can_write_project(id) or owner_id = auth.uid());

-- ========== 004_owner_select_bootstrap ==========
drop policy if exists "projects_select_member" on public.projects;

create policy "projects_select_member"
  on public.projects for select
  using (public.can_read_project(id) or owner_id = auth.uid());

-- ========== 005_member_owner_bootstrap ==========
drop policy if exists "project_members_select_member" on public.project_members;
drop policy if exists "project_members_insert_owner" on public.project_members;
drop policy if exists "project_members_update_owner" on public.project_members;
drop policy if exists "project_members_delete_owner" on public.project_members;

create policy "project_members_select_member"
  on public.project_members for select
  using (public.can_read_project(project_id) or public.is_project_owner_column(project_id));

create policy "project_members_insert_owner"
  on public.project_members for insert
  with check (
    (role = 'owner' and user_id = auth.uid() and public.is_project_owner_column(project_id))
    or public.can_own_project(project_id)
  );

create policy "project_members_update_owner"
  on public.project_members for update
  using (public.can_own_project(project_id) or public.is_project_owner_column(project_id))
  with check (public.can_own_project(project_id) or public.is_project_owner_column(project_id));

create policy "project_members_delete_owner"
  on public.project_members for delete
  using (public.can_own_project(project_id) or public.is_project_owner_column(project_id));

-- ========== 006_project_members_rpc ==========
alter table public.projects
  add column if not exists revision bigint not null default 1;

create or replace function public.find_user_id_by_email(target_email text)
returns uuid
language sql
stable
security definer
set search_path = auth, public
as $$
  select id
  from auth.users
  where lower(email) = lower(target_email)
    and auth.uid() is not null
  limit 1;
$$;

revoke all on function public.find_user_id_by_email(text) from public, anon;
grant execute on function public.find_user_id_by_email(text) to authenticated;

create or replace function public.project_members_with_info(p_project_id text)
returns table (
  user_id uuid,
  role text,
  email text,
  account text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = auth, public
as $$
  select
    pm.user_id,
    pm.role,
    u.email,
    (u.raw_user_meta_data ->> 'account')::text as account,
    pm.created_at
  from public.project_members pm
  left join auth.users u on u.id = pm.user_id
  where pm.project_id = p_project_id
    and public.can_read_project(p_project_id)
  order by
    case pm.role when 'owner' then 0 when 'editor' then 1 else 2 end,
    pm.created_at asc;
$$;

revoke all on function public.project_members_with_info(text) from public, anon;
grant execute on function public.project_members_with_info(text) to authenticated;

create or replace function public.push_project_if_revision(
  p_id text,
  p_expected_revision bigint,
  p_user_id uuid,
  p_data jsonb,
  p_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.projects%rowtype;
  v_role text;
begin
  select * into v_current from public.projects where id = p_id for update;
  if not found then
    insert into public.projects (id, user_id, owner_id, data, updated_at, revision)
    values (p_id, p_user_id, p_user_id, p_data, p_updated_at, 1);
    insert into public.project_members (project_id, user_id, role)
    values (p_id, p_user_id, 'owner')
    on conflict (project_id, user_id) do update set role = excluded.role;
    return jsonb_build_object('ok', true, 'revision', 1);
  end if;

  select pm.role into v_role
  from public.project_members pm
  where pm.project_id = p_id and pm.user_id = p_user_id
  limit 1;
  if v_role is null then
    if v_current.owner_id = p_user_id then
      v_role := 'owner';
    else
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  end if;
  if v_role not in ('owner', 'editor') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_current.revision <> p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'current', v_current.data,
      'revision', v_current.revision
    );
  end if;

  update public.projects
  set data = p_data, updated_at = p_updated_at, revision = v_current.revision + 1
  where id = p_id;
  return jsonb_build_object('ok', true, 'revision', v_current.revision + 1);
end;
$$;

revoke all on function public.push_project_if_revision(text, bigint, uuid, jsonb, timestamptz) from public;
grant execute on function public.push_project_if_revision(text, bigint, uuid, jsonb, timestamptz) to service_role;

-- ========== 007_project_assets ==========
insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', false)
on conflict (id) do nothing;

create or replace function public.asset_project_id(path text)
returns text
language sql
immutable
set search_path = public
as $$
  select split_part(coalesce($1, ''), '/', 1)
$$;

create or replace function public.can_read_asset(bucket text, path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    bucket = 'project-assets'
    and public.current_project_role(public.asset_project_id(path)) in ('owner', 'editor', 'viewer')
$$;

create or replace function public.can_write_asset(bucket text, path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    bucket = 'project-assets'
    and public.current_project_role(public.asset_project_id(path)) in ('owner', 'editor')
$$;

create or replace function public.can_delete_asset(bucket text, path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    bucket = 'project-assets'
    and public.current_project_role(public.asset_project_id(path)) = 'owner'
$$;

grant execute on function public.asset_project_id(text) to anon, authenticated;
grant execute on function public.can_read_asset(text, text) to anon, authenticated;
grant execute on function public.can_write_asset(text, text) to anon, authenticated;
grant execute on function public.can_delete_asset(text, text) to anon, authenticated;

drop policy if exists "assets_select_member" on storage.objects;
create policy "assets_select_member"
  on storage.objects for select
  using (public.can_read_asset(bucket_id, name));

drop policy if exists "assets_insert_editor" on storage.objects;
create policy "assets_insert_editor"
  on storage.objects for insert
  with check (public.can_write_asset(bucket_id, name));

drop policy if exists "assets_update_editor" on storage.objects;
create policy "assets_update_editor"
  on storage.objects for update
  using (public.can_write_asset(bucket_id, name))
  with check (public.can_write_asset(bucket_id, name));

drop policy if exists "assets_delete_owner" on storage.objects;
create policy "assets_delete_owner"
  on storage.objects for delete
  using (public.can_delete_asset(bucket_id, name));


-- ============================================================
-- 008 · usage_events / audit_events（M5 数据池记账与审计）
-- ============================================================
-- M5 · 用量记账表（PRD §11.2 用量记账 / §11.4 用量统计）
--
-- 记账口径：workspace × 工具 × 次数；缓存命中仍然记账（cache_hit=true）但成本为 0，
-- 这样既能算钱，也能回答"缓存省了多少次外部调用"。
-- 成本不落库（用 cost_table 在查询时估算），因为单价会变；落库的是可复算的事实（次数/token）。

create table if not exists public.usage_events (
  id                text primary key,
  workspace_id      text not null default 'default',
  user_id           text not null,
  project_id        text,
  tool              text not null,                -- market/keywords/reviews/competitor_listing/traffic/ai/other
  provider          text not null default '',     -- sellersprite/xydc/deepseek/...
  ok                boolean not null default true,
  cache_hit         boolean not null default false,
  calls             integer not null default 0,   -- 外部接口调用次数
  input_tokens      integer,
  output_tokens     integer,
  duration_ms       integer,
  error             text,
  created_at        timestamptz not null default now()
);

-- 管理员按"月/用户/工具/项目"聚合，这条索引覆盖最常见的三种查询
create index if not exists usage_events_created_at_idx on public.usage_events (created_at desc);
create index if not exists usage_events_user_created_idx on public.usage_events (user_id, created_at desc);
create index if not exists usage_events_project_created_idx on public.usage_events (project_id, created_at desc);
create index if not exists usage_events_tool_created_idx on public.usage_events (tool, created_at desc);

-- 仅服务端（service_role）可读写：前端不直连这张表，一律走 /api/admin/*
alter table public.usage_events enable row level security;

drop policy if exists usage_events_service_only on public.usage_events;
create policy usage_events_service_only on public.usage_events
  for all
  using (false)
  with check (false);
-- 说明：service_role 绕过 RLS，因此策略写成"全部拒绝"即可；
-- 普通 JWT 与 anon 一律读不到（这比"允许用户读自己的"更安全，用量只给管理员看）。

-- 2026-09 追加 · key_source（自带密钥归因）
-- 为什么加这一列：用户决策变更后（PRD §15.26），平台 Key 与**用户自带 Key** 都能用，
-- 记账必须能分开（"这个月平台付了多少、用户自带 Key 跑了多少次"）。这一列只记
-- 'user' | 'platform' | 'none' 三个字面量 —— **绝不记录 Key 本身**。
-- 幂等写法：已经跑过 008 的库，再整体执行一次 all_in_one.sql 就会补上这一列。
alter table public.usage_events
  add column if not exists key_source text not null default 'platform';

-- 管理员后台「用量统计」按 Key 来源分账要走这条索引
create index if not exists usage_events_key_source_idx on public.usage_events (key_source);

-- 审计日志（§11.4 审计日志：登录/取数/报告生成/机会决策等关键操作留痕）
create table if not exists public.audit_events (
  id            text primary key,
  actor_user_id text not null,
  actor_email   text,
  action        text not null,          -- login/fetch/report/decision/admin_config/...
  target        text,                   -- 动作对象（项目 id / 用户 id / 配置项）
  detail        jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_events_created_at_idx on public.audit_events (created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events (actor_user_id, created_at desc);
create index if not exists audit_events_action_idx on public.audit_events (action, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists audit_events_service_only on public.audit_events;
create policy audit_events_service_only on public.audit_events
  for all
  using (false)
  with check (false);


-- ============================================================
-- 009 · pool_cache（M5 数据池持久化缓存）
-- ============================================================
-- M5 · 数据池持久化缓存表（PRD §11.2「请求缓存（词/ASIN/评论按 TTL 缓存，降本）」）
--
-- 为什么必须落库：网关（api/data/[action].ts）原先只有"进程内 Map"这一层缓存，而 Serverless 实例随时会被回收，
-- 冷启动后缓存全部丢失 → 同一个 ASIN / 同一批关键词被反复向外部 MCP 付费取数，且"到底省了多少次调用"无从度量。
-- 这张表让缓存跨请求、跨实例、跨部署存活；hits 落库后，命中率与降本效果可以在管理后台按类型统计。
--
-- 口径要点：
-- - key 由 buildCacheKey() 生成（v1 前缀 + 参数归一化），因此天然去重，且口径变化时可整体失效；
-- - value 存 jsonb 原始响应；只写**成功**结果（失败不缓存，避免把错误缓存起来挡住重试）；
-- - expires_at 由 TTL 分档（DEFAULT_TTL_SECONDS）算出，过期判断与内存缓存共用 isFresh() 同一套规则；
-- - 过期清理由网关按 expires_at <= now 删除（见 src/utils/poolCacheStore.ts 的 prunePlan），
--   不引入数据库定时任务，少一个运维件。

create table if not exists public.pool_cache (
  key         text primary key,                 -- buildCacheKey() 生成的缓存键（v1:<type>:<归一化参数>）
  type        text not null,                    -- keywords/asin_detail/reviews/listing/traffic/market/other
  value       jsonb not null,                   -- 外部响应原文（jsonb 便于查询与压缩）
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,             -- 过期时间；<= now 即可清理
  hits        integer not null default 0        -- 命中次数（每次命中 +1，用于算"省了多少次外部调用"）
);

-- 清理任务只按过期时间扫描，单独建索引避免全表扫
create index if not exists pool_cache_expires_at_idx on public.pool_cache (expires_at);
-- 管理后台/排查时按类型统计与抽样
create index if not exists pool_cache_type_idx on public.pool_cache (type);

-- 仅服务端（service_role）可读写：前端不直连这张表，一律走 /api/data/*（缓存内容付费取回，等效于数据池额度）
alter table public.pool_cache enable row level security;

drop policy if exists pool_cache_service_only on public.pool_cache;
create policy pool_cache_service_only on public.pool_cache
  for all
  using (false)
  with check (false);
-- 说明：service_role 绕过 RLS，因此策略写成"全部拒绝"即可；
-- 普通 JWT 与 anon 一律读写不到：缓存里存的是按 key 付费取回的外部数据，泄露等于泄露数据池成本。


-- ============================================================
-- 010 · app_config（管理员「配置中心」的服务端键值表）
-- ============================================================
-- 为什么补这张表：api/admin/[action].ts 的 config get/set/clear 与 api/data/[action].ts
-- 的 resolveProviderSecret 一直在读写 public.app_config，但 001-009 从未建过它 ——
-- 结果是"迁移全跑完，配置中心保存密钥仍然失败"，而缺表提示又指向 all_in_one.sql，形成死循环。
--
-- 口径：
-- - key 用 'key:<provider>' 前缀（sellersprite / xydc / lingxing / sorftime / deepseek）；
-- - value 是密钥明文，所以这张表**只有 service_role 能读写**（前端一律走 /api/admin/*，永不直连）；
-- - 缺失时的降级行为不是崩溃：resolveProviderSecret 会回退环境变量（见 api/data/[action].ts），
--   但管理员就再也无法在界面上换密钥了 —— 所以它是"可选但强烈建议建"的表。

create table if not exists public.app_config (
  key         text primary key,             -- 'key:sellersprite' 这类前缀键
  value       text not null,                -- 配置值（密钥明文；只允许服务端读写）
  updated_at  timestamptz not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists app_config_service_only on public.app_config;
create policy app_config_service_only on public.app_config
  for all
  using (false)
  with check (false);
-- 说明：service_role 绕过 RLS，策略写成"全部拒绝"即可；普通 JWT 与 anon 一律读写不到，
-- 因为这里存的是数据池与 AI 的密钥明文（M5 安全红线：密钥只在服务端）。


-- ============================================================
-- 011 · user_provider_keys（每个用户自己的 MCP 密钥，跟着账号走）
-- ============================================================
-- 为什么必须落库：用户自带 Key（BYO Key，见 §15.26）原先只存在他自己的浏览器 localStorage
-- （amzdev_mcp_settings__<userId> 的 providers[].secretKey）。用户原话：
-- 「我的mcp没有跟着账号走吗，需要跟着账号」——换设备、换浏览器、清一次缓存再登录同一账号，
-- Key 就没了，他只能重新填一遍，还会以为"我填的东西被弄丢了"。
-- 所以密钥的**唯一真相**必须落到这张表：主键 (user_id, provider)，登录后任意设备取到同一份。
--
-- 口径：
-- - provider 取 sellersprite / xydc / lingxing / sorftime / custom（与设置页的数据源一一对应）；
-- - value 是密钥明文，所以这张表**只有 service_role 能读写**：前端一律走 /api/data/*
--   （keyList / keySet / keyClear），永不直连这张表；
-- - user_id 一律取自 JWT（verifyToken 里的 sub），**绝不接受客户端传来的 userId** ——
--   跨账号隔离靠的就是这一条 + 下面的"全部拒绝"策略：只认令牌，不认参数；
-- - 对外只回"配没配 + 指纹"（maskKey：前 3 末 4），任何响应体 / 日志 / 审计详情里都不给明文。

create table if not exists public.user_provider_keys (
  user_id     text not null,                       -- JWT 的 sub（verifyToken 返回的 userId），不是客户端传的
  provider    text not null,                       -- sellersprite / xydc / lingxing / sorftime / custom
  value       text not null,                       -- 密钥明文（只允许服务端读写，永不进浏览器）
  updated_at  timestamptz not null default now(),  -- 最后一次替换的时间（清除是删行，不留空串行）
  primary key (user_id, provider)                   -- 一个用户一个数据源只留一条：换 Key 是 upsert，不是追加
);

alter table public.user_provider_keys enable row level security;

drop policy if exists user_provider_keys_service_only on public.user_provider_keys;
create policy user_provider_keys_service_only on public.user_provider_keys
  for all
  using (false)
  with check (false);
-- 说明：service_role 绕过 RLS，策略写成"全部拒绝"即可；普通 JWT 与 anon 一律读写不到。
-- 跨账号隔离不能靠"前端自觉"：这里存的是别人的密钥，读到一个就等于拿到了别人的数据池额度。

