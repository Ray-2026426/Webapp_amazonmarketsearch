-- Phase 3 团队权限基础：项目成员表 + owner/editor/viewer RLS。
-- 兼容 001_projects.sql：保留 user_id，新增 owner_id，并把历史 user_id 回填为 owner。

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
