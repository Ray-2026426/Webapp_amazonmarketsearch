-- 全量迁移（合并 supabase/migrations/001-007）
-- 在 Supabase 网页 SQL Editor 里「一次全选粘贴 → Run」即可。
-- 所有语句都是幂等写法（if not exists / drop policy if exists / create or replace），重复执行也安全。

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
